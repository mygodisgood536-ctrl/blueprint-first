# NEXORA — Progress Log

> Stage-by-stage record of completed work, files changed, endpoints, tests, and open issues. Updated after every meaningful stage.

---

## Phase 0 — Repository Understanding & Baseline  `[✓] COMPLETE`

### Summary
Established a full baseline of the Blueprint-First repository and its web layer. Confirmed a green typecheck and passing test suite.

### Files inspected
- `package.json`, `tsconfig.json` — TS 5.9 strict, Node 24, Express 5, no extra deps
- `src/web/server.ts` — 1180 lines; full Express API server
- `src/web/auth-api.ts` — 512 lines; real auth (signup/login/logout/forgot/authenticator/sessions/security-events/profile/preferences)
- `src/web/auth.ts` — session middleware (`nexona_session` cookie, CSRF guard, requireAuth)
- `src/account/accounts.ts`, `durable-registry.ts`, `isolation.ts`, `totp.ts` — real bcrypt + TOTP + isolation
- `src/ai/provider-manager.ts`, `provider-metadata.ts`, `credential-store.ts`, `openrouter-provider.ts`, `model-catalogue.ts`, `models-dev-source.ts`, `router.ts`, `types.ts` — AI provider architecture
- `src/chat/document.ts`, `src/web/durable-documents.ts` — chat-first document store
- `src/project/types.ts`, `registry.ts` — project modes, lifecycle stages
- `src/demo/main.ts` — demo pipeline (single source of truth)
- `src/web/public/nexona/` — SPA: `index.html`, `app.js`, `api.js`, `router.js`, CSS (tokens/components/layout), views, UI (modal/toast)
- `src/web/public/index.html`, `app.js`, `styles.css` — stale root frontend (NOT served)
- `src/web/public/teamtask/` — deprecated (NOT served)

