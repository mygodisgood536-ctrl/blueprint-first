/**
 * ROUTE RESOLUTION
 *
 * The application's route table lives here as a pure function so the routing
 * decisions - which screen a URL produces, and which URLs are retired - are
 * directly testable instead of only observable by eye.
 *
 * Route model
 * -----------
 * ONE PUBLIC APPLICATION URL. There is no role-named entry point: no /owner,
 * no /user, no developer/member variant. Authorization decides what an
 * authenticated account may see AFTER sign-in; it is never encoded in the URL.
 *
 * PUBLIC ENTRY (no role wording in any URL):
 *   '/'            the application root: brand splash, then the welcome screen
 *   /welcome       the product welcome screen
 *   /signin        sign in, or create an account (the ONLY authentication URL)
 *   /dashboard ... the workspace
 *
 * PRIVILEGED PAGES (unadvertised, never linked from the product; the server
 * refuses the corresponding APIs for any other account regardless):
 *   /settings/infrastructure   platform configuration
 *
 * RETIRED ROUTES
 *   A retired route never renders a page of its own and never re-enters an old
 *   flow: it forwards to the single current sign-in screen. `/signin/verify`,
 *   `/signin/recovery`, `/setup/*`, `/owner` and `/user` all land there, so no
 *   stale bookmark can become a second public entry point or resurrect a
 *   password, OTP, authenticator or recovery screen.
 */
export type RouteKind = 'splash' | 'welcome' | 'signin' | 'ownerSettings' | 'product' | 'notFound'

export interface RouteDecision {
  kind: RouteKind
  /** Where a retired or out-of-order route should forward to. */
  redirect?: string
  /** True when the decision needs an authenticated account. */
  requiresAuth?: boolean
}

export interface AuthFacts {
  authenticated: boolean
  isAdministrator: boolean
}

/**
 * Retired routes that only ever forward to the one current sign-in screen.
 * None resolves to a password, OTP, authenticator or recovery screen, because
 * those screens no longer exist anywhere in the application.
 */
export const RETIRED_ROUTES: Readonly<Record<string, string>> = {
  '/signin/verify': '#/signin',
  '/signin/recovery': '#/signin',
  '/forgot': '#/signin',
  '/setup': '#/signin',
  '/setup/recovery': '#/signin',
  '/setup/authenticator': '#/signin',
  '/settings/authenticator': '#/signin',
  '/settings/security': '#/signin',
  '/settings/security/password': '#/signin',
  '/settings/security/authenticator': '#/signin',
  '/settings/security/sessions': '#/signin',
  '/settings/security/events': '#/signin',
  '/owner': '#/signin',
  '/owner/access': '#/signin',
  '/owner/settings': '#/signin',
  '/owner/infrastructure': '#/signin',
  '/user': '#/signin',
  '/user/signin': '#/signin',
  '/user/entry': '#/',
  '/developer': '#/signin',
  '/member': '#/signin',
  '/role': '#/signin',
  '/intro': '#/welcome',
  '/login': '#/signin',
  '/signup': '#/signin',
  '/splash': '#/',
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
 *  1. Retired routes forward. They can never render content of their own.
 *  2. The public entry, welcome and the single sign-in screen.
 *  3. Privileged pages: reachable only with a session, and only for the
 *     privileged account. A non-privileged account is returned to their own
 *     workspace rather than left on a URL the server would refuse.
 *  4. The product.
 */
export function resolveRoute(hash: string, auth: AuthFacts, depth = 0): RouteDecision {
  const { path, parts } = splitRoute(hash)

  // 1. Retired routes forward only. The decision is resolved against the
  //    destination so the reported screen is the one that will actually render,
  //    and `depth` guarantees a mis-authored table can never loop.
  const retired = RETIRED_ROUTES[path]
  if (retired !== undefined) {
    if (depth >= 2) return { kind: 'welcome', redirect: '#/welcome' }
    const target = resolveRoute(retired, auth, depth + 1)
    return { kind: target.kind, redirect: retired, requiresAuth: target.requiresAuth }
  }

  // 2. Public product entry and the one authentication screen.
  if (path === '' || path === '/') return { kind: 'splash' }
  if (path === '/welcome') return { kind: 'welcome' }
  if (path === '/signin') {
    return auth.authenticated ? { kind: 'product', redirect: PRODUCT_HOME } : { kind: 'signin' }
  }
  if (path === '/how' || path === '/difference' || path === '/use-cases') {
    return { kind: 'product', requiresAuth: false }
  }

  // 3. Privileged platform configuration. Presentation only — the server
  //    refuses these APIs for any other account independently.
  if (path === '/settings/infrastructure') {
    if (!auth.authenticated) return { kind: 'welcome', redirect: '#/welcome' }
    if (!auth.isAdministrator) return { kind: 'product', redirect: PRODUCT_HOME }
    return { kind: 'ownerSettings', requiresAuth: true }
  }

  // 4. The product requires a session.
  if (!auth.authenticated) return { kind: 'welcome', redirect: '#/welcome' }

  if (PRODUCT_PATHS.has(path)) return { kind: 'product', requiresAuth: true }
  // Parameterised product routes: /projects/:id, /artifacts/:id, ...
  if (parts.length >= 2 && ['projects', 'documents', 'artifacts', 'evidence'].includes(parts[0]!)) {
    return { kind: 'product', requiresAuth: true }
  }
  return { kind: 'notFound' }
}

/** Product entry for a signed-in account. */
export const PRODUCT_HOME = '#/dashboard'

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
