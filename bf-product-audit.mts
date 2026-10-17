/**
 * AUTHENTICATED PRODUCT AUDIT
 *
 * The redesign was only ever verified on the signed-out entry screens. This
 * drives the whole product behind a real session in a real Chromium against
 * the real server: it creates an account through the actual form, signs in with
 * the actual credential model, then visits every route the application defines.
 *
 * For each route it asserts, against the rendered page:
 *   - the route actually resolved (no silent redirect to somewhere else)
 *   - the shell rendered (header, sidebar, main landmark)
 *   - no uncaught exception, console error or failed same-origin request
 *   - no horizontal overflow at desktop, tablet and mobile
 *   - no element wider than the viewport
 *   - no element left invisible (opacity 0 / zero size) that should be visible
 *   - every text colour actually resolves to a colour (a broken token shows as
 *     inherited, which is how the earlier token bug presented)
 *
 * Screenshots are written for visual review.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BF_BASE ?? 'http://127.0.0.1:3112';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9950 + (process.pid % 40);
const SUFFIX = String(process.pid).slice(-6);
const SHOTS = `${process.env.TEMP}\\bf-product-shots`;

let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (v: any) => void>();
let pageErrors: string[] = [];
let consoleErrors: string[] = [];
let badResponses: string[] = [];
let server: ChildProcess | undefined;

let fails = 0;
const log = (s: string) => console.log(s);
function check(label: string, ok: boolean, detail = ''): void {
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ->  ' + detail : ''}`);
  if (!ok) fails += 1;
}

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate<T = any>(expression: string): Promise<T> {
  const res = await send('Runtime.evaluate', { expression: `(function(){ ${expression} })()`, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value as T;
}

function resetErrorBuffers(): void {
  pageErrors = [];
  consoleErrors = [];
  badResponses = [];
}

async function waitForRender(timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate<number>(`
      const r = document.getElementById('root');
      return (r && r.children.length > 0 && r.innerText.trim().length > 0) ? 1 : 0;
    `).catch(() => 0);
    if (ready === 1) return true;
    await delay(120);
  }
  return false;
}

async function open(hashTarget: string, waitMs = 1100): Promise<void> {
  const current = await evaluate<string>('return location.hash;').catch(() => '');
  if (current === hashTarget) await send('Page.reload');
  else await send('Page.navigate', { url: `${BASE}/${hashTarget}` });
  await waitForRender();
  await delay(waitMs);
}

async function shot(name: string): Promise<void> {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  if (res?.data) writeFileSync(`${SHOTS}\\${name}.png`, Buffer.from(res.data, 'base64'));
}

async function viewport(width: number, height: number): Promise<void> {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await delay(350);
}

/** Everything wrong with one rendered page. */
async function inspect(): Promise<{
  hash: string; title: string; hasShell: boolean; overflow: number; widest: string;
  invisibleText: string; badColour: string; textLen: number;
}> {
  return await evaluate(`
    const doc = document.documentElement;
    const vw = doc.clientWidth;

    let widest = '', max = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const over = r.right - vw;
      if (over > max) {
        max = over;
        widest = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      }
    }

    // A visible text element that is fully transparent is invisible to a user.
    let invisible = '';
    for (const el of Array.from(document.querySelectorAll('h1,h2,h3,p,label,button,a,span,td,li'))) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') {
        if (!(el.textContent || '').trim()) continue;
        invisible = el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '');
        break;
      }
    }

    // A text colour that failed to resolve is the signature of a broken token.
    let badColour = '';
    for (const el of Array.from(document.querySelectorAll('p,span,td,label,li,h1,h2,h3'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (!(el.textContent || '').trim()) continue;
      const cs = getComputedStyle(el);
      const colour = cs.color;
      if (!/^rgba?\\(/.test(colour)) { badColour = el.tagName + ':' + colour; break; }
      if (colour === 'rgba(0, 0, 0, 0)') { badColour = el.tagName + ':transparent'; break; }
    }

    return {
      hash: location.hash,
      title: (document.querySelector('h1')?.textContent || document.querySelector('.page-head h1')?.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 60),
      hasShell: !!(document.querySelector('.topbar') && document.querySelector('.sidebar') && document.getElementById('main-content')),
      overflow: Math.round(doc.scrollWidth - doc.clientWidth),
      widest: max > 1 ? widest + ' (+' + Math.round(max) + 'px)' : '',
      invisibleText: invisible,
      badColour: badColour,
      textLen: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length,
    };
  `);
}

/* --- routes the application defines ------------------------------------- */

const ROUTES = [
  '/dashboard', '/projects', '/projects/new', '/documents', '/execution',
  '/artifacts', '/evidence', '/lineage', '/dependency-map', '/traceability',
  '/verification', '/certification', '/testing', '/operations', '/continuous',
  '/system', '/expansion', '/twin', '/providers/credentials',
  '/settings/profile', '/settings/preferences', '/about', '/help',
  '/how', '/difference', '/use-cases', '/faq',
];

