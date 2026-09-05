# NEXORA — Master Product Specification & Control Document

> **NEXORA — The Blueprint AI Software Engineering Platform**
> Living control document. Status legend: `[ ]` Not started · `[~]` In progress · `[x]` Implemented · `[✓]` Tested/verified · `[!]` Blocked. Updated after every stage.

## 0. Document Control

| Property | Value |
|---|---|
| Product | NEXORA — The Blueprint AI Software Engineering Platform |
| Engine (foundation, untouched) | Blueprint-First: `src/` core (discovery, design, build, verification, testing, continuous, recursion, perm, council, AI) |
| Web server | `src/web/server.ts` (Express `buildServer`/`startServer`); serves `public/nexona/` SPA |
| Auth | `nexona_session` cookie (opaque signed token, SameSite=Lax, 12 h); bcrypt + TOTP (RFC 6238) + recovery codes; server-side enforced |
| Tests | `node --test` — 358 pass / 0 fail (baseline) |
| Typecheck | `npx tsc --noEmit` — GREEN |
| Baseline | 2026-09-03 |

## 1. Execution Rule

Do not build NEXORA in one go. Each stage: Understand → Backend-map → Specify → Design → Implement-backend → Implement-UI → Connect → Test → Browser-verify → Mark complete.

| `[✓]` | Stages small and verifiable |
| `[~]` | Method enforced per-stage |

## 2. Persistent Documents

| Document | Path | Status |
|----------|------|--------|
| Master Spec | `NEXORA_MASTER_SPEC.md` | `[~]` In progress |
| Product Blueprint | `NEXORA_PRODUCT_BLUEPRINT.md` | `[~]` In progress |
| Implementation Roadmap | `NEXORA_IMPLEMENTATION_ROADMAP.md` | `[~]` In progress |
| Progress Log | `NEXORA_PROGRESS.md` | `[~]` In progress |

## 3. Product Identity

| `[x]` | "NEXORA" + subtitle |
| `[x]` | Browser title, splash, nav use NEXORA |
| `[!]` | Old "Nexona" refs in source — cleanup review |
| `[!]` | Stale `public/index.html` + `app.js` + `styles.css` NOT served |
| `[!]` | `public/teamtask/` exists, NOT served — remove in cleanup |

## 9. Logo

| `[✓]` | SVG wordmark, standalone mark, favicon created and integrated |
| `[✓]` | Design: hexagon, blueprint grid, AI nodes, flow path, evolution arc |

## 10. Splash

| `[✓]` | `splash.js`: ~4 s reveal, reduced-motion, skip, any-click advances |
| `[✓]` | Authenticated users skip to `/dashboard`; backend-independent |

## 11. Public Introduction

Progressive story: What → Problem → Blueprint-First → Discovery → Design → Blueprint → Approval → Engineering → Verification → Evidence → Testing → Ops → Runtime → Continuous Eng → Differentiation.

| `[✓]` | `intro.js`: full 14-step guided story, Continue/Back, progress dots, founder section |

## 12. Founder

**Cornelius Adedeji Victor**. Product stays central.

## 30. Customer Care

**Cornelius Adedeji Victor** · WhatsApp/Phone: **08154076947** / **07061743252** · Email: adedejicorneliusvictor@gmail.com

| `[x]` | Details specified |
| `[✓]` | `help.js` view: real clickable WhatsApp, phone, email links; public route `/help` |

## 36. TeamTask

| `[x]` | Exists, NOT served |
| `[!]` | Remove in cleanup |

## 13. Authentication (Backend)

| `[✓]` | Signup: validates input, hashes password (scrypt + per-user salt), enforces username uniqueness, rate-limited |
| `[✓]` | Login: rate-limited (8 fails/15min, 5min lock), scrypt verification, session cookie issued |
| `[✓]` | Logout: single-session revocation (`POST /api/auth/logout`) + cookie cleared |
| `[✓]` | Sessions: 7-day TTL, opaque token in `nexona_session` cookie (HttpOnly, SameSite=Lax) |
| `[✓]` | Protected routes: `attachAuth` middleware → 401 for anonymous; `assertSameOrigin` CSRF guard |
| `[✓]` | Session expiry: registry enforces TTL; expired token → anonymous → 401 |
| `[✓]` | Account isolation: per-user projects, documents, credentials (verified in tests) |

