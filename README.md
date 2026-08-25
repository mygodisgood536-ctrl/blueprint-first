# Blueprint-First Platform

A foundational implementation of the **Blueprint-First AI Software Engineering
Architecture 2.0** ("nothing advances without evidence"), built incrementally
along the architecture's additive roadmap.

**Current state: roadmap Levels 1a + 1b + 2 are implemented and tested — the
platform now runs brief → Discovery Department → Design → Approval → Build →
Council → Master Verification → Blueprint Completeness Certification with
per-dimension Confidence, product-grade Traceability, and a governed
Definition-of-Complete machine over every artifact. No engine pretends to
exist before it exists.** See [`docs/status.md`](docs/status.md) for the exact,
evidence-backed completion record and
[`docs/roadmap.md`](docs/roadmap.md) for what comes next.

## What is actually implemented today

| Subsystem | State | Where |
|---|---|---|
| Stable artifact IDs (`PAGE-0042`, phase lineage `…-DESIGN/-IMPL/-TEST/-DEPLOY/-OPS`) | implemented + tested | `src/core/ids.ts` |
| Deterministic ID allocation (never reuses numbers, restart-safe) | implemented + tested | `src/core/id-allocator.ts` |
| Artifact metadata model with append-only provenance (who/what model produced it) | implemented + tested | `src/core/artifact.ts` |
| Artifact lifecycle state machine (enforced transitions, terminal states) | implemented + tested | `src/core/status.ts` |
| Persistence abstraction (`ArtifactStore` port) + memory & atomic JSON-file adapters | implemented + tested | `src/core/store*.ts` |
| Application Knowledge Graph foundation (typed relations, integrity, traversal, cycle detection) | implemented + tested | `src/core/graph.ts` |
| AI provider seam + deterministic ScriptedProvider + OpenAI-compatible HTTP client (env-var keys only) | implemented; HTTP client unverified against live API | `src/ai/*` |
| AI Router (task-type routing, records which model produced/verified what) | implemented + tested | `src/ai/router.ts` |
| Eleven verification dimensions + evidence log + verifier port + independence guards (no self-certification) | implemented + tested | `src/verification/*` |
| Worker → Self → Specialist → Boss flow (fail-fast independence enforcement) | implemented + tested | `src/orchestration/worker-boss.ts` |
| Staged pipeline runner with honest failure reporting | implemented + tested | `src/orchestration/pipeline.ts` |
| Traceability queries (lineage gaps located by ID, coverage summary) | implemented + tested | `src/traceability/trace.ts` |
| Discovery Department (Level 1b) | **implemented + tested** — Worker Corps Clusters A+B with self-verification, one independent specialist per cluster, lightweight boss reconstructing pages/features/workflows from the brief only, artifact-level FINDING deltas, confidence scoring | `src/discovery/department/*`, `src/engines/discovery-department.ts` |
| Multi-Perspective Reasoning Council (Level 2) | **implemented + tested** — five independent persona seats through separate router calls, sha256-anchored per-seat evidence, deterministic reconcile-not-average verdicts | `src/council/council.ts` |
| Master / Live Verification Engines (Level 2) | **implemented + tested** — set-wide independent audit over the existing verifier port with per-dimension rollup, class-coverage audit, council-resolved judgment dimensions; Live re-engagement with REGRESSED/RESOLVED/DEGRADED drift detection | `src/verification/master-engine.ts`, `live-engine.ts`, `class-coverage.ts`, `closure-verifier.ts` |
| Requirements Traceability Engine (Level 2) | **implemented + tested** — product-grade matrix over FEATURE/PAGE lineage: missing links by ID, orphaned phase artifacts, unsupported transitions, evidence-counted rows | `src/traceability/trace.ts` |
| Blueprint Completeness Certification + Confidence (Level 2) | **implemented + tested** — formal mechanical event (approval re-derived, master passed, council endorsed, trace complete, closure ≥ BOSS-VERIFIED) stamping CERTIFIED DoC gates; explainable per-dimension confidence with unproduced dimensions reported null | `src/design/certification.ts` |
| Definition-of-Complete state machine (§0.17, Level 2) | **implemented + tested** — 13-state linear gated machine with governor entitlement checks, provenance-recorded gates, inference from Levels 1a/1b history, downgrade-aware derivation | `src/core/doc.ts` |
| Single-pass Product Discovery Engine | **implemented + tested** — brief validation, AI-routed single pass, structural parse + semantic normalization, deterministic materialization, independent verification, boss decision | `src/discovery/*`, `src/engines/product-discovery-engine.ts` |
| AI Design Studio → approvable blueprint | **implemented + tested** — deterministic derivation from VERIFIED baselines, evidence-anchored AI rationales, BLUEPRINT aggregation, eleven-dimension verification, real approval gate | `src/design/*`, `src/engines/ai-design-studio.ts` |
| AI Build Studio implements blueprint | **implemented + tested** — APPROVED-blueprint gate, -IMPL lineage artifacts, COMPONENT implementation manifest with persisted unit plan, evidence-backed AI notes, independent verification | `src/build/*`, `src/engines/ai-build-studio.ts` |
| Engine contracts & descriptors | implemented — every engine reports name/target-level/status; scaffolding helper remains for future levels | `src/engines/*` |
| Structured logging with secret redaction; env-driven configuration | implemented + tested | `src/core/logging.ts`, `src/core/config.ts` |

