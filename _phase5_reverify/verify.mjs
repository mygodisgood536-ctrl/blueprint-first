import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { buildServer } from '../src/web/server.ts';
import { runDemoPipeline } from '../src/demo/main.ts';
import { consoleSink, createLogger } from '../src/core/logging.ts';

let pass = 0, fail = 0;
const failures = [];
let BASE = '';
const store = {};

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
async function j(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json, cookie: res.headers.get('set-cookie') };
}
function cookieFrom(sc) { return sc ? sc.split(';')[0] : null; }
function account(name) { return { username: name, password: 'Password1!', displayName: name.toUpperCase() }; }
async function signupAndLogin(name) {
  const a = account(name);
  await j('POST', '/api/auth/signup', a);
  const li = await j('POST', '/api/auth/login', { username: a.username, password: a.password });
  const cookie = cookieFrom(li.cookie);
  const me = await j('GET', '/api/me', null, cookie);
  return { cookie, account: me.body.account, status: li.status };
}
async function bootServer(dataDir) {
  const logger = createLogger({ level: 'warn', sink: consoleSink() });
  const result = await runDemoPipeline(logger);
  const pm = new ProviderManager();
  const { app } = await buildServer({ result, providerManager: pm, dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  BASE = `http://127.0.0.1:${addr.port}`;
  return server;
}
function finish() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log('  • ' + f)); }
  process.exit(fail ? 1 : 0);
}

async function testAuthLifecycle() {
  console.log('\n— Authentication lifecycle —');
  const A = await signupAndLogin('alice_p5');
  ok('A signup -> session', A.status === 200 && A.cookie && A.account?.username === 'alice_p5', JSON.stringify(A.body));
  ok('A /api/me real identity', A.account?.username === 'alice_p5' && !!A.account?.createdAt);
  const A2 = await j('GET', '/api/me', null, A.cookie);
  ok('A session persists across requests', A2.body.account?.username === 'alice_p5');
  const lo = await j('POST', '/api/auth/logout', null, A.cookie);
  ok('logout 204', lo.status === 204);
  const afterLogout = await j('GET', '/api/me', null, A.cookie);
  ok('after logout session gone', afterLogout.body.account === null);
  const Arelogin = await signupAndLogin('alice_p5');
  ok('login again establishes session', Arelogin.status === 200 && !!Arelogin.cookie);
  A.cookie = Arelogin.cookie;
  store.A = A;
}

async function testAccountIsolation() {
  console.log('\n— Account isolation —');
  const A = store.A;
  const B = await signupAndLogin('bob_p5');
  store.B = B;
  ok('B independent session', B.cookie && B.account?.username === 'bob_p5');
  const aPref = await j('POST', '/api/account/preferences', { theme: 'dark' }, A.cookie);
  ok('A sets preference 200', aPref.status === 200);
  const bPref = await j('GET', '/api/account/preferences', null, B.cookie);
  ok('B cannot see A preferences', bPref.status === 200 && Object.keys(bPref.body.preferences ?? {}).length === 0, JSON.stringify(bPref.body));
  const aProj = await j('POST', '/api/projects', { name: 'Alpha Project', vision: 'A vision for alpha that is long enough to pass validation' }, A.cookie);
  ok('A creates project 201', aProj.status === 201, JSON.stringify(aProj.body));
  const bProjects = await j('GET', '/api/projects', null, B.cookie);
  ok('B cannot see A projects', bProjects.status === 200 && (bProjects.body.projects ?? []).length === 0, JSON.stringify(bProjects.body));
  const aProjId = aProj.body.project?.id;
  const bAccessA = await j('GET', `/api/projects/${aProjId}`, null, B.cookie);
  ok('B forbidden from A project', bAccessA.status === 404, `status=${bAccessA.status}`);
  const unauth = await j('GET', '/api/projects', null, null);
  ok('unauthenticated /api/projects -> 401', unauth.status === 401);
}
async function testPreferences() {
  console.log('\n— Preferences lifecycle —');
  const A = store.A;
  const p1 = await j('POST', '/api/account/preferences', { theme: 'dark', fontSize: 14 }, A.cookie);
  ok('POST preferences 200', p1.status === 200 && p1.body.preferences?.theme === 'dark', JSON.stringify(p1.body));
  const g1 = await j('GET', '/api/account/preferences', null, A.cookie);
  ok('GET reflects saved', g1.body.preferences?.theme === 'dark' && g1.body.preferences?.fontSize === 14);
  const badKey = await j('POST', '/api/account/preferences', { '1bad': 'x' }, A.cookie);
  ok('invalid key rejected with 400', badKey.status === 400, JSON.stringify(badKey.body));
  const badVal = await j('POST', '/api/account/preferences', { obj: { nested: 1 } }, A.cookie);
  ok('non-scalar value dropped', badVal.status === 200, JSON.stringify(badVal.body));
  const emptyPost = await j('POST', '/api/account/preferences', {}, A.cookie);
  ok('empty POST ok', emptyPost.status === 200);
}

