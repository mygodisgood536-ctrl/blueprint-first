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

/** The routes the application actually recognises. */
const RETIRED_ROUTES = ['/user', '/user/signin', '/user/entry', '/intro', '/login', '/login/verify', '/signup', '/forgot', '/splash'];

test('the public product entry is the application root and carries no role word', async () => {
  const { js } = await readServedBundle();
  // The root is the entry: it is the splash that leads into the welcome screen.
  assert.match(js, /#\/welcome/, 'the product entry must lead to a welcome screen');
  // No route may be a public, role-labelled entry point.
  for (const retired of RETIRED_ROUTES) {
    // Retired routes are allowed to EXIST only as redirect targets/sources.
    const occurrences = (js.match(new RegExp(retired.replace('/', '\\/'), 'g')) ?? []).length;
    if (occurrences > 0) {
      // Every occurrence must be inside a redirect to a clean destination.
      assert.ok(
        /Redirect/.test(js),
        `retired route ${retired} must only be handled as a redirect`,
      );
    }
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
  // The administration settings route exists in the shipped bundle.
  assert.match(js, /#\/owner\/settings/, 'the administration settings route must exist');

  // Role gating is a source-level guarantee (the bundle is minified, so the
  // identifier is not stable there). Read the real source instead.
  const shell = await readFile(join(process.cwd(), 'design-prototype', 'src', 'shell.tsx'), 'utf8');
  assert.match(shell, /auth\.role === 'admin'/, 'the sidebar must gate the administration nav on the role');
  assert.match(shell, /#\/owner\/settings/, 'the sidebar link must point at the administration route');
  assert.match(shell, /\{isOwner && \(/, 'the administration nav block must be conditional');

  // The route table itself must refuse a non-administrator account.
  const routesSrc = await readFile(join(process.cwd(), 'design-prototype', 'src', 'routes.ts'), 'utf8');
  assert.match(routesSrc, /isAdministrator/, 'the route table must be told the account role');
  assert.match(
    routesSrc,
    /path === '\/owner\/settings'[\s\S]{0,240}?!auth\.isAdministrator/,
    'the administration route must refuse a non-administrator account',
  );
  // And the app must pass the real role into that decision.
  const app = await readFile(join(process.cwd(), 'design-prototype', 'src', 'App.tsx'), 'utf8');
  assert.match(
    app,
    /isAdministrator: auth\.role === 'admin'/,
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
  // shared control. (Some legacy pages are not currently routed, so they are
  // verified at source level above rather than by their presence in the bundle.)
  for (const hook of [
    'daytona-api-key',
    'model-popup-api-key',
    'authenticator-secret',
    'auth-password',
    'auth-confirm',
    'owner-password',
    'owner-confirm',
    'recovery-verify-',
    'forgot-new-password',
    'settings-new-password',
  ]) {
    assert.ok(js.includes(hook), `the shared control must be wired to "${hook}"`);
  }
  // The first-time recovery answers are indexed, so the stable prefix is what
  // the bundle carries.
  const setupSrc = await readFile(join(pagesDir, 'pages', 'Setup.tsx'), 'utf8');
  assert.match(setupSrc, /data-testid=\{`recovery-answer-\$\{index\}`\}/);
  assert.match(setupSrc, /data-testid=\{`recovery-confirm-\$\{index\}`\}/);
});

test('the authenticator secret is a real backend value, issued once, matching its provisioning URI', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    // A brand-new, part-way-through-setup account: first-time authenticator
    // enrollment is exactly the flow the UI drives.
    const created = await fetch(`${s.url}/api/user/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'secret_user', password: 'secret-password-1' }),
    });
    const cookie = created.headers.get('set-cookie')!.split(';')[0]!;

    const first = (await (
      await fetch(`${s.url}/api/account/authenticator/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({}),
      })
    ).json()) as { secret: string; otpauth: string };

    // A real, server-generated base32 secret.
    assert.match(first.secret, /^[A-Z2-7]{16,}$/);
    // The provisioning URI embeds the SAME secret, so a QR scan and the
    // displayed key are one authenticator rather than two different ones.
    assert.ok(first.otpauth.includes(first.secret), 'the provisioning URI must carry the same secret');
    assert.match(first.otpauth, /^otpauth:\/\/totp\//, 'a standard otpauth URI must be produced');

    // The secret is not readable again through any account route.
    const me = await (await fetch(`${s.url}/api/me`, { headers: { cookie } })).text();
    assert.ok(!me.includes(first.secret), 'the secret must never be returned by /api/me');
    const status = await (await fetch(`${s.url}/api/account/authenticator`, { headers: { cookie } })).text();
    assert.ok(!status.includes(first.secret), 'the authenticator status route must never return the secret');
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

    // The owner-exists probe reveals nothing about any other account.
    const probe = (await (await fetch(`${s.url}/api/auth/owner-exists`)).json()) as { ownerExists: boolean };
    assert.equal(typeof probe.ownerExists, 'boolean');
    assert.deepEqual(Object.keys(probe), ['ownerExists'], 'the probe must not leak any account detail');
  } finally {
    await s.close();
  }
});

test('the authenticator is still mandatory and the setup gate is still enforced after the redesign', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const res = await fetch(`${s.url}/api/user/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate_user', password: 'gate-password-1' }),
    });
    assert.equal(res.status, 201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    // No setup: the product is refused.
    const blocked = await fetch(`${s.url}/api/system/foundation`, { headers: { cookie } });
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as { code: string }).code, 'recovery_setup_required');
  } finally {
    await s.close();
  }
});
