# Blueprint-First — Vision ↔ Implementation Reconciliation (Architecture 3.3)

Status: Phase 3 artifact of the master build instruction. This document records what the
approved vision requires, what the repository actually contains, where they diverge, and
which production-grade interpretation governs. It is the source of truth for all subsequent
rebuild work in this engagement.

Sources of authority, in precedence order:

1. `BLUEPRINT-FIRST_AI_SOFTWARE_ENGINEERING_ARCHITECTURE_3.3_FINAL_APPROVED_PRODUCT_AMENDMENTS`
   (the vision document, Part V amendments included).
2. The master build instruction governing this engagement.
3. This reconciliation document (decisions taken under it).

---

## 1. Version and authority conflicts

| # | Conflict | Resolution |
|---|---|---|
| 1.1 | Repository self-describes as "Architecture 2.0 — Level 1a" (`package.json:4`); the approved target is Architecture 3.3. | The repository description is stale. Implementation target is Architecture 3.3 with Part V amendments. `package.json` will be corrected. |
| 1.2 | The vision PDF's own internal title reads "Architecture 3.2 — Discovery-Hardened" while the filename/approval record says 3.3. | Document-internal inconsistency; the approved product version is 3.3 (per approval record and filename). Noted for the final report; does not change content. |
| 1.3 | `.env.example:4` references `docs/configuration.md`, which does not exist. No README, no CI, no deployment manifest (`vercel.json`) exists. | Create `docs/configuration.md`, README, and Vercel deployment configuration as part of the hosting work. |
| 1.4 | Roadmap (Part III) is additive across Levels 1a → 5. The repo implements a mix of levels: Level 1a core plus substantive Level 1b/2/3-shaped modules, at uneven depth. | Target: complete, real, per-project functionality for every module the repository contains, at the depth required by the vision for that module's own specification; gaps against the vision's full form are tracked in §6 and closed or explicitly reported — never papered over. |

---

## 2. Part V amendments — verdict against the code

### V.2 Approved authentication model — SUBSTANTIALLY MET, cleanup required
- Active stack (`src/account/identity.ts`, `src/web/identity-api.ts`) implements exactly the
  required contract: signup = Full Name, Username, Gmail, Security Question, Security Answer;
  no session issued at signup; single login = Gmail + Security Question + Security Answer;
  scrypt-hashed answers; server-side Gmail/username uniqueness; uniform failure message.
  Verified by `test/identity-auth.test.ts`, `test/identity-http.test.ts`,
  `test/entry-experience-audit.test.ts`.
- **Gap 2.1:** A full legacy authentication stack still exists in source —
  `src/account/accounts.ts` (passwords, TOTP authenticator, recovery codes, password reset,
  two-step login challenge), `src/account/totp.ts`, `src/web/account-api.ts` remnants.
  No legacy route is registered in the active product (audited), but the code and its tests
  (`test/authenticator.test.ts`, `test/web-login-two-step.test.ts`, …) remain.
  **Disposition: remove the legacy stack and its tests from the product; the active identity
  stack is the only authentication system.**

### V.3 Single public application / server-side authorization — MET
- One signup route, one login route, one login screen; owner uses the same path.
  Owner-only router guarded server-side (`server.ts:2971-2994`, 401/403), verified by
  `test/owner-infrastructure.test.ts` and `test/entry-experience-audit.test.ts`.
- **Gap 2.2:** `GET /api/artifacts/:id` (`server.ts:1693`) and
  `GET /api/models/:providerId/:modelId` (`server.ts:3651`) have no session check.
  **Disposition: add server-side authentication + ownership scoping.**
- **Gap 2.3:** Duplicate session endpoints (`/api/auth/session` and `/api/me`).
  **Disposition: keep one; drop the other to a thin alias or remove.**

### V.4 Platform Owner account — MET (pending production secret provisioning)
- Owner identity defaults in `src/account/identity.ts:487-492` match the vision exactly:
  Cornelius Adedeji Victor / Oluwasegun / corneliusadedejivictor@gmail.com /
  "What city did my parents meet?". Bootstrap answer comes only from
  `BF_BOOTSTRAP_SECURITY_ANSWER` (server-side secret boundary), never stored in source.
