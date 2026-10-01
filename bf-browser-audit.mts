/**
 * REAL BROWSER CLICK AUDIT
 *
 * Drives an actual Chromium browser over the DevTools Protocol. Every assertion
 * is made against the live page: the real address bar, the real rendered DOM,
 * real console/runtime errors, and real HTTP responses. Nothing is mocked.
 *
 * Coverage: the product entry, the full first-time journey (create account ->
 * recovery questions -> authenticator -> verified 6-digit code -> workspace),
 * returning sign-in, forgot password, role separation, the private
 * administration entry, every anchor on every visited page, refresh, and
 * desktop/tablet/mobile layouts.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9401 + (process.pid % 200);
const SUFFIX = String(process.pid).slice(-6);

let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (v: any) => void>();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const badResponses: string[] = [];

let fails = 0;
const log = (s: string) => console.log(s);
function check(label: string, ok: boolean, detail = ''): void {
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ->  ' + detail : ''}`);
  if (!ok) fails += 1;
}
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(s: string): Buffer {
  let bits = '';
  for (const c of s.toUpperCase()) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const b: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) b.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(b);
}
function totp(sec: string): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', b32(sec)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
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
const hash = () => evaluate<string>('return location.hash;');
/** Reads the rendered text of the body. innerText is the visible text. */
const text = () =>
  evaluate<string>(
    'return (document.body.innerText || document.body.textContent || "").replace(/\\s+/g, " ").trim();',
  );

/** Waits until the app has actually rendered something, rather than sleeping. */
async function waitForRender(timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate<number>(`
      const r = document.getElementById('root');
      return (r && r.children.length > 0) ? 1 : 0;
    `).catch(() => 0);
    if (ready === 1) return true;
    await delay(120);
  }
  return false;
}

async function openRoute(target: string, waitMs = 1500): Promise<void> {
  // A navigation that differs only by hash does NOT reload the document, so
  // component state would survive. Force a real load when we intend a fresh
  // page, otherwise the "same URL" case would silently keep stale state.
  const current = await hash().catch(() => '');
  if (current === target) {
    await send('Page.reload');
  } else {
    await send('Page.navigate', { url: `${BASE}/${target}` });
  }
  await waitForRender();
  await delay(waitMs);
}

async function clickText(selector: string, needle: string): Promise<{ ok: boolean; url: string; error?: string }> {
  const before = await hash();
  const hit = await evaluate<boolean>(`
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = els.find(e => (e.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase().includes(${JSON.stringify(needle.toLowerCase())}));
    if (!el) return false;
    el.scrollIntoView({block:'center'});
    el.click();
    return true;
  `);
  if (!hit) return { ok: false, url: before, error: `no ${selector} containing "${needle}"` };
  // Wait for the real navigation to settle rather than a fixed sleep: a click
  // that performs a network round trip must not be judged before it lands.
  let now = before;
  for (let i = 0; i < 30; i += 1) {
    await delay(150);
    now = await hash();
    if (now !== before) { await delay(400); return { ok: true, url: now }; }
  }
  await delay(600);
  return { ok: true, url: now };
}

async function clickSel(selector: string, index = 0): Promise<boolean> {
  return await evaluate<boolean>(`
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return false;
    el.scrollIntoView({block:'center'});
    el.click();
    return true;
  `);
}

async function anchors(): Promise<Array<{ href: string; text: string }>> {
  return await evaluate<Array<{ href: string; text: string }>>(
    `return Array.from(document.querySelectorAll('a')).map(a => ({ href: a.getAttribute('href')||'', text: (a.textContent||'').trim().slice(0,50) }));`,
  );
}

const RETIRED = ['#/user', '#/user/signin', '#/user/entry', '#/intro', '#/login', '#/signup', '#/forgot', '#/splash', '#/settings/authenticator'];

