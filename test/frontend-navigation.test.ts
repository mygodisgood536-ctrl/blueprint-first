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

const ANONYMOUS: AuthFacts = {
  authenticated: false, setupComplete: false, recoveryPending: false, totpPending: false, isAdministrator: false,
};
const READY: AuthFacts = {
  authenticated: true, setupComplete: true, recoveryPending: false, totpPending: false, isAdministrator: false,
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

test('every password field keeps the id its label points at', () => {
  // Each (label htmlFor, SecretField id) pair must match. This is the exact
  // regression that broke sign-in, account creation and the administration form.
  const files = ['pages/SignIn.tsx', 'pages/OwnerAccess.tsx', 'modelPopup.tsx'];
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

// â”€â”€ 2. Sign-in must not validate the hidden confirm field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('sign-in does not compare the password against the hidden confirm field', () => {
  /**
   * Walks the source from the `if (mode === 'create')` guard, tracking brace
   * depth, and reports whether the confirm comparison is still inside that
   * block. Comparing an entered password against a confirm field the user
   * cannot see blocked EVERY returning user with "Passwords do not match".
   */
  const isGuarded = (src: string): boolean => {
    const guardAt = src.indexOf("if (mode === 'create')");
    if (guardAt < 0) return false;
    const compareAt = src.indexOf('password !== confirm', guardAt);
    if (compareAt < 0) return false;
    let depth = 0;
    for (let i = guardAt + "if (mode === 'create')".length; i < compareAt; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
    }
    return depth > 0;
  };

  for (const file of ['pages/SignIn.tsx', 'pages/OwnerAccess.tsx']) {
    const src = read(file);
    assert.ok(src.includes('password !== confirm'), `${file}: expected a confirm comparison while creating`);
    assert.ok(
      isGuarded(src),
      `${file}: the confirm comparison must be inside the "mode === 'create'" guard (bug: sign-in was blocked by the hidden field)`,
    );
  }
});

// â”€â”€ 3. Setup must not navigate past the one-time recovery codes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('first-time setup does not auto-redirect past the one-time recovery codes', () => {
  const setup = read('pages/Setup.tsx');
  // The redirect helper must accept a suppression flag...
  assert.match(
    setup,
    /function useSetupRedirect\(suppressComplete = false\)/,
    'useSetupRedirect must support suppressing the completion redirect',
  );
  // ...and the authenticator step must enable it while the codes are shown.
  assert.match(
    setup,
    /useSetupRedirect\(recoveryCodes !== null\)/,
    'the authenticator step must suppress the redirect while recovery codes are displayed',
  );
  // The completion redirect must actually respect the flag.
  assert.match(
    setup,
    /if \(!suppressComplete\) navigate\('#\/dashboard'\)/,
    'the completion redirect must be conditional on the suppression flag',
  );
  // And the user must still be able to leave deliberately.
  assert.match(setup, /Continue to workspace/, 'a deliberate continue action must exist');
});

// â”€â”€ 4. A non-administrator must not be left on an administration URL â”€â”€â”€â”€â”€â”€

test('a non-administrator is moved off an administration URL they cannot use', () => {
  const decision = resolveRoute('#/owner/settings', READY);
  assert.equal(decision.redirect, '#/dashboard', 'a non-administrator must land in their own workspace');
  assert.notEqual(decision.redirect, '#/owner/settings', 'and must not remain on the administration route');
  // The legacy administration path behaves identically.
  assert.equal(resolveRoute('#/owner/infrastructure', READY).redirect, '#/dashboard');
  // An administrator is still served.
  assert.equal(resolveRoute('#/owner/settings', ADMIN).kind, 'ownerSettings');
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
  assert.ok(bundle.includes('secret-input'), 'the shared secret control must ship in the bundle');
  // The splash must hand off automatically to the welcome screen.
  assert.match(read('pages/Welcome.tsx'), /navigate\('#\/welcome'\)/);
});

// â”€â”€ 6. No shipped page may link to a retired route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('no shipped page links to a retired route', () => {
  const retired = ['#/user', '#/user/signin', '#/user/entry', '#/intro', '#/login', '#/signup', '#/forgot', '#/splash', '#/settings/authenticator'];
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
  for (const file of ['pages/Welcome.tsx', 'pages/SignIn.tsx', 'pages/Setup.tsx', 'pages/Auth2.tsx', 'router.ts']) {
    const src = read(file);
    assert.ok(!src.includes('#/owner'), `${file} must not link the administration area`);
    assert.ok(!/Daytona/i.test(src), `${file} must not mention Daytona`);
    assert.ok(
      !/Platform Owner|Nexora Owner|NEXORA OWNER|NEXORA USER|normal user|Owner settings|Owner dashboard|This is for/i.test(src),
      `${file} must not use role-identifying copy`,
    );
  }
});