- Owner-only Daytona configuration routes exist and are tested.
- **Disposition: production provisioning requires the real bootstrap answer to be supplied
  as a Vercel environment secret (owner action). See §9.**

### V.5 AI MODEL / provider contract — STRUCTURE MET, frozen content NOT enforced
- The popup structure exists (`design-prototype/src/modelPopup.tsx`): FREE MODELS section,
  API PROVIDER with Provider + API Key, Model selector, the exact required wording
  (lines 280 and 297 match the frozen strings verbatim), Verify and Done.
- Catalogue is dynamically sourced from the OpenCode-backed integration
  (`src/ai/opencode/*`); free models are derived from live cost data, not hard-coded.
- **Gap 2.4:** The approved FREE MODELS set (Space Bunny Free; MiMo-V2.6-Flash Free;
  Muse Spark 1.3 Free; Ling 3.0 Flash Fin Free; Nemotron 3.5 Lightning Free;
  Muse Spark 1.2 Free; Nemotron 3 Ultra Free; Big Pickle) is neither enforced nor
  tested anywhere. **Disposition: FREE MODELS section renders the approved set, filtered by
  live catalogue availability; API PROVIDER model selection stays fully dynamic. Add an
  executable test pinning the approved set.**
- Verify must perform a real provider verification; Done must actually commit the selection.
  To be verified end-to-end in testing.

### V.6 Deferred comprehensive redesign — OPEN (sequenced last by design)
- Current frontend is pre-redesign (Vite/React hash-routed SPA, real API integration,
  30+ screens). The complete redesign (new identity, dark/light, splash ≈4 s, ≤3-page
  introduction, responsive phone/tablet/desktop, every control working) is deliberately
  sequenced AFTER the functional target is implemented and tested — this satisfies both
  V.6's ordering rule and the engagement's requirement for a from-scratch redesign.
  **Decision D1.** See §7.

### V.7 Execution transparency — PARTIAL
- SSE event stream, supervisor snapshot, job records and evidence log exist
  (`/api/working/project/:id/stream`, `/api/working/supervisor`, `/api/evidence`).
- **Gap 2.5:** A large share of currently displayed stage state derives from the boot-time
  demo pipeline rather than persisted per-project execution (§5). V.7 requires every
  displayed event to correspond to actual persisted execution state. Fixed by §5 work.

### V.8 Hosting direction — NOT STARTED
- No `vercel.json`, no database driver, no PostgreSQL integration; persistence is
  JSON files on local disk; the supervisor runs as an in-process loop; the server boots a
  full demo pipeline synchronously (≈15 s), which is incompatible with serverless cold starts.
- **Disposition: full control-plane conversion — Neon-backed persistence (D2), Daytona
  execution adapter (D3), supervisor converted to durable job queue + periodic watchdog tick
  usable both in a long-lived process and on a serverless cron (D4), plus `vercel.json`.**

### V.9 What must not change — tracked as binding requirements
- Real Daytona, real Cline, real OpenCode integration; Worker Runtime, scheduling,
  supervision, recovery, evidence, provenance, no-skipping; Discovery 25-pass / 36-worker
  organization; certification; Digital Twin; single project-wide provider/model identity;
  security, tenant isolation, three-minute hang recovery, checkpointing; reality-over-declaration.
  Gaps against these are enumerated in §6.

### V.10 / Appendix D — testability of the amendments
- Every amendment must be covered by executable tests and final acceptance evidence.
  Test additions are part of each gap's disposition below.

---

## 3. Reality audit — subsystem verdicts

Evidence from a full read of `src/` and `test/` (detailed in the audit pass; key files named).