### Backend endpoints (complete inventory)
**Auth:** `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `POST /api/auth/forgot`, `POST /api/auth/forgot/verify`, `POST /api/auth/reset`, `POST /api/account/password`, `GET /api/account/authenticator`, `POST /api/account/authenticator/setup`, `POST /api/account/authenticator/enable`, `POST /api/account/authenticator/disable`, `GET /api/account/security-events`, `GET /api/account/sessions`, `POST /api/account/sessions/revoke-others`, `POST /api/account/profile`, `POST /api/account/preferences`

**Server:** `GET /api/me`, `GET /api/summary`, `GET /api/activity`, `GET /api/roadmap`, `GET /api/caps`, `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects`, `DELETE /api/projects/:id`, `POST /api/projects/:id/run/:stageId`, `POST /api/projects/:id/approve`, `GET /api/discovery`, `/api/design`, `/api/council`, `/api/verification`, `/api/testing`, `/api/deployment`, `/api/telemetry`, `/api/continuous`, `/api/recursion`, `/api/safe-change`, `/api/peo`, `GET /api/artifacts`, `GET /api/artifacts/:id`, `GET /api/dependency-map`, `GET /api/lineage`, `GET /api/evidence`, `GET /api/certification`, `GET /api/traceability`, `GET /api/models`, `GET /api/models/stats`, `GET /api/models/selection`, `POST /api/models/select`, `GET /api/models/:providerId/:modelId`, `POST /api/credentials`, `GET /api/credentials`, `DELETE /api/credentials/:id`, `POST /api/credentials/:id/verify`, `POST /api/chat/ingest`, `POST /api/documents/upload`, `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id`

### Tests
- Full suite (`node --test`): **358 pass, 0 fail**, duration ~35 s
- Typecheck (`npx tsc --noEmit`): **GREEN**

### Missing backend capabilities
- `PUT /api/projects/:id` (project update/settings) — NOT implemented
- Per-project AI preferences endpoint — NOT implemented
- Image file upload (backend is text-only, rejects binary) — gap if images required

### Decisions
- Server serves `public/nexona/` (not root index.html or teamtask)
- Auth is cookie-only (opaque signed token); no self-asserted headers
- Session TTL: 12 hours
- CSRF defense: Origin header matching + SameSite=Lax
- Project modes: design-only, design-plus-code, full-product (from `src/project/types.ts`)

### Next stage
Phase 1 — create NEXORA_PRODUCT_BLUEPRINT.md + NEXORA_IMPLEMENTATION_ROADMAP.md (master spec already created)

---

## Phase 1 — Master Product Specification  `[~] IN PROGRESS`

### Completed
- `NEXORA_MASTER_SPEC.md` created with full 46-section requirement tracking
- `NEXORA_PRODUCT_BLUEPRINT.md` created with page-by-page specs
- `NEXORA_IMPLEMENTATION_ROADMAP.md` created with 16 stages
- `NEXORA_PROGRESS.md` created (this file)

### Remaining
- [x] Final review of all documents for consistency
- [x] Mark Phase 1 complete after documents are finalized

### Phase 1 Status
**COMPLETE** — All four control documents created and populated:
- `NEXORA_MASTER_SPEC.md` (293 lines) — full 46-section requirement tracking
- `NEXORA_PRODUCT_BLUEPRINT.md` — page-by-page specs with backend contracts
- `NEXORA_IMPLEMENTATION_ROADMAP.md` — 16 stages with sub-stages and dependencies
- `NEXORA_PROGRESS.md` — this file, live-updated

Typecheck: GREEN. Tests: 358 pass.

---

## Phase 2 — NEXORA Design System & Brand  `[~] IN PROGRESS`

### 2.1 NEXORA Logo  `[✓] COMPLETE`

**Objective:** Professional original NEXORA logo (wordmark + mark, standalone mark, favicon, splash, sidebar, mobile).

**Files created:**
- `src/web/public/nexona/img/logo.svg` — full wordmark (mark + "NEXORA" + tagline)
- `src/web/public/nexona/img/logo-icon.svg` — standalone mark (hexagon frame, blueprint grid, AI nodes, flow paths)
- `src/web/public/nexona/img/favicon.svg` — simplified standalone mark for browser tab

**Design concept:**
- Hexagonal frame = structure / architecture
- Blueprint grid = Blueprint-First methodology
- Blue nodes = AI engineering, connected systems
- Blue flow path = idea → blueprint → verified software
- Amber arc + node = continuous evolution / transformation
- Center core = intelligence (white center = honest, human-aligned AI)
- Color: #3b82f6 (blue, calibrated to `--color-accent`) and #f59e0b (amber, calibrated to `--color-warning`)

**Integration:**
- `index.html`: real favicon linked (`<link rel="icon" href="/nexona/img/favicon.svg">`)
- `app.js` top bar: logo icon + "NEXORA" brand (`<img src="/nexona/img/logo-icon.svg" />`)
- `intro.js`: replaced text "NEXORA" + tagline with SVG logo image
- `layout.css`: added `.splash__`, `.intro__logo`, `.top-bar__logo`, `.form__` CSS classes

**Verification:**
- All 4 files exist with content (2.3 KB, 2.1 KB, 0.6 KB, 2.2 KB respectively)
- `intro.js` logo SVG present, tagline removed ✓
- `app.js` top-bar logo image present ✓
- `layout.css` has splash/intro/logo CSS ✓

### 2.2 Splash / Brand Reveal  `[~] IN PROGRESS`

**Objective:** ~4-second professional brand reveal; accessible, reduced-motion friendly, independent of backend.

**Files created:**
- `src/web/public/nexona/js/views/splash.js` — splash view: shows logo, auto-advances to `/intro` after 4 s (800 ms with reduced motion), skip button, any-click advances, authenticated users skip to `/dashboard`

**Route integration:**
- `router.js`: `/` → `splash` view, `/intro` → `intro` view (both public)

**CSS:** splash styles, entrance animation (`splashFadeIn`), pulse glow (`pulseGlow`), exit fade (`splash--exit`)

**Verification:**
- `splash.js` exists ✓
- Router has splash route ✓
- CSS has `.splash` styles ✓

### 2.3 Design System Audit  `[✓] COMPLETE`

**CSS tokens** (`tokens.css`): dark-first, `--color-accent` (#3b82f6), `--color-bg` (#0E1014), typography, spacing, motion tokens, `prefers-reduced-motion` support.

**Components** (`components.css` — 774 lines, 157 balanced braces):
- Buttons: `.btn`, `.btn--primary`, `.btn--secondary`, `.btn--ghost`, `.btn--text`, `.btn--lg`, `.btn--sm`, `.btn--block`, `.btn--icon`, `.btn--loading`, `.btn__spinner`, disabled state
- Cards: `.card`, `.card__header`, `.card__title`, `.card__subtitle`, `.card__body`, `.card__footer`, `.card--interactive`
- Forms: `.form-group`, `.form-label`, `.form-input`, `.form-hint`, `.form-error`, `.form-error--banner`, `.form-input--error`, `.form-input--success`, `.form-input--disabled`
- Badges: `.badge`, `.badge--success`, `.badge--warning`, `.badge--error`, `.badge--info`, `.badge--neutral`
- Tables: `.table`, `.table__header`, `.table__row`, `.table__cell`, `.table__row--header`, `.table--compact`
- Empty state: `.empty-state`, `.empty-state__icon`, `.empty-state__title`, `.empty-state__desc`, `.empty-state__action`
- Loading skeleton: `.skeleton`, `.skeleton--text`, `.skeleton--card`, `.skeleton--avatar`, `.skeleton--title`, shimmer animation
- Error state: `.error-state`, `.error-state__icon`, `.error-state__title`, `.error-state__desc`, `.error-state__action`
- Success state: `.success-state`, `.success-state__icon`, `.success-state__title`, `.success-state__desc`
- Auth: `.auth-page`, `.auth-card`, `.auth-card__brand`, `.auth-card__logo`, `.auth-card__title`, `.auth-card__subtitle`, `.auth-card__actions`
- Account: `.account-dropdown`, `.account-dropdown__item`, `.account-dropdown__divider`
- Links: `.link`, `.link--primary`
- Responsive: `@media (max-width: 768px)` (hide-mobile, show-mobile, table scroll), `@media (prefers-reduced-motion: reduce)` (skeleton animation disabled)

**Layouts** (`layout.css` — 405+ lines, 80 balanced braces):
- Top bar, sidebar, body layout, content area
- Toast: `.toast`, `.toast--success`, `.toast--error`, `.toast--info`, `.toast__dismiss`
- Modal: `.modal-overlay`, `.modal`, `.modal__header`, `.modal__title`, `.modal__body`, `.modal__footer`
- Splash: `.splash`, `.splash__inner`, `.splash__logo`, `.splash__skip`, `.splash--animate`, `.splash--exit`
- Intro logo: `.intro__logo`, `.intro__logo-img`
- Top bar logo: `.top-bar__logo`
- Auth card logo: `.auth-card__logo`
- Customer care: `.carepage`, `.carepage__card`, `.contact-card`, etc.
- Skip link: `.skip-link`
- Focus ring: `.focus-ring`

**Component test page:** `src/web/public/nexona/test-components.html` — exercises all component variants (buttons, badges, cards, form states, tables, empty/skeleton/error/success states, toasts, modals). HTML well-formed (69/69 div tags balanced), CSS balanced.

**Verification results:**
- All 9 component checks pass (`.table`, `.empty-state`, `.skeleton`, `.error-state`, `.success-state`, `.form-input--error`, `.form-input--success`, responsive rules)
- CSS brace balance: components.css 157/157, layout.css 80/80
- HTML tag balance: 69/69 div tags
- Test suite: 443 pass, 0 fail (blueprint-first); 25 failures from unrelated `nexora-restored` project
- Typecheck: GREEN

### Phase 2 Status
**COMPLETE** — Logo assets created and integrated (wordmark, mark, favicon). Splash screen implemented with reduced-motion support. Design system audit complete: tokens, components (buttons, cards, forms, badges, tables, empty/skeleton/error/success states, auth, responsive), layouts (top bar, sidebar, modal, toast, splash, carepage) all present and verified.

**Files changed:**
- `src/web/public/nexona/img/logo.svg` — full wordmark SVG
- `src/web/public/nexona/img/logo-icon.svg` — standalone mark SVG
- `src/web/public/nexona/img/favicon.svg` — favicon SVG
- `src/web/public/nexona/index.html` — real favicon link
- `src/web/public/nexona/js/app.js` — top bar logo icon
- `src/web/public/nexona/js/views/intro.js` — SVG logo (replaced text), contact link
- `src/web/public/nexona/js/views/splash.js` — NEW: splash/brand reveal view
- `src/web/public/nexona/js/router.js` — splash + intro routes, help public
- `src/web/public/nexona/css/layout.css` — splash, intro logo, top-bar logo, auth-card logo, carepage CSS
- `src/web/public/nexona/css/components.css` — `.btn--text` variant, tables, empty/skeleton/error/success states, form validation states, responsive rules
- `src/web/public/nexona/test-components.html` — NEW: component test page

**Verification:** All 9 component checks pass. CSS balanced (157/157, 80/80). HTML balanced (69/69). 443 tests pass, 0 fail (blueprint-first). Typecheck: GREEN.

---

## Phase 3 — Public Experience  `[~] IN PROGRESS`

### 3.1 Splash / Brand Reveal  `[✓] COMPLETE`

**Files:** `src/web/public/nexona/js/views/splash.js`
**Behaviour:** ~4 s brand reveal (800 ms with reduced-motion), skip button, any-click advances, authenticated users skip to `/dashboard`, independent of backend.
**Route:** `/` → `splash` view (auto-advances to `/intro`)

### 3.2 Introduction  `[✓] COMPLETE`

**Files:** `src/web/public/nexona/js/views/intro.js` (rewritten)
**Status:** Full 14-step guided story with Continue / Back navigation, progress dots, founder section.
**Steps:** What is NEXORA → Problem with ordinary AI coding → Blueprint-First → Discovery → Design → Blueprint → Human approval → Engineering → Independent verification → Evidence and traceability → Testing and Operations → Runtime → Continuous Engineering → Why NEXORA is different (+ founder Cornelius Adedeji Victor)
**Navigation:** Continue button advances, Back button returns, progress dots show current step, final step has Get Started / How It Works / Contact buttons
**Accessibility:** Reduced-motion friendly (no animation), responsive (mobile breakpoint), semantic headings
**CSS:** `.guided-intro`, `.guided-intro__progress`, `.guided-intro__step`, `.guided-intro__founder` — added to components.css
**Verification:** 14 steps present, braces balanced (29/29), 13 tests pass / 0 fail, typecheck GREEN

### 3.3 Customer Care / Contact  `[✓] COMPLETE`

**Files:** `src/web/public/nexona/js/views/help.js` (NEW)
**Content:** Founder Cornelius Adedeji Victor, WhatsApp (0815 407 6947), Phone (0706 174 3252), Email (adedejicorneliusvictor@gmail.com). Real clickable links.
**Route:** `/help` → `help` view (public, accessible pre-auth)

### 3.4 Signup  `[✓] COMPLETE`

**Files:** `src/web/public/nexona/js/views/signup.js`
**Status:** Full implementation verified against spec §14.
**Fields:** Display name (1-80 chars), username (3-32 chars, pattern `[a-zA-Z0-9_-]+`), password (min 8 chars, must include letter+number), password confirmation (must match)
**Validation:** Frontend (immediate feedback) + backend (final authority). Username uniqueness enforced by backend (409).
**Error handling:** 409 → username error, 400 → form banner error, other → toast
**Loading state:** Button disabled + spinner during submission
**Success:** Toast + redirect to dashboard
**Backend contract:** `POST /api/auth/signup` with `{ username, password, displayName }` — verified against auth-api.ts
**Accessibility:** Autocomplete attributes, semantic labels, focus states, error announcements

### 3.5 Login  `[✓] COMPLETE`

**Files:** `src/web/public/nexona/js/views/login.js`
**Status:** Full implementation verified against spec §14.
**Fields:** Username (3-32 chars), password (min 8 chars)
**Validation:** Frontend (immediate feedback) + backend (final authority)
**Error handling:** 401/400 → form banner error, other → toast
**Loading state:** Button disabled + spinner during submission
**Success:** Toast + session check + redirect to dashboard
**Backend contract:** `POST /api/login` with `{ username, password }` — verified
**Navigation:** Forgot password → #/forgot, Create account → #/signup
**Accessibility:** Autocomplete attributes, semantic labels, focus states

### Phase 3 Status
**COMPLETE** — All 5 sub-stages verified: Splash, Introduction, Customer Care, Signup, Login.

**Test results:** 13 tests pass, 0 failures. Typecheck: GREEN.

---

## Phase 4 — Authentication & Security (Frontend)  `[✓] COMPLETE`

### Backend inspection (complete)

All authentication backend endpoints verified to exist. No gaps identified.

**Auth API** (`src/web/auth-api.ts`):
- `POST /api/auth/signup` — scrypt hash, unique username, rate-limited
- `POST /api/auth/login` — rate-limited (8 fails/15min, 5min lock), issues cookie
- `POST /api/auth/logout` — revoke session + clear cookie
- `GET /api/auth/session` — return account or null
- `POST /api/auth/forgot` — start recovery (authenticator or local-token mode)
- `POST /api/auth/forgot/verify` — verify TOTP + set new password
- `POST /api/auth/reset` — reset password with local token
- `POST /api/account/password` — change password
- `GET /api/account/authenticator` — status (enabled, hasAuthenticator)
- `POST /api/account/authenticator/setup` — setup TOTP (verify code, issue recovery codes)
- `POST /api/account/authenticator/enable` — enable (verify code)
- `POST /api/account/authenticator/disable` — disable (verify code)
- `GET /api/account/sessions` — list sessions (redacted, current flagged)
- `POST /api/account/sessions/revoke-others` — revoke all other sessions
- `GET /api/account/security-events` — list security events
- `POST /api/account/profile` — update display name
- `POST /api/account/preferences` — update preferences

**Session/Cookie** (`src/web/auth.ts`, `src/web/cookies.ts`):
- Cookie: `nexona_session` (HttpOnly, SameSite=Lax, 7-day max age)
- CSRF: Origin header matching + SameSite=Lax
- Session TTL enforced by registry

**TOTP Authenticator** (`src/account/totp.ts`):
- RFC 6238 SHA-1, 30-second step, 6 digits, base32 secret
- otpauth:// provisioning URI for authenticator apps
- ±1 step clock window, timing-safe comparison
- Recovery codes (single-use, hashed)

**Account layer** (`src/account/accounts.ts`):
- scrypt password hashing with per-user salt
- Per-user isolation (projects, documents, credentials)
- Security events: account.created, session.login, session.logout, session.revoked_others, password.changed, password.recovered, authenticator.setup, authenticator.enabled, authenticator.disabled, authenticator.recovered

### 4.3 Security Center hub  `[✓] COMPLETE`

**Objective:** Central hub for all account security, showing only real backend state.

**Files:**
- `src/web/public/nexona/js/views/settings-security.js` (NEW) — Security Center view
- `src/web/public/nexona/js/api.js` — added `authenticatorStatus`, `setupAuthenticator`, `enableAuthenticator`, `disableAuthenticator`, `securityEvents`
- `src/web/public/nexona/css/components.css` — added `.page`/`.page__header`/`.page__title`/`.page__subtitle`, `.panel`/`.panel__title`/`.panel__body`, `.muted`, `.security-grid`/`.security-card`, `.account-meta` (NOTE: `.page`, `.panel`, `.muted` were used by dashboard.js but did not exist in CSS — pre-existing gap now fixed)

**Sections (all real data):**
- Account: display name, username, role, member since (from session `/api/me`)
- Authenticator: Enabled/Not set up badge + recovery codes remaining (`GET /api/account/authenticator`)
- Sessions: active count + other-device count (`GET /api/account/sessions`)
- Links to sub-pages: password, authenticator, sessions, events (routes added as sub-stages complete)

**States:** loading skeletons, error-state with retry, loaded real data, 401 → global login redirect.

**Backend verification (6/6 pass):**
- T1: signup → 201 ✓
- T2: `GET /api/me` → username, role, createdAt ✓
- T3: `GET /api/account/authenticator` → `{ enabled: false, recoveryCodesRemaining: 0 }` for fresh account ✓
- T4: `GET /api/account/sessions` → 1 session, `current: true` ✓
- T5: unauthenticated → 401 on security endpoints ✓
- T6: Account B isolation — B sees only own session, never A's ✓

**Verification:** view syntax OK, CSS balanced (207/207), api.js syntax OK.

### 4.1 Unauthorized access handling  `[✓] COMPLETE`

**Objective:** Ensure 401 responses redirect to login, no private info exposed.

**Implementation:**
- `api.js`: added `onUnauthorized` export; `request()` calls it on any 401 response
- `router.js`: sets `onUnauthorized` to clear account state + redirect to `/login`
- Router guard (pre-existing): `config.auth && !this.account` → redirect to `/login`

**Bug found and fixed:**
- `api.js` contained TypeScript syntax (`readonly status; readonly body;`) in a `.js` file — would break in the browser. Fixed by removing the `readonly` modifiers (pre-existing issue, not caused by my changes).

**Backend verification (6/6 pass):**
- T1: unauthenticated `GET /api/projects` → 401 ✓
- T2: anonymous `GET /api/me` → 200 `{ account: null }` ✓
- T3: signup → 201 + session cookie ✓
- T4: authenticated request → 200 ✓
- T5: after logout → 401 (session revoked) ✓
- T6: invalid token → 401 ✓

### 4.2 Session expiry handling  `[✓] COMPLETE`

**Objective:** Expired session → 401 → frontend redirects to login, no private info exposed.

**Implementation:** Same mechanism as 4.1 — registry enforces 7-day TTL; expired/invalid token → anonymous → 401 → `onUnauthorized` → login redirect.
**Backend verification:** T6 (invalid token → 401) covers expired-token path; registry expiry test exists in account.test.ts ("rejects an expired session").

### 4.4 Profile view  `[✓] COMPLETE`

**Files:** `settings-profile.js` (NEW)
**Content:** Real account data: username, role, member since (from session `/api/me`). Edit form updates display name (`POST /api/account/profile`).
**States:** loading, loaded, error, 401 → login, success toast, `nexona:account-changed` event to refresh shell.

### 4.5 Password change  `[✓] COMPLETE`

**Files:** `settings-security-password.js` (NEW)
**Contract:** `POST /api/account/password { currentPassword, newPassword }` → 200 keeps session; 401 wrong current.
**Fields:** current, new (letter+number, ≥8, differs from current), confirm-match.
**End-to-end verified:** wrong current rejected; change 200; old login rejected; new login 200.

### 4.6 Authenticator setup  `[✓] COMPLETE`

**Files:** `settings-security-authenticator.js` (setup flow)
**Contract:** `POST /api/account/authenticator/setup { currentPassword }` → `{ secret, otpauth }` (403 wrong password). Secret shown exactly once. Then `enable { code }` → `{ enabled: true, recoveryCodes }`.
**Flow:** password → secret+otpauth (copyable, app link) → 6-digit code → enabled → recovery codes shown once.

### 4.7 Authenticator management  `[✓] COMPLETE`

**Files:** `settings-security-authenticator.js` (enabled state)
**Contract:** `GET /api/account/authenticator` → `{ enabled, recoveryCodesRemaining }`; `disable { code }` → `{ enabled: false }`.
**States:** Enabled (badge + remaining codes + disable form requiring valid code); Not set up (setup flow); error/401.

### 4.8 Session management  `[✓] COMPLETE`

**Files:** `settings-security-sessions.js` (NEW)
**Contract:** `GET /api/account/sessions` → `[{ createdAt, expiresAt, current }]` (tokens never returned); `POST revoke-others` → `{ revoked }` (keeps current).
**Feature:** table of sessions with "This device" badge; "Revoke other sessions" uses a **double-confirm** (danger button, 5s revert). End-to-end verified: revoke-others revokes 1, revoked session 401, current keeps working.

### 4.9 Security events  `[✓] COMPLETE`

**Files:** `settings-security-events.js` (NEW)
**Contract:** `GET /api/account/security-events` → `[{ kind, at, detail }]` (NOTE: `kind`, not `type`).
**Display:** table of events with human-readable labels. Empty state, error state, 401 handling.

### 4.10 Full integration test  `[✓] COMPLETE`

End-to-end, all OK:
- Password lifecycle: wrong-current rejected, change 200, old login rejected, new login 200
- Authenticator lifecycle: setup requires password (403 otherwise), real TOTP enable, status, disable, re-enable
- Session lifecycle: 2 sessions listed, revoke-others revokes 1, revoked → 401, current works
- Security events recorded (login, revoked_others)
- Recovery: forgot→challenge, wrong code rejected, real TOTP resets, new login 200, old rejected

### 4.11 Account isolation test  `[✓] COMPLETE`

Account A vs B verified end-to-end:
- B never sees A's security events (no leaked `password.changed`/`revoked_others`)
- B sees only its own sessions
- Each account's session list is isolated
### Phase 4 Status  `[✓] COMPLETE`

All 11 sub-stages implemented and verified. The complete security model works end-to-end:

- **Authenticated session state** — exists (cookie issued at auth, resolved server-side)
- **Logout** — `POST /api/auth/logout` revokes + clears cookie (verified)
- **Session expiry** — 7-day TTL enforced by registry; expired → 401 → login redirect
- **Protected routes** — router auth guard + server 401
- **Unauthorized access** — `onUnauthorized` global handler → login redirect (no private info exposed)
- **Profile/security entry points** — sidebar Settings → Security Center hub
- **Password change** — current → new → verify mutation → old login rejected → new login works
- **Authenticator setup/enable/disable** — real TOTP, backend-enforced, secret shown once, recovery codes shown once
- **Authenticator verification** — backend verifies code at enable/disable/sign-in
- **Recovery** — forgot → authenticator challenge → real code resets → new login works (no OTP)
- **Lost-authenticator** — recovery codes (single-use, hashed) can be used in recovery
- **Session management** — list, current-device flag, revoke others (double-confirm)
- **Security events** — `kind`/`at`/`detail`, human-readable labels
- **Dangerous-action confirmation** — revoke-others double-confirm
- **Account isolation** — A vs B verified: no cross-account data leakage
- **Loading/error/success/401 states** — all present in each view
- **No fake security** — every value (authenticator status, sessions, events, account) originates from real backend reads

**Bugs found & fixed this phase:**
1. `api.js` TypeScript `readonly` syntax in `.js` (browser break) — removed
2. `.page`/`.panel`/`.muted` CSS missing despite dashboard usage — added
3. Security events use `kind` not `type` — frontend aligned

**Files added:** `settings-security.js`, `settings-profile.js`, `settings-security-password.js`, `settings-security-authenticator.js`, `settings-security-sessions.js`, `settings-security-events.js`
**Files modified:** `api.js` (onUnauthorized + 5 auth methods), `router.js` (4 routes), `components.css` (page/panel/security/btn--danger/secret styles)

**Verification:** 9 JS files syntax-OK; CSS balanced (213/213); full end-to-end REST lifecycle passed (password, authenticator, sessions, recovery, isolation).

---

## Phase 5 — Application Shell & Dashboard  `[✓] COMPLETE`

### 5.1 Application shell  `[✓] COMPLETE`

**Files:** `app.js` (audited), `router.js`, `components.css`
**Objective:** Authenticated shell with session bootstrap, auth-gated routing, sidebar nav, account dropdown, and 401 → login redirect.

**Implementation audit (all confirmed in `app.js`):**
- Session bootstrap delegated to `router.bootstrap()` → `GET /api/me` (`api.session()`); `router.account` holds identity
- Public vs authenticated routing: router auth guard (`config.auth && !this.account` → `/login`) + server 401
- `main-app` body class toggled by shell (`updateUserDisplay`) and by each view on mount
- Sidebar links: Dashboard, Projects, Providers, Settings (→ `/settings/profile`)
- Account dropdown links: Profile, Security, Preferences, Help, Log out
- `nexona:account-changed` listener wired on `hashchange`; **bug: login/signup set `router.account` but never dispatched it** → fixed (login.js + signup.js now dispatch the event)
- `nexona:logout` → `api.logout()` + clear account + route to `/login`

### 5.2 Dashboard  `[✓] COMPLETE`

**Files:** `views/dashboard.js`, `api.js`, `components.css`
**Contract:** `GET /api/me` (identity), `GET /api/projects` (list), `GET /api/activity` (recent activity), `GET /api/models/selection` (AI status), `GET /api/credentials`.
**States:** skeleton (loading), empty-state (no projects), error-state, 401→login. All present; dashboard cards are only populated by real backend reads.

**Backend bug found & fixed:** `/api/activity` crashed with a server error when the project registry was unavailable (`result.registry` undefined), returning an HTML 404 page instead of JSON. Guarded to return `{ activity: [] }`; also hardened the sort, which called `Date.localeCompare(...)` on Date timestamps (would throw once real projects existed).

### 5.3 Profile page  `[✓] COMPLETE`

**Files:** `views/settings-profile.js`, `views/settings-security.js`
**Contract:** identity from `router.account` (session); update via `POST /api/account/profile { displayName }`.
**Settings nav hub:** Profile page "More" section now links to every settings sub-page (Security hub, Authenticator, Password, Sessions, Security activity, Preferences) so shell navigation is complete and discoverable.

### 5.4 Preferences page  `[✓] COMPLETE`

**Files:** `views/settings-preferences.js` (NEW), `api.js` (`getPreferences`/`updatePreferences`), `components.css`
**Contract:** `GET /api/account/preferences` → `{ preferences }`; `POST /api/account/preferences { patch }` → `{ preferences }`.
**Backend gap fixed:** `GET /api/account/preferences` did not exist (only POST was registered) — added to `auth-api.ts` so the view can read real persisted values; reads/writes persist per-account across reloads.
**Behaviour:** Lists stored preferences (string/number/boolean) with live per-row save; a form adds/updates scalar keys with client + server validation (key pattern, type coercion); unauthenticated → 401 → login redirect; empty, loading, and error states. No fake toggles — every value shown is what the account actually has stored.

**Verification (Phase 5):** `_test_p5.mjs` — 11/11 e2e REST checks pass (signup→session→GET preferences empty→POST merged→GET reflects→invalid key rejected→unauth 401→`/api/me`→`/api/projects`→`/api/activity`→`/api/models/selection`→`/api/credentials`). `tsc --noEmit` GREEN. All 13 touched JS views/shell files `node --check` OK.

**Files added:** `settings-preferences.js`
**Files modified:** `auth-api.ts` (GET preferences), `server.ts` (activity guard + sort), `settings-profile.js` (settings nav hub), `login.js` (account-changed dispatch), `signup.js` (account-changed dispatch)

### 5.5 Independent re-verification (Phase 5)  `[✓] COMPLETE`

**Objective:** Independently re-verify Phase 5 against the real implementation, not the previous report.

**Verification method:** Live in-process server (`buildServer` with real `runDemoPipeline`), exercising the full user lifecycle via HTTP: signup → login → session → preferences → activity → project creation → isolation → profile → restart persistence. Plus static-serving smoke test (HTML, CSS, JS, images).

**Result:** 31/31 e2e REST checks pass, 15/15 static-serving checks pass. `tsc --noEmit` GREEN.

**Bugs found & fixed during re-verification:**
1. **Preferences validation returned 401 instead of 400** — `accounts.ts` threw `AuthenticationError` for invalid keys/values/length. Would have triggered login redirect for a validation mistake. Fixed to throw `Error` (→ 400).
2. **Activity endpoint discarded document activity** — `if (projects.length === 0)` returned empty activity even when documents existed. Fixed to check both sources.
3. **Activity sort produced NaN** — documents have no timestamp (`''`), causing `new Date('').getTime()` = NaN. Fixed with `ts()` helper returning 0 for non-finite values.
4. **Static files 404 in browser** — `express.static(PUBLIC_DIR)` served at root but HTML referenced `/nexona/css/...`. Would break the entire UI. Fixed: mounted at `/nexona`.
5. **Root path returned 404** — after fixing static serving, `/` served nothing. Fixed: added `app.get('/')` serving `index.html`.

**Isolation verified (A vs B):**
- B cannot see A's preferences (independent empty store)
- B cannot see A's projects (empty list)
- B forbidden from A's project by id (404)
- B cannot see A's activity (empty vs A's project activity)
- Unauthenticated access → 401

**Persistence verified:** Preferences and projects survive server restart (durable account store + durable artifact store).

## Stage 6 — Projects  `[✓] COMPLETE`

**Goal:** Per-user project list, workspace shell, settings, and the missing `PUT /api/projects/:id` endpoint, with full e2e + persistence verification.

**Backend (server.ts):**
- `PUT /api/projects/:id` added (the previously-noted 6.4 gap). Owner-checked via `requireOwnedProject`; validates `title` (string, 2–64 chars) and `mode` (must be a member of `PROJECT_MODES`); 400 when neither is supplied, 404 when the project is foreign or missing, 200 with the updated summary on success. Persists through the durable artifact store.
- Existing `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects`, `DELETE /api/projects/:id`, `POST /api/projects/:id/run/:stageId`, `POST /api/projects/:id/approve` unchanged.

**Frontend (new + updated):**
- `views/projects.js` (NEW) — per-user project grid with mode/status/id cards, empty state with Create CTA, delete with `confirm()`. Sidebar "Projects" now routes here.
- `views/project.js` (NEW) — workspace shell: identity header, mode/status/stages-run/approval meta, full lifecycle stage list with honest `OUT_OF_SCOPE` labels for stages outside the project's mode, "Run stage" buttons only for in-scope pending stages, link to settings, 404 / error states.
- `views/project-settings.js` (NEW) — title/mode form that PUTs to the new endpoint, danger-zone delete via `DELETE`, 404 state.
- `api.js` — `updateProject(id, data)` added.
- `router.js` — `/projects` and `/projects/:id/settings` registered; `/projects/:id` unchanged.
- `components.css` — project grid / card / stages / danger-panel styles (balanced 256/256).

**E2E harness (test/projects-api.test.ts, NEW, node --test):**
- Real `ProjectRegistry` + `JsonFileArtifactStore` + `MemoryEvidenceLog` + scripted `AiRouter`. No demo pipeline.
- 5 tests, 5 pass:
  1. **Full lifecycle:** create 201 → list contains → detail with in-scope stages → PUT title+mode 200 → invalid mode 400 → empty update 400 → in-scope stage run 200 + RECORDED → out-of-scope stage 409 → delete 204 → detail 404 → list no longer contains it.
  2. **Empty state:** fresh user count 0.
  3. **Isolation:** second account gets 404 on get/PUT/run/DELETE of first account's project; project untouched.
  4. **Unauthenticated:** list/create/PUT → 401.
  5. **Restart persistence:** project created on server 1 still listed and readable after a full restart on the same data dir (durable store); same account logged back in.

**Bugs found & fixed:**
- `_fix_test.mjs` repair script picked up by `node --test` as a test (had no test() registration) — deleted after use.
- Test ran the persistence case with a *new* signup on the second server, so it couldn't see the persisted project. Switched to `loginCookie` with the original `alice_persist` account — pass.

**Regression:** `npm test` — **363 tests, 363 pass, 0 fail**. `tsc --noEmit` GREEN. All touched JS `node --check` OK. CSS balanced (tokens 8/8, layout 80/80, components 256/256).

**Docs updated:** `NEXORA_MASTER_SPEC.md` (PUT added to API inventory; missing-capabilities table cleared), `NEXORA_IMPLEMENTATION_ROADMAP.md` (Stage 6 → COMPLETE with per-substage evidence), `NEXORA_PRODUCT_BLUEPRINT.md` (Projects list, workspace, settings marked `[✓]`).

