# NEXORA — Product & Page Blueprint

> Page-by-page specification. For every page/screen: identity, visual structure, content, interactions, states, responsive behavior, and the full UI→API→Backend→Persistence→Response→UI contract. Designed incrementally, one page at a time.

## Design System Foundation

### Visual tokens (`nexona/css/tokens.css`)
- Color scheme: dark (`color-scheme: dark`)
- Typography, spacing, color, motion tokens
- `reducedMotion` token present

### Component primitives (`nexona/css/components.css`)
- `.btn` variants (`.btn--primary`, `.btn--sm`, etc.)
- Cards, forms, tables, grid
- `.top-bar` shell, `.account-dropdown`, `.sidebar`

### Layout (`nexona/css/layout.css`)
- Top bar + sidebar shell + `#app-content` main
- Body class `main-app` toggles shell chrome
- Public pages: full-bleed (no shell)

### JS primitives (`nexona/js/ui/`)
- `modal.js` — modal/dialog
- `toast.js` — non-blocking toasts (`aria-live="polite"`)

### Shell (`nexona/js/app.js`)
- Top bar: NEXORA brand → `#/` · search input · account dropdown (Profile / Security / Preferences / Help)
- Sidebar links: Dashboard `◧` · Projects `⧉` · Providers `⚙` · Settings `⚿` · Help `?`
- Account dropdown items reference: `#/settings/profile`, `#/settings/security`, `#/settings/preferences`, `#/help`

### Component test page
- `nexona/test-components.html` — exercises all component variants for visual verification
- Covers: buttons (9 variants), badges (5), cards (2), form states (4), tables, empty state, loading skeleton, error state, success state, toasts (3), modal

## Public Pages

### Page: Splash / Brand Reveal
- **Purpose:** First impression — professional NEXORA brand reveal.
- **Access:** Everyone (pre-auth).
- **Entry/Exit:** On load → auto-transition to Introduction after ~4 s.
- **Visual:** Centered NEXORA wordmark + tagline. Restrained animation. Respects `prefers-reduced-motion`.
- **Backend:** None (independent of backend).
- **Status:** `[!]` Not started — transition timer needs implementation.

### Page: Introduction
- **Purpose:** Progressive guided product story.
- **Access:** Everyone (pre-auth).
- **Entry/Exit:** Splash → here; Continue → next step; Back → previous step.
- **Steps:** 1. What is NEXORA? → 2. Problem with ordinary AI coding → 3. Blueprint-First → 4. Discovery → 5. Design → 6. Blueprint → 7. Human approval → 8. Engineering → 9. Independent verification → 10. Evidence & traceability → 11. Testing & Operations → 12. Runtime → 13. Continuous Engineering → 14. Differentiation.
- **Backend:** None.
- **Interactions:** Continue button, Back button, skip-to-login.
- **Status:** `[~]` `intro.js` exists; needs step-by-step verification.

### Page: Customer Care / Help
- **Purpose:** Founder contact.
- **Access:** Everyone.
- **Content:** Cornelius Adedeji Victor · WhatsApp 08154076947 · Phone 07061743252 · Email adedejicorneliusvictor@gmail.com.
- **Interactions:** Real clickable WhatsApp, phone, email links.
- **Backend:** None.
- **Status:** `[!]` Not started.

### Page: Signup
- **Purpose:** Create account.
- **Access:** Anonymous only.
- **Entry/Exit:** From Introduction or Login → on success, redirect to Dashboard.
- **Fields:** Legal name, username, password, password confirmation.
- **Validation:** Username uniqueness, password strength, field match, real-time frontend + backend.
- **Backend:** `POST /api/auth/signup` → 201 + `nexona_session` cookie.
- **Errors:** Duplicate username (409), weak password (400), server errors.
- **UI→API→Backend→Persistence:** POST /api/auth/signup → auth-api.ts → AccountRegistry.createAccount → bcrypt hash → durable accounts.json → 201 + Set-Cookie.
- **Status:** `[~]` `signup.js` exists; verify error handling.

### Page: Login
- **Purpose:** Authenticate.
- **Access:** Anonymous only.
- **Entry/Exit:** On success → Dashboard.
- **Fields:** Username, password.
- **Backend:** `POST /api/auth/login` → 200 + cookie.
- **Errors:** Wrong credentials (401), rate-limited (429).
- **Status:** `[~]` `login.js` exists.

