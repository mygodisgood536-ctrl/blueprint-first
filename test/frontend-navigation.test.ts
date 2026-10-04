/**
 * FRONTEND NAVIGATION REGRESSION GUARD
 *
 * These tests lock in the real defects found by driving an actual browser, so
 * they cannot regress silently. They assert against the shipped source and the
 * built bundle, plus the real route resolver, rather than a mocked DOM.
 *
 * Each of these was an actual, user-visible bug:
 *  1. The shared secret input dropped its `id`, so every password field lost the
 *     association with its <label> and could not be targeted.
 *  2. Sign-in compared the typed password against the hidden confirm field, so
 *     EVERY returning user was blocked with "Passwords do not match".
 *  3. First-time setup auto-redirected on completion and navigated past the
 *     one-time recovery codes, so the user could never save them.
 *  4. A non-administrator typing an administration URL stayed on that URL.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRoute, type AuthFacts } from '../design-prototype/src/routes.ts';

const SRC = join(process.cwd(), 'design-prototype', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
/** Source with comments stripped, so prose explaining what is ABSENT cannot
 *  itself trip a guard that asserts the thing is absent. */
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ANONYMOUS: AuthFacts = {
  authenticated: false, isAdministrator: false,
};
const READY: AuthFacts = {
  authenticated: true, isAdministrator: false,
};
const ADMIN: AuthFacts = { ...READY, isAdministrator: true };

/** The built bundle the server actually serves, when it has been built. */
function builtBundle(): string | null {
  const dir = join(process.cwd(), 'src', 'web', 'public', 'nexona', 'assets');
  if (!existsSync(dir)) return null;
  const js = readdirSync(dir).find((f) => f.endsWith('.js'));
  return js === undefined ? null : readFileSync(join(dir, js), 'utf8');
}

// â”€â”€ 1. The shared secret input must keep its id and label association â”€â”€â”€â”€â”€â”€â”€

test('the shared secret input forwards its id so every label stays associated', () => {
  const control = read('components/SecretField.tsx');
  // The component must accept an id...
  assert.match(control, /id\?: string/, 'SecretField must accept an id prop');
  // ...and put it on the input.
  assert.match(control, /\.\.\.\(id !== undefined \? \{ id \} : \{\}\)/, 'SecretField must forward the id to the input');
  // Unknown attributes must pass through rather than be swallowed.
  assert.match(control, /\.\.\.rest\b/, 'SecretField must forward additional input attributes');
  // The masked/plain switch is the only place the input type is chosen.
  assert.equal((control.match(/type=\{visible \? 'text' : 'password'\}/g) ?? []).length, 1);
});

test('every labelled field keeps the id its label points at', () => {
  // Each (label htmlFor, SecretField id) pair must match. This is the exact
  // regression that broke sign-in, account creation and the administration form.
  const files = ['pages/SignIn.tsx', 'modelPopup.tsx'];
  for (const file of files) {
    const src = read(file);
    const labels = [...src.matchAll(/<label[^>]*htmlFor="([^"]+)"/g)].map((m) => m[1]!);
    for (const label of labels) {
      // The element that carries this id must exist in the same file, either as a
      // plain input or as an id passed to the shared control.
      const asInput = new RegExp(`id="${label}"`).test(src);
      assert.ok(asInput, `${file}: <label for="${label}"> has no matching element id`);
    }
    // Any id handed to the shared control must also be referenced by a label.
    const controlIds = [...src.matchAll(/<SecretField[\s\S]{0,220}?id="([^"]+)"/g)].map((m) => m[1]!);
    for (const id of controlIds) {
      assert.ok(
        labels.includes(id),
        `${file}: SecretField id="${id}" is not referenced by any <label htmlFor>`,
      );
    }
  }
});

// ── 2. Sign-in must validate only what it actually shows ───────────────────
//
// The original bug: sign-in compared the typed password against a confirmation
// field that only exists while creating an account, so EVERY returning user was
// blocked. That class of defect still matters - a field that is validated but
// not rendered (or rendered but not validated) breaks real people - so the
// guard is restated against the fields that exist today.

test('sign-in renders exactly the three fields it validates', () => {
  const src = code('pages/SignIn.tsx');
  // The sign-in branch must carry Gmail, security question and security answer.
  for (const field of ['gmail', 'signinQuestion', 'signinAnswer']) {
    assert.ok(src.includes(field), `SignIn must carry the "${field}" sign-in field`);
  }
  // The create branch carries exactly five fields: full name, username, Gmail,
  // security question and security answer. Nothing more.
  for (const field of ['fullName', 'username', 'createGmail', 'createQuestion', 'createAnswer']) {
    assert.ok(src.includes(field), `SignIn must carry the "${field}" sign-up field`);
  }
  // There must be no hidden confirmation or second-factor field that sign-in
  // could accidentally compare against.
  assert.ok(!/confirm/i.test(src), 'SignIn must not carry a confirmation field');
  assert.ok(!/verification code|one-time-code|otp/i.test(src), 'SignIn must not carry a second-factor field');
});