| Subsystem | Verdict | Evidence / key limitation |
|---|---|---|
| Discovery (Clusters A/B, Boss) | PARTIAL | `src/discovery/department/engine.ts` real worker→self-check→specialist→independent Boss flow; Level-3 extension runs ≈10 passes (`level3.ts`), not the required 25; ~7 named DW roles, not the 36-role corps; negative-space rules = 3 hardcoded; one-regex contradiction scan. |
| Design studio + approval gate | REAL | `design/studio.ts`, `design/approval.ts` (bidirectional coverage, lineage, no self-approval), `design/coverage.ts`; tests present. |
| Build studio | PARTIAL | Gating/verification real (`build/studio.ts`, tests), but **no code generation**: `build/materialize.ts` writes JSON artifacts + a ≤400-char note; real code production exists only in the Cline/agentic path. |
| Verification (11 dimensions) | REAL | `master-engine.ts`, `live-engine.ts`, `dimensions.ts` (`assertElevenDimensions`), DoC state machine in `core/doc.ts` (17 states); caveat: `closure-verifier.ts` shallow checks pass/inconclusive by design of that layer. |
| Certification | REAL | `design/certification.ts` — 6 mechanical preconditions, governed gates, honest confidence; one hardcoded contradiction-register precondition line (gap 6.4). |
| Council | REAL | 15 independent seats, reconciliation, consumed by master engine; demo answers seats with scripted strings (fixed by §5). |
| Traceability | REAL | `traceability/trace.ts`, `design-code-trace.ts`; the latter never test-covered (gap 6.6). |
| Digital Twin | PARTIAL | Static derived model (`twin/materialize.ts`), served at `/api/twin`; no interactive simulation (vision scope: Level 3). |
| Continuous / Operations / Change / Perm | PARTIAL | Governance flows real + tested (`continuous`, `change`, `perm` depts); deployment substrate is an in-memory simulation (`operations/deploy.ts`); telemetry source synthetic. |
| Supervisor / Jobs | REAL | 180 s hard timeout, hang classification, checkpoints, crash→RECOVERING, dependency/env gates; extensive tests. |
| Worker/Boss runtime | PARTIAL | Pattern implemented per-department inline; generic `runWorkerBossFlow` exists but is not called by production code; `jobExecutor` issues one generic model prompt per stage instead of invoking the department engines (central defect, §5). |
| Auth / owner controls / evidence / documents / projects API | REAL | Test-covered, passing. |
| Dead code | — | `teamtask-api.ts` (15 unregistered routes + static app), legacy `public/` static dashboard, orphaned `mock/*` datasets incl. old demo credentials, unrouted `Providers.tsx`/`Credentials.tsx`, shadowed `#/projects/:id/execution` route, broken `start-dev.cmd`. |

---

## 4. Frontend inventory and defects (pre-redesign baseline)

- Real API integration confirmed (`api.ts` same-origin fetch with session cookie;
  23 of 26 pages call the backend).
- Defects to be eliminated by the redesign (all are V.6 "no dead buttons" violations):
  global search stub ("coming soon"), Privacy/Terms "coming soon", dead/unrouted pages,
  per-project execution route shadowed by workspace route, `#/providers`/`#/credentials`
  unreachable, Vite dev server has no `/api` proxy (dev workflow broken).
- Mock layer (`src/mock/*`) is mostly orphaned; `stagesForMode()` still fabricates stage
  status for project-list rows and post-create state until real detail loads — replaced by
  real state in the redesign.
- Production serves the built bundle from `src/web/public/nexona`
  (`npm run build:serve` in `design-prototype/` copies `dist` there).

---

## 5. Central defect — the boot-time demo pipeline

**Every stage/lifecycle API in the product is currently fed by a single boot-time
`runDemoPipeline()`** (`server.ts:280`), which:

- runs once for the whole server, not per project;
- uses `ScriptedProvider` with a hardcoded discovery payload ("TeamTask") that ignores
  its input, so every boot returns the same answers;
- deletes the artifact store at start for determinism;
- costs ≈15 s of synchronous boot time (fatal for serverless cold starts).

The on-demand run paths (`POST /api/projects/:id/run/:stageId`, `POST /api/working/jobs`)
**bypass the Discovery/Design/Build engines entirely** — they send one generic
"Produce the {stage} deliverable" prompt to the bound model (or honestly record a
checkpoint when no credential exists), storing prose into job attributes.

This is the single largest reality-over-declaration violation (V.9) and the root cause of
V.7 transparency problems.

