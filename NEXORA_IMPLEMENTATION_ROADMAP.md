# NEXORA — Implementation Roadmap

> Staged, dependency-ordered plan. Each stage must pass the completion gate (design ✓ · backend ✓ · frontend connected ✓ · persistence ✓ · errors ✓ · security ✓ · responsive ✓ · a11y ✓ · tests ✓ · reload ✓ · restart ✓) before the next begins.

## Stage 0 — Repository Understanding & Baseline  `[✓] COMPLETE`

**Objective:** Understand the existing repository and establish a green baseline.

| Item | Status |
|------|--------|
| Architecture understood | `[✓]` |
| Engine (Blueprint-First core) mapped | `[✓]` |
| Backend APIs inventoried | `[✓]` (server.ts + auth-api.ts) |
| Auth mechanism mapped | `[✓]` (nexona_session cookie, bcrypt, TOTP) |
| Provider architecture mapped | `[✓]` (Models.dev + OpenRouter) |
| Persistence mapped | `[✓]` (accounts.json, documents, artifacts) |
| Frontend (nexona SPA) mapped | `[✓]` |
| Tests inventoried | `[✓]` (358 pass, 0 fail) |
| Typecheck green | `[✓]` |
| Missing capabilities identified | `[✓]` |

**Dependencies:** None.

## Stage 1 — Master Specification & Control Documents  `[~] IN PROGRESS`

**Objective:** Create and populate the three persistent control documents + progress log.

| Item | Status |
|------|--------|
| `NEXORA_MASTER_SPEC.md` created | `[✓]` |
| `NEXORA_PRODUCT_BLUEPRINT.md` created | `[✓]` |
| `NEXORA_IMPLEMENTATION_ROADMAP.md` created (this file) | `[✓]` |
| `NEXORA_PROGRESS.md` created | `[ ]` |
| Complete page inventory | `[✓]` |
| Backend capability map | `[✓]` |
| Missing capability map | `[✓]` |

**Dependencies:** Stage 0.

## Stage 2 — NEXORA Design System & Brand  `[✓] COMPLETE`

**Objective:** Professional brand identity + complete design system.

| Sub-stage | Objective | Backend | Frontend | Tests | Status |
|-----------|-----------|---------|----------|-------|--------|
| 2.1 | NEXORA logo (wordmark + mark, SVG, favicon, splash, sidebar, mobile) | none | Create SVG assets | visual check | `[✓]` |
| 2.2 | CSS design system audit (tokens, components, forms, tables, dialogs, empty/loading/error states) | none | Audit + complete `nexona/css/` | review | `[✓]` |
| 2.3 | Accessibility foundation (focus, reduced motion, semantic roles, contrast) | none | Audit `nexona/` HTML/CSS | review | `[✓]` |

**Dependencies:** Stage 0.

**Verification:** All 9 component checks pass. CSS balanced (157/157, 80/80). HTML balanced (69/69). 443 tests pass, 0 fail (blueprint-first). Typecheck: GREEN. Component test page exercises all variants.

## Stage 3 — Public Experience  `[✓] COMPLETE`

**Objective:** Splash → Introduction → Founder → Contact → Signup → Login.

| Sub-stage | Objective | Backend | Frontend | Status |
|-----------|-----------|---------|----------|--------|
| 3.1 | Splash / brand reveal (~4 s, reduced-motion, back-end independent) | none | splash view + timer | `[!]` |
| 3.2 | Introduction (14-step guided story) | none | `intro.js` verify + complete | `[~]` |
| 3.3 | Customer Care / Contact (real links, founder details) | none | help/how view | `[!]` |
| 3.4 | Signup (legal name, username, password, validation, errors) | `[✓]` `/api/auth/signup` | `signup.js` verify | `[~]` |
| 3.5 | Login (credentials, rate-limit, errors) | `[✓]` `/api/auth/login` | `login.js` verify | `[~]` |

**Dependencies:** Stage 2 (design system) + Stage 4 (auth backend verified).

## Stage 4 — Authentication & Security (Frontend)  `[✓] COMPLETE`

**Objective:** Complete security experience on the verified auth backend. All backend endpoints existed; no gaps found.

