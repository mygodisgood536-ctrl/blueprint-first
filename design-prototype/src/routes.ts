/**
 * ROUTE RESOLUTION
 *
 * The application's route table lives here as a pure function so the routing
 * decisions - which screen a URL produces, and which URLs are retired - are
 * directly testable instead of only observable by eye.
 *
 * Route model
 * -----------
 * PUBLIC PRODUCT ENTRY (no role wording in any URL):
 *   ''/ ''            the application root: brand splash, then the welcome screen
 *   /welcome          the product welcome screen
 *   /signin           sign in, or create an account
 *   /signin/verify    the 6-digit authenticator code
 *   /signin/recovery  password recovery
 *   /setup/recovery   first-time recovery questions   (mandatory)
 *   /setup/authenticator  first-time authenticator    (mandatory)
 *   /dashboard ...    the workspace
 *
 * PRIVATE ADMINISTRATION ENTRY (unadvertised, never linked from the product):
 *   /owner            create / sign in to the administration account
 *   /owner/settings   platform configuration
 *
 * RETIRED ROUTES
 *   A retired route never renders a page of its own; it resolves to a
 *   `redirect` so a stale bookmark or deep link lands on the intended screen
 *   and can never become a second, role-named public entry point.
 */
export type RouteKind =
  | 'splash'
  | 'welcome'
  | 'signin'
  | 'signinVerify'
  | 'signinRecovery'
  | 'setupRecovery'
  | 'setupAuthenticator'
  | 'ownerAccess'
  | 'ownerSettings'
  | 'product'
  | 'notFound'

export interface RouteDecision {
  kind: RouteKind
  /** Where a retired or out-of-order route should forward to. */
  redirect?: string
  /** True when the decision needs an authenticated account. */
  requiresAuth?: boolean
}

export interface AuthFacts {
  authenticated: boolean
  setupComplete: boolean
  recoveryPending: boolean
  totpPending: boolean
  isAdministrator: boolean
}

/** Retired routes that only ever forward. Keyed by the path the router sees. */
export const RETIRED_ROUTES: Readonly<Record<string, string>> = {
  '/user': '#/signin',
  '/user/signin': '#/signin',
  '/user/entry': '#/',
  '/developer': '#/signin',
  '/member': '#/signin',
  '/role': '#/signin',
  '/intro': '#/welcome',
  '/login': '#/signin',
  '/login/verify': '#/signin/verify',
  '/signup': '#/signin',
  '/forgot': '#/signin/recovery',
  '/splash': '#/',
  '/settings/authenticator': '#/setup/authenticator',
}

/** Product paths served to an authenticated, fully set-up account. */
const PRODUCT_PATHS: ReadonlySet<string> = new Set([
  '/dashboard',
  '/projects',
  '/projects/new',
  '/documents',
  '/artifacts',
  '/evidence',
  '/lineage',
  '/dependency-map',
  '/traceability',
  '/expansion',
  '/twin',
  '/system',
  '/execution',
  '/verification',
  '/testing',
  '/operations',
  '/continuous',
  '/certification',
  '/settings/profile',
  '/settings/security',
  '/settings/security/password',
  '/settings/security/authenticator',
  '/settings/security/sessions',
  '/settings/security/events',
  '/settings/preferences',
  '/help',
  '/faq',
  '/founder',
  '/about',
])

/**
 * Resolves a hash route into the screen to render.
 *
 * Order matters and is deliberate:
 *  1. The private administration entry is resolved first and unconditionally, so
 *     it is reachable but never advertised.
 *  2. Retired routes forward. They can never render content of their own.
 *  3. The public entry, welcome and authentication screens.
 *  4. First-time setup, which requires a session.
 *  5. Mandatory setup gates, which the server enforces independently.
 *  6. The product.
 */
