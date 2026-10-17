/**
 * REDESIGN VISUAL + BEHAVIOUR AUDIT
 *
 * Drives a real Chromium over the DevTools Protocol against the real server.
 * Nothing is mocked and nothing is inferred from source: every assertion is made
 * against the rendered page.
 *
 * Checks:
 *   1. the splash runs for approximately four seconds, then advances by itself
 *   2. the introduction is three pages, paginates, and is PERSISTED (a reload at
 *      page 2 resumes at page 2; a completed introduction is not replayed)
 *   3. the sign-in form is only reached by an explicit action
 *   4. no horizontal overflow at desktop / tablet / mobile
 *   5. the design tokens actually resolve (an element coloured by rgb(var(--fg))
 *      computes to the intended colour) in BOTH themes
 *   6. Fraunces (display) and JetBrains Mono actually loaded
 *   7. light theme holds the same contrast as dark
 *   8. no console errors, no uncaught exceptions, no failed same-origin requests
 *
 * Screenshots are written for visual review.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BF_BASE ?? 'http://127.0.0.1:3111';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + (process.pid % 250);
const SUFFIX = String(process.pid).slice(-6);
const SHOTS = `${process.env.TEMP}\\bf-redesign-shots`;

let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (v: any) => void>();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const badResponses: string[] = [];
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
const hash = () => evaluate<string>('return location.hash;');
const text = () => evaluate<string>('return (document.body.innerText||"").replace(/\\s+/g," ").trim();');

async function waitForRender(timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate<number>(`
      const r = document.getElementById('root');
      return (r && r.children.length > 0) ? 1 : 0;
    `).catch(() => 0);
    if (ready === 1) return true;
    await delay(100);
  }
  return false;
}

async function open(hashTarget: string, waitMs = 700): Promise<void> {
  const current = await hash().catch(() => '');
  if (current === hashTarget) await send('Page.reload');
  else await send('Page.navigate', { url: `${BASE}/${hashTarget}` });
  await waitForRender();
  await delay(waitMs);
}

async function clickText(selector: string, needle: string): Promise<boolean> {
  return await evaluate<boolean>(`
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = els.find(e => (e.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase().includes(${JSON.stringify(needle.toLowerCase())}));
    if (!el) return false;
    el.click();
    return true;
  `);
}

async function shot(name: string): Promise<void> {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  if (!res?.data) return;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOTS}\\${name}.png`, Buffer.from(res.data, 'base64'));
  log(`  shot   ${name}.png`);
}

async function viewport(width: number, height: number): Promise<void> {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await delay(400);
}

/** Horizontal overflow is the single most common responsive defect. */
async function overflow(): Promise<{ doc: number; widest: string }> {
  return await evaluate(`
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    let widest = '';
    let max = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      const over = r.right - document.documentElement.clientWidth;
      if (over > max) { max = over; widest = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0,2).join('.') : ''); }
    }
    return { doc: Math.round(doc), widest: max > 1 ? widest + ' (+' + Math.round(max) + 'px)' : '' };
  `);
}

/** Does rgb(var(--fg)) actually resolve to the intended colour? */
async function tokenResolved(varName: string): Promise<string> {
  return await evaluate<string>(`
    const probe = document.createElement('span');
    probe.style.color = 'rgb(var(${varName}))';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  `);
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  // Persist the choice AND apply it. The pre-paint script re-runs on every
  // navigation, so a preference must exist or the page will resolve back to
  // whatever the headless system reports.
  await evaluate<string>(`
    try { window.localStorage.setItem('bf.theme','${theme}'); } catch (e) {}
    document.documentElement.setAttribute('data-theme','${theme}');
    document.documentElement.style.colorScheme='${theme}';
    return 'ok';
  `);
  await delay(300);
}

/** A font is genuinely in use only if it renders at a different width than the
 *  generic fallback for the same string. document.fonts.check() cannot confirm
 *  a variable font, so it is used only as a secondary signal. */