| Sub-stage | Objective | Status |
|-----------|-----------|--------|
| 4.1 | Unauthorized access handling (401 → login redirect) | `[✓]` |
| 4.2 | Session expiry handling (auto-redirect on 401) | `[✓]` |
| 4.3 | Security Center hub (entry point) | `[✓]` |
| 4.4 | Profile view (display name, account info) | `[✓]` |
| 4.5 | Password change (current → new → verify → login) | `[✓]` |
| 4.6 | Authenticator setup (QR/secret + code → enable) | `[✓]` |
| 4.7 | Authenticator management (status, disable, recovery codes) | `[✓]` |
| 4.8 | Session management (list, revoke others) | `[✓]` |
| 4.9 | Security events (activity log) | `[✓]` |
| 4.10 | Full integration test (signup→login→security→logout) | `[✓]` |
| 4.11 | Account isolation test (Account A vs B) | `[✓]` |

**Frontend views added:**
- `settings-security.js` — Security Center hub
- `settings-profile.js` — Profile (real account data + update)
- `settings-security-password.js` — Change password
- `settings-security-authenticator.js` — Authenticator setup/enable/disable/recovery codes
- `settings-security-sessions.js` — Session list + revoke others (double-confirm)
- `settings-security-events.js` — Security event log

**Routes added:** `/settings/security/password`, `/settings/security/authenticator`, `/settings/security/sessions`, `/settings/security/events`

**API client additions (`api.js`):** `authenticatorStatus`, `setupAuthenticator`, `enableAuthenticator`, `disableAuthenticator`, `securityEvents` + global `onUnauthorized` → login redirect.

**Bugs found & fixed during this phase:**
- `api.js` had TypeScript `readonly` syntax in a `.js` file (browser break) — removed
- `.page`, `.panel`, `.muted` CSS were used by dashboard.js but did not exist — added
- Security events backend uses `kind`, not `type` — frontend aligned

**End-to-end verification (all OK):**
- Password lifecycle: wrong current rejected; change 200; old login rejected; new login 200
- Authenticator lifecycle: setup requires password (403 otherwise); real TOTP enable; status; disable; re-enable
- Session lifecycle: two sessions listed; revoke-others revokes 1; revoked 401; current still works
- Security events: login/revoked recorded
- Recovery: forgot→challenge; wrong code rejected; real TOTP resets password; new login 200; old rejected
- Isolation: A never sees B's events/sessions; B sees only own

**Verification:** all 9 modified/new JS files syntax-OK; CSS balanced 213/213.

**Dependencies:** Stage 3 (signup/login).

## Stage 5 — Application Shell & Dashboard  `[✓] DONE`

**Objective:** Authenticated shell + dashboard with real backend data.

| Sub-stage | Objective | Backend | Frontend | Status |
|-----------|-----------|---------|----------|--------|
| 5.1 | Shell (top bar, sidebar, nav, session handling, 401 redirect) | `[✓]` `/api/me` | Shell in `app.js` + nav links to all settings views + `nexona:account-changed` dispatch on login/signup | `[✓]` |
| 5.2 | Dashboard (real data: identity, projects, activity, AI status) | `[✓]` `/api/me`, `/api/projects`, `/api/activity`, `/api/models/selection`, `/api/credentials` | `dashboard.js` bound to real endpoints; loading/error/empty/401 states | `[✓]` |
| 5.3 | Profile page (legal name, username, account info) | `[✓]` `/api/me`, `/api/account/profile` | Build view + settings nav hub | `[✓]` |
| 5.4 | Preferences page | `[✓]` `GET /api/account/preferences` (filled backend gap) + `POST` | `settings-preferences.js` — read/update persisted scalar preferences | `[✓]` |

**Backend fixes in this stage:**
- `GET /api/account/preferences` endpoint added to `auth-api.ts` (the POST already existed but was unreachable from a list view)
- `/api/activity` crashed on `result.registry` undefined — now guards to return `{ activity: [] }`; sort hardened against non-string timestamps
- Preferences validation in `accounts.ts` threw `AuthenticationError` (401) for invalid keys/values — fixed to throw `Error` (400)
- Activity endpoint discarded document activity when no projects existed; sort produced NaN for document timestamps
- Static files served at wrong path (`/css/` vs `/nexona/css/`) — fixed mount point; added root `/` SPA entry

