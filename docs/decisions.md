# Architecture & Engineering Decisions

Decision records for choices that shape the foundation. Newest last.

## D-001 — Zero runtime dependencies; Node-native TypeScript
**Context:** Windows dev box, npm registry reachable but terminal tooling
flaky; platform is foundation-layer domain logic + I/O seams.
**Decision:** Runtime has zero npm dependencies. Dev deps: `typescript`,
`@types/node` only. Tests run on Node's built-in runner executing TS directly
(Node >= 24 native type-stripping). Code avoids TS-only runtime constructs
(no enums, namespaces, parameter properties) so stripped execution and `tsc`
emit agree.
**Consequence:** Supply chain ≈ none; tests/builds run offline; some TS sugar
unavailable. Accepted.

## D-002 — `.ts` import extensions + `rewriteRelativeImportExtensions`
Native Node execution requires real on-disk extensions in imports.
tsconfig uses `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
(TS ≥ 5.7) so the same sources both execute natively and compile cleanly to
`dist/` (extensions rewritten `.ts → .js`).
**Consequence:** imports look like `./ids.ts`; verified working under node,
tsc typecheck, and tsc emit.

## D-003 — Ports & adapters everywhere state or judgment flows
`ArtifactStore`, `EvidenceLog`, `AiProvider`, `Verifier` are interfaces with
in-memory/JSON/scripted implementations today. Database-backed stores, extra
providers, and engine implementations plug in later without upstream rewrites.
This is the architecture's extensibility requirement made concrete.

## D-004 — JSON-file store now, database adapter later (not "fake graph")
The Knowledge Graph is a real typed-graph module with integrity rules and
queries; its persistence at this level is a schema-versioned atomic JSON
snapshot. This is a deliberate Level-1a choice with an explicit upgrade path:
the store port and graph query surface stay fixed when a SQL/graph backend
arrives.

## D-005 — ScriptedProvider as the default AI provider
Deterministic, labeled-as-scripted responses keep demos/tests honest and
offline-capable. The router treats it like any provider; nothing consumes AI
content without provenance stamping. Live HTTP client exists but is explicitly
marked unverified against a real endpoint until exercised with credentials.

## D-006 — Independence = origin identity, not role label
Two actors are "the same" iff their ids match — relabeling a worker account as
a "verifier" does not create independence. Enforced before work runs, not
after. Self-verification remains allowed as a non-certifying first pass,
matching the spec's WORKER → SELF → SPECIALIST → BOSS chain.

## D-007 — Stores own versioning; artifacts are immutable snapshots
Mutators receive drafts; the store stamps `version = found + 1` and appends
provenance via pure helpers. Optimistic concurrency (`expectedVersion`)
protects against lost updates across adapters. A defect where this contract
was ambiguous was caught by the shared store-contract test and fixed.

## D-008 — Honest incompleteness as a feature
Lineage gaps are first-class results located by exact ID (spec §T.3);
certification returns explicit refusal reasons; scaffolded engines throw
typed errors naming their roadmap level. The demo prints its own gaps and
non-certifiability rather than a green-washed summary.

## D-009 — Engines derive structure deterministically; AI contributes labeled commentary only
**Context:** Level 1a needed Discovery→Design→Build engines that can never
silently contradict a certified baseline, while still exercising the AI seam.
**Decision:** Each engine derives its output structure deterministically from
stored artifacts (discovery attributes → design docs → implementation docs +
unit plan). AI model responses travel through the router per task type
(DISCOVERY/DESIGN/BUILD) but are recorded as sha256-anchored evidence and,
for DESIGN/BUILD, stored verbatim as clearly-labeled `aiRationale`/`aiNote`
commentary that never feeds structure.
**Consequence:** Same input + same history ⇒ byte-identical artifacts (tested);
live providers can be swapped in behind the router without touching engine
logic; deep semantic quality remains honestly inconclusive until later-level
verification engines exist.

## D-010 — The approval gate is a real gate over stored state
Blueprint approval re-derives its verdict from the store/graph at call time:
blueprint VERIFIED, every listed design VERIFIED, every design tracing via a
DERIVED_FROM edge to a VERIFIED discovery base, coverage matching the certified
baseline exactly in both directions (no missing pages/features, no invented
ones), and approver origin ≠ producing worker (identity rule: same id = same
origin regardless of declared kind). Only then is APPROVED promoted with an
evidence record; otherwise reasons are returned and nothing changes.
**Consequence:** Approval cannot be forged by status tampering upstream without
detection; rejection records follow legal state-machine paths
(VERIFIED → IN_REVIEW → CHANGES_REQUESTED).

## D-011 — Phase artifacts keep their base type; builds aggregate via a COMPONENT manifest
`PAGE-n-DESIGN`/`PAGE-n-IMPL` carry type `PAGE` (phase lives in the ID, not a
new type), keeping the artifact-type set closed. The Build Studio's aggregation
record is one `COMPONENT` implementation-manifest artifact whose dependencies
and CONTAINS edges cover the blueprint and every -IMPL artifact, and whose
attributes persist the deterministic unit plan (page/feature components;
api/entity/integration units from certified inventory).
**Consequence:** No schema churn for lineage phases; a single graph node roots
all build output for traceability queries.

## D-012 — One shared service bundle across all stages
Every engine receives the same `CoreServices` (store, allocator, graph,
evidence log, router, logger). IDs stay continuous across stages (the allocator
never resets mid-chain), provenance is uniform, and traceability queries span
discovery→design→build without stitching.
**Consequence:** Stage isolation bugs (private allocators, divergent graphs)
are structurally impossible; a durable multi-project deployment later swaps
adapters behind the same bundle.

## D-013 — The department wraps the single-pass pipeline; validators are never duplicated
Cluster B's inventory is validated by COMBINING both cluster responses into
the exact Level-1a `RawDiscoveryResult` shape and running the existing
structural parser + semantic normalizer. The Level-1a engine stays unchanged
alongside the department; both produce the same baseline contract.
**Consequence:** Every future referential rule added to normalization applies
to the department automatically; the org chart evolves without forking
validation logic.

## D-014 — Boss independence is structural, not conventional
The Discovery Boss's reconstruction call receives the raw brief plus a fixed
foundational-knowledge preamble and NOTHING else — worker output cannot reach
it because the engine never passes it (§0.15 strengthened). Its diff is
artifact-level: each delta becomes an addressable `FINDING-n` artifact;
matching tolerates key/title/token correlation deterministically so naming
differences do not fabricate deltas, while any true gap or invention rejects.
A boss expectation contradicting the brief itself fails closed.
**Consequence:** Confident-but-wrong work is rejectable by construction;
rejections persist their findings for the correction cycle.

## D-015 — Confidence is mechanical corroboration, never narrative
Spec §0.13 confidence is computed by a deterministic formula over defined
signals (descriptive completeness, downstream references, resolved cross-
refs, specialist pass), clamped below certainty; trivial leaves inherit the
parent score per §0.13's inheritance allowance; every artifact also carries a
`discovered_by` pass label. Certification still refuses on inconclusive
dimensions — confidence informs later-level engines, it is not evidence.
**Consequence:** Scores are reproducible and auditable; live models cannot
inflate them by asserting confidence in prose.