**Required end state (Decision D5):** per-project, on-demand execution that invokes the
real department engines (DiscoveryDepartment, AiDesignStudio, AiBuildStudio, verification,
certification, …) bound to the project's single verified provider/model, executing real
agentic work in a Daytona sandbox, persisting artifacts/evidence/events to durable storage;
stage APIs read only that persisted per-project state; boot performs no pipeline work.
`ScriptedProvider` remains available for unit tests only.

---

## 6. Gap register

| # | Gap | Disposition |
|---|---|---|
| 6.1 | 25-pass discovery discipline not implemented (≈10 passes exist); 36-worker corps not implemented (~7 named roles). | Implement the full approved 25-pass sequence and 36-role roster per the vision's discovery organization, reusing the existing worker/self-check/specialist/Boss machinery. |
| 6.2 | Build stage produces JSON manifests, not real code. | Real code generation through the agentic/Cline path executing in the project's Daytona sandbox; artifacts = actual repository files with evidence (git commits, output logs). |
| 6.3 | Stage engines never invoked per project (§5). | Core rebuild item — per-project execution wiring (D5). |
| 6.4 | Certification precondition writes a hardcoded "contradiction register: empty (engine arrives at a later level)" line. | Bind to the real contradiction register (now required by 6.1) and test it. |
| 6.5 | Operations substrate is an in-memory deployment simulation; telemetry synthetic. | Keep governed operations flow, but execution/deployment verification must operate against the real sandbox environment and produce real evidence; telemetry source must be labelled honestly in UI per V.7. |
| 6.6 | `design-code-trace.ts` never exercised by tests; `src/engines`, `src/security/threat-model.ts`, `src/visual/*`, `src/design/system/*` untested. | Add test coverage as these modules are wired into per-project execution. |
| 6.7 | Two unauthenticated read endpoints (2.2). | Server-side auth + scoping; add negative tests. |
| 6.8 | `GET /api/account/preferences` always returns `{}` (never reads stored prefs). | Fix read path; test round-trip. |
| 6.9 | No health/version endpoint. | Add `GET /api/health` (liveness + version) for the hosted control plane. |
| 6.10 | Dead surfaces: teamtask module, legacy static frontend, orphaned mocks, unrouted pages, broken `start-dev.cmd`. | Remove in the redesign/cleanup pass. |
| 6.11 | No database; local-filesystem persistence only (V.8). | Neon PostgreSQL behind the store layer (D2). |
| 6.12 | No Vercel deployment configuration; supervisor cannot run as a serverless daemon. | `vercel.json` + API-function packaging + durable queue/watchdog (D4). |
| 6.13 | Legacy authentication code in source (2.1). | Remove legacy stack + its tests. |
| 6.14 | Approved FREE MODELS set not enforced/tested (2.4). | Enforce + test (D6). |
| 6.15 | Tests requiring locally installed cline/daytona CLIs (`real-cli-integration`, `real-e2e-execution`) contradict the cloud-only policy (they encode "CLI must be on this host"). | Re-target these tests to the real cloud integration: Daytona API with the owner-supplied key, OpenCode/Cline execution verified remotely; local-CLI expectations removed. |
| 6.16 | `foundation-capabilities.test.ts:276` hardcodes `opencodeReady === false`, an assumption false on hosts where an opencode binary exists. | Derive the expectation from the same live probe used for cline/daytona (honest regardless of host). |
| 6.17 | Server boot cost ≈15 s per instance (demo pipeline) — also breaks parallel test throughput (observed load timeouts). | Resolved by §5 (no boot-time pipeline). |
| 6.18 | Vite dev server cannot reach the API (no proxy). | Add dev proxy or unified dev serving. |

---

## 7. Decisions (production-grade interpretations)