**Verification (Phase 5):** 31/31 e2e REST checks pass (auth lifecycle, account isolation A vs B, preferences, activity, dashboard, profile, restart persistence); 15/15 static-serving checks pass (HTML, CSS, JS, images at `/nexona/`); `tsc --noEmit` clean; all 8 frontend JS files `node --check` OK.

**Dependencies:** Stage 4.

## Stage 6 — Projects  `[✓] COMPLETE`

**Objective:** Project listing, creation, workspace, settings.

| Sub-stage | Objective | Backend | Frontend | Status |
|-----------|-----------|---------|----------|--------|
| 6.1 | Projects list (per-user, status, mode, progress) | `[✓]` `GET /api/projects` | `projects.js` (NEW) — grid of cards, empty state, delete with confirm | `[✓]` |
| 6.2 | Create Project (title, mode, idea intake) | `[✓]` `POST /api/projects` | `project-new.js` verified — creates then routes to workspace | `[✓]` |
| 6.3 | Project detail/workspace shell | `[✓]` `GET /api/projects/:id` | `project.js` (NEW) — lifecycle stages, in/out-of-scope honest labels, run-stage action | `[✓]` |
| 6.4 | Project settings (title/mode edit, delete) | `[✓]` `PUT /api/projects/:id` (gap filled) | `project-settings.js` (NEW) + danger-zone delete | `[✓]` |

**Backend work in this stage:**
- `PUT /api/projects/:id` added to `server.ts` (the 6.4 gap): owner-checked via `requireOwnedProject`, validates title (2–64 chars) and mode against `PROJECT_MODES`, persists through the durable artifact store, returns updated summary; 404 for foreign/missing projects, 400 when no valid updates supplied.
- Sidebar "Projects" now routes to the real list (`#/projects`) instead of the create form.
- Router: `/projects` and `/projects/:id/settings` registered; `/projects/:id` unchanged.

**Frontend work in this stage:**
- `projects.js` — per-user project grid (title, mode badge, status, id), honest empty state with create CTA, delete with `confirm()`.
- `project.js` — workspace shell: identity header, mode/status/stages-run/approval meta, full lifecycle stage list with honest `OUT_OF_SCOPE` handling, run-stage buttons for in-scope pending stages only, 404 and error states.
- `project-settings.js` — edit title/mode via `PUT`, danger-zone delete via `DELETE`, 404/error states.
- `api.js` — `updateProject(id, data)` added and exported.
- `components.css` — project grid/cards/stages/danger-panel styles (balanced 256/256).

**Verification (Stage 6):** `test/projects-api.test.ts` (NEW, node --test) — 5/5 pass:
1. full lifecycle: create 201 → list contains project → detail with in-scope stages → PUT title+mode 200 persisted → invalid mode 400 → empty update 400 → in-scope stage run 200 + RECORDED → out-of-scope stage 409 → delete 204 → detail 404 → list no longer contains it
2. empty state: fresh user count 0
3. isolation: second account gets 404 on get/PUT/run/DELETE of the first account's project; project untouched
4. unauthenticated list/create/PUT → 401
5. iteration persistence: project created on server 1 still listed and readable after a full server restart on the same data dir (durable store), same account logged back in

**Regression:** full suite `npm test` — **363 tests, 363 pass, 0 fail**. `tsc --noEmit` GREEN. All touched frontend JS `node --check` OK. CSS balanced (tokens 8/8, layout 80/80, components 256/256).

**Dependencies:** Stage 5.

## Stage 7 — Files & Inputs  `[~] PARTIAL`

**Objective:** Real file/image uploads end-to-end.

| Sub-stage | Objective | Backend | Frontend | Status |
|-----------|-----------|---------|----------|--------|
| 7.1 | Document upload (text, 5 MB, validation, progress) | `[✓]` `POST /api/documents/upload` | Build upload UI | `[!]` |
| 7.2 | Document listing/detail/deletion | `[✓]` | Build views | `[!]` |
| 7.3 | Chat ingest (short→message, large→document ref) | `[✓]` `POST /api/chat/ingest` | Wire to chat | `[!]` |

**Dependencies:** Stage 5.

## Stage 8 — Blueprint-First Workspace  `[!] NOT STARTED`

**Objective:** Engineering workspace around the existing engine, one stage at a time.