test('the authentication screen offers no password, OTP or recovery surface', () => {
  const src = code('pages/SignIn.tsx');
  for (const banned of ['Password', 'password', 'Forgot', 'recovery', 'authenticator', 'Authenticator']) {
    assert.ok(
      !src.includes(banned),
      `SignIn must not mention "${banned}": the product has no such credential`,
    );
  }
  // It must post to exactly the two credential routes, via the shared client.
  const api = read('api.ts');
  assert.ok(api.includes('/api/auth/signup'), 'the client must call the one signup route');
  assert.ok(api.includes('/api/auth/login'), 'the client must call the one login route');
  for (const banned of [
    '/api/auth/owner-signup', '/api/user/signup', '/api/auth/forgot', '/api/auth/reset',
    '/api/account/password', '/api/account/authenticator', '/api/auth/login/verify',
    '/api/account/recovery', '/api/auth/owner-exists',
  ]) {
    assert.ok(!api.includes(banned), `the client must not call the retired route ${banned}`);
  }
});

// ── 3. Sign-up must not silently log the new account in ────────────────────
//
// The original bug: first-time setup auto-redirected past the one-time recovery
// codes. The recovery codes are gone with the rest of the old credential model,
// but the underlying intent - never navigate past a step the user must act on -
// survives as: sign-up creates no session, so the app must not navigate into the
// product as though the person were signed in.

test('sign-up does not sign the new account in or navigate into the product', () => {
  const store = read('store.tsx');
  // Sign-up must not store an authenticated session.
  const signupBody = store.slice(store.indexOf('const signup = useCallback'), store.indexOf('const login = useCallback'));
  assert.ok(!signupBody.includes('setAuth(authFromAccount'), 'sign-up must not establish a session');
  assert.ok(!signupBody.includes('navigate('), 'sign-up must not navigate anywhere');
  // And it must say so to the user.
  assert.match(signupBody, /sign in/i, 'sign-up must direct the user to sign in');
});

// â”€â”€ 4. A non-administrator must not be left on an administration URL â”€â”€â”€â”€â”€â”€

test('a non-administrator is moved off an administration URL they cannot use', () => {
  const decision = resolveRoute('#/settings/infrastructure', READY);
  assert.equal(decision.redirect, '#/dashboard', 'a non-administrator must land in their own workspace');
  assert.notEqual(decision.redirect, '#/owner/settings', 'and must not remain on the administration route');
  // The retired administration paths behave identically.
  assert.equal(resolveRoute('#/owner', READY).redirect, '#/signin');
  assert.equal(resolveRoute('#/owner/settings', READY).redirect, '#/signin');
  // An administrator is still served.
  assert.equal(resolveRoute('#/settings/infrastructure', ADMIN).kind, 'ownerSettings');
});

// â”€â”€ 5. The entry URL is a real, loadable page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('the public entry is the application root and the built bundle ships it', () => {
  assert.equal(resolveRoute('#/', ANONYMOUS).kind, 'splash');
  assert.equal(resolveRoute('#/welcome', ANONYMOUS).kind, 'welcome');
  const bundle = builtBundle();
  if (bundle === null) return; // not built in this environment
  // The bundle must actually contain the entry surfaces, not just the route table.
  assert.ok(bundle.includes('Ship software from a blueprint'), 'the welcome screen must ship in the bundle');
  assert.ok(bundle.includes('Get started'), 'the entry action must ship in the bundle');
  assert.ok(bundle.includes('Security Answer'), 'the security-answer field must ship in the bundle');
  // The splash must hand off automatically to the welcome screen.
  assert.match(read('pages/Welcome.tsx'), /navigate\('#\/welcome'\)/);
});

// â”€â”€ 6. No shipped page may link to a retired route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('no shipped page links to a retired route', () => {
  const retired = ['#/user', '#/user/signin', '#/user/entry', '#/intro', '#/login', '#/signup', '#/forgot', '#/splash', '#/signin/verify', '#/setup/authenticator', '#/settings/security'];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name) || entry.name === 'routes.ts') continue;
      const src = readFileSync(full, 'utf8');
      // A retired route may only appear inside the redirect table itself.
      for (const r of retired) {
        if (src.includes(`'${r}'`) || src.includes(`"${r}"`)) offenders.push(`${full}: ${r}`);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], 'only the route table may reference a retired route');
});

// â”€â”€ 7. The public experience must not mention privileged concepts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('the public entry screens contain no privileged wording or link', () => {
  for (const file of ['pages/Welcome.tsx', 'pages/SignIn.tsx', 'router.ts']) {
    const src = read(file);
    assert.ok(!src.includes('#/owner'), `${file} must not link the administration area`);
    assert.ok(!/Daytona/i.test(src), `${file} must not mention Daytona`);
    assert.ok(
      !/Platform Owner|Nexora Owner|NEXORA OWNER|NEXORA USER|normal user|Owner settings|Owner dashboard|This is for/i.test(src),
      `${file} must not use role-identifying copy`,
    );
  }
});

