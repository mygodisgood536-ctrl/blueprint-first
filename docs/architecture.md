# Architecture (as implemented at this stage)

This document describes what the codebase actually contains today, mapped to
the Blueprint-First AI Software Engineering Architecture 2.0 specification
(text in `docs/spec/`). Where a spec mechanism is only partially present, that
is stated explicitly.

## 1. Artifact identity (`src/core/ids.ts`)

Implements the spec's stable ID scheme (§0.12) and extended ID chain (§T.1):

```
TYPE-NNNN                    canonical base ID      e.g. PAGE-0042
TYPE-NNNN-PHASE              phase-extended IDs     e.g. PAGE-0042-DESIGN

PAGE-0042 -> PAGE-0042-DESIGN -> PAGE-0042-IMPL
          -> PAGE-0042-TEST   -> PAGE-0042-DEPLOY -> PAGE-0042-OPS
```

- Types are a closed set (`PROJECT`, `MODULE`, `FEATURE`, `WORKFLOW`, `PAGE`,
  `SECTION`, `CONTENT`, `ACTION`, `STATE`, `VALIDATION`, `RULE`, `PERMISSION`,
  `API`, `ENTITY`, `INTEGRATION`, `COMPONENT`, `TEST`, `BLUEPRINT`, `FINDING`,
  `RISK`).
- Canonical form is enforced: zero-padded four-digit numbers (growing beyond
  9999), phases in canonical order without repeats; parsing rejects anything
  not byte-identical to canonical.
- IDs are permanent once assigned; deprecation happens in metadata/status,
  never by reassignment.
- Pure module: no clock, no I/O — identical inputs always yield identical IDs.

Allocation (`id-allocator.ts`) is sequential per type, monotonic, never reuses
a number, seeds from existing IDs or persisted snapshots (restart-deterministic).

## 2. Artifact metadata & provenance (`src/core/artifact.ts`)

Covers the §0.13 metadata fields as follows:

| Spec field | Implementation today |
|---|---|
| purpose | `title` + `description` |
| dependencies | `dependencies: readonly string[]` (validated artifact IDs) |
| parent/children | Knowledge Graph `CONTAINS` edges (graph-owned, not duplicated on the artifact) |
| evidence | append-only Evidence Log (`verification/evidence.ts`) referenced from provenance/graph edges |
| discovered-by / verified-by | `Actor` records (`kind`, `id`, AI `modelId`) in provenance entries |
| status | enforced lifecycle state machine (`status.ts`) |
| change history | append-only `provenance[]` on every artifact |
| **confidence** | **not yet implemented** — planned with Level 1b discovery scoring |

Artifacts are frozen objects; updates go through store `update()` with
optimistic concurrency (expectedVersion) — the *store* owns versioning.

## 3. Lifecycle state machine (`src/core/status.ts`)

Ten statuses with an explicit transition table:

```
DRAFT → IN_REVIEW → VERIFIED → APPROVED → ARCHIVED/SUPERSEDED/DEPRECATED
IN_REVIEW → CHANGES_REQUESTED → IN_REVIEW | DRAFT
IN_REVIEW → REJECTED → DRAFT        any(pre-terminal) → BLOCKED → recover
```

Illegal transitions throw typed errors listing legal alternatives. ARCHIVED is
terminal. This is the foundation for the spec's Definition-of-Complete state
machine (§0.17); the full DoC machine is Level 2 work.

## 4. Persistence (`src/core/store.ts`, `memory-store.ts`, `json-file-store.ts`)

A single async port (`ArtifactStore`) with two adapters:

- **Memory** — tests/ephemeral runs.
- **JSON file** — durable snapshot file, schema-versioned, written atomically
  (temp file + rename, Windows-safe fallback) on every mutation; persists
  allocator state so IDs continue correctly across restarts.

Both enforce: duplicate-ID rejection, version-conflict rejection, clone-on-read
(no aliasing corruption), deterministic ID-ordered listings. A database-backed
adapter can be added later behind the same port without upstream changes.

## 5. Application Knowledge Graph (`src/core/graph.ts`)