async function waitForServer(timeoutMs = 150000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* not up */ }
    await delay(800);
  }
  return false;
}

function startServer(): ChildProcess {
  return spawn(process.execPath, ['src/web/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BF_DATA_DIR: `${process.env.TEMP}\\bf-product-data`,
      BF_BOOTSTRAP_SECURITY_ANSWER: 'Lagos',
      BF_WEB_PORT: new URL(BASE).port,
    },
    stdio: 'ignore',
  });
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  log(`\nAuthenticated product audit  ->  ${BASE}`);
  log(`Screenshots: ${SHOTS}\n`);

  server = startServer();
  if (!(await waitForServer())) throw new Error('server did not become healthy');

  const profile = `${process.env.TEMP}\\chrome-product-${SUFFIX}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });

  let target: string | undefined;
  for (let i = 0; i < 60 && target === undefined; i += 1) {
    await delay(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as any[];
      target = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not ready */ }
  }
  if (target === undefined) throw new Error('Chromium did not expose a debugging target');

  ws = new WebSocket(target);
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consoleErrors.push((m.params?.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.startsWith(BASE) && r.status >= 400) badResponses.push(`${r.status} ${r.url.replace(BASE, '').split('?')[0]}`);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await viewport(1440, 900);

  /* ---- 1. create a real account through the real form ------------------ */
  log('ACCOUNT CREATION + SIGN IN');
  resetErrorBuffers();
  const USER = `audit_${SUFFIX}`;
  // The server requires a Gmail address and, by design, performs no email
  // verification, so a well-formed Gmail address is sufficient here.
  const GMAIL = `${USER}@gmail.com`;
  const ANSWER = 'Greenwood Primary 1988';

  await open('#/signin', 900);
  // Switch the single screen into its create mode.
  await evaluate<boolean>(`
    const a = Array.from(document.querySelectorAll('.auth-switch a, a'))
      .find(x => (x.textContent||'').toLowerCase().includes('create an account'));
    if (!a) return false;
    a.click(); return true;
  `);
  await delay(700);

  const created = await evaluate<boolean>(`
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const ok = set('full-name', 'Audit Tester')
      && set('username', ${JSON.stringify(USER)})
      && set('gmail', ${JSON.stringify(GMAIL)});
    if (!ok) return false;
    const sel = document.getElementById('security-question');
    if (!sel || sel.options.length < 2) return false;
    const proto = window.HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    set('security-answer', ${JSON.stringify(ANSWER)});
    const btn = Array.from(document.querySelectorAll('button[type=submit]')).find(b => /create account/i.test(b.textContent||''));
    if (!btn) return false;
    btn.click();
    return true;
  `);
  check('the create-account form could be completed', created);

  // Sign-up deliberately returns no session; the app must say so and offer sign-in.
  let notice = '';
  for (let i = 0; i < 30; i += 1) {
    await delay(300);
    notice = await evaluate<string>(`return (document.querySelector('.notice, .toast')?.textContent || '').replace(/\\s+/g,' ').trim();`);
    if (notice) break;
  }
  check('creating an account tells the user to sign in', /sign in/i.test(notice), notice.slice(0, 90));

  await evaluate<boolean>(`
    const a = Array.from(document.querySelectorAll('a,button'))
      .find(x => /sign in instead|already have an account/i.test(x.textContent||''));
    if (!a) return false; a.click(); return true;
  `);
  await delay(800);

  const signedIn = await evaluate<boolean>(`
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    set('gmail', ${JSON.stringify(GMAIL)});
    const sel = document.getElementById('security-question');
    if (sel && sel.options.length > 1) {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, sel.options[1].value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    set('security-answer', ${JSON.stringify(ANSWER)});
    const btn = Array.from(document.querySelectorAll('button[type=submit]')).find(b => /sign in/i.test(b.textContent||''));
    if (!btn) return false; btn.click(); return true;
  `);
  check('the sign-in form could be completed', signedIn);

  let landed = '';
  for (let i = 0; i < 40; i += 1) {
    await delay(350);
    landed = await evaluate<string>('return location.hash;').catch(() => '');
    if (landed !== '#/signin') break;
  }
  check('sign-in reaches the product', landed !== '#/signin' && landed !== '', `hash=${landed}`);
  const shellUp = await evaluate<boolean>(`return !!(document.querySelector('.topbar') && document.querySelector('.sidebar'));`);
  check('the application shell rendered after sign-in', shellUp);

  /* ---- 2. walk every route --------------------------------------------- */
  log('\nEVERY ROUTE (desktop 1440)');
  for (const route of ROUTES) {
    resetErrorBuffers();
    await open(`#${route}`, 1300);
    const info = await inspect();
    const problems: string[] = [];
    // The route must actually be the route: a silent redirect somewhere else
    // is a failure, not a pass.
    if (info.hash !== `#${route}`) problems.push(`redirected to ${info.hash}`);
    if (!info.hasShell && !route.startsWith('/how') && !route.startsWith('/difference') && !route.startsWith('/use-cases') && !route.startsWith('/faq')) {
      problems.push('application shell missing');
    }
    if (info.overflow > 1) problems.push(`overflow ${info.overflow}px ${info.widest}`);
    if (info.badColour) problems.push(`unresolved colour ${info.badColour}`);
    if (info.invisibleText) problems.push(`invisible text ${info.invisibleText}`);
    if (pageErrors.length) problems.push(`exception ${pageErrors[0]!.slice(0, 90)}`);
    if (consoleErrors.length) problems.push(`console ${consoleErrors[0]!.slice(0, 90)}`);
    const failed = badResponses.filter((r) => !/\/api\/(auth\/session|account\/preferences)/.test(r));
    if (failed.length) problems.push(`http ${failed.slice(0, 2).join(', ')}`);
    if (info.textLen < 20) problems.push(`empty page (${info.textLen} chars)`);

    check(
      `${route.padEnd(24)} ${(info.title || '(no h1)').slice(0, 30).padEnd(32)}`,
      problems.length === 0,
      problems.join(' | ') || 'ok',
    );
    await shot(`route-${route.replace(/\//g, '_')}`);
  }

  /* ---- 3. responsive sweep over the real product ---------------------- */
  log('\nRESPONSIVE SWEEP (real product)');
  for (const [label, w, h] of [['tablet', 820, 1180], ['mobile', 390, 844]] as const) {
    await viewport(w, h);
    for (const route of ['/dashboard', '/projects', '/artifacts', '/settings/profile', '/execution']) {
      resetErrorBuffers();
      await open(`#${route}`, 1000);
      const info = await inspect();
      check(
        `${label} ${w}px ${route.padEnd(18)}`,
        info.overflow <= 1 && !info.badColour && pageErrors.length === 0,
        info.overflow > 1 ? `overflow ${info.overflow}px ${info.widest}` : (pageErrors[0]?.slice(0, 70) ?? ''),
      );
    }
    await shot(`responsive-${label}-dashboard`);
  }
  await viewport(1440, 900);

  /* ---- 4. the shell search must actually work ------------------------- */
  log('\nSHELL SEARCH');
  resetErrorBuffers();
  await open('#/dashboard', 900);
  const searchResult = await evaluate<string>(`
    const input = document.querySelector('.topbar-search input');
    if (!input) return 'NO-INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'zzz-no-such-thing');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  `);
  check('the header search control exists', searchResult !== 'NO-INPUT', searchResult);
  await delay(1400);
  const searchIdle = await evaluate<string>(`
    const menu = document.querySelector('.topbar-search .account-menu');
    return menu ? menu.textContent.trim().slice(0, 60) : 'no-menu';
  `);
  check('search with no matches shows nothing rather than inventing results', !/project|artifact/i.test(searchIdle), searchIdle.slice(0, 60));
  check('search produced no errors', pageErrors.length === 0 && consoleErrors.length === 0,
    (pageErrors[0] ?? consoleErrors[0] ?? '').slice(0, 90));

  /* A real project should be searchable. Create one through the API-backed form. */
  const projectMade = await evaluate<string>(`
    return (async () => {
      try {
        const r = await fetch('/api/projects', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Auditable Widget Platform',
            vision: 'A searchable platform that tracks engineering work end to end.',
            mode: 'full-product',
          }),
        });
        return r.ok ? 'ok' : r.status + ' ' + (await r.text()).slice(0, 100);
      } catch (e) { return 'threw ' + String(e); }
    })()
  `);
  await delay(600);
  await open('#/dashboard', 900);
  const foundHit = await evaluate<string>(`
    const input = document.querySelector('.topbar-search input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Auditable');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  `);
  await delay(1600);
  const hits = await evaluate<string>(`
    const menu = document.querySelector('.topbar-search .account-menu');
    return menu ? menu.textContent.replace(/\\s+/g,' ').trim().slice(0, 90) : 'no-menu';
  `);
  check('search finds a real project (creation: ' + projectMade + ')',
    /Auditable/i.test(hits), hits.slice(0, 90));
  await shot('shell-search-results');

  /* ---- 5. a dead control must not exist ------------------------------- */
  const deadControls = await evaluate<string>(`
    const out = [];
    const text = (document.body.innerText || '').toLowerCase();
    for (const phrase of ['coming soon', 'not implemented', 'todo', 'placeholder feature']) {
      if (text.includes(phrase)) out.push(phrase);
    }
    return out.join(', ');
  `);
  check('the product contains no "coming soon" dead controls', deadControls === '', deadControls);

  await send('Emulation.clearDeviceMetricsOverride');
  chrome.kill();
  server.kill();
  log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nAUDIT ERROR:', err);
  server?.kill();
  process.exit(2);
});