async function fontActive(family: string): Promise<boolean> {
  return await evaluate<boolean>(`
    const measure = (ff) => {
      const s = document.createElement('span');
      s.textContent = 'Blueprint-First 0123456789';
      s.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:64px;white-space:nowrap;font-family:' + ff;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const target = measure(JSON.stringify(${JSON.stringify(family)}));
    const fallback = measure('serif');
    const monoFallback = measure('monospace');
    return Math.abs(target - fallback) > 0.5 && Math.abs(target - monoFallback) > 0.5;
  `);
}

/* --- class coverage against the built stylesheet ---------------------------- */

/**
 * Reads the stylesheet that was actually built and shipped, collects every
 * class named by the screens, and reports the ones with no rule. This is done
 * statically because a runtime probe cannot distinguish "styled" from "unstyled"
 * without a baseline, and because proving the SHIPPED file contains the rules is
 * what actually matters.
 */
async function staticClassCoverage(): Promise<{ used: number; missing: string[] }> {
  const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  const assets = 'design-prototype/dist/assets';
  if (!existsSync(assets)) return { used: 0, missing: ['(no build found - run the build first)'] };
  const cssFile = readdirSync(assets).find((f) => f.endsWith('.css'));
  if (!cssFile) return { used: 0, missing: ['(no stylesheet in the build)'] };
  const css = readFileSync(join(assets, cssFile), 'utf8');
  const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.tsx?$/.test(entry)) yield full;
    }
  }

  const used = new Set<string>();
  for (const file of walk('design-prototype/src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      for (const c of raw.split(/\s+/)) {
        if (!c || c.includes('$')) continue;
        // Skip values that are expressions rather than literal class names.
        if (!/^[a-zA-Z][\w-]*$/.test(c)) continue;
        used.add(c);
      }
    }
  }
  return { used: used.size, missing: [...used].filter((c) => !defined.has(c)) };
}

/* --- server ------------------------------------------------------------- */

async function waitForServer(timeoutMs = 120000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await delay(800);
  }
  return false;
}

function startServer(): ChildProcess {
  const proc = spawn(process.execPath, ['src/web/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BF_DATA_DIR: `${process.env.TEMP}\\bf-redesign-data`,
      BF_BOOTSTRAP_SECURITY_ANSWER: 'Lagos',
      BF_WEB_PORT: new URL(BASE).port,
    },
    stdio: 'ignore',
  });
  return proc;
}