### Page: Forgot Password
- **Purpose:** Recover account via authenticator.
- **Access:** Anonymous only.
- **Steps:** 1. Identify account (username) → 2. Authenticator verification (TOTP code) → 3. New password → 4. Confirmation → session invalidation → login.
- **Backend:** `/api/auth/forgot` → `/api/auth/forgot/verify` → `/api/auth/reset`.
- **No OTP:** Uses TOTP code, not SMS/email OTP.
- **Status:** `[~]` `forgot.js` exists; needs full flow verification.

### Page: 404 / Not Found
- **Purpose:** Not-found state.
- **Access:** Everyone.
- **Visual:** Clear "page not found" + link to Dashboard.
- **Backend:** Static fallback route.
- **Status:** `[~]` `404.js` exists.

## Authenticated Pages

### Page: Dashboard
- **Purpose:** User's NEXORA control center.
- **Access:** Authenticated.
- **Entry/Exit:** After login/signup → here. Sidebar → Dashboard.
- **Content:** Real user identity (`GET /api/me`), project list (`GET /api/projects`), recent activity (`GET /api/activity`), AI model selection status (`GET /api/models/selection`), verification state, attention items, useful shortcuts.
- **Visual:** Summary cards (real data only), project cards, activity feed, status indicators.
- **Empty state:** "No projects yet" + Create Project button.
- **Backend contract:** `GET /api/me` → `GET /api/projects` → `GET /api/activity` → `GET /api/models/selection`.
- **Status:** `[✓]` Implemented (`dashboard.js`) — verified real data reads on all 4 endpoints + `GET /api/credentials`.

### Page: Projects List
- **Purpose:** See all projects.
- **Access:** Authenticated.
- **Content:** Per-user projects (isolated). Each card: title, mode badge, status, project id, last activity. Delete with confirm. Empty state with Create CTA.
- **View:** `projects.js` (grid of `.project-card` items). Sidebar "Projects" links here.
- **Backend:** `GET /api/projects` → `/api/projects` route in server.ts (owner-filtered) + `DELETE /api/projects/:id`.
- **Status:** `[✓]` Implemented (Stage 6).

### Page: Create Project
- **Purpose:** Start a new engineering project.
- **Access:** Authenticated.
- **Entry:** Dashboard + Projects button.
- **Fields:** Title, lifecycle mode (design-only / design-plus-code / full-product), idea/intent (natural language).
- **Backend:** `POST /api/projects` → ProjectRegistry.createProject → durable artifact store.
- **Status:** `[~]` `project-new.js` exists.

### Page: Project Workspace
- **Purpose:** Drive the Blueprint-First pipeline.
- **Access:** Authenticated (owner or admin).
- **Entry:** From Projects list → open project (route `#/projects/:id`).
- **View:** `project.js` — identity header, mode/status/stages-run/approval meta, full lifecycle stage list (in-scope and out-of-scope) with honest `OUT_OF_SCOPE` labelling, "Run stage" action for in-scope pending stages only, link to settings.
- **Tabs/stages:** Discovery → Design → Design Verification → Blueprint → Approval → Architecture → Implementation → Testing → Verification → Deployment → Operations → Maintenance → Continuous Improvement.
- **In-scope stages** depend on project mode (see `PROJECT_MODE_STAGES`). Out-of-scope stages are shown but disabled with a clear "not in scope" label.
- **Actions:** Run stage (`POST /api/projects/:id/run/:stageId`), approve blueprint (`POST /api/projects/:id/approve`).
- **Views:** `GET /api/discovery`, `GET /api/design`, `GET /api/council`, `GET /api/verification`, etc.
- **Status:** `[✓]` Implemented (Stage 6).

## Blueprint-First Workspace — Per-Stage Views (Stage 8)

Each project lifecycle stage is inspectable as its own tab, sharing the project workspace shell. Route: `#/projects/:id/stages/:stageId`.

| Stage (tab) | Route / Endpoint | Frontend view | Backend | Status |
|-------------|------------------|---------------|---------|--------|
| 8.1 Discovery | `GET /api/discovery` | `project-stage.js` → Discovery renderer | defensive `PENDING_DISCOVERY` guard | `[✓]` |
| 8.2 Design | `GET /api/design` | Design renderer | defensive `PENDING_DESIGN` guard | `[✓]` |
| 8.3 Blueprint | `GET /api/certification` | Blueprint renderer | real `BlueprintCertificationResult` fields; `PENDING_CERT` guard | `[✓]` |
| 8.4 Approval | `POST /api/projects/:id/approve` | Approval renderer (`Approve blueprint`) | project-scoped (`PROJECT_ONLY`) | `[✓]` |
| 8.5 Build | `POST /api/projects/:id/run/:stageId` | Build renderer (`Run` per in-scope pending stage) | project-scoped (`PROJECT_ONLY`); in-scope pending stages listed | `[✓]` |
| 8.6 Verification | `GET /api/verification` | Verification renderer | defensive `PENDING_VERIFICATION` guard | `[✓]` |
| 8.7 Testing | `GET /api/testing` | Testing renderer | defensive `PENDING_TEST` guard | `[✓]` |
| 8.8 Operations/Runtime | `GET /api/deployment`, `/api/telemetry`, `/api/continuous`, `/api/recursion`, `/api/safe-change`, `/api/peo` | Operations/Runtime/Telemetry/Continuous renderers | all defensive `PENDING_*` guards | `[✓]` |

