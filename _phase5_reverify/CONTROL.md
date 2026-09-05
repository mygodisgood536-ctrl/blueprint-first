# Phase 5 Re-verification — Control Document

## Purpose
Independent re-verification of Phase 5 (Application Shell & Dashboard) against the REAL implementation, not the previous report.

## Status Legend
- [x] verified OK
- [ ] not yet verified
- [~] partial / needs attention
- [FAIL] failed — see findings

---

## 1. Application Shell
- [ ] Session bootstrap calls backend GET /api/me
- [ ] Unauthenticated user cannot access protected routes by direct URL
- [ ] Expired/revoked/invalid session → unauthenticated state
- [ ] Frontend does not rely on stale JS state to fake login
- [ ] Username shown = real authenticated username (no hardcoded/fake)
- [ ] Every nav item leads somewhere real
- [ ] Every account menu action performs intended behavior
- [ ] Logout calls backend + invalidates session
- [ ] After logout, protected access denied
- [ ] Refresh after logout does NOT restore auth
- [ ] Login again establishes real session
- [ ] Shell correct after refresh and direct navigation

## 2. Dashboard
- [ ] Every displayed value has a real backend source
- [ ] No fake stats/counts/activity/provider status
- [ ] Empty state: "No projects yet" + Create Project
- [ ] Empty state primary action → project creation route
- [ ] Real project appears from backend data
- [ ] Project persists across refresh
- [ ] Project persists across server restart
- [ ] Dashboard reconstructs from persistent state