## Quick start

```bash
npm install        # dev tooling only (TypeScript); runtime has zero dependencies
npm test           # 155 behavior tests / 44 suites via Node's built-in runner
npm run typecheck  # strict TypeScript gate
npm run build      # emits dist/
npm run demo       # Level-2 end-to-end demo: discovery dept -> design -> approval
                   # -> build -> council -> master verification -> CERTIFICATION
```

Requires Node.js >= 24 (native TypeScript execution). No API keys are needed;
the demo uses the deterministic ScriptedProvider and says so in its output.

## Project rules baked into the code

- **Production/judgment separation**: workers produce; verifiers judge. The
  flow runner refuses to let one origin certify its own work.
- **Honest incompleteness**: missing lineage links are reported by ID
  (`PAGE-0001-TEST missing`), never papered over.
- **Secrets**: resolved from environment variables at call time only; redacted
  in logs; `.env` is gitignored; see [docs/configuration.md](docs/configuration.md).
- **Isolation**: this repository is self-contained; nothing outside its folder
  is referenced or required at build/test/run time.

## Documentation

- [Architecture](docs/architecture.md) — subsystems, ID spec, state machine, graph semantics
- [Roadmap](docs/roadmap.md) — Levels 1a–5 mapped to modules, current position marked
- [Status record](docs/status.md) — per-stage evidence log (what passed, what didn't)
- [Configuration](docs/configuration.md) · [Testing](docs/testing.md) · [Decisions](docs/decisions.md)
- The source-of-truth specification text lives at
  [`docs/spec/blueprint-first-architecture-2.0.extracted.txt`](docs/spec/blueprint-first-architecture-2.0.extracted.txt)
  (extracted via `tools/extract-spec.ps1`; source SHA256 recorded in status.md).

## Repository layout

```
src/core/          ids, allocator, artifacts, status machine, stores, graph,
                   logging, config, errors
src/ai/            provider port, scripted + OpenAI-compatible providers, router
src/verification/  dimensions, evidence, verifier port, independence guards
src/orchestration/ pipeline runner, worker-boss flow
src/traceability/  lineage status/gaps, traversal, coverage
src/discovery/     single-pass Product Discovery Engine (brief -> verified baseline)
src/discovery/department/  Level-1b Discovery Department (Clusters A+B, specialists,
                   independent-reconstruction boss, confidence scoring)
src/council/       Level-2 Multi-Perspective Reasoning Council
src/design/        AI Design Studio + Level-2 Blueprint Completeness Certification
                   & Confidence
src/build/         AI Build Studio (approved blueprint -> -IMPL artifacts + manifest)
src/engines/       engine contracts + descriptors for the Level-1a/1b engines
src/demo/          deterministic Level-2 end-to-end demo
test/              Node built-in runner suites (155 tests / 44 suites)
tools/             spec extraction utility
docs/              architecture, roadmap, status, decisions, testing, config, spec
```
