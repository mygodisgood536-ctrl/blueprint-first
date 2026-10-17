/**
 * Isolates the session lifecycle at the HTTP level: no browser, no bundler.
 * Prints the raw Set-Cookie header and then re-requests the session with and
 * without the returned cookie, so it is unambiguous whether the fault is on the
 * server or in the browser.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:3114';
let server: ChildProcess | undefined;

async function main(): Promise<void> {
  server = spawn(process.execPath, ['src/web/server.ts'], {
    env: {
      ...process.env,
      BF_DATA_DIR: `${process.env.TEMP}\\bf-session-probe`,
      BF_BOOTSTRAP_SECURITY_ANSWER: 'Lagos',
      BF_WEB_PORT: '3114',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* wait */ }
    await delay(700);
  }

  const gmail = `sessionprobe_${String(process.pid).slice(-5)}@gmail.com`;
  const answer = 'Answer From Memory';

  const questions = await (await fetch(`${BASE}/api/auth/security-questions`)).json() as { questions: string[] };
  const question = questions.questions[0]!;
  console.log('security questions:', questions.questions.length);

  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Session Probe', username: `sp_${String(process.pid).slice(-5)}`, gmail, securityQuestion: question, securityAnswer: answer }),
  });
  console.log('signup:', signup.status);
  if (!signup.ok) console.log('  body:', (await signup.text()).slice(0, 200));

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gmail, securityQuestion: question, securityAnswer: answer }),
  });
  console.log('login:', login.status);
  const setCookie = login.headers.get('set-cookie');
  console.log('  set-cookie:', setCookie === null ? '(ABSENT)' : setCookie);
  if (!login.ok) console.log('  body:', (await login.text()).slice(0, 200));

  // Follow-up with the cookie exactly as the server sent it.
  const cookieHeader = (setCookie ?? '').split(';')[0]!.trim();
  console.log('  cookie pair:', cookieHeader === '' ? '(none)' : cookieHeader.slice(0, 24) + '...');

  const withCookie = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookieHeader } });
  const withBody = await withCookie.json() as { account: unknown };
  console.log('session WITH cookie:', withCookie.status, 'account =', withBody.account ? 'present' : 'null');

  const without = await fetch(`${BASE}/api/auth/session`);
  const withoutBody = await without.json() as { account: unknown };
  console.log('session WITHOUT cookie:', without.status, 'account =', withoutBody.account ? 'present' : 'null');

  // And an authenticated endpoint, to prove the token is honoured.
  const projects = await fetch(`${BASE}/api/projects`, { headers: { cookie: cookieHeader } });
  console.log('GET /api/projects with cookie:', projects.status);
  const projectsAnon = await fetch(`${BASE}/api/projects`);
  console.log('GET /api/projects without cookie:', projectsAnon.status);

  // What a browser would do: fetch() from the page keeps cookies automatically.
  console.log('\n-- durable file after sign-in --');
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(`${process.env.TEMP}\\bf-session-probe\\identity.json`, 'utf8');
  const parsed = JSON.parse(raw) as { sessions?: unknown };
  const sessions = parsed.sessions;
  console.log('  sessions stored:', Array.isArray(sessions) ? sessions.length : typeof sessions);
  if (Array.isArray(sessions)) {
    for (const s of sessions.slice(0, 3)) {
      const rec = s as Record<string, unknown>;
      console.log('   ', JSON.stringify({ accountId: rec['accountId'], expiresAt: rec['expiresAt'], token: String(rec['token']).slice(0, 12) + '...' }));
    }
  }

  // A token must stop working the moment it is signed out.
  const beforeLogout = await fetch(`${BASE}/api/projects`, { headers: { cookie: cookieHeader } });
  const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader } });
  const afterLogout = await fetch(`${BASE}/api/projects`, { headers: { cookie: cookieHeader } });
  const sessionAfter = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookieHeader } });
  const sessionAfterBody = await sessionAfter.json() as { account: unknown };
  console.log('\n-- sign-out must revoke the token server-side --');
  console.log('  /api/projects before logout:', beforeLogout.status, '(expect 200)');
  console.log('  POST /api/auth/logout     :', logout.status);
  console.log('  /api/projects after logout :', afterLogout.status, '(expect 401)');
  console.log('  session after logout       : account =', sessionAfterBody.account ? 'PRESENT (BUG)' : 'null (correct)');

  server.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); server?.kill(); process.exit(1); });