# Blueprint-First

**Software is not generated. It is engineered — understood first, architected
second, validated third, and only then built.**

Blueprint-First is an AI software engineering platform. A user states product
intent; an engineering organization discovers the complete system that intent
requires, designs it, builds it, tests it, deploys it, and then operates it for
life — and **nothing advances without evidence**.

The governing principle is stated once and applied everywhere:

> **Workers produce. Verifiers judge. Bosses independently reconstruct. Auditors
> inspect. Certification records the result.** Nothing is complete because a
> count matched, a test passed, or an agent said so.

---

## The lifecycle

```
USER PRODUCT INTENT
   ↓  AI Executive Orchestrator
DISCOVERY          25-pass sequence · 36-role worker corps · Boss reconstruction
   ↓              red team · negative-space · contradiction engine · certification
DESIGN             12-specialist Design Department · Design Boss · Digital Twin
   ↓              blueprint approval
BUILD              9-role Build Department · real code in a real sandbox
   ↓              Build Boss · Build Auditor · Change/Reopening for any gap
TEST               10-role Test Department · coverage derived from certified artifacts
   ↓              Test Boss · Test Auditor re-executes sampled tests
DEPLOY & OPERATE   Deployment Boss · live Operations Department · drift detection
   ↓
PERMANENT ENGINEERING  Guardian · Self-Healing · Living Blueprint · Safe Change
   ↓
CONTINUOUS LEARNING    lessons attributed to the artifact and pass that caused them
```

Every artifact carries a permanent ID and one unbroken lineage:

```
PAGE-0042  →  PAGE-0042-DESIGN  →  PAGE-0042-IMPL  →  PAGE-0042-TEST  →  PAGE-0042-DEPLOY  →  PAGE-0042-OPS
```

A gap is never reported as "something is incomplete". It is reported as the
**specific broken edge, by ID**, at the stage where it broke.

---

## Execution is real

| Concern | Reality, not a placeholder |
|---|---|
| Project execution environment | Real [Daytona](https://www.daytona.io) sandboxes over the Daytona API |
| Worker/agent execution | Real Cline sessions, bound to a project, worker, job and environment |
| AI execution | Real OpenCode-integrated provider/model calls |
| Durable state | Real PostgreSQL (Neon) behind a storage port |
| Supervision | Independent three-minute no-progress timeout, hang detection, checkpoints, reconciliation |
| Evidence | Append-only, inspectable, attributed to the execution that produced it |

A platform that cannot demonstrate these from runtime evidence is not complete,
and it says so rather than claiming otherwise.

---

## One provider and model per project

Each project has exactly **one authoritative provider and model**. Every Worker
job and agent session inherits it, and every AI request records the identity
actually used. A silent model switch is prohibited: if the selected model lacks a
capability, is rate-limited or is failing, the platform surfaces that condition
and handles it through retry, waiting, recovery or an explicit user decision.

---

## Architecture and this repository

The complete approved architecture is `docs/ARCHITECTURE_3.3_VISION.txt` (an
extraction of
`BLUEPRINT-FIRST_AI_SOFTWARE_ENGINEERING_ARCHITECTURE_3.3_FINAL_APPROVED_PRODUCT_AMENDMENTS`).
It is the authority for every design decision; where this implementation and the
vision disagree, the vision wins and the code is corrected.

`docs/RECONCILIATION-3.3.md` records the vision-versus-implementation audit and
the decisions taken under it. `docs/configuration.md` is the deployment and
environment contract.

### Source layout

| Path | Contents |
|---|---|
| `src/core` | Artifact model, knowledge graph, ID system, state machine, store ports, durable files |
| `src/storage` | Storage backends: PostgreSQL/Neon (production) and filesystem (development, tests) |
| `src/discovery` | The Discovery Department: 25-pass sequence, 36-role corpus, Boss, red team, negative space |
| `src/design` | AI Design Studio, coverage, certification, blueprint approval |
| `src/build` | AI Build Studio, implementation materialization, build verification |
| `src/testing`, `src/operations` | Acceptance Testing and Operations departments |
| `src/perm`, `src/continuous`, `src/change`, `src/recursion` | Permanent Engineering Organization |
| `src/verification`, `src/council` | Eleven-dimension verification, live/master engines, reasoning council |
| `src/ai` | AI Router, provider manager, credentials, OpenCode integration, model catalogue |
| `src/env` | Environment manager, Daytona adapters (API + CLI), local workspace, capability discovery |
| `src/jobs`, `src/supervisor`, `src/events` | Job engine, Execution Supervisor, durable event bus |
| `src/project` | Project registry, per-project execution, stage state |
| `src/web` | HTTP API, identity, sessions, accounts, documents, startup gate, watchdog |
| `api/index.ts` | Vercel serverless entry point |
| `design-prototype` | The frontend application |
| `test` | The test suite |

---

## Commands

```bash
npm install
npm run dev          # control plane on http://127.0.0.1:3000
npm test             # full test suite
npm run typecheck    # tsc --noEmit
npm run build        # compile the backend
npm run build:frontend
```

---

## Licence

Private. All rights reserved.