## 3. Activity (/api/activity)
- [ ] Activity production path understood
- [ ] Activity associated with correct account
- [ ] Activity retrieval correct
- [ ] Sorting correct (timestamps)
- [ ] Account isolation (A cannot see B's activity)
- [ ] Empty state honest
- [ ] Dependency-unavailable → honest error, not fake success

## 4. Profile & Settings Navigation
- [ ] Profile shows authenticated user's real data
- [ ] Full name from backend
- [ ] Username from backend
- [ ] No hardcoded account info
- [ ] Security → real security center
- [ ] Preferences → real preferences page
- [ ] Logout performs real logout
- [ ] Every option has real destination/behavior

## 5. Preferences
- [ ] GET returns real persisted preferences
- [ ] POST validates + persists
- [ ] Frontend reflects saved state
- [ ] Reload → preference remains
- [ ] Server restart → preference remains
- [ ] Invalid values rejected
- [ ] Unauthorized → 401
- [ ] Account isolation (A vs B preferences independent)

## 6. Authentication State Lifecycle
- [ ] create account → login → dashboard → refresh → navigate → logout → protected denied → login again → dashboard
- [ ] Session revocation → 401 → login page
- [ ] Frontend handles 401 correctly
- [ ] Navigation state sensible after auth

## 7. Account Isolation (mandatory)
- [ ] Account A creates data
- [ ] Account B logs in independently
- [ ] B cannot see A's dashboard/projects/activity/preferences/providers
- [ ] Backend endpoints reject unauthorized access
- [ ] Reverse: A cannot see B's data

## 8. Frontend/Backend Contract Audit
- [ ] api.js request method correct
- [ ] auth.ts session resolution correct
- [ ] Dashboard endpoints: /api/me, /api/projects, /api/activity, /api/models/selection, /api/credentials
- [ ] Preferences endpoints: GET + POST /api/account/preferences
- [ ] Request method, URL, body, headers, auth all correct
- [ ] Backend validation present
- [ ] Response schema matches frontend parsing
- [ ] Frontend state update correct
- [ ] Visible result correct

## 9. Silent Failure Investigation
- [ ] No 200-without-change
- [ ] No false success messages
- [ ] No stale frontend state
- [ ] No incorrect response parsing
- [ ] No wrong URLs/methods
- [ ] No duplicate submissions
- [ ] No race conditions
- [ ] No data loss after refresh/restart
- [ ] No unauthorized access
- [ ] No UI actions that do nothing
- [ ] No links to nonexistent pages
- [ ] No swallowed frontend errors
- [ ] No backend errors presented as success

## 10. Browser Verification
- [ ] App actually starts
- [ ] Shell renders
- [ ] Dashboard renders
- [ ] Account menu works
- [ ] Profile works
- [ ] Preferences works
- [ ] Sidebar navigation works
- [ ] Logout works
- [ ] Login again works
- [ ] Refresh works
- [ ] Direct navigation works
- [ ] Empty dashboard works
- [ ] Real-data dashboard works

## 11. Responsive Verification
- [ ] 320px
- [ ] 375px
- [ ] 480px
- [ ] 768px
- [ ] 1024px
- [ ] 1440px+

## 12. Visual Quality
- [ ] Professional, calm, structured
- [ ] No placeholder elements
- [ ] Consistent components
- [ ] Clear information communication

## 13. Every Interactive Element
- [ ] Each element has legitimate purpose + behavior

---

## Findings Log

### Finding 1: Preferences validation threw wrong error type [BUG — FIXED]
- **Location**: `src/account/accounts.ts:286,290,293`
- **Issue**: Invalid preference keys, non-scalar values, and over-long values threw `AuthenticationError` (→ HTTP 401). These are validation errors that should return 400. The 401 would also trigger the frontend's `onUnauthorized` handler, potentially redirecting to login for a simple validation mistake.
- **Fix**: Changed to throw `Error` (→ 400 via `errorStatus` default).

### Finding 2: Activity endpoint discarded document activity [BUG — FIXED]
- **Location**: `src/web/server.ts:398-401`
- **Issue**: `if (projects.length === 0) { return { activity: [] } }` discarded all document activity when the user had no projects. A user with documents but no projects would see empty activity.
- **Fix**: Changed condition to `projects.length === 0 && documents.length === 0`.

### Finding 3: Activity sort produced NaN for documents [BUG — FIXED]
- **Location**: `src/web/server.ts:412,415-416`
- **Issue**: Documents have no timestamp (`timestamp: ''`). `new Date('').getTime()` returns `NaN`, making the sort comparator return `NaN` (unpredictable order).
- **Fix**: Added `ts()` helper that returns 0 for non-finite timestamps.

### Finding 4: Static files not served at correct path [BUG — FIXED]
- **Location**: `src/web/server.ts:259`
- **Issue**: `express.static(PUBLIC_DIR)` served files at root (`/css/tokens.css`), but the HTML references `/nexona/css/tokens.css`. This would cause all CSS/JS to 404 in the browser, breaking the entire UI.
- **Fix**: Changed to `app.use('/nexona', express.static(PUBLIC_DIR))`.

### Finding 5: Root path returned 404 [BUG — FIXED]
- **Location**: `src/web/server.ts` (missing route)
- **Issue**: After fixing static serving to `/nexona/`, the root path `/` returned 404. The browser needs `/` to load the SPA shell.
- **Fix**: Added `app.get('/')` handler that serves `index.html`.

### Finding 6: Test harness used incomplete stub [TEST ISSUE — FIXED]
- **Location**: `_phase5_reverify/verify.mjs`
- **Issue**: The initial test used `result: { baseline: { projectId: 'p' } }` which lacks a `registry`, causing all project endpoints to return 501.
- **Fix**: Changed to run the real `runDemoPipeline()` to get a complete result with a working registry.

## Fixes Applied
1. `src/account/accounts.ts`: preference validation errors → `Error` (400) instead of `AuthenticationError` (401)
2. `src/web/server.ts`: activity endpoint — combined empty check, NaN-safe sort
3. `src/web/server.ts`: static files mounted at `/nexona` to match HTML references
4. `src/web/server.ts`: added root `/` handler to serve index.html
5. `_phase5_reverify/verify.mjs`: use real demo pipeline result for complete registry

## Verification Evidence
- `_phase5_reverify/result_final.txt`: 31/31 e2e REST checks pass (auth lifecycle, isolation, preferences, activity, dashboard, profile, restart persistence)
- `_phase5_reverify/smoke_result.txt`: 15/15 static-serving checks pass (HTML, CSS, JS, images all served with correct content types)
- `_phase5_reverify/tsc_final.txt`: empty (typecheck GREEN)
- All 8 frontend JS files pass `node --check`
- All 3 CSS files balanced (tokens 8/8, layout 80/80, components 237/237)