Nodes = artifact IDs; edges = eight typed relations (`CONTAINS`, `DEPENDS_ON`,
`DERIVED_FROM`, `TRACES_TO`, `VERIFIED_BY`, `PRODUCED_BY`, `CONFLICTS_WITH`,
`RELATES_TO`). Enforces referential integrity, forbids self-dependency and
self-derivation, deduplicates triples, provides deterministic traversal
(upstream/downstream, relation-filtered, transitive) and DEPENDS_ON cycle
detection. Storage-free by design; a DB-backed graph adapter will implement
the same query surface.

## 6. Verification (`src/verification/*`)

- The eleven dimensions (§0.16) as a closed tuple with a runtime integrity
  guard: COUNT, COVERAGE, IDENTITY, CORRECTNESS, QUALITY, TRACEABILITY,
  DEPENDENCY_INTEGRITY, DUPLICATION, CONFLICTS, CONSISTENCY, EVIDENCE_OF_WORK.
- Append-only evidence log with monotonic `EV-NNNNNN` IDs; artifact references
  validated against canonical IDs.
- Verifier port producing per-dimension findings; aggregation reports verdict
  counts, missing dimensions, blocking failures.
- **Independence guards**: same-origin verification is refused *before any work
  runs*; certification requires an independent verifier of kind
  verifier/system, all-eleven coverage, and zero failures. Self-checks by the
  producer are allowed but structurally non-certifying.

## 7. Orchestration (`src/orchestration/*`)

- Pipeline runner: ordered stages over shared services/state, per-stage timing
  records, failures captured and reflected in the summary (never swallowed).
- Worker-Boss flow implementing WORKER → SELF-VERIFICATION (non-certifying) →
  SPECIALIST VERIFIER → BOSS, failing fast when specialist/boss share the
  worker's origin. Independent audit + certification stages are Level-2
  extensions of this same flow.

## 8. AI provider seam & router (`src/ai/*`)

- `AiProvider` port; responses always carry `providerId` + `modelId` so calls
  can stamp provenance ("which model produced/verified this").
- **ScriptedProvider**: deterministic rules/queue; test/demo infrastructure,
  clearly labeled wherever used.
- **OpenAiCompatibleProvider**: real HTTP chat-completions client with injected
  fetch (offline-testable), timeout, typed HTTP errors, env-var-only keys.
  Status: implemented and unit-tested offline; **not yet exercised against a
  live endpoint** (needs real credentials).
- **AiRouter**: task-type routing table with default fallback, loud errors for
  unregistered routes, completed-selection log recording task/provider/model.

## 9. Traceability (`src/traceability/trace.ts`)

- Lineage status per base artifact: which links exist and their statuses,
  where the contiguous chain stops, gaps located **by exact ID** (spec §T.3),
  including orphan detection (`-IMPL` existing while `-DESIGN` is missing).
- Upstream/downstream traversal and requirement-coverage summaries with
  untraced lists.

## 10. Cross-cutting

- Logging (`core/logging.ts`): JSON entries, levels, child bindings, deep
  secret redaction (api-key/authorization/token/secret/password patterns).
- Configuration (`core/config.ts`): env-driven, fail-fast validation,
  credentials resolved at call time — variable names in errors, never values.
- Errors (`core/errors.ts`): typed hierarchy with stable machine codes.

## 11. Level-1a engines (Discovery, Design, Build)

Three engines implement the Level-1a product chain on the shared
`CoreServices` bundle (one allocator/store/graph/evidence log/router per run,
so IDs stay continuous and provenance uniform across stages):

- **Single-pass Product Discovery Engine** (`src/discovery/*`): brief
  validation → AI call via router (DISCOVERY) → JSON extraction → structural
  parsing (collects all problems before failing) → semantic normalization
  (duplicate keys / dangling references rejected) → deterministic
  materialization of 14 artifact types with provenance + graph edges →
  sha256-anchored evidence → independent specialist verification across all
  eleven dimensions → boss accept/reject → status promotion. Rejected baselines
  stay in the store marked CHANGES_REQUESTED.