| ID | Decision |
|---|---|
| D1 | **Sequencing:** implement the functional target and its tests first (§5, §6), then the complete visual redesign (V.6), then end-to-end acceptance. This satisfies V.6's "redesign only after functionality" rule while delivering the engagement's required from-scratch redesign. No UI redesign work happens before the functional target is met. |
| D2 | **Persistence:** storage behind a single store interface with two real backends — JSON-file (default: local development and the test suite, fast, no network) and PostgreSQL via Neon (`DATABASE_URL` present: production). Production on Vercel runs exclusively on Neon; no local PostgreSQL is ever installed. Schema migrations ship with the repo. |
| D3 | **Execution plane:** pluggable environment adapter — Daytona (production, owner-configured, keys in the secret boundary) and local workspace (development/tests only, honestly reported by the foundation report as `development-local`). The startup gate only opens for production when Daytona is genuinely READY. |
| D4 | **Control plane on Vercel:** the Express app is packaged as serverless functions; long-lived loops become durable database-backed work + a periodic watchdog tick (Vercel cron) so the 3-minute hang recovery, crash recovery and supervision survive without a daemon. SSE streams replay persisted events. The same code runs in a long-lived process for development. |
| D5 | **Per-project real execution:** stage runs invoke the actual department engines bound to the project's single verified provider/model; real agentic work (OpenCode/Cline) executes in the project's Daytona sandbox; artifacts/evidence/events are persisted per project. The boot-time demo pipeline is deleted. `ScriptedProvider` is test-only. |
| D6 | **Free-model contract:** the FREE MODELS section renders exactly the approved eight entries, filtered by live OpenCode catalogue availability; all other catalogue surfaces remain dynamically OpenCode-sourced. Verify/Done perform real verification/commitment. |
| D7 | **No local execution infrastructure:** nothing is installed on the operator's machine beyond ordinary repository dev-dependencies and git (explicitly authorized). PostgreSQL, Daytona, Cline and platform OpenCode execution remain cloud-side. Local test doubles exist only as in-process test fixtures. |
| D8 | **Legacy removal:** legacy password/TOTP/recovery code and all dead surfaces (§6.10, §6.13) are removed rather than left dormant — dead code is an attack surface and a maintenance lie. |

---

## 8. Baseline test results (pre-change)

Environment: Windows, Node v24, git 2.55 installed during baseline (owner-approved),
opencode binary pre-existing on host (not installed by this engagement).

- **639 tests — 628 pass, 5 fail, 1 cancelled, 5 skipped** (full suite ≈19 min).
- Failures and their classification:
  - `real-cli-integration` ×3, `real-e2e-execution` ×1 — require locally installed
    cline/daytona CLIs (prohibited; see 6.15). Will be re-targeted to cloud verification.
  - `foundation-capabilities:239` — hardcoded `opencodeReady === false` assumption
    (see 6.16); the product's answer (`true`) is honest on this host.
  - cancelled: `opencode-e2e` — live free model unresponsive at run time (environmental;
    the real OpenCode integration reached a live model call).
  - `stage8-api` observed timeout under full parallel load; passes alone (14/14) —
    boot-cost load flake (see 6.17).
- Typecheck (`tsc --noEmit`) passes.

---

## 9. Items required from the platform owner

Requested in one consolidated batch (nothing else blocks local work):

1. **GitHub credentials** (fine-grained PAT with contents:write on `blueprint-first`) to
   push the rebuilt code.
2. **Vercel token** to deploy and set production environment secrets.
3. **Neon `DATABASE_URL`** (pooled) plus its sibling connection strings — re-supply needed;
   never committed, only set as Vercel env vars.
4. **Platform Owner bootstrap security answer** — the production value for
   `BF_BOOTSTRAP_SECURITY_ANSWER` (chosen by the owner; not to be written into any file
   in this repository).
5. **AI provider API key** for real model execution (or confirmation that OpenCode's free
   bundled models are sufficient for the acceptance run).

---

## 10. Engagement target scope

Delivered under this reconciliation:

1. All §6 gaps closed or explicitly reported with evidence.
2. Real per-project execution end-to-end (§5) with Daytona/OpenCode/Cline cloud integration,
   Neon persistence, Vercel hosting, owner infrastructure controls.
3. Amendments V.2–V.5, V.7–V.10 fully satisfied and test-covered.
4. Complete from-scratch visual redesign (V.6) after the functional target, including
   splash, ≤3-page introduction, dark/light, responsive layouts, zero dead controls.
5. Full test suite green in the honest environment matrix (local fixtures + cloud
   integration), followed by an end-to-end acceptance run and the final engineering report.