async function testActivity() {
  console.log('\n— Activity —');
  const A = store.A;
  const B = store.B;
  const actEmpty = await j('GET', '/api/activity', null, B.cookie);
  ok('B activity empty (no projects)', actEmpty.status === 200 && Array.isArray(actEmpty.body.activity) && actEmpty.body.activity.length === 0, JSON.stringify(actEmpty.body));
  const actA = await j('GET', '/api/activity', null, A.cookie);
  ok('A activity returns array', actA.status === 200 && Array.isArray(actA.body.activity), JSON.stringify(actA.body));
  ok('A activity shows project', actA.body.activity.some((x) => x.type === 'project' && x.title === 'Alpha Project'), JSON.stringify(actA.body.activity));
  const aActCount = actA.body.activity.length;
  const bAct = await j('GET', '/api/activity', null, B.cookie);
  ok('B cannot see A activity', bAct.body.activity.length === 0 && aActCount > 0);
}

async function testDashboardEndpoints() {
  console.log('\n— Dashboard endpoints —');
  const A = store.A;
  const sel = await j('GET', '/api/models/selection', null, A.cookie);
  ok('GET /api/models/selection 200', sel.status === 200, JSON.stringify(sel.body));
  const creds = await j('GET', '/api/credentials', null, A.cookie);
  ok('GET /api/credentials 200', creds.status === 200 && Array.isArray(creds.body.credentials), JSON.stringify(creds.body));
  const me = await j('GET', '/api/me', null, A.cookie);
  ok('GET /api/me 200', me.status === 200 && me.body.account?.username === 'alice_p5');
}

async function testProfile() {
  console.log('\n— Profile —');
  const A = store.A;
  const prof = await j('POST', '/api/account/profile', { displayName: 'Alice Renamed' }, A.cookie);
  ok('update profile 200', prof.status === 200 && prof.body.account?.displayName === 'Alice Renamed', JSON.stringify(prof.body));
  const meAfter = await j('GET', '/api/me', null, A.cookie);
  ok('profile change reflected in /api/me', meAfter.body.account?.displayName === 'Alice Renamed');
}

async function testRestartPersistence() {
  console.log('\n— Persistence across restart —');
  const dataDir = mkdtempSync(join(tmpdir(), 'nexona-p5r-'));
  const server = await bootServer(dataDir);
  const dave = await signupAndLogin('dave_p5');
  ok('signup after restart', dave.status === 200 && !!dave.cookie);
  const cp = await j('POST', '/api/account/preferences', { lang: 'en' }, dave.cookie);
  ok('set pref after restart', cp.status === 200);
  const cg = await j('GET', '/api/account/preferences', null, dave.cookie);
  ok('pref persists after restart', cg.body.preferences?.lang === 'en', JSON.stringify(cg.body));
  const cproj = await j('POST', '/api/projects', { name: 'Persist Project', vision: 'A vision that is long enough to pass the validation check' }, dave.cookie);
  ok('project persists across restart', cproj.status === 201, JSON.stringify(cproj.body));
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
}

async function run() {
  const dataDir = mkdtempSync(join(tmpdir(), 'nexona-p5-'));
  console.log('Data dir:', dataDir);
  const server = await bootServer(dataDir);
  await testAuthLifecycle();
  await testAccountIsolation();
  await testPreferences();
  await testActivity();
  await testDashboardEndpoints();
  await testProfile();
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  await testRestartPersistence();
  finish();
}

run().catch((e) => { console.error(e); process.exit(2); });