export function resolveRoute(hash: string, auth: AuthFacts, depth = 0): RouteDecision {
  const { path, parts } = splitRoute(hash)

  // 1. Private administration entry.
  if (path === '/owner') return { kind: 'ownerAccess' }

  // 2. Retired routes forward only. The decision is resolved against the
  //    destination so the reported screen is the one that will actually render,
  //    and `depth` guarantees a mis-authored table can never loop.
  const retired = RETIRED_ROUTES[path]
  if (retired !== undefined) {
    if (depth >= 2) return { kind: 'welcome', redirect: '#/welcome' }
    const target = resolveRoute(retired, auth, depth + 1)
    return { kind: target.kind, redirect: retired, requiresAuth: target.requiresAuth }
  }

  // 3. Public product entry and authentication.
  if (path === '' || path === '/') return { kind: 'splash' }
  if (path === '/welcome') return { kind: 'welcome' }
  if (path === '/signin') return { kind: 'signin' }
  if (path === '/signin/verify') return { kind: 'signinVerify' }
  if (path === '/signin/recovery') return { kind: 'signinRecovery' }
  if (path === '/how' || path === '/difference' || path === '/use-cases') {
    return { kind: 'product', requiresAuth: false }
  }

  // 4. First-time setup. A session is required to reach these screens.
  if (path === '/setup/recovery') {
    return auth.authenticated ? { kind: 'setupRecovery', requiresAuth: true } : { kind: 'signin', redirect: '#/signin' }
  }
  if (path === '/setup/authenticator') {
    return auth.authenticated
      ? { kind: 'setupAuthenticator', requiresAuth: true }
      : { kind: 'signin', redirect: '#/signin' }
  }

  // 5. Platform configuration: refused for a non-administrator account, and the
  //    server refuses the corresponding APIs regardless. A non-administrator is
  //    returned to their own workspace rather than left sitting on an
  //    administration URL they cannot use, which would misrepresent the page.
  if (path === '/owner/settings' || path === '/owner/infrastructure') {
    if (!auth.authenticated) return { kind: 'welcome', redirect: '#/welcome' }
    if (!auth.isAdministrator) return { kind: 'product', redirect: '#/dashboard' }
    if (!auth.setupComplete) return { kind: 'product', redirect: '#/setup/recovery' }
    return { kind: 'ownerSettings', requiresAuth: true }
  }

  // 6. The product requires a session.
  if (!auth.authenticated) return { kind: 'welcome', redirect: '#/welcome' }

  // Mandatory setup, in the enforced order. The server answers 403 on every
  // product route until both steps are complete, so this is a convenience.
  if (auth.recoveryPending) return { kind: 'product', redirect: '#/setup/recovery' }
  if (auth.totpPending) return { kind: 'product', redirect: '#/setup/authenticator' }
  if (!auth.setupComplete) return { kind: 'product', redirect: '#/setup/recovery' }

  if (PRODUCT_PATHS.has(path)) return { kind: 'product', requiresAuth: true }
  // Parameterised product routes: /projects/:id, /artifacts/:id, ...
  if (parts.length >= 2 && ['projects', 'documents', 'artifacts', 'evidence'].includes(parts[0]!)) {
    return { kind: 'product', requiresAuth: true }
  }
  return { kind: 'notFound' }
}

/**
 * TEMPORARY AUDIT MODE - NOT THE FINAL ENTRY ARCHITECTURE.
 *
 * While authentication is deliberately set aside for a backend/execution audit,
 * the product still presents its normal splash and welcome experience; only the
 * authentication hand-off itself is bypassed, so "Get started" enters the
 * workspace directly. There is ONE application URL. No role is ever taken from
 * the URL: identity and permissions remain the backend's decision.
 */
export const AUDIT_MODE_FLAG = '/audit-mode';

/** Product entry for a signed-in, fully set-up account. */
export const PRODUCT_HOME = '#/dashboard';

export function isAuditModePath(path: string): boolean {
  return path === '/audit-mode';
}

export function hasRoleWordingInPath(path: string): boolean {
  return /(^|\/)(user|users|developer|developers|member|members|role|roles|normal-user|customer|admin|owner)(?=\/|$)/i.test(
    path,
  )
}

/**
 * Splits a hash route into its path segments. Self-contained so the route table
 * can be exercised directly, without a browser, by the test suite.
 */
export function splitRoute(hash: string): { path: string; parts: string[] } {
  const withoutHash = hash.replace(/^#/, '')
  const [rawPath = ''] = withoutHash.split('?')
  return { path: rawPath, parts: rawPath.split('/').filter(Boolean) }
}