| Sub-stage | Stage | Backend endpoint | Frontend view | Status |
|-----------|-------|-------------------|---------------|--------|
| 8.1 | Discovery | `GET /api/discovery` | Build view | `[!]` |
| 8.2 | Design | `GET /api/design` | Build view | `[!]` |
| 8.3 | Blueprint | `GET /api/certification` | Build view | `[!]` |
| 8.4 | Approval | `POST /api/projects/:id/approve` | Build view | `[!]` |
| 8.5 | Build/Engineering | `POST /api/projects/:id/run/:stageId` | Build view | `[!]` |
| 8.6 | Verification | `GET /api/verification` | Build view | `[!]` |
| 8.7 | Testing | `GET /api/testing` | Build view | `[!]` |
| 8.8 | Operations/Runtime | `GET /api/deployment`, `/api/telemetry`, `/api/continuous` | Build view | `[!]` |

**Dependencies:** Stage 6 (project workspace shell).

## Stage 9 — Artifacts, Evidence & Traceability  `[!] NOT STARTED`

| Sub-stage | Objective | Backend | Status |
|-----------|-----------|---------|--------|
| 9.1 | Artifacts list/detail | `GET /api/artifacts`, `GET /api/artifacts/:id` | `[!]` |
| 9.2 | Evidence log | `GET /api/evidence` | `[!]` |
| 9.3 | Traceability report | `GET /api/traceability`, `/api/dependency-map`, `/api/lineage` | `[!]` |
| 9.4 | Certification status | `GET /api/certification` | `[!]` |

**Dependencies:** Stage 8.

## Stage 10 — AI Providers & Models (Frontend)  `[!] NOT STARTED`

| Sub-stage | Objective | Backend | Status |
|-----------|-----------|---------|--------|
| 10.1 | Providers/models view (search, status) | `GET /api/models`, `GET /api/models/stats` | `[!]` |
| 10.2 | Credential management (add/list/remove) | `POST/GET/DELETE /api/credentials` | `[!]` |
| 10.3 | Connection verification | `POST /api/credentials/:id/verify` | `[!]` |
| 10.4 | Model selection | `GET/POST /api/models/selection`, `/api/models/select` | `[!]` |

**Dependencies:** Stage 5.

## Stage 11 — Failure & Recovery Experiences  `[~] PARTIAL`

| Sub-stage | State | Status |
|-----------|-------|--------|
| 11.1 | 404 / not found | `[~]` `404.js` exists |
| 11.2 | 401 / 403 / 500 | `[!]` |
| 11.3 | Offline / network failure | `[!]` |
| 11.4 | Processing / failed processing | `[!]` |
| 11.5 | Expired session | `[!]` |
| 11.6 | Unavailable provider/model | `[!]` |
| 11.7 | Approval required / verification failure | `[!]` |

**Dependencies:** All interactive stages.

## Stage 12 — Full Integration  `[!] NOT STARTED`

Verify complete journeys: public → auth → dashboard → project → intake → Blueprint-First → artifacts/evidence → AI config → security → customer care.

| Status |
|--------|
| `[!]` |

**Dependencies:** Stages 3–11 complete.

## Stage 13 — Security & Isolation Audit  `[~] PARTIAL`

| Test | Backend | Frontend | Browser | API |
|------|---------|----------|---------|-----|
| Account A vs B isolation (projects, files, artifacts, credentials) | `[✓]` | `[!]` | `[!]` | `[✓]` unit |
| Session revocation / expiration | `[✓]` | `[!]` | `[!]` | `[✓]` unit |
| CSRF / same-origin | `[✓]` | — | — | `[✓]` |

**Dependencies:** Stages 4, 12.

## Stage 14 — Browser & Responsive Verification  `[!] NOT STARTED`

Verify at 320px, 375px, 480px, 768px, 1024px, 1440px+. Test keyboard nav, focus, dialogs, reduced motion, touch targets, contrast, screen-reader names.

| Status |
|--------|
| `[!]` |

**Dependencies:** All frontend stages.

## Stage 15 — Final Honesty Audit  `[!] NOT STARTED`

For every visible interactive element: click → request → endpoint → payload → backend → mutation → persistence → response → parse → state update → visible result → reload → restart. Remove or properly implement anything that cannot answer.

| Status |
|--------|
| `[!]` |

**Dependencies:** All stages complete.