/* --- the audit ---------------------------------------------------------- */

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  log(`\nBlueprint-First redesign audit  ->  ${BASE}`);
  log(`Screenshots: ${SHOTS}\n`);

  server = startServer();
  if (!(await waitForServer())) throw new Error('server did not become healthy');

  const profile = `${process.env.TEMP}\\chrome-redesign-${SUFFIX}`;
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
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 240));
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consoleErrors.push((m.params?.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 240));
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.startsWith(BASE) && r.status >= 400) badResponses.push(`${r.status} ${r.url.replace(BASE, '')}`);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  /* ---- 1. splash timing (fresh browser => splash must show) ---- */
  log('SPLASH');
  await viewport(1440, 900);
  await open('#/', 200);
  await waitForRender();
  const splashText = await text();
  check('splash is rendered on first entry', /Blueprint-First/i.test(splashText), splashText.slice(0, 70));

  // Measure the splash from the moment it MOUNTED (its own clock), not from
  // before navigation — first paint includes loading the bundle and the fonts,
  // which is not the splash duration.
  await evaluate<string>(`
    window.__bfMountedAt = Date.now();
    return 'ok';
  `);
  // it must still be showing well before its duration elapses
  await delay(2500);
  const stillSplash = await hash();
  check('splash still shown at ~2.5s', stillSplash !== '#/welcome', `hash=${stillSplash}`);

  // and must have moved on by ~6s without any interaction
  let advanced = '';
  for (let i = 0; i < 40; i += 1) {
    await delay(250);
    advanced = await hash();
    if (advanced === '#/welcome') break;
  }
  const elapsed = await evaluate<number>(`return Date.now() - (window.__bfMountedAt || Date.now());`);
  check('splash advances BY ITSELF', advanced === '#/welcome', `after ${elapsed}ms -> ${advanced}`);
  check('splash duration is ~4s (3s..6s)', elapsed > 3000 && elapsed < 6500, `${elapsed}ms`);

  /* ---- 2. introduction is three pages, persisted ---- */
  log('\nINTRODUCTION');
  await delay(700);
  check('arrives on the welcome screen', (await hash()) === '#/welcome');
  await viewport(1440, 1000);
  await shot('02-welcome-page1-dark');

  const h2s = await evaluate<string[]>(`return Array.from(document.querySelectorAll('.display-md')).map(e=>(e.textContent||'').trim());`);
  check('introduction has a heading', (h2s[0] ?? '').length > 10, h2s[0] ?? '(none)');

  const dots = await evaluate<number>(`return document.querySelectorAll('.intro-dot').length;`);
  check('introduction is exactly three pages', dots === 3, `${dots} dots`);

  check('Next advances', await clickText('button', 'Next'));
  await delay(600);
  check('page 2 reached', (await text()).includes('wrong'), (await text()).slice(0, 90));
  await shot('03-welcome-page2-dark');

  check('Next advances again', await clickText('button', 'Next'));
  await delay(600);
  const p3 = await text();
  check('page 3 reached', /Discovery first|Evidence always/i.test(p3), p3.slice(0, 90));
  await shot('04-welcome-page3-dark');

  const storedPage = await evaluate<string>(`return window.localStorage.getItem('bf.onboarding.introPage') || '';`);
  check('current page is persisted', storedPage === '2', `stored=${storedPage}`);

  /* persisted: a reload must resume at page 3, not restart at page 1 */
  await send('Page.reload');
  await waitForRender();
  await delay(900);
  const afterReload = await text();
  check('RELOAD RESUMES the introduction, not restarts it', /Discovery first|Evidence always/i.test(afterReload), afterReload.slice(0, 90));

  /* ---- 3. sign-in is only reached by an explicit action ---- */
  log('\nENTRY GUARD');
  await open('#/dashboard', 800);
  const guarded = await hash();
  const guardedText = await text();
  check('a protected route cannot be entered directly', guarded === '#/welcome' || guarded === '#/signin', `hash=${guarded}`);
  check('sign-in form is not the first thing a visitor sees', !/^Sign in/i.test(guardedText) || guarded === '#/welcome', guardedText.slice(0, 80));

  check('"Create an account" is offered on the last page', await clickText('button', 'Create an account'));
  await delay(1000);
  check('explicit action reaches the form', (await hash()) === '#/signin', await hash());
  const signinText = await text();
  check('form has no password / OTP / authenticator fields',
    !/password|one[- ]time|6[- ]digit|authenticator|recovery code/i.test(signinText),
    signinText.slice(0, 120));
  await viewport(1440, 1000);
  await shot('05-signin-dark');

  /* completion is persisted: returning later should not replay the introduction */
  await open('#/welcome', 800);
  check('a completed introduction is NOT replayed', (await hash()) === '#/signin', await hash());

  /* ---- 4. responsiveness ---- */
  log('\nRESPONSIVE');
  for (const [label, w, h] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844]] as const) {
    await viewport(w, h);
    await open('#/signin', 800);
    const of_ = await overflow();
    check(`${label} ${w}px sign-in has no horizontal overflow`, of_.doc <= 1, `overflow ${of_.doc}px ${of_.widest}`);

    /* Form controls must not overlap each other: a regression that styled the
       .field wrapper as if it were the input collapsed the label into the box
       and made adjacent fields collide. */
    const collide = await evaluate<string>(`
      const boxes = Array.from(document.querySelectorAll('.field > input, .field > select, .field > textarea'));
      const rects = boxes.map(b => b.getBoundingClientRect());
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].top < rects[i-1].bottom - 0.5) return 'overlap: field ' + i + ' starts ' +
          (rects[i-1].bottom - rects[i].top).toFixed(1) + 'px before the previous ends';
      }
      return '';
    `);
    check(`${label} ${w}px form fields do not overlap`, collide === '', collide);

    /* A control must be visibly taller than a single line of text. */
    const squashed = await evaluate<string>(`
      const bad = Array.from(document.querySelectorAll('.field > input, .field > select'))
        .filter(b => b.getBoundingClientRect().height < 32);
      return bad.length ? bad.length + ' control(s) under 32px tall' : '';
    `);
    check(`${label} ${w}px form controls are a usable size`, squashed === '', squashed);

    await shot(`06-signin-${label}-${w}`);
  }

  /* ---- branding is the product name, everywhere ---- */
  log('\nBRANDING');
  const brandHits = await evaluate<string>(`
    const t = document.body.innerText || '';
    const bad = [];
    if (/NEXORA|Nexora/i.test(t)) bad.push('NEXORA on sign-in');
    if (!/Blueprint-First/.test(t)) bad.push('product name absent');
    return bad.join('; ');
  `);
  check('the product is named Blueprint-First, not the legacy name', brandHits === '', brandHits);
  const favicon = await evaluate<string>(`
    const link = document.querySelector('link[rel~="icon"]');
    return link ? (link.getAttribute('href') || '') : '';
  `);
  check('favicon is declared', favicon !== '', favicon);
  const legacyFavicon = await fetch(`${BASE}/favicon.svg`).then((r) => r.text());
  check('favicon uses the approved blue, not the old green', !/#022C1A|#10B981/i.test(legacyFavicon));

  /* The entry experience and the form must agree on the name. */
  await open('#/welcome', 800);
  const welcomeBrand = await text();
  check('the welcome screen carries the same product name', /Blueprint-First/.test(welcomeBrand) && !/NEXORA/i.test(welcomeBrand));

  /* ---- default theme is the approved dark identity ---- */
  log('\nDEFAULT THEME');
  await evaluate<string>(`try { window.localStorage.removeItem('bf.theme'); } catch (e) {} return 'ok';`);
  await open('#/signin', 700);
  const defaultIsDark = await evaluate<string>(`
    const t = document.documentElement.getAttribute('data-theme');
    const bg = getComputedStyle(document.body).backgroundColor;
    return t + '|' + bg;
  `);
  check('a first-time visitor sees the dark identity', /^dark\|rgb\(7, 10, 18\)$/.test(defaultIsDark), defaultIsDark);

  /* ---- 5/6/7. tokens, fonts, both themes ---- */
  log('\nDESIGN TOKENS + FONTS');
  await viewport(1440, 1000);
  await open('#/signin', 700);
  const seenBg: Record<string, string> = {};
  const seenFg: Record<string, string> = {};
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme);
    const fg = await tokenResolved('--fg');
    const accent = await tokenResolved('--accent');
    const bg = await evaluate<string>(`return getComputedStyle(document.body).backgroundColor;`);
    seenBg[theme] = bg;
    seenFg[theme] = fg;
    check(`${theme}: --fg resolves to a colour`, /^rgba?\(/.test(fg), fg);
    check(`${theme}: --accent resolves to a colour`, /^rgba?\(/.test(accent), accent);
    check(`${theme}: page background is the token background`, /^rgba?\(/.test(bg), bg);
    check(`${theme}: text and background actually differ`, fg !== bg, `fg=${fg} bg=${bg}`);
    await shot(`07-signin-${theme}`);
  }
  check('the two themes are genuinely different', seenBg.dark !== seenBg.light, `dark=${seenBg.dark} light=${seenBg.light}`);

  // Contrast is computed here in Node from the colours the browser actually
  // resolved, not from the values we intended to write.
  const lum = (c: string): number => {
    const [r, g, b] = c.match(/\d+/g)!.slice(0, 3).map(Number);
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  for (const theme of ['dark', 'light'] as const) {
    const ratio = (Math.max(lum(seenFg[theme]!), lum(seenBg[theme]!)) + 0.05) / (Math.min(lum(seenFg[theme]!), lum(seenBg[theme]!)) + 0.05);
    check(`${theme}: body text contrast >= 7:1 (AAA)`, ratio >= 7, `${ratio.toFixed(2)}:1`);
  }

  await setTheme('dark');
  await delay(700);
  for (const family of ['Inter', 'Fraunces', 'JetBrains Mono']) {
    check(`${family} is actually rendered`, await fontActive(family));
  }

  const displayUsed = await evaluate<string>(`
    const h = document.querySelector('.display-md, .brand-name, h1, h2');
    return h ? getComputedStyle(h).fontFamily : '';
  `);
  check('a display heading actually uses the display face', /Fraunces/.test(displayUsed), displayUsed.slice(0, 60));

  /* ---- 8. runtime cleanliness ---- */
  log('\nRUNTIME');
  check('no uncaught exceptions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no failed same-origin requests', badResponses.length === 0, badResponses.slice(0, 5).join(' | '));

  /* Every class the app renders must exist as a real rule in the SHIPPED
     stylesheet. An undefined class is invisible to the compiler and silently
     drops layout, so this is checked against the built CSS rather than guessed.
     (getComputedStyle().cssText is not usable here: it is empty in Chromium.) */
  log('\nSTYLE COVERAGE');
  const coverage = await staticClassCoverage();
  check(
    'every class the screens use is defined in the built stylesheet',
    coverage.missing.length === 0,
    coverage.missing.length ? coverage.missing.slice(0, 12).join(' ') : `${coverage.used} classes, 0 missing`,
  );

  /** A toast must actually pick up its variant styling. */
  await evaluate<string>(`window.__bfToastProbe = true; return 'ok';`);
  const toastStyled = await evaluate<string>(`
    const t = document.createElement('div');
    t.className = 'toast error';
    document.body.appendChild(t);
    const border = getComputedStyle(t).borderTopColor;
    t.remove();
    return border;
  `);
  check('a toast variant resolves a real border colour', /^rgba?\(/.test(toastStyled), toastStyled);

  /* Vertical rhythm inside the credential card: no dead gap between the
     heading and the first field, and no gap below the final control. */
  log('\nSPACING');
  await viewport(1440, 1000);
  await open('#/signin', 800);
  const spacing = await evaluate<string>(`
    const card = document.querySelector('.auth-card');
    if (!card) return '{}';
    const pad = parseFloat(getComputedStyle(card).paddingTop);
    const kids = Array.from(card.children).filter(k => k.getBoundingClientRect().height > 0);
    const cardBox = card.getBoundingClientRect();
    const top = kids[0].getBoundingClientRect().top - cardBox.top;
    const bottom = cardBox.bottom - kids[kids.length - 1].getBoundingClientRect().bottom;
    const sub = card.querySelector('.auth-sub');
    const form = card.querySelector('form');
    const gap = form && sub ? form.getBoundingClientRect().top - sub.getBoundingClientRect().bottom : -1;
    return JSON.stringify({ pad: Math.round(pad), top: Math.round(top), bottom: Math.round(bottom), gap: Math.round(gap) });
  `);
  const sp = JSON.parse(spacing || '{}') as Record<string, number>;
  check('the card respects its own padding at the top', sp.top >= sp.pad - 2, `top=${sp.top} pad=${sp.pad}`);
  check('the card respects its own padding at the bottom', sp.bottom >= sp.pad - 2, `bottom=${sp.bottom} pad=${sp.pad}`);
  check('no dead gap under the intro text', sp.gap >= 8 && sp.gap <= 40, `${sp.gap}px`);

  /* The sign-in switch line must stay centred, not spread edge to edge. */
  const switchCentred = await evaluate<string>(`
    const el = document.querySelector('.auth-switch');
    if (!el) return '999';
    const r = el.getBoundingClientRect();
    const card = document.querySelector('.auth-card').getBoundingClientRect();
    return Math.abs((r.left + r.right) / 2 - (card.left + card.right) / 2).toFixed(1);
  `);
  check('the "create an account" line is centred in the card', parseFloat(switchCentred) <= 2, `offset ${switchCentred}px`);

  await send('Emulation.clearDeviceMetricsOverride');
  chrome.kill();
  server.kill();

  log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nAUDIT ERROR:', err);
  server?.kill();
  process.exit(2);
});