- **AI Design Studio** (`src/design/*`): refuses anything but a fully VERIFIED
  baseline; derives page/feature design docs deterministically from stored
  discovery attributes (layout hints from section content types; interactions
  joined with their validations; state handling; security notes incl. a derived
  destructive-action guard; feature→page wiring by module membership);
  enriches each page design with an AI rationale via the router (DESIGN task)
  recorded as evidence only; materializes `PAGE-n-DESIGN` / `FEATURE-n-DESIGN`
  plus a `BLUEPRINT-n` aggregation (DERIVED_FROM + CONTAINS edges); independent
  specialist verification; boss decision. The **approval gate**
  (`src/design/approval.ts`, D-010) re-derives approval from stored state —
  statuses, DERIVED_FROM tracing, two-directional coverage against the
  certified baseline, approver-origin independence — and records review
  evidence on APPROVED.
- **AI Build Studio** (`src/build/*`): refuses anything but an APPROVED
  blueprint whose listed designs are VERIFIED and trace to VERIFIED discovery
  origins; derives implementation docs from approved design docs plus api/
  entity/integration units from the certified inventory (the unit plan is
  persisted on the manifest); adds AI implementation notes per page via the
  router (BUILD task) as evidence only; materializes `PAGE-n-IMPL` /
  `FEATURE-n-IMPL` (DERIVED_FROM to their -DESIGN) aggregated by one COMPONENT
  implementation manifest (D-011); independent specialist verification; boss
  decision.

All three share the same verification shape: mechanical dimensions run real
checks against store/graph; CORRECTNESS/QUALITY/CONFLICTS are honestly
inconclusive at this level; no origin ever certifies its own work.

## 12. Discovery Department (Level 1b)

The single-pass engine remains valid; Level 1b adds the spec's organization
around it (`src/discovery/department/`):

- **Cluster A — Understanding Worker (DW-A1)**: one AI call from the brief
  alone producing the product statement + optional domain profile. The parser
  structurally forbids structural inventories here — understanding and
  enumeration are different jobs.
- **Cluster B — Structural Worker**: one AI call taking the brief PLUS
  Cluster A's specialist-cleared understanding (a certified upstream baseline,
  legitimate authoritative input under §0.15's general principle) and emitting
  every enumerated collection. Validation reuses the ENTIRE Level-1a
  parse+normalize pipeline via combination — zero duplicated validators.
- **Self-verification (§0.14)**: each worker response carries a selfCheck
  block; surfaced uncertainties are recorded as inspection evidence and in the
  run result — never silently dropped.
- **Specialist Verifiers** (understanding-specialist-01 / structural-specialist-
  01): mechanical eleven-dimension checks over their cluster draft — identity
  fidelity to the brief, vision-token traceability, actionability floor,
  orphan-module coverage, empty-workflow consistency, sha256 evidence anchors.
  CORRECTNESS/QUALITY/CONFLICTS stay honestly inconclusive.
- **Discovery Boss**: reconstructs its expectation of pages/features/workflows
  from the raw brief plus the platform's foundational-knowledge preamble ONLY
  (structurally guaranteed: the reconstruction call receives nothing else),
  then diffs at artifact level. Every delta becomes an addressable `FINDING-n`
  artifact (missing = expected-but-absent, extra = worker-invented); matching
  tolerates key/title/token correlation deterministically. Zero deltas accepts;
  anything else rejects with the inventory retained CHANGES_REQUESTED and the
  findings persisting for the correction cycle. Boss-vs-brief name mismatch
  fails closed.
- **Promotion + metadata**: after the gate, confidence scores (§0.13) are
  computed by a deterministic completeness/corroboration formula — leaves
  inherit their parent page's score — and stamped together with `discovered_by`
  pass labels across the FULL inventory, now including states/validations that
  previously stayed DRAFT.

## Deliberately NOT here yet

Multi-worker Discovery Worker Corps beyond Clusters A+B (Behavioral, Non-
Functional, Red Team clusters), the Discovery Auditor, Domain/Category/Genome
understanding workers beyond the Level-1b DW-A1 stand-in, Multi-Perspective
Reasoning Council, Live/Master Verification Engines,
Digital Twin, Living Blueprint, Operations, self-healing, Engineering Memory,
Safe Change Intelligence, Continuous Learning Engine, Blueprint Completeness
Certification/Confidence engines — see `docs/roadmap.md`. Their seams exist:
the department's cluster/boss structure extends role-by-role, later-level
orgs reuse the same ports/flows under test, and the certification gate
already refuses honestly.