### Authentication backend endpoints (complete)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/signup` | POST | Create account (scrypt hash, unique username) |
| `/api/auth/login` | POST | Authenticate (rate-limited, issues cookie) |
| `/api/auth/logout` | POST | Revoke session + clear cookie |
| `/api/auth/session` | GET | Return current account or null |
| `/api/auth/forgot` | POST | Start recovery (authenticator or local-token mode) |
| `/api/auth/forgot/verify` | POST | Verify authenticator code + set new password |
| `/api/auth/reset` | POST | Reset password with local token |
| `/api/account/password` | POST | Change password (current + new) |
| `/api/account/authenticator` | GET | Get authenticator status (enabled, hasAuthenticator) |
| `/api/account/authenticator/setup` | POST | Setup TOTP (verify code, issue recovery codes) |
| `/api/account/authenticator/enable` | POST | Enable authenticator (verify code) |
| `/api/account/authenticator/disable` | POST | Disable authenticator (verify code) |
| `/api/account/sessions` | GET | List sessions (redacted, current flagged) |
| `/api/account/sessions/revoke-others` | POST | Revoke all other sessions |
| `/api/account/security-events` | GET | List security events |
| `/api/account/profile` | POST | Update display name |
| `/api/account/preferences` | GET/POST | GET: list preferences; POST: patch-update preferences |

### Authenticator backend (TOTP, RFC 6238 SHA-1)

| Capability | Status |
|------------|--------|
| Secret generation (base32, 160-bit) | `[✓]` |
| otpauth:// provisioning URI | `[✓]` |
| Setup (verify code, issue recovery codes) | `[✓]` |
| Enable (verify code, persist enabled state) | `[✓]` |
| Disable (verify code, clear enabled state) | `[✓]` |
| Verification (±1 step window, timing-safe) | `[✓]` |
| Recovery codes (single-use, hashed) | `[✓]` |
| Backend-enforced enabled state | `[✓]` |
| Challenge-based recovery flow | `[✓]` |
| `[✓]` | Account isolation: per-user projects verified in `account.test.ts` |
| `[~]` | Signup frontend (`signup.js`) — needs full validation verification |

## 14. No OTP

| `[✓]` | No SMS/email OTP. Recovery via TOTP codes / recovery codes only |

## 15. Authenticator Security

| `[✓]` | Secret generation, QR/manual setup, setup verification (code required to enable) |
| `[✓]` | Enabled state persisted (durable), backend-enforced |
| `[✓]` | Verification (TOTP code check), recovery (single-use recovery codes) |
| `[✓]` | Disable requires valid code; security events recorded |
| `[✓]` | Frontend authenticator UI: setup (secret+otpauth), enable (code), disable (code), recovery codes — `settings-security-authenticator.js` |

## 16. Forgot Password

Backend: `POST /api/auth/forgot` → `POST /api/auth/forgot/verify` → `POST /api/auth/reset`. Every step communicates with backend; no fake success.

| `[✓]` | Backend full flow |
| `[✓]` | `forgot.js` frontend: identify → authenticator code → new password → login (verified end-to-end) |

## 17. Security Center

| `[✓]` | Backend: password, authenticator, recovery, sessions, revoke-others, security events |
| `[✓]` | Frontend security center hub `settings-security.js` + sub-pages (password, authenticator, sessions, events) |

## 18. Profile

| `[✓]` | Backend: `GET /api/me`, `POST /api/account/profile` |
| `[✓]` | Frontend profile view `settings-profile.js` (real account data + display-name update) |

## 27. Account Isolation

| `[✓]` | Backend per-user isolation (account.test.ts, chat-docs-api.test.ts): projects, documents, credentials |
| `[✓]` | Verified end-to-end: A vs B — B never sees A's sessions/security events |

## 28. AI Providers and Models

| `[✓]` | Backend: Models.dev + OpenRouter; credential CRUD + verify; selection per user |
| `[!]` | Frontend providers/models view — not started |

## 29. API Key Security

| `[✓]` | Backend: credential refs are opaque (id + providerId only), secret never echoed, verify distinguishes configured vs verified/available |
| `[!]` | Frontend credential display needs masking verification |

## 8. Backend Capability Map (Implemented)

**Auth API** (`src/web/auth-api.ts`):
`POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/session` · `POST /api/auth/forgot` · `POST /api/auth/forgot/verify` · `POST /api/auth/reset` · `POST /api/account/password` · `GET /api/account/authenticator` · `POST /api/account/authenticator/setup` · `POST /api/account/authenticator/enable` · `POST /api/account/authenticator/disable` · `GET /api/account/security-events` · `GET /api/account/sessions` · `POST /api/account/sessions/revoke-others` · `POST /api/account/profile` · `POST /api/account/preferences`

