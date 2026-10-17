/**
 * Probe: what does a full page reload actually render for a signed-in user?
 * Samples the route and the rendered surface over time so the redirect sequence
 * is visible rather than guessed at.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:3113';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + (process.pid % 90);

let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (v: any) => void>();
let server: ChildProcess | undefined;

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  return new Promise((r) => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev<T = any>(expr: string): Promise<T> {
  const res = await send('Runtime.evaluate', { expression: `(function(){ ${expr} })()`, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) return ('EXCEPTION: ' + (res.exceptionDetails.exception?.description ?? '')) as T;
  return res.result.value as T;
}

async function main(): Promise<void> {
  server = spawn(process.execPath, ['src/web/server.ts'], {
    env: { ...process.env, BF_DATA_DIR: `${process.env.TEMP}\\bf-probe-data`, BF_BOOTSTRAP_SECURITY_ANSWER: 'Lagos', BF_WEB_PORT: '3113' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* wait */ }
    await delay(700);
  }

  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + `${process.env.TEMP}\\chrome-probe-${process.pid}`, 'about:blank'], { stdio: 'ignore' });

  let target: string | undefined;
  for (let i = 0; i < 60 && !target; i += 1) {
    await delay(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as any[];
      target = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* wait */ }
  }
  ws = new WebSocket(target!);
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); } };
  await send('Page.enable'); await send('Runtime.enable');

  const user = `probe_${String(process.pid).slice(-5)}`;
  const gmail = `${user}@gmail.com`;

  await send('Page.navigate', { url: `${BASE}/#/signin` });
  await delay(3000);

  console.log('--- creating account + signing in via the API (cookie lands in the browser) ---');
  const auth = await ev<string>(`
    return (async () => {
      const q = await (await fetch('/api/auth/security-questions')).json();
      const question = q.questions[0];
      const created = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Probe Tester', username: ${JSON.stringify(user)}, gmail: ${JSON.stringify(gmail)}, securityQuestion: question, securityAnswer: 'Answer From Memory' }),
      });
      if (!created.ok) return 'signup failed: ' + created.status + ' ' + (await created.text()).slice(0, 120);
      const login = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gmail: ${JSON.stringify(gmail)}, securityQuestion: question, securityAnswer: 'Answer From Memory' }),
      });
      if (!login.ok) return 'login failed: ' + login.status + ' ' + (await login.text()).slice(0, 120);
      const session = await fetch('/api/auth/session');
      const body = await session.json();
      return 'session account=' + (body.account ? body.account.username : 'null');
    })()
  `);
  console.log('  ' + auth);

  console.log('\n--- cookie actually stored? ---');
  console.log('  ' + await ev<string>(`return document.cookie ? 'visible:' + document.cookie : '(HttpOnly: not visible to JS, expected)'`));

  console.log('\n--- what renders at #/dashboard after a FULL reload, sampled over time ---');
  await send('Page.navigate', { url: `${BASE}/#/dashboard` });
  for (let i = 0; i < 12; i += 1) {
    await delay(500);
    const s = await ev<string>(`
      const root = document.getElementById('root');
      const body = document.body.innerText || '';
      return JSON.stringify({
        hash: location.hash,
        surface: document.querySelector('.topbar') ? 'shell'
              : document.querySelector('.splash-bg') ? 'splash'
              : document.querySelector('.auth-card') ? 'signin'
              : document.querySelector('.auth-wide') ? 'welcome'
              : (root && root.children.length ? 'other' : 'empty'),
        h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 30),
        len: body.replace(/\\s+/g,' ').trim().length,
        text: body.replace(/\\s+/g,' ').trim().slice(0, 60),
      });
    `);
    console.log(`  t+${((i + 1) * 0.5).toFixed(1)}s  ${s}`);
  }

  console.log('\n--- now the same, navigating to #/artifacts (same-document hash change) ---');
  await ev<string>(`location.hash = '#/artifacts'; return 'ok'`);
  await delay(2500);
  console.log('  ' + await ev<string>(`
    return JSON.stringify({
      hash: location.hash,
      shell: !!document.querySelector('.topbar'),
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 30),
      len: (document.body.innerText||'').replace(/\\s+/g,' ').trim().length,
    });
  `));

  chrome.kill(); server.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); server?.kill(); process.exit(1); });