- **Wiring:** `api.js` exports `getDiscovery`, `getDesign`, `getCouncil`, `getVerification`, `getTesting`, `getDeployment`, `getTelemetry`, `getContinuous` + `approveBlueprint`/`runStage`; `router.js` registers `#/projects/:id/stages/:stageId` → `project-stage`; `project.js` stage rows link into the per-stage view; `components.css` (`nexona/css/`) grew `.tabs`, `.status-pill--*`, `.stage-panel*`, `.meta-grid*`, `.evidence-row*`, `.diff-view` (braces 321/321).
- **Security:** all 12 Stage 8 GET endpoints are auth-guarded (401 without a session); approve/run are project-owner checked.
- **Tests:** `test/stage8-api.test.ts` — 14 tests, 200/401 across all 12 stage endpoints, per-stage shape assertions, approve/run 401 + 404. **14/14 pass.** Full suite **379 pass, 0 fail** (two batches). `tsc --noEmit` GREEN.

### Page: Project Settings
- **Purpose:** Edit project title/mode; delete the project.
- **Access:** Authenticated (owner). Route: `#/projects/:id/settings`.
- **View:** `project-settings.js` — title + mode form (PUT), danger-zone delete (DELETE with confirm), 404 state for missing/foreign projects.
- **Backend:** `PUT /api/projects/:id` (owner-checked title/mode update; validates 2–64 char title and `PROJECT_MODES` enum) and `DELETE /api/projects/:id`.
- **Status:** `[✓]` Implemented (Stage 6).

## Files & Inputs Pages

### Page: Documents List
- **Purpose:** See all documents uploaded by the current account.
- **Access:** Authenticated. Route: `#/documents`. Sidebar entry: `Documents` (between Projects and Providers).
- **View:** `documents.js` — grid of cards showing id, char/byte length, content-hash preview, Open and Delete actions; empty-state with upload CTA; honest 401/error/retry states.
- **Backend:** `GET /api/documents` → `{ documents, count }` (owner-filtered) and `DELETE /api/documents/:id` for the per-card delete.
- **Status:** `[✓]` Implemented (Stage 7).

### Page: Document Detail
- **Purpose:** Read the full content of a document the user owns.
- **Access:** Authenticated (owner). Route: `#/documents/:id`.
- **View:** `document.js` — back link, identity header (id + char/byte/hash), bounded preview, monospace full content, delete (DELETE with confirm), 404 state for missing/foreign documents, error/retry.
- **Backend:** `GET /api/documents/:id?full=true` (full content opt-in) and `DELETE /api/documents/:id`.
- **Status:** `[✓]` Implemented (Stage 7).

### Page: Document Upload
- **Purpose:** Upload text files (up to 5 MB) and paste text that may turn into a document reference.
- **Access:** Authenticated. Route: `#/documents/upload`.
- **View:** `documents-upload.js` — drag-and-drop + file picker with 5 MB client guard and progress bar; success toast then auto-routes to the new document. A second card exposes a paste-text box that calls `api.chatIngest(text)` and shows the short→message vs long→document classification live (with a link to the created document).
- **Backend:** `POST /api/documents/upload` (multipart, "file" field, text-only, 5 MB cap, owner-scoped) and `POST /api/chat/ingest` (json `{ text }` → `IngestionResult`). Text at or above 4,000 chars becomes a document reference; shorter text stays a chat message.
- **Status:** `[✓]` Implemented (Stage 7).

### Chat ingest integration (Stage 7.3)
- The new project-creation flow (`project-new.js`) sends the vision text through `api.chatIngest(text)` first. If the result is a `documentRef`, the project is created with the optional `visionDocumentId` field on `POST /api/projects`; the server stores a `DocumentRef` under `config.visionDocument` (no byte duplication, owner-scoped) so the project links to the document rather than copying it. Short visions stay inline. The success screen reports the attached `doc_…` id so the user can see the wiring actually happened.
- **Backend:** `POST /api/projects` now accepts an optional `visionDocumentId`; owner-checked (`DocumentNotFoundError` → 400 if foreign or missing).
- **Status:** `[✓]` Implemented (Stage 7).

