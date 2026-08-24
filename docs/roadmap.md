# Implementation Roadmap

The architecture defines an additive roadmap (spec Part III). This project
follows it strictly: each level builds on verified foundations, nothing is
thrown away, and no level claims completeness it does not have.

## Current position

```
LEVEL 1a  Blueprint-First MVP
├── FOUNDATIONS (this batch) .................. IMPLEMENTED + TESTED (88 tests)
├── Single-pass Product Discovery Engine ...... SCAFFOLDED (contract refuses to run)
├── AI Design Studio producing approvable blueprint ... SCAFFOLDED
└── AI Build Studio implementing the blueprint ........ SCAFFOLDED

LEVEL 1b  Minimum Viable Discovery Department ....... PLANNED (next)
LEVEL 2   Verified Engineering Organization ......... PLANNED
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
| Single-pass Product Discovery Engine | `src/engines/product-discovery-engine.ts` | scaffolded — next stage |
| AI Design Studio → approvable blueprint | `src/engines/ai-design-studio.ts` | scaffolded |
| AI Build Studio implements blueprint | `src/engines/ai-build-studio.ts` | scaffolded |

### Level 1b — Minimum Viable Discovery Department (planned next)
Discovery Worker Corps restricted to Understanding + Structural clusters,
self-verification, specialist verification, lightweight Discovery Boss
(independent reconstruction), core artifact reconstruction, stable artifact
IDs (done), artifact metadata (mostly done — add confidence scoring).
Builds directly on: worker-boss flow, evidence log, verifier port, allocator.

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