**Server API** (`src/web/server.ts`):
`GET /api/me` · `GET /api/summary` · `GET /api/activity` · `GET /api/roadmap` · `GET /api/caps` · `GET /api/projects` · `GET /api/projects/:id` · `POST /api/projects` · `DELETE /api/projects/:id` · `POST /api/projects/:id/run/:stageId` · `POST /api/projects/:id/approve` · `PUT /api/projects/:id` (owner-checked title/mode update) · `GET /api/projects` pipeline stages (discovery, design, council, verification, testing, deployment, telemetry, continuous, recursion, safe-change, peo) · `GET /api/artifacts` · `GET /api/artifacts/:id` · `GET /api/dependency-map` · `GET /api/lineage` · `GET /api/evidence` · `GET /api/certification` · `GET /api/traceability` · `GET /api/models` · `GET /api/models/stats` · `GET /api/models/selection` · `POST /api/models/select` · `GET /api/models/:providerId/:modelId` · `POST /api/credentials` · `GET /api/credentials` · `DELETE /api/credentials/:id` · `POST /api/credentials/:id/verify` · `POST /api/chat/ingest` · `POST /api/documents/upload` · `GET /api/documents` · `GET /api/documents/:id` · `DELETE /api/documents/:id`

### Missing Backend Capabilities

| Capability | Status |
|---|---|
| `PUT /api/projects/:id` (update/project settings) | `[✓]` Implemented (Stage 6) |
| Per-project AI preferences endpoint | `[!]` Not started |
| `GET /api/projects/:id` explicit owner check confirmation | `[✓]` Confirmed (`requireOwnedProject`; enforced by `projects-api.test.ts` isolation test) |

## 6. Page Inventory (Condensed)

### Public
| Page | Frontend view | Backend | Status |
|------|---------------|---------|--------|
| Splash/brand reveal | (splash) | none | `[!]` |
| Introduction | `intro.js` | none | `[~]` |
| Founder section | (in intro) | none | `[~]` |
| Customer Care | `how.js` | none | `[~]` → `[!]` needs real links |
| Signup | `signup.js` | `/api/auth/signup` | `[~]` |
| Login | `login.js` | `/api/auth/login` | `[~]` |
| Forgot password | `forgot.js` | `/api/auth/forgot`+verify+reset | `[~]` |

### Authenticated application
| Page | Frontend view | Backend | Status |
|------|---------------|---------|--------|
| Dashboard | `dashboard.js` | `/api/me`, `/api/projects`, `/api/activity`, `/api/models/selection`, `/api/credentials` | `[✓]` |
| Projects list | `projects.js` | `GET /api/projects` | `[✓]` |
| Create project | `project-new.js` | `POST /api/projects` (accepts optional `visionDocumentId` from `chat/ingest`) | `[✓]` |
| Project workspace | `project.js` | all pipeline endpoints | `[✓]` |
| Project settings | `project-settings.js` | `PUT /api/projects/:id` + `DELETE /api/projects/:id` | `[✓]` |
| Documents list | `documents.js` | `GET /api/documents` | `[✓]` |
| Document detail | `document.js` | `GET /api/documents/:id?full=true` + `DELETE /api/documents/:id` | `[✓]` |
| Document upload | `documents-upload.js` | `POST /api/documents/upload` (multipart, 5 MB) + `POST /api/chat/ingest` (live classification) | `[✓]` |
| Artifacts | (none) | `GET /api/artifacts` | `[!]` |
| Evidence | (none) | `GET /api/evidence` | `[!]` |

### Account
| Page | Frontend view | Backend | Status |
|------|---------------|---------|--------|
| Profile | `settings-profile.js` | `/api/account/profile` | `[✓]` |
| Security | `settings-security.js` | authenticator + sessions endpoints | `[✓]` |
| Preferences | `settings-preferences.js` | `GET/POST /api/account/preferences` | `[✓]` |

### AI
| Feature | Frontend view | Backend | Status |
|---------|---------------|---------|--------|
| Providers/models/credentials | (none) | all `/api/models` + `/api/credentials` | `[!]` |

### System states
| State | Status |
|-------|--------|
| 404 | `[~]` `404.js` |
| 401/403/500/offline/expired session/unavailable provider | `[!]` / `[~]` (backend returns errors; frontend needs handling) |

## 19. Dashboard

Show only real backend info: user identity, projects, progress, next action, attention items, provider/model status, recent activity, verification state, warnings, processing state, shortcuts.

| `[~]` | `dashboard.js` exists; needs real data binding verification |
| `[~]` | Provider/model status wiring needed |

## 20. Projects

| `[✓]` | Backend: list/get/create/delete + per-user isolation |
| `[~]` | Frontend: `project-new.js` exists; list/open/detail views not started |
| `[!]` | Export, archive views |

