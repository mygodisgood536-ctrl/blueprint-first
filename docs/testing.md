# Testing

## Runner

Node.js built-in test runner (`node --test`) executing TypeScript directly via
native type-stripping — zero test dependencies, no build step required.

## Commands

```bash
npm test          # full suite (121 tests / 35 suites)
npm run typecheck # strict TypeScript gate over src/ + test/
npm run build     # emits dist/ (compile gate)
npm run demo      # deterministic Level-1a end-to-end demo
```

## What is covered (behavior, not existence)

| Suite | Proves |
|---|---|
| ids | canonical formatting/parsing rejects non-canonical IDs; full lineage chain; phase order rules |
| id-allocator | sequential per-type allocation, seeding from existing IDs, snapshot restart-determinism |
| status | legal/illegal transitions incl. rework cycles; terminal ARCHIVED; no unreachable statuses |
| artifact | identity/type consistency; provenance append-only versioning; self-dependency rejection |
| stores | shared store contract on both adapters: duplicates, optimistic concurrency, clone-on-read, filters; JSON persistence across instances incl. allocator continuity; corrupt-file detection; atomic overwrite cleanliness |
| graph | referential integrity, self-loop bans, dedupe, multi-hop traversal, relation filtering, cycle detection, incoming edges, artifact sync |
| logging | level filtering, secret redaction (nested), child bindings, depth caps |
| config | defaults, routing override parsing, malformed-config failures, credential resolution naming missing vars without leaking values |
| router | rule precedence, default fallback, loud unregistered-route errors, duplicate registration ban, selection recording w/ model ids, mis-stamp detection |
| providers | scripted rules + queue exhaustion refusal; OpenAI-compatible request shaping/auth header/response parsing/error mapping/key-absence fast-fail (offline, injected fetch) |
| verification | eleven-dimension integrity guard; report summarization honesty; independence/self-certification blocks; certification requirements; evidence log ids + reference validation |
| worker-boss | step ordering; same-origin specialist/boss refused BEFORE production; rejection rationale surfacing |
| pipeline | ordered execution, state hand-off, failure stops-or-continues honestly, service sharing |
| trace | lineage link/gap reporting located by ID; orphan detection; coverage summaries with untraced lists |
| discovery | brief validation; structural parse collecting all problems; markdown-fence tolerance; duplicate keys / dangling references rejected; deterministic sorting; engine end-to-end with deterministic IDs, graph edges, evidence anchoring, eleven-dimension report; garbage-response failure cleanliness; determinism across runs |
| design-studio | end-to-end baseline→blueprint with exact -DESIGN lineage IDs and statuses; derivation correctness from certified attributes (layout, interactions+validations, states, security notes, feature→page wiring); evidence-anchored rationales on page designs only; router/provenance records; report honesty (inconclusive dimensions); determinism; refusal on non-VERIFIED baselines; approval gate happy path + self-approval forbidden regardless of declared kind + non-VERIFIED designs rejected + missing-coverage rejection without promotion + explicit CHANGES_REQUESTED rejections; mechanical COUNT/COVERAGE/IDENTITY/EVIDENCE_OF_WORK checks incl. fail paths |
| build-studio | end-to-end approved-blueprint→implementations with exact -IMPL lineage IDs, COMPONENT manifest aggregation, persisted unit plan (page/feature components; api/entity/integration units); evidence-backed AI notes on page impls only; report honesty; determinism; gate refusals (not APPROVED, unknown blueprint, demoted design) producing nothing; mechanical COUNT/COVERAGE/IDENTITY/EVIDENCE_OF_WORK checks incl. fail paths |
| engines | every Level-1a engine contract reports implemented status with name/target level |

## Testing principles

- Tests assert behavior and failure modes, never mere symbol existence.
- No network access anywhere in the suite (fetch is injectable).
- No wall-clock dependencies beyond ISO-string round-tripping.
- Shared-state leaks between tests are treated as defects (one was found and
  fixed during this batch — see docs/status.md).

## Current limitations (honest)

- The OpenAI-compatible client has no live-API integration test yet.
- Evidence log persistence is memory-only (port exists; durable adapter later).
- Performance/load testing not yet meaningful at this stage.
