# Implementation Roadmap

The architecture defines an additive roadmap (spec Part III). This project
follows it strictly: each level builds on verified foundations, nothing is
thrown away, and no level claims completeness it does not have.

## Current position

```
LEVEL 1a  Blueprint-First MVP ...................... COMPLETE (verified)
├── FOUNDATIONS .................................... IMPLEMENTED + TESTED
├── Single-pass Product Discovery Engine ........... IMPLEMENTED + TESTED
├── AI Design Studio producing approvable blueprint  IMPLEMENTED + TESTED
│                                                    (incl. real approval gate)
└── AI Build Studio implementing the blueprint ...... IMPLEMENTED + TESTED

LEVEL 1b  Minimum Viable Discovery Department ...... COMPLETE (verified)
├── Worker Corps Clusters A+B (Understanding+Structural)  IMPLEMENTED + TESTED
├── Self-verification + one Specialist per cluster .. IMPLEMENTED + TESTED
├── Lightweight Boss: independent reconstruction of   IMPLEMENTED + TESTED
│   pages/features/workflows into FINDING deltas
└── Artifact metadata confidence scoring ............ IMPLEMENTED + TESTED

LEVEL 2   Verified Engineering Organization ......... NEXT
LEVEL 3   Full Discovery + Simulation + Testing ..... PLANNED
LEVEL 4   Operations & Observability ................ PLANNED
LEVEL 5   Permanent Self-Healing Engineering Org .... PLANNED
```

## Level-by-level mapping to modules

### Level 1a — Blueprint-First MVP
| Item | Module | State |
|---|---|---|
| Artifact ID system + lineage | `src/core/ids.ts` | implemented, tested |
| Deterministic allocation | `src/core/id-allocator.ts` | implemented, tested |
| Metadata/provenance model | `src/core/artifact.ts` | implemented, tested |
| Lifecycle state machine | `src/core/status.ts` | implemented, tested |
| Persistence abstraction + adapters | `src/core/store*.ts` | implemented, tested |
| Knowledge Graph foundation | `src/core/graph.ts` | implemented, tested |
| AI provider abstraction + router | `src/ai/*` | implemented; HTTP client offline-tested only |
| Evidence/verification foundation | `src/verification/*` | implemented, tested |
| Orchestration foundation | `src/orchestration/*` | implemented, tested |
| Traceability foundation | `src/traceability/trace.ts` | implemented, tested |
| Single-pass Product Discovery Engine | `src/discovery/*` + `src/engines/product-discovery-engine.ts` | implemented, tested |
| AI Design Studio → approvable blueprint | `src/design/*` + `src/engines/ai-design-studio.ts` | implemented, tested (incl. approval gate) |
| AI Build Studio implements blueprint | `src/build/*` + `src/engines/ai-build-studio.ts` | implemented, tested |

### Level 1b — Minimum Viable Discovery Department (COMPLETE)
Worker Corps restricted to Clusters A (Understanding) and B (Structural),
§0.14 self-verification surfacing uncertainties as evidence, one independent
Specialist Verifier per cluster running mechanical eleven-dimension checks,
a lightweight Discovery Boss performing §0.15 independent reconstruction of
the core artifact types (pages, features, workflows) from the raw brief plus
platform knowledge only — diffed at artifact level into addressable `FINDING-n`
artifacts — and artifact-metadata confidence scoring (§0.13) with
`discovered_by` pass labels across the full inventory including trivial leaves.
Builds directly on: worker-boss independence guards, evidence log, verifier
port, allocator, and the entire Level-1a parse/normalize pipeline (reused via
cluster combination — zero duplicated validators).

### Level 2 — Verified Engineering Organization (planned)
Multi-Perspective Reasoning Council; Live + Master Verification Engines;
Requirements Traceability Engine and Design-to-Code Traceability made
product-grade on top of `trace.ts`; Blueprint Completeness Certification +
Blueprint Confidence extending `certificationDecision()`; full eleven-dimension
verification coverage per artifact class; Definition-of-Complete state machine
extending `status.ts`.

### Level 3 — Full Discovery + Simulation + Testing (planned)
Remaining discovery clusters; Behavioral/Non-Functional discovery; Recursive
Page Expansion; Edge-Case Discovery; Industry Comparison Engine; Discovery Red
Team; Negative-Space Discovery; Contradiction Engine; Digital Twin; AI
Acceptance Testing.

### Level 4 — Operations & Observability (planned)
Deployment artifacts (`*-DEPLOY`, `*-OPS` lineage), Live Verification Engine
against running systems, drift detection against the Living Blueprint.

### Level 5 — Permanent Self-Healing Engineering Organization (planned)
Continuous Engineering department, AI Engineering Guardian, AI Self-Healing
Engineering System, Living Blueprint maintenance, Continuous Product Evolution,
Engineering Memory, Safe Change Intelligence, Continuous Learning Engine.

## Non-negotiables carried through every level

1. Artifact IDs stay permanent; lineage only extends.
2. No actor certifies its own work.
3. Completion requires evidence across the eleven dimensions.
4. Gaps are reported by exact artifact ID, never aggregated away.
5. New providers/workers/verifiers plug into existing ports; no rewrites.