## Account Pages

### Page: Profile
- **Access:** Authenticated. Route: `#/settings/profile`.
- **Content:** Legal name (display name), username, role, member since (from session `GET /api/me`).
- **Interactions:** Edit display name → `POST /api/account/profile` → success toast + shell refresh.
- **Status:** `[✓]` Implemented (`settings-profile.js`).

### Page: Security Center
- **Access:** Authenticated. Route: `#/settings/security`.
- **Content:** Account info, authenticator status (enabled/recovery codes remaining), session count (real backend), links to 4 sub-pages.
- **Interactions:** Click card → sub-page. All values from real backend reads.
- **Status:** `[✓]` Implemented (`settings-security.js`).

### Sub-page: Change Password  `#/settings/security/password`  `[✓]`
- Current + new + confirm; new must differ, ≥8 chars, letter+number. `POST /api/account/password`.
- Verified: wrong current rejected (401/403), change 200, old login rejected, new login works.

### Sub-page: Authenticator  `#/settings/security/authenticator`  `[✓]`
- Not set up: password → secret+otpauth (shown once) → 6-digit code → enabled → recovery codes (once).
- Enabled: status badge + remaining codes + disable (requires valid code).
- Every check backend-enforced; no fake toggles.

### Sub-page: Sessions  `#/settings/security/sessions`  `[✓]`
- Table of sessions (started, expires, This device badge). "Revoke other sessions" = double-confirm → `POST revoke-others` keeps current, revokes rest.

### Sub-page: Security Activity  `#/settings/security/events`  `[✓]`
- `GET /api/account/security-events` → `[{ kind, at, detail }]`, human-readable labels, newest first.

### Page: Preferences
- **Access:** Authenticated. Route: `#/settings/preferences`.
- **Backend:** `GET /api/account/preferences` (list) + `POST /api/account/preferences` (patch-update scalar string/number/boolean keys).
- **Content:** List of stored per-account preferences (type shown) with live per-row save; form to add/update a key (key pattern `[a-zA-Z][a-zA-Z0-9_-]*`, type select string/number/boolean, coercion). Values persist per-account across reloads.
- **States:** loading (skeleton), empty (No preferences stored), error-state (retry), 401 → login.
- **Status:** `[✓]` Implemented (`settings-preferences.js`). Real persisted reads/writes; no decorative toggles.

## AI Pages

### Page: Providers / Models / Credentials
- **Access:** Authenticated. Route: `#/providers`.
- **Content:** Model search (`GET /api/models`), provider/credential list (`GET /api/credentials`), connection verification (`POST /api/credentials/:id/verify`), current selection (`GET /api/models/selection`), select model (`POST /api/models/select`).
- **Security:** Credentials never show secret after storage (masked only). CONFIGURED ≠ VERIFIED/AVAILABLE.
- **Status:** `[!]` Backend complete. Frontend not started.

<!-- BLUEPRINT_MARKER -->

## System States

| State | Trigger | Behavior |
|-------|---------|----------|
| 404 Not Found | Unknown route | `404.js` view + clear message + Dashboard link |
| 401 Unauthorized | No/invalid session on protected route | Redirect to Login |
| 403 Forbidden | CSRF cross-origin, or access denied | Error message + return to safe page |
| 500 Server Error | Backend crash | Generic error + refresh option |
| Offline/Network | Fetch fails | Retry UI + explain connectivity |
| Loading | Data fetching | Spinner + skeleton |
| Empty | No data | Explaining empty state + action |
| Processing | Stage running | Progress indicator tied to real backend state |
| Expired session | Session TTL elapsed | Auto-redirect to Login on 401 |
| Unavailable provider/model | Provider error | Honest status + no fake availability |
| Approval required | Blueprint not approved | Block build + explain requirement |
| Verification/certification failure | Stage failed | Show failures + findings + retry |

## Project Lifecycle Modes

From `src/project/types.ts`. Mode is set at creation and governs in-scope stages:

| Mode | In-scope stages |
|---|---|
| design-only | Discovery → Design → Design Verification |
| design-plus-code | Discovery → Design → Design Verification → Blueprint → Architecture → Implementation → Testing → Verification |
| full-product | Discovery → ... → Continuous Improvement (all stages) |

Out-of-scope stages must be shown honestly as "not in scope," never as completed.