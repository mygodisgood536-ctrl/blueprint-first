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

LEVEL 2   Verified Engineering Organization ......... COMPLETE (verified)
├── Multi-Perspective Reasoning Council ............. IMPLEMENTED + TESTED
├── Master + Live Verification Engines .............. IMPLEMENTED + TESTED
├── Requirements Traceability Engine (product-grade). IMPLEMENTED + TESTED
├── Blueprint Completeness Certification ............ IMPLEMENTED + TESTED
├── Blueprint Confidence (per-dimension, evidence-    IMPLEMENTED + TESTED
│   backed, distinct from certification)
├── Eleven-dimension coverage per artifact class .... ENFORCED + TESTED
└── Definition-of-Complete state machine (§0.17) .... IMPLEMENTED + TESTED

LEVEL 3   Full Discovery + Simulation + Testing ..... COMPLETE (verified)
LEVEL 4   Operations & Observability ................ COMPLETE (verified)
LEVEL 5   Permanent Self-Healing Engineering Org .... COMPLETE (verified)
```

## Current position (Level 5 — verified)

```
243 / 243 tests passing across 60 test suites
+16 L5-specific tests covering PEO composition, Guardian (KNOWN/RECURRING/NOVEL),
   Impact Analysis determinism, Self-Healing (reproduce/refuse), Evolution Review,
   Learning engine, Change History append-only invariant, Living Blueprint
   snapshot/restore, and L4 integration.

Typecheck:  clean
Build:      clean
Demo:       Stages 1-12 complete (Stage 12 = Permanent Engineering Organization
            composition over the L4 Safe Change + Continuous Engineering chain)

L5 components (src/perm/*):
  - department.ts          : PEO orchestrator (composes L4 engines, never certifies)
  - types.ts               : GuardianWatch, CandidateChange, EvolutionSeed, ...
  - guardian.ts            : classifies runtime signals (KNOWN/RECURRING/NOVEL)
  - impact-analysis.ts     : declared+discovered surprise set, deterministic hash
  - self-healing.ts        : reproduces drift before proposing any fix; refuses
                             to fabricate when reproduction fails
  - evolution.ts           : review-only evolution seeds; never applies
  - learning.ts            : lesson recording with deterministic hashes
  - change-history.ts      : append-only lineage with duplicate-entry rejection
  - living-blueprint.ts    : certified snapshots + restore via currentLivingBlueprint
  - dependency-map.ts      : graph-based downstream surface for impact analysis
  - index.ts               : public surface

Independence preserved:
  - L4 Continuous Engineering Boss + Auditor remain the only certifiers
  - PEO never stamps CERTIFIED; authorized = (change.status !== 'REJECTED')
  - Evolution review never applies; Living Blueprint never mutates upstream state
  - Self-Healing never fabricates a candidate without reproduction
  - Change History rejects duplicate entry IDs
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

### Level 2 — Verified Engineering Organization (COMPLETE)
Multi-Perspective Reasoning Council (five independent seats, reconcile-not-
average); Master Verification Engine as the org-level Independent Audit plus
the Live re-engagement engine with drift detection; Requirements Traceability
Engine product-grade on top of `trace.ts` (missing links, orphans, unsupported
transitions by ID with evidence counts); Blueprint Completeness Certification
as a formal mechanical event stamping CERTIFIED DoC gates; Blueprint Confidence
per §0.23 dimension with evidence-backed scores and null-for-unproduced;
eleven-dimension coverage enforced per artifact class via council-resolvable
judgment dimensions; Definition-of-Complete machine (§0.17) in `core/doc.ts`
with governor entitlement checks and inference from recorded history.

### Level 3 — Full Discovery + Simulation + Testing (COMPLETE)
Remaining discovery clusters; Behavioral/Non-Functional discovery; Recursive
Page Expansion; Edge-Case Discovery; Industry Comparison Engine; Discovery Red
Team; Negative-Space Discovery; Contradiction Engine; Digital Twin; AI
Acceptance Testing.

### Level 4 — Operations & Observability (COMPLETE)
Deployment artifacts (`*-DEPLOY`, `*-OPS` lineage), Live Verification Engine
against running systems, drift detection against the Living Blueprint.

### Level 5 — Permanent Self-Healing Engineering Organization (COMPLETE)
Continuous Engineering department, AI Engineering Guardian, AI Self-Healing
Engineering System, Living Blueprint maintenance, Continuous Product Evolution,
Engineering Memory, Safe Change Intelligence, Continuous Learning Engine.

## Non-negotiables carried through every level

1. Artifact IDs stay permanent; lineage only extends.
2. No actor certifies its own work.
3. Completion requires evidence across the eleven dimensions.
4. Gaps are reported by exact artifact ID, never aggregated away.
5. New providers/workers/verifiers plug into existing ports; no rewrites.