## 21. Idea Intake

| `[~]` | Project creation with mode selection exists; needs natural-language + file/image intake fields |
| `[!]` | Image upload support (backend is text-only — gap if required) |

## 22. Real File/Image Uploads

| `[✓]` | Backend: `POST /api/documents/upload` (text only, 5 MB, multipart, validation, per-user isolation verified) |
| `[✓]` | Frontend: `views/documents.js` (list), `views/document.js` (detail), `views/documents-upload.js` (drag-and-drop + paste path with live `chat/ingest` classification) — covered by `test/documents-api.test.ts` (5/5). |
| `[!]` | Image uploads: backend rejects binary — gap if images required |

## 23. Transparent Engineering Process

| `[✓]` | Backend exposes all stage data via `/api/*` endpoints |
| `[!]` | Frontend workspace with stage visualization — not started |

## 24. Every UI Element Has a Real Purpose

| `[~]` | To be audited per-stage as pages are implemented |
| `[~]` | `api.js` uses real endpoints; per-element review pending |

## 25. Frontend/Backend Contract

| `[✓]` | `api.js` matches backend routes |
| `[~]` | Per-component contract verification pending |

## 26. Silent Failure Testing

| `[~]` | Will be tested per-stage |
| `[✓]` | Some isolation tests exist |

## 31. What-If Scenarios

| Scenario | Backend | Frontend |
|----------|---------|----------|
| Auth failures | `[✓]` | `[~]` |
| Infrestructure | `[~]` | `[~]` |
| Projects | `[✓]` | `[~]` |
| Uploads | `[✓]` | `[~]` |
| AI | `[✓]` | `[~]` |
| Blueprint-First | `[✓]` | `[!]` |
| Synchronization | `[~]` | `[~]` |

## 32. Explain Complexity

| `[!]` | Help/tooltip system needs design |

## 33. Professional Design System

| `[✓]` | CSS tokens (dark-first, accent #3b82f6, reduced-motion) complete |
| `[✓]` | Components: buttons, cards, forms, badges, tables, empty/skeleton/error/success states, auth, responsive |
| `[✓]` | Layouts: top bar, sidebar, modal, toast, splash, carepage, focus-ring, skip-link |
| `[✓]` | Component test page exercises all variants; CSS balanced; HTML balanced |
| `[!]` | Help/tooltip system needs design (future phase) |

## 34. Responsive Design

| `[~]` | CSS has viewport meta + tokens; needs breakpoint testing (320–1440px+) |

## 35. Accessibility

| `[~]` | Some a11y attributes in HTML; needs behavioral testing per stage |

## 38. Development Phases

| Phase | Title | Status |
|-------|-------|--------|
| 0 | Repository Understanding & Baseline | `[✓]` Complete |
| 1 | Master Product Specification | `[✓]` Complete |
| 2 | NEXORA Design System & Brand | `[✓]` Complete |
| 3 | Public Experience | `[✓]` Complete |
| 4 | Authentication & Security | `[✓]` Complete |
| 5 | Application Shell & Dashboard | `[~]` Partial |
| 6 | Projects | `[~]` Backend `[✓]`; Frontend `[~]` |
| 7 | Files & Inputs | `[~]` Backend `[✓]`; Frontend `[~]` |
| 8 | Blueprint-First Workspace | `[!]` Frontend not started |
| 9 | Artifacts, Evidence & Traceability | `[!]` Frontend not started |
| 10 | AI Providers & Models | `[✓]` Backend; `[!]` Frontend |
| 11 | Failure & Recovery | `[~]` |
| 12 | Full Integration | `[!]` |
| 13 | Security & Isolation Audit | `[~]` Backend `[✓]`; UI pending |
| 14 | Browser & Responsive Verification | `[!]` |
| 15 | Final Honesty Audit | `[!]` |

## 39. Stage Completion Gate

Stage is complete only when: design ✓ · backend ✓ · frontend connected ✓ · persistence ✓ · errors ✓ · security ✓ · responsive ✓ · a11y ✓ · tests ✓ · reload ✓ · restart ✓.

| `[~]` | Gate defined; enforced per stage |

## 40-46. Quality Standards & Process Discipline

| `[~]` | Process defined |
| `[~]` | Progress logged per stage in `NEXORA_PROGRESS.md` |
| `[!]` | Final honesty audit pending |

## Baseline Verification (Phase 0 output)

- TypeScript strict typecheck: GREEN (`_tsc4.status`: TSC_OK)
- Test suite: 358 tests pass, 0 fail, 0 skipped (duration ~35 s)
- All Phase 0 objectives: COMPLETE