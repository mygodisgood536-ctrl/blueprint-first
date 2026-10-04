/**
 * ENTRY-EXPERIENCE, ROUTING AND SENSITIVE-INPUT AUDIT
 *
 * These tests inspect the ACTUAL built frontend bundle that the server serves,
 * plus the real backend authorization boundary, and assert the requirements of
 * the entry-experience redesign:
 *
 *  1. The normal-product entry URL carries no internal role word.
 *  2. The normal-product experience never links to, advertises, or names the
 *     private administration area, Daytona, or any role label.
 *  3. The retired role-labelled route is a redirect only, not a second entry.
 *  4. Every sensitive input uses the shared show/hide control.
 *  5. The authenticator secret is a real single-fetch flow, not a regenerated
 *     or client-side value.
 *  6. The owner boundary is enforced by the BACKEND regardless of any route.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkingServer, workingTempDataDir as tempDataDir } from './working-harness.ts';
import { signUp, signUpOwner } from './account-api-helper.ts';

const NEXONA_DIR = join(process.cwd(), 'src', 'web', 'public', 'nexona');

/** Reads the served index.html and the JS bundle it references. */
async function readServedBundle(): Promise<{ html: string; js: string; name: string }> {
  const indexPath = join(NEXONA_DIR, 'index.html');
  assert.ok(existsSync(indexPath), 'the built SPA must be present in src/web/public/nexona');
  const html = await readFile(indexPath, 'utf8');
  const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  assert.ok(match !== null, 'index.html must reference a built JS bundle');
  const name = match![0]!;
  return { html, js: await readFile(join(NEXONA_DIR, name), 'utf8'), name };
}

/**
 * The retired entry points that once existed, which must all still be present in
 * the route table - and present only as a forwarding destination.
 *
 * These are the real Phase 2 names: the two-step verification screen became
 * `/signin/verify` when the flow was replaced, and `/setup/*` is where the
 * mandatory recovery/authenticator setup used to live.
 */
const RETIRED_ROUTES = [
  '/signin/verify',
  '/signin/recovery',
  '/setup',
  '/setup/recovery',
  '/setup/authenticator',
  '/settings/authenticator',
  '/settings/security',
  '/login',
  '/signup',
  '/forgot',
  '/owner',
  '/user',
  '/user/signin',
  '/user/entry',
  '/intro',
  '/splash',
];

test('the public product entry is the application root and carries no role word', async () => {
  const { js } = await readServedBundle();
  // The root is the entry: it is the splash that leads into the welcome screen.
  assert.match(js, /#\/welcome/, 'the product entry must lead to a welcome screen');

  // Retired routes may only ever FORWARD. They are verified against the real
  // route table rather than by looking for an identifier in the minified
  // bundle: minification destroys the very names this used to grep for, which
  // made the old assertion pass or fail for a cosmetic reason. Reading the
  // source proves the actual routing behaviour.
  const routesSrc = await readFile(join(process.cwd(), 'design-prototype', 'src', 'routes.ts'), 'utf8');
  for (const retired of RETIRED_ROUTES) {
    assert.match(
      routesSrc,
      new RegExp(`'${retired.replace('/', '\\/')}'\\s*:`),
      `${retired} must still be listed in the retired-route table`,
    );
  }
  // Every retired route forwards somewhere; none renders a screen of its own.
  const retiredTable = routesSrc.slice(routesSrc.indexOf('RETIRED_ROUTES'), routesSrc.indexOf('PRODUCT_PATHS'));
  for (const line of retiredTable.split('\n')) {
    const m = line.match(/'([^']+)'\s*:\s*'([^']+)'/);
    if (m === null) continue;
    assert.match(
      m[2]!,
      /^#\//,
      `retired route ${m[1]} must forward to a hash destination, never render itself`,
    );
  }

  // The product entry must never be labelled with an internal role.
  assert.ok(!/#\/developer|#\/role|#\/normal-user|#\/member|#\/customer/.test(js), 'no role-labelled product route may exist');
});

test('the normal-product experience never advertises the administration area, Daytona, or a role', async () => {
  const { js } = await readServedBundle();
  // The bundle legitimately contains the private owner's own module and the
  // role check, so the audit is on USER-FACING strings, not on identifiers.
  const userFacingStrings = [...js.matchAll(/"([A-Za-z0-9 ,.'’\-:!?()/&]{6,})"/g)].map((m) => m[1]!);
  const forbidden = [
    'Platform Owner',
    'platform owner',
    'Nexora Owner',
    'NEXORA OWNER',
    'PLATFORM OWNER',
    'I am the owner',
    "I'm the owner",
    'I am a normal user',
    'Owner dashboard',
    'Owner settings',
    'Owner signup',
    'Owner login',
    'Switch to owner',
    'Are you the owner',
    'This is for User',
    'This is for Owner',
  ];
  for (const phrase of forbidden) {
    assert.ok(
      !userFacingStrings.includes(phrase),
      `user-facing copy must not contain "${phrase}"`,
    );
  }
  // The public welcome/sign-in screens must not link to the private area.
  const welcome = js.slice(js.indexOf('Ship software from a blueprint') - 4000, js.indexOf('Ship software from a blueprint') + 4000);
  assert.ok(!welcome.includes('#/owner'), 'the public welcome screen must not link to the administration area');
  assert.ok(!/Daytona/i.test(welcome), 'the public welcome screen must not mention Daytona');
});

test('the private administration area is role-gated in source AND enforced by the server', async () => {
  const { js } = await readServedBundle();
  // The administration settings route exists in the shipped bundle. The route is
  // assembled at runtime, so the bundle carries the path rather than the literal
  // `#/settings/infrastructure`.
  assert.match(js, /settings\/infrastructure/, 'the administration settings route must exist');

  // Role gating is a source-level guarantee (the bundle is minified, so the
  // identifier is not stable there). Read the real source instead.
  const shell = await readFile(join(process.cwd(), 'design-prototype', 'src', 'shell.tsx'), 'utf8');
  assert.match(
    shell,
    /auth\.canManagePlatform/,
    'the sidebar must gate the administration nav on the server-resolved authorization flag',
  );
  assert.match(
    shell,
    /settings\/infrastructure/,
    'the sidebar link must point at the administration route',
  );
  assert.match(shell, /\{isOwner && \(/, 'the administration nav block must be conditional');

  // The route table itself must refuse a non-administrator account.
  const routesSrc = await readFile(join(process.cwd(), 'design-prototype', 'src', 'routes.ts'), 'utf8');
  assert.match(routesSrc, /isAdministrator/, 'the route table must be told the account role');
  assert.match(
    routesSrc,
    /path === '\/settings\/infrastructure'[\s\S]{0,240}?!auth\.isAdministrator/,
    'the administration route must refuse a non-administrator account',
  );
  // And the app must pass the real flag into that decision.
  const app = await readFile(join(process.cwd(), 'design-prototype', 'src', 'App.tsx'), 'utf8');
  assert.match(
    app,
    /isAdministrator: auth\.canManagePlatform/,
    'the app must derive the administrator flag from the authenticated account',
  );
});

test('every sensitive input uses the shared show/hide control', async () => {
  const { js } = await readServedBundle();
  // The shared control must exist and provide the full set of affordances.
  assert.match(js, /secret-input/, 'the shared sensitive-input control must be shipped');
  assert.match(js, /Show/, 'the control must offer a reveal action');
  assert.match(js, /Hide/, 'the control must offer a hide action');
  assert.match(js, /Copy secret|Copy to clipboard/, 'the control must offer a copy action for secrets');

  const pagesDir = join(process.cwd(), 'design-prototype', 'src');

  // The masked/plain switch must exist in exactly ONE place in the source: the
  // shared control. (Counting literals in the minified bundle is unreliable
  // because `autoComplete` values such as "new-password" also match.)
  const controlSrc = await readFile(join(pagesDir, 'components', 'SecretField.tsx'), 'utf8');
  const switches = (controlSrc.match(/type=\{visible \? 'text' : 'password'\}/g) ?? []).length;
  assert.equal(switches, 1, 'the masked/plain switch must exist in exactly one place');

  // Source-level proof that every sensitive field uses the control.
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  await walk(pagesDir);
  await walk(join(pagesDir, 'components'));

  const offenders: string[] = [];
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    if (file.endsWith('SecretField.tsx')) continue; // the control itself
    // Any literal password input outside the control is a missed field.
    if (/type=["']password["']/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'no page may render a bare password input instead of the shared control');

  // The fields that are actually reachable in the product are wired through the
  // shared control, and every sensitive field the retired authentication model
  // used to render is genuinely gone.
  for (const hook of [
    'daytona-api-key',
    'model-popup-api-key',
  ]) {
    assert.ok(js.includes(hook), `the shared control must be wired to "${hook}"`);
  }
  // The security answer is the one secret a member enters, and it is masked.
  assert.ok(js.includes('Security Answer'), 'the security-answer field must ship in the bundle');

  // The retired authentication inputs are NOT rendered any more. This is the
  // direct replacement for the old "recovery-answer-${index}" Setup-page check:
  // that page was deleted with the two-step flow, so the honest assertion is
  // that its fields are absent from the shipped product.
  for (const retiredHook of [
    'authenticator-secret',
    'auth-password',
    'auth-confirm',
    'owner-password',
    'owner-confirm',
    'recovery-verify-',
    'recovery-answer-',
    'forgot-new-password',
    'settings-new-password',
  ]) {
    assert.ok(!js.includes(retiredHook), `the retired field "${retiredHook}" must not ship in the bundle`);
  }
  // The retired setup page itself is gone from the source tree.
  await assert.rejects(
    readFile(join(pagesDir, 'pages', 'Setup.tsx'), 'utf8'),
    'the retired Setup page must not exist',
  );
});

test('the security answer is a real backend value that is never issued back', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    // This test used to pin the TOTP enrollment secret: a server-generated
    // base32 value, returned exactly once, never readable again. That mechanism
    // was deliberately removed in Phase 2, so there is no authenticator to
    // enroll. The property it protected - a real backend secret that is issued
    // once and never handed back - now applies to the security answer, which is
    // the one secret a member holds.
    const QUESTION = 'What city did my parents meet?';
    const ANSWER = 'Riverbank-77';
    const created = await fetch(`${s.url}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Secret User',
        username: 'secret_user',
        gmail: 'secret_user@gmail.com',
        securityQuestion: QUESTION,
        securityAnswer: ANSWER,
      }),
    });
    assert.equal(created.status, 201);
    // Sign-up is not authentication, and it must not echo the answer back.
    assert.equal(created.headers.get('set-cookie'), null, 'signup must not issue a session');
    const createdText = await created.text();
    assert.ok(!createdText.includes(ANSWER), 'signup must never return the security answer');

    // The answer is a genuine credential: only it, with the right question,
    // yields a session.
    const wrong = await fetch(`${s.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gmail: 'secret_user@gmail.com', securityQuestion: QUESTION, securityAnswer: 'wrong' }),
    });
    assert.equal(wrong.status, 401, 'a wrong answer must not authenticate');
    assert.equal(wrong.headers.get('set-cookie'), null, 'a failed login must not set a cookie');

    const ok = await fetch(`${s.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gmail: 'secret_user@gmail.com', securityQuestion: QUESTION, securityAnswer: ANSWER }),
    });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;

    // The answer is not readable again through any account route.
    const session = await (await fetch(`${s.url}/api/auth/session`, { headers: { cookie } })).text();
    assert.ok(!session.includes(ANSWER), 'the security answer must never be returned by the session route');
    const me = await (await fetch(`${s.url}/api/me`, { headers: { cookie } })).text();
    assert.ok(!me.includes(ANSWER), 'the security answer must never be returned by /api/me');
  } finally {
    await s.close();
  }
});

test('the backend refuses every owner endpoint regardless of any route the client renders', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const owner = await signUpOwner(s.url, 'audit_owner');
    const user = await signUp(s.url, 'audit_user');

    // A normal account is refused by the SERVER on read, write and delete.
    for (const [method, path] of [
      ['GET', '/api/owner/daytona'],
      ['PUT', '/api/owner/daytona'],
      ['DELETE', '/api/owner/daytona'],
    ] as const) {
      const res = await fetch(`${s.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: user },
        ...(method === 'PUT' ? { body: JSON.stringify({ apiKey: 'x' }) } : {}),
      });
      assert.equal(res.status, 403, `${method} ${path} must be refused for a normal account`);
    }
    // A method with no owner route must still be refused at the owner boundary,
    // not fall through to a generic 404 that could be probed.
    for (const [method, path] of [
      ['POST', '/api/owner/daytona'],
      ['POST', '/api/owner/anything'],
      ['PATCH', '/api/owner/daytona'],
    ] as const) {
      const res = await fetch(`${s.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: user },
        body: JSON.stringify({ apiKey: 'x' }),
      });
      assert.equal(res.status, 403, `${method} ${path} must be refused for a normal account`);
      // The refusal must not echo the credential back.
      assert.ok(!(await res.clone().text()).includes('x'), 'a refusal must not echo the submitted key');
    }
    // The same unhandled method reaches an administrator only as a refusal, and
    // never activates anything.
    const adminProbe = await fetch(`${s.url}/api/owner/anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ apiKey: 'x' }),
    });
    assert.equal(adminProbe.status, 405, 'an unimplemented owner method must be refused, not handled');
    // Anonymous is refused outright.
    assert.equal((await fetch(`${s.url}/api/owner/daytona`)).status === 401, true);
    // The administration account is served.
    assert.equal((await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: owner } })).status, 200);

    // There is no longer an "owner exists?" probe. That route existed only so
    // the retired owner-signup screen could decide what to render; with one
    // signup route and one server-provisioned privileged account it has nothing
    // to ask, and it would only leak account existence. It must be unregistered.
    for (const method of ['GET', 'POST'] as const) {
      const res = await fetch(`${s.url}/api/auth/owner-exists`, {
        method,
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(res.status, 404, `${method} /api/auth/owner-exists must not be registered`);
    }
  } finally {
    await s.close();
  }
});

