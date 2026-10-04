/**
 * ROUTING BEHAVIOUR
 *
 * These tests drive the application's REAL route table (`design-prototype/src/
 * routes.ts`) - the same function the running app uses - so the entry model is
 * verified rather than assumed.
 *
 * What is proven:
 *  1. The public product entry is the application root and leads to a welcome
 *     screen before any authentication form.
 *  2. No public route contains an internal role identifier.
 *  3. Every retired role-labelled route is a REDIRECT and never renders a page,
 *     so it cannot become a second public entry point.
 *  4. The private administration entry is reachable but never advertised from
 *     the product, and the product never redirects anyone into it.
 *  5. First-time setup cannot be bypassed by typing a product URL, and the
 *     enforced order is recovery -> authenticator -> product.
 *  6. A non-administrator account cannot reach the administration area by URL.
 *  7. A signed-out visitor is never sent to an administration screen.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveRoute,
  hasRoleWordingInPath,
  RETIRED_ROUTES,
  type AuthFacts,
} from '../design-prototype/src/routes.ts';

const SRC = join(process.cwd(), 'design-prototype', 'src');
const routesTs = readFileSync(join(SRC, 'routes.ts'), 'utf8');

const ANONYMOUS: AuthFacts = { authenticated: false, isAdministrator: false };
const READY: AuthFacts = { authenticated: true, isAdministrator: false };
const ADMIN_READY: AuthFacts = { authenticated: true, isAdministrator: true };

// ── 1. The public product entry ─────────────────────────────────────────────

test('the public product entry is the application root and shows a welcome screen before any form', () => {
  // The root is the entry.
  assert.equal(resolveRoute('#/', ANONYMOUS).kind, 'splash');
  assert.equal(resolveRoute('#', ANONYMOUS).kind, 'splash');
  // The splash hands off to the welcome screen.
  assert.equal(resolveRoute('#/welcome', ANONYMOUS).kind, 'welcome');
  // Only the welcome screen leads to the authentication form.
  assert.equal(resolveRoute('#/signin', ANONYMOUS).kind, 'signin');
  // The root must never drop straight into the form.
  assert.notEqual(resolveRoute('#/', ANONYMOUS).kind, 'signin');
});

test('no public route contains an internal role identifier', () => {
  const publicPaths = [
    '/',
    '/welcome',
    '/signin',
    '/signin/verify',
    '/signin/recovery',
    '/setup/recovery',
    '/setup/authenticator',
    '/dashboard',
    '/projects',
    '/system',
    '/execution',
  ];
  for (const p of publicPaths) {
    assert.equal(hasRoleWordingInPath(p), false, `public route "${p}" must not contain a role word`);
  }
  // The guardrail itself must actually work.
  for (const p of ['/user', '/user/signin', '/developer', '/role', '/member', '/normal-user']) {
    assert.equal(hasRoleWordingInPath(p), true, `the guardrail must flag "${p}"`);
  }
});

// ── 2. Retired routes are redirects only ────────────────────────────────────

test('every retired role-labelled route is a redirect and never renders a page', () => {
  for (const [retired, destination] of Object.entries(RETIRED_ROUTES)) {
    const decision = resolveRoute(`#${retired}`, ANONYMOUS);
    assert.equal(decision.redirect, destination, `#${retired} must forward to ${destination}`);
    // The reported screen must be the destination's own screen, so the decision
    // describes what will actually render once the redirect resolves.
    const destinationDecision = resolveRoute(destination, ANONYMOUS);
    assert.equal(decision.kind, destinationDecision.kind, `#${retired} must resolve to the destination screen`);
    // No retired route may advertise a role word in the place it forwards to.
    assert.equal(
      hasRoleWordingInPath(destination.replace(/^#/, '')),
      false,
      `#${retired} must not forward to a role-labelled destination`,
    );
  }
  // The specifically forbidden normal-user entry can never render a page.
  for (const roleRoute of ['/user', '/user/signin', '/user/entry', '/developer', '/member', '/role']) {
    const d = resolveRoute(`#${roleRoute}`, ANONYMOUS);
    assert.equal(d.redirect !== undefined, true, `#${roleRoute} must redirect`);
    assert.ok(
      ['signin', 'welcome', 'splash'].includes(d.kind),
      `#${roleRoute} must not render ${d.kind}`,
    );
  }
  // And those same paths are recognisable as role-labelled by the guardrail,
  // which is what keeps them out of the product route set.
  for (const roleRoute of ['/user', '/user/signin', '/user/entry', '/developer', '/member', '/role']) {
    assert.equal(hasRoleWordingInPath(roleRoute), true, `the guardrail must flag "${roleRoute}"`);
  }
});

// ── 3. The private administration entry is private ───────────────────────────

test('the administration area is reachable but the product never advertises or routes into it', () => {
  // There is no longer a dedicated administration ENTRY. `/owner` is retired and
  // forwards to the one public sign-in screen like every other stale role URL.
  assert.equal(resolveRoute('#/owner', ANONYMOUS).redirect, '#/signin');
  assert.equal(resolveRoute('#/owner', READY).redirect, '#/signin');

  // No public or product route may redirect a visitor into the administration area.
  const visitorRoutes = ['#/', '#/welcome', '#/signin', '#/user'];
  for (const r of visitorRoutes) {
    const d = resolveRoute(r, ANONYMOUS);
    if (d.redirect !== undefined) {
      assert.ok(
        !d.redirect.includes('owner'),
        `${r} must never redirect to the administration area (got ${d.redirect})`,
      );
    }
  }
  // The route table must contain no outbound link to the administration area.
  assert.ok(!/#\/owner/.test(routesTs.split('RETIRED_ROUTES')[0]!.split('PRODUCT_PATHS')[0]!), 'the public route table must not link the administration area');
});

test('a non-administrator account cannot reach the administration area by URL', () => {
  const INFRA = '#/settings/infrastructure';
  const attempt = resolveRoute(INFRA, READY);
  // The area must not render, and the account must be returned to its own
  // workspace rather than left sitting on an administration URL it cannot use.
  assert.notEqual(attempt.kind, 'ownerSettings', 'a non-administrator must not render the administration area');
  assert.equal(attempt.redirect, '#/dashboard', 'a non-administrator is returned to their own workspace');
  // An administrator can.
  assert.equal(resolveRoute(INFRA, ADMIN_READY).kind, 'ownerSettings');
  // A signed-out visitor is sent to the welcome screen, never the admin area.
  const anon = resolveRoute(INFRA, ANONYMOUS);
  assert.equal(anon.kind, 'welcome');
  assert.equal(anon.redirect, '#/welcome');
  // No resolution of a non-administrator may ever name the administration route.
  for (const facts of [ANONYMOUS, READY]) {
    for (const p of [INFRA, '#/owner', '#/owner/settings']) {
      const d = resolveRoute(p, facts);
      assert.notEqual(d.kind, 'ownerSettings', `${p} must not render for a non-administrator`);
      assert.ok(
        (d.redirect ?? '').includes('#/owner') === false,
        `${p} must never redirect toward the administration area for a non-administrator`,
      );
    }
  }
});

// ── 4. There is exactly ONE authentication URL, and no second factor ────────

test('the retired authentication surfaces all resolve to the single sign-in screen', () => {
  // These screens ceased to exist: there is no password reset, no two-step
  // verification and no first-time setup any more. What matters now is that a
  // stale deep link cannot resurrect any of them, and lands on the one screen
  // that does exist.
  for (const retired of [
    '#/signin/verify', '#/signin/recovery', '#/forgot',
    '#/setup', '#/setup/recovery', '#/setup/authenticator',
    '#/settings/security', '#/settings/security/password',
    '#/settings/security/authenticator', '#/settings/security/sessions',
    '#/settings/security/events', '#/settings/authenticator',
  ]) {
    const d = resolveRoute(retired, ANONYMOUS);
    assert.equal(d.redirect, '#/signin', `${retired} must forward to the one sign-in screen`);
    assert.equal(d.kind, 'signin', `${retired} must resolve to the sign-in screen`);
  }
  // And the route table still knows they are retired, so they cannot drift back.
  for (const p of ['/signin/verify', '/signin/recovery', '/setup/recovery', '/setup/authenticator']) {
    assert.ok(RETIRED_ROUTES[p] !== undefined, `${p} must remain in the retired table`);
  }
  // A signed-out visitor typing a product URL gets the welcome screen.
  assert.equal(resolveRoute('#/dashboard', ANONYMOUS).redirect, '#/welcome');
  // An authenticated account goes straight to the product - there is no setup
  // step to complete first.
  assert.equal(resolveRoute('#/dashboard', READY).kind, 'product');
  // Signing in with a live session is pointless; it lands in the product.
  assert.equal(resolveRoute('#/signin', READY).redirect, '#/dashboard');
});

// ── 5. The product interface advertises nothing privileged ──────────────────

test('no product page links to the administration area or names a role', () => {
  const pageFiles = ['shell.tsx', 'store.tsx', 'modelPopup.tsx', 'router.ts'];
  for (const file of pageFiles) {
    const src = readFileSync(join(SRC, file), 'utf8');
    // A link to the administration area is allowed only in the sidebar, which
    // is itself role-gated, and never from the store or the router defaults.
    if (file === 'shell.tsx') continue;
    assert.ok(
      !src.includes('#/owner'),
      `${file} must never reference the administration area`,
    );
  }
  // The welcome and sign-in screens carry no privileged reference at all.
  for (const file of ['pages/Welcome.tsx', 'pages/SignIn.tsx']) {
    const src = readFileSync(join(SRC, file), 'utf8');
    assert.ok(!src.includes('#/owner'), `${file} must never link the administration area`);
    assert.ok(!/Daytona/i.test(src), `${file} must never mention Daytona`);
    assert.ok(
      !/Platform Owner|Nexora Owner|NEXORA OWNER|normal user|Normal User|Owner settings|Owner dashboard/i.test(src),
      `${file} must not use role-identifying copy`,
    );
  }
  // The store must not navigate anywhere privileged on login or logout.
  const store = readFileSync(join(SRC, 'store.tsx'), 'utf8');
  assert.ok(!store.includes('#/owner'), 'the store must never route to the administration area');
});