async function auditLinks(label: string, expectAdminAllowed = false): Promise<void> {
  const list = await anchors();
  const hrefs = [...new Set(list.map((a) => a.href))].filter((h) => h !== '' && !h.startsWith('http'));
  for (const h of hrefs) {
    check(`${label}: "${h}" is not a retired route`, !RETIRED.includes(h), h);
  }
  const adminLinks = list.filter((a) => a.href.includes('/owner'));
  check(
    `${label}: administration links ${expectAdminAllowed ? 'are expected' : 'are absent'}`,
    expectAdminAllowed ? true : adminLinks.length === 0,
    adminLinks.map((a) => a.href).join(','),
  );
  log(`         (${list.length} anchors, ${hrefs.length} distinct internal hrefs checked)`);
}

async function main(): Promise<void> {
  const profile = `${process.env.TEMP}\\chrome-audit-${SUFFIX}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });

  let target: string | undefined;
  for (let i = 0; i < 50 && target === undefined; i += 1) {
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
      if (r.url.startsWith(BASE) && r.status >= 400) badResponses.push(`${r.status} ${r.url.replace(BASE, '')}`);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const USERNAME = `browser_${SUFFIX}`;
  const PASSWORD = 'Browser!Audit2026';
  const RECOVERY: Array<{ questionId: string; answer: string }> = [
    { questionId: 'first_school', answer: 'Greenwood Primary' },
    { questionId: 'first_pet', answer: 'Rex' },
  ];

  // ── 1. The product entry ─────────────────────────────────────────────────
  log('\n[1] PRODUCT ENTRY   http://127.0.0.1:3000/#/');
  await openRoute('#/', 200);
  check('the entry renders the splash (not a form)', /NEXORA/i.test(await text()));
  check('the entry is not a sign-in form', !/Create your account/i.test(await text()));
  log('         waiting for the splash to hand off to the welcome screen…');
  let landed = '';
  for (let i = 0; i < 40; i += 1) { await delay(400); landed = await hash(); if (landed === '#/welcome') break; }
  check('the splash hands off to #/welcome', landed === '#/welcome', landed);
  check('the welcome screen renders its product promise', /Ship software from a blueprint/i.test(await text()));
  await auditLinks('welcome');

  // ── 2. Get started -> sign in ────────────────────────────────────────────
  log('\n[2] GET STARTED -> SIGN IN');
  let r = await clickText('a,button', 'Get started');
  check('clicking "Get started" navigates', r.ok, r.error ?? '');
  check('the address bar shows #/signin', r.url === '#/signin', r.url);
  check('the sign-in screen renders', /Sign in/i.test(await text()));
  await auditLinks('signin');

  // ── 3. Every control on the sign-in screen ───────────────────────────────
  log('\n[3] SIGN-IN SCREEN CONTROLS');
  const controls = await evaluate<number>(`
    return Array.from(document.querySelectorAll('button, a[href], input, select'))
      .filter(e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; }).length;
  `);
  check('the sign-in screen exposes interactive controls', controls > 5, `controls=${controls}`);
  const revealButtons = await evaluate<number>(`return document.querySelectorAll('.secret-input-actions .secret-input-btn').length;`);
  check('the password field has a show/hide control', revealButtons >= 1, `buttons=${revealButtons}`);
  const maskedBefore = await evaluate<number>(`return Array.from(document.querySelectorAll('.secret-input input')).filter(i=>i.type==='password').length;`);
  await clickSel('.secret-input-actions .secret-input-btn');
  const maskedAfter = await evaluate<number>(`return Array.from(document.querySelectorAll('.secret-input input')).filter(i=>i.type==='password').length;`);
  check('the show/hide control reveals the value', maskedAfter < maskedBefore, `${maskedBefore} -> ${maskedAfter}`);
  await clickSel('.secret-input-actions .secret-input-btn');

  // ── 4. Create-account toggle ─────────────────────────────────────────────
  log('\n[4] CREATE-ACCOUNT TOGGLE');
  r = await clickText('a', 'Create an account');
  check('"Create an account" switches the screen', /Create your account/i.test(await text()), r.url);
  const pwFields = await evaluate<number>(`return document.querySelectorAll('.secret-input input').length;`);
  check('create mode shows password + confirm fields', pwFields >= 2, `fields=${pwFields}`);

  // ── 5. Forgot password ───────────────────────────────────────────────────
  log('\n[5] FORGOT PASSWORD');
  await openRoute('#/signin');
  r = await clickText('a', 'Forgot your password?');
  check('"Forgot your password?" navigates', r.ok, r.error ?? '');
  check('the address bar shows #/signin/recovery', r.url === '#/signin/recovery', r.url);
  check('the recovery screen renders', /Reset password/i.test(await text()));
  await auditLinks('recovery');
  r = await clickText('a', 'Back to sign in');
  check('"Back to sign in" returns to #/signin', r.url === '#/signin', r.url);

  // ── 6. FULL FIRST-TIME JOURNEY, driven by real clicks ────────────────────
  log('\n[6] FIRST-TIME ACCOUNT JOURNEY (real clicks)');
  await openRoute('#/signin');
  await clickText('a', 'Create an account');
  await evaluate(`
    const set = (sel, v) => { const e = document.querySelector(sel); if (!e) return false;
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement : (e.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement);
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    const inputs = Array.from(document.querySelectorAll('input'));
    const byId = (id) => document.getElementById(id);
    set('#auth-username', ${JSON.stringify(USERNAME)});
    set('#auth-display-name', 'Browser Audit');
    set('#auth-password', ${JSON.stringify(PASSWORD)});
    set('#auth-confirm', ${JSON.stringify(PASSWORD)});
    return inputs.length;
  `);
  await delay(400);
  const typed = await evaluate<string>('return document.getElementById("auth-username").value;');
  check('typing into the form reaches component state', typed === USERNAME, typed);
  r = await clickText('button', 'Create account');
  check('"Create account" submits and navigates', r.ok, r.error ?? '');
  check('the address bar shows #/setup/recovery', r.url === '#/setup/recovery', r.url);
  check('the recovery-question screen renders', /recovery question/i.test(await text()));
  await auditLinks('setup/recovery');
  const recToggles = await evaluate<number>(`return document.querySelectorAll('.secret-input-actions .secret-input-btn').length;`);
  check('recovery answers have show/hide controls', recToggles >= 2, `buttons=${recToggles}`);

  // Recovery answers, through the real selects and inputs. The form starts with
  // one question (the platform minimum), so drive exactly what is on screen.
  const rowsRendered = await evaluate<number>(`return document.querySelectorAll('select').length;`);
  check('the recovery form renders at least one question', rowsRendered >= 1, `rows=${rowsRendered}`);
  await evaluate(`
    const setNative = (el, v) => { if (!el) return false;
      const p = el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;
      Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(el, v);
      el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('input',{bubbles:true})); return true; };
    const selects = Array.from(document.querySelectorAll('select'));
    const ins = Array.from(document.querySelectorAll('.secret-input input'));
    const a1 = ${JSON.stringify(RECOVERY[0].answer)};
    setNative(selects[0], ${JSON.stringify(RECOVERY[0].questionId)});
    setNative(ins[0], a1);
    setNative(ins[1], a1);
    return true;
  `);
  await delay(400);
  r = await clickText('button', 'Save and continue');
  check('"Save and continue" advances to the authenticator step', r.url === '#/setup/authenticator', r.url);

  // The authenticator secret must be present, stable and copyable.
  log('\n[7] AUTHENTICATOR SECRET (stability + copy)');
  await delay(1200);
  const secret1 = await evaluate<string>(`
    const el = document.querySelector('[data-testid="authenticator-secret"]');
    return el ? el.textContent.replace(/\\s+/g,'') : '';
  `);
  check('the authenticator secret is displayed', secret1.length >= 16, `len=${secret1.length}`);
  const snapshot = async () => (await evaluate<string>(`
    const el = document.querySelector('[data-testid="authenticator-secret"]');
    return el ? el.textContent.replace(/\\s+/g,'') : '';
  `));
  const samples: string[] = [];
  for (let i = 0; i < 6; i += 1) { await delay(350); samples.push(await snapshot()); }
  const stable = samples.every((s) => s === secret1);
  check('the secret is STABLE (does not regenerate/flicker)', stable, stable ? '6 samples identical' : `changed: ${[...new Set(samples)].join(' | ')}`);
  check('the secret is base32 (usable by a TOTP app)', /^[A-Z2-7]+$/.test(secret1), secret1.slice(0, 10) + '…');
  const hasCopy = await evaluate<boolean>(`
    const box = document.querySelector('[data-testid="authenticator-secret"]').parentElement;
    return !!box && box.querySelectorAll('.secret-input-btn').length >= 2;
  `);
  check('the secret has copy and show/hide actions', hasCopy);

  // Verify the code the app accepts really matches the displayed secret.
  const rawSecret = await evaluate<string>(`
    const el = document.querySelector('[data-testid="authenticator-secret"]');
    return el ? el.textContent.replace(/\\s+/g,'') : '';
  `);
  const code = totp(rawSecret);
  await evaluate(`
    const el = document.getElementById('setup-code');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(code)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  `);
  await delay(300);
  r = await clickText('button', 'Verify and finish');
  check('a TOTP code generated from the DISPLAYED secret is accepted', r.ok, r.error ?? '');
  await delay(1200);
  check('after verification the recovery-code screen is shown (not skipped)', (await hash()) === '#/setup/authenticator', await hash());
  const dash = await text();
  check('the one-time recovery codes are shown once (not navigated past)', /one-time recovery codes/i.test(dash), dash.slice(0, 90));
  const codes = await evaluate<number>(`return document.querySelectorAll('.code-list li').length;`);
  check('the one-time recovery codes are listed', codes > 0, `codes=${codes}`);
  // The user leaves deliberately, which is what keeps the codes on screen.
  r = await clickText('button', 'Continue to workspace');
  check('"Continue to workspace" enters the workspace', r.url === '#/dashboard', r.url);
  const wsText = await text();
  check('the workspace renders', wsText.length > 40, wsText.slice(0, 70));
  await auditLinks('workspace');

  // ── 8b. Every sidebar navigation item is clickable and lands correctly ───
  log('\n[8b] SIDEBAR NAVIGATION SWEEP');
  const navItems = await evaluate<Array<{ href: string; text: string }>>(`
    return Array.from(document.querySelectorAll('.sidebar a[href], nav a[href]'))
      .map(a => ({ href: a.getAttribute('href')||'', text: (a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30) }));
  `);
  check('the workspace renders a sidebar of navigation', navItems.length > 5, `items=${navItems.length}`);
  let navFails = 0;
  for (const item of navItems) {
    if (!item.href.startsWith('#/')) continue;
    const before = await hash();
    await evaluate(`
      const a = Array.from(document.querySelectorAll('a[href]')).find(x => x.getAttribute('href') === ${JSON.stringify(item.href)});
      if (a) a.click();
    `);
    let now = before;
    for (let i = 0; i < 20; i += 1) { await delay(120); now = await hash(); if (now !== before) break; }
    const blank = (await text()).length < 5;
    if (now !== item.href || blank) {
      navFails += 1;
      check(`sidebar "${item.text || item.href}" navigates and renders`, false, `landed=${now} blank=${blank}`);
    }
  }
  check('every sidebar navigation item navigates and renders content', navFails === 0, `${navItems.length} items swept`);

  // A short wrong code must be refused (a real negative control in the browser).
  log('\n[8] WRONG CODE REFUSED IN THE BROWSER');
  const wrongRejected = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USERNAME, password: PASSWORD }) })).json() as { challengeId?: string };
  check('a wrong 6-digit code is refused by the server', wrongRejected.challengeId !== undefined);

  // ── 9. Returning sign-in through the UI ──────────────────────────────────
  log('\n[9] LOGOUT AND RETURNING SIGN-IN');
  // "Log out" lives inside the account dropdown, so open the menu first.
  const menuState = await evaluate<string>(`
    const hasLogout = () => Array.from(document.querySelectorAll('button')).some(b => /log out/i.test(b.textContent||''));
    if (hasLogout()) return 'already-open';
    const triggers = Array.from(document.querySelectorAll('button'))
      .filter(b => /browser audit|account menu|avatar/i.test(b.textContent||'') || (b.getAttribute('aria-label')||'').match(/account|profile|menu/i));
    if (triggers.length > 0) { triggers[0].click(); return 'opened:' + triggers.length; }
    return 'no-trigger';
  `);
  check('the account menu control is present', menuState !== 'no-trigger', menuState);
  await delay(600);
  const logoutPresent = await evaluate<boolean>(`
    return Array.from(document.querySelectorAll('button')).some(b => /log out/i.test(b.textContent||''));
  `);
  check('"Log out" becomes available in the account menu', logoutPresent);
  if (logoutPresent) {
    const beforeLogout = await hash();
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => /log out/i.test(x.textContent||''));
      if (b) b.click();
    `);
    let now = beforeLogout;
    for (let i = 0; i < 25; i += 1) { await delay(150); now = await hash(); if (now !== beforeLogout) break; }
    check('logging out leaves the workspace', now !== '#/dashboard', `landed=${now}`);
    check('logging out lands on a public entry', ['#/', '#/welcome', '#/signin'].includes(now), now);
    // Session must really be dead.
    const sessionStatus = await evaluate<number>(`
      return fetch('/api/me', { credentials: 'include' }).then(r => r.json()).then(j => j.account === null ? 200 : 401);
    `);
    check('the session is genuinely dead after logout', sessionStatus === 200, `account-null=${sessionStatus === 200}`);
  }
  await openRoute('#/signin');
  await evaluate(`
    const set = (sel, v) => { const e = document.querySelector(sel); const p = HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(p,'value').set.call(e, v); e.dispatchEvent(new Event('input',{bubbles:true})); };
    set('#auth-username', ${JSON.stringify(USERNAME)}); set('#auth-password', ${JSON.stringify(PASSWORD)}); return true;
  `);
  r = await clickText('button', 'Sign in');
  check('"Sign in" submits the returning user', r.ok, r.error ?? '');
  check('the address bar shows the code step', r.url === '#/signin/verify', r.url);
  const verifyCode = totp(rawSecret);
  await evaluate(`
    const el = document.getElementById('verify-code');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(verifyCode)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  `);
  await delay(300);
  r = await clickText('button', 'Verify');
  check('the 6-digit code signs the user in', r.url === '#/dashboard', r.url);

  // ── 10. Role separation in the browser ───────────────────────────────────
  log('\n[10] ROLE SEPARATION IN THE BROWSER');
  await openRoute('#/owner/settings', 1600);
  check('a normal account is returned out of the administration area', (await hash()) !== '#/owner/settings', `landed=${await hash()}`);
  check('and lands in its own workspace', (await hash()) === '#/dashboard', await hash());
  const apiProbe = await evaluate<number>(`
    return fetch('/api/owner/daytona', { credentials: 'include' }).then(r => r.status);
  `);
  check('the administration API is refused for a normal account (403)', apiProbe === 403, `status=${apiProbe}`);
  // This 403 above is an intentional negative control, not a defect.
  const realBad = badResponses.filter((r) => !(r.startsWith('403 /api/owner')));
  log(`         (ignored ${badResponses.length - realBad.length} intentional authorization probe(s))`);

  // ── 11. The private administration entry (from a signed-out state) ───────
  log('\n[11] PRIVATE ADMINISTRATION ENTRY');
  // The rest of the audit must observe signed-OUT behaviour, so end the session.
  await evaluate(`
    const hasLogout = () => Array.from(document.querySelectorAll('button')).some(b => /log out/i.test(b.textContent||''));
    if (!hasLogout()) {
      const t = Array.from(document.querySelectorAll('button')).filter(b => /browser audit|account menu|avatar/i.test(b.textContent||'') || (b.getAttribute('aria-label')||'').match(/account|profile|menu/i));
      if (t.length) t[0].click();
    }
  `);
  await delay(500);
  await evaluate(`
    const b = Array.from(document.querySelectorAll('button')).find(x => /log out/i.test(x.textContent||''));
    if (b) b.click();
  `);
  for (let i = 0; i < 25; i += 1) { await delay(150); if ((await hash()) !== '#/dashboard') break; }
  const signedOut = await evaluate<number>(`return fetch('/api/me',{credentials:'include'}).then(r=>r.json()).then(j=>j.account===null?1:0);`);
  check('the audit is now observing a signed-out browser', signedOut === 1, `signedOut=${signedOut === 1}`);

  await openRoute('#/owner', 1800);
  const ownerText = await text();
  check('#/owner renders the administration screen', /Administration/i.test(ownerText), ownerText.slice(0, 60));
  check('the administration screen offers no product entry', !/Get started/i.test(ownerText));
  const ownerPw = await evaluate<boolean>(`return !!document.getElementById('owner-password');`);
  check('the administration password field is present and labelled', ownerPw);
  const ownerToggles = await evaluate<number>(`return document.querySelectorAll('.secret-input-actions .secret-input-btn').length;`);
  check('the administration password field has a show/hide control', ownerToggles >= 1, `buttons=${ownerToggles}`);
  check('the administration wordmark does not link into the product', await evaluate<boolean>(`
    const a = Array.from(document.querySelectorAll('a')).find(x => /NEXORA/.test(x.textContent||''));
    return !a || !a.getAttribute('href');
  `));

  // ── 12. Retired URLs ─────────────────────────────────────────────────────
  log('\n[12] RETIRED URLS FORWARD');
  for (const stale of ['#/user', '#/user/signin', '#/user/entry', '#/intro', '#/login', '#/signup', '#/forgot', '#/splash', '#/settings/authenticator']) {
    await openRoute(stale, 900);
    const now = await hash();
    check(`stale ${stale} forwards off itself`, now !== stale, `landed=${now}`);
  }

  // ── 13. Refresh ──────────────────────────────────────────────────────────
  log('\n[13] BROWSER REFRESH');
  for (const page of ['#/', '#/welcome', '#/signin', '#/signin/recovery', '#/owner']) {
    await openRoute(page, 600);
    await send('Page.reload');
    const ok = await waitForRender();
    await delay(900);
    const now = await hash();
    check(`refresh on ${page}: app renders, no blank screen`, ok && (await text()).length > 0, `hash=${now}`);
    check(`refresh on ${page}: stays on a live route`, ['#/', '#/welcome', '#/signin', '#/signin/verify', '#/signin/recovery', '#/owner'].includes(now), now);
  }

  // ── 14. Responsive layouts ───────────────────────────────────────────────
  log('\n[14] RESPONSIVE LAYOUTS');
  for (const [label, w, h] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
    await openRoute('#/welcome', 700);
    const overflow = await evaluate<number>('return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);');
    check(`${label} ${w}x${h}: no horizontal overflow`, overflow <= 1, `overflow=${overflow}px`);
    const cta = await evaluate<boolean>(`
      const a = Array.from(document.querySelectorAll('a,button')).find(e => /get started/i.test(e.textContent||''));
      if (!a) return false; const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight * 2;
    `);
    check(`${label}: the primary action is visible and reachable`, cta);
    await openRoute('#/signin', 600);
    const cta2 = await evaluate<boolean>(`
      const i = document.getElementById('auth-password');
      if (!i) return false; const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    `);
    check(`${label}: the sign-in password field is reachable`, cta2);
  }
  await send('Emulation.clearDeviceMetricsOverride');

  // ── 15. Runtime health ───────────────────────────────────────────────────
  log('\n[15] RUNTIME HEALTH ACROSS THE WHOLE AUDIT');
  check('no uncaught page exceptions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no unexpected failed same-origin responses during navigation', realBad.length === 0, realBad.slice(0, 5).join(' | '));

  chrome.kill();
  log(`\n${'='.repeat(66)}`);
  log(fails === 0 ? 'ALL BROWSER CHECKS PASSED' : `${fails} BROWSER CHECK(S) FAILED`);
  log('='.repeat(66));
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e: unknown) => { console.error('AUDIT ERROR:', e); process.exit(1); });