test('the retired setup gate is gone: a new account is never blocked from the product', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    // This test used to assert the OPPOSITE: that a freshly password-signed-up
    // account was refused by `/api/system/foundation` with
    // `recovery_setup_required`. That gate existed only because the product
    // demanded a mandatory recovery/authenticator setup. Phase 2 removed that
    // architecture, so the gate must no longer exist. The property worth keeping
    // is that a new account can actually USE the product immediately.
    const QUESTION = 'What city did my parents meet?';
    const res = await fetch(`${s.url}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Gate User',
        username: 'gate_user',
        gmail: 'gate_user@gmail.com',
        securityQuestion: QUESTION,
        securityAnswer: 'Northgate-12',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('set-cookie'), null, 'signup must not authenticate the account');

    const login = await fetch(`${s.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gmail: 'gate_user@gmail.com', securityQuestion: QUESTION, securityAnswer: 'Northgate-12' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // No setup step exists, so nothing may block this account.
    const foundation = await fetch(`${s.url}/api/system/foundation`, { headers: { cookie } });
    assert.notEqual(
      foundation.status,
      403,
      'a signed-in account must not be blocked by a setup gate that no longer exists',
    );
    const code = ((await foundation.json()) as { code?: string }).code;
    assert.notEqual(code, 'recovery_setup_required', 'the retired setup gate must not be reachable');
  } finally {
    await s.close();
  }
});
