# Deployment & Configuration

Blueprint-First runs as a **managed control plane on Vercel** with **Neon
PostgreSQL** for durable state and **Daytona** as the real project execution
environment. The operator's personal computer is never required to be powered on
for the production platform to work (V.8).

---

## 1. What is deployed where

| Concern | Where | Why |
|---|---|---|
| Frontend (SPA), API, authentication, orchestration, durable workflows, events | Vercel (this repository) | Managed control plane, auto-deploys on push |
| Durable state (projects, artifacts, evidence, jobs, events, environments, accounts, documents, judgment ledger, supervision trace) | Neon PostgreSQL | Durable, transactional, survives any single instance being reclaimed |
| Project execution environments (real sandboxes, real commands, real git) | Daytona | The real project execution environment; required by the architecture |
| Cline (Worker/agent execution boundary) | Inside the Daytona sandbox | It must operate on the project's own workspace, not the control plane |
| OpenCode (AI execution/provider integration) | Control plane, calling real providers | Real AI execution; the project's single verified provider/model |

---

## 2. Required environment variables

Set these in the Vercel project (**Settings → Environment Variables**). None of
them ever enters the repository, the frontend bundle, a log line, an evidence
record or a response body.

### Required in production

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled PostgreSQL connection string. Selects the PostgreSQL storage backend and applies migrations at boot. |
| `BF_BOOTSTRAP_SECURITY_ANSWER` | The Platform Owner's security answer. Read once at boot to provision the reserved owner account; never persisted in plaintext. |
| `BF_DAYTONA_API_KEY` | Daytona API key. Verified against Daytona's real API at boot; only a credential Daytona actually accepts activates the Daytona backend. |
| `CRON_SECRET` | Authorizes the scheduled supervision watchdog. Vercel sends it as `Authorization: Bearer $CRON_SECRET`. |

### Strongly recommended

| Variable | Purpose |
|---|---|
| `BF_WATCHDOG_SECRET` | Alternative watchdog secret when the scheduler is not Vercel's cron. |
| `DAYTONA_API_URL` | Daytona API base URL. Defaults to `https://app.daytona.io`. Only needed for self-hosted Daytona. |
| `BF_ENV` | `production` in production. Appears in `GET /api/health`. |

### Optional

| Variable | Purpose |
|---|---|
| `BF_REQUIRE_DATABASE` | Set to `1` to make a missing database connection string a hard boot failure instead of a filesystem fallback. |
| `BF_SUPERVISOR_MODE` | Set to `serverless` to disable the in-process supervisor interval loops (Vercel sets this automatically for the function). |
| `BF_LOG_LEVEL` | `info` (default), `debug`, `warn`, `error`. |
| `BF_DATA_DIR` | Filesystem data root for development. Ignored for durable state in production (PostgreSQL is authoritative). |

### Never required, never installed on the operator's machine

PostgreSQL, Docker, the Daytona CLI, the Cline CLI and the OpenCode CLI are **not**
installed locally to make the product work. Their absence is reported honestly by
the foundation gate rather than papered over.

---

## 3. Platform Owner account (V.4)

The owner account is provisioned **server-side** during boot and cannot be claimed
through public signup:

| Field | Value |
|---|---|
| Full Name | Cornelius Adedeji Victor |
| Username | `Oluwasegun` |
| Gmail | `corneliusadedejivictor@gmail.com` |
| Security Question | *What city did my parents meet?* |
| Security Answer | `BF_BOOTSTRAP_SECURITY_ANSWER` (secret; never stored in this repository) |

The owner uses the **same public login screen and the same login path** as every
other account (V.3). There is no separate owner or user entry point.

Owner-only controls live behind `server-side` authorization at `/api/owner/*`:

| Route | Purpose |
|---|---|
| `GET /api/owner/daytona` | Non-secret Daytona connection state |
| `PUT /api/owner/daytona` | Configure and **really verify** a Daytona credential, then activate the Daytona execution backend |
| `DELETE /api/owner/daytona` | Clear the configuration and revert to the local-workspace backend |

An ordinary user receives `403` for every one of these — the control is not merely
hidden in the UI.

---

## 4. Storage backends (D2)

`src/storage` defines one narrow port with two **real** implementations:

| Backend | Selected when | Used by |
|---|---|---|
| `postgresql` | `DATABASE_URL` (or `POSTGRES_URL` / `NEON_DATABASE_URL`) is set | Production |
| `json-file` | No connection string | Local development and the automated test suite |

Every durable store (accounts, sessions, projects, documents, evidence, jobs,
events, environments, capabilities, judgment ledger, supervision trace, stage
state) persists through the port, so moving to Neon required **zero** call-site
changes.

Migrations are ordered, additive and idempotent, and run at boot before any
request is served:

| Migration | Contents |
|---|---|
| `0001_state` | `bf_schema_migrations` |
| `0002_durable_snapshots` | `bf_state` (schema-versioned JSONB slots) |
| `0003_artifacts` | `bf_artifacts` (indexed `project_id`, per-row version) |
| `0004_id_counters` | `bf_id_counters` (atomic ID block reservation) |
| `0005_execution_events` | `bf_execution_events` (append-only execution history) |

No migration ever drops or rewrites certified data: certification history is
append-only by architecture (§T.4).

---

## 5. Execution foundation and the Daytona transport

A managed control plane has no `daytona` binary, so Daytona is driven over its
**documented HTTP API**:

```
Platform API   https://app.daytona.io/api        Bearer <key>
  GET    /health
  GET    /users/me
  GET    /sandbox
  POST   /sandbox
  POST   /sandbox/{idOrName}/start
  DELETE /sandbox/{idOrName}

Toolbox API    {sandbox.toolboxProxyUrl}/{sandboxId}
  POST   /process/execute        GET  /files
  GET    /files/download         POST /files/upload-v2
  POST   /files/move             DELETE /files
  GET    /git/status             POST /git/add
  POST   /git/commit
```

The CLI transport remains available on a development host that has Daytona
installed; both are real Daytona, only the transport differs, and the active one
is reported honestly through `GET /api/system/foundation`.

**Cline** executes *inside* the project execution environment, so the control
plane does not need a Cline binary. The control-plane capability probe reports
that honestly and the real Cline check happens per session, bound to a specific
project, worker, job and environment.

---

## 6. Supervision on a serverless control plane (D4)

The Execution Supervisor enforces the architecture's **three-minute
no-meaningful-progress timeout**, hang suspicion, network-loss parking with
automatic resume, environment-wait states, backpressure and durable checkpoints.

On Vercel there is no long-lived daemon, so:

- the in-process interval loops are disabled (`BF_SUPERVISOR_MODE=serverless`);
- `vercel.json` schedules `POST /api/internal/watchdog` every minute;
- that route runs the **same** `tick()` and `watchdogCheck()` scans against the
  durable supervision trace, authorized by `CRON_SECRET`.

The hard timeout is therefore still independently enforced on the control plane;
it simply has a scheduler instead of a resident loop. On the Hobby plan Vercel
allows one cron invocation per day — set the schedule to `*/5 * * * *` or
`0 * * * *` on that plan and expect correspondingly longer detection latency.

---

## 7. Local development

```bash
npm install
npm run dev          # control plane on http://127.0.0.1:3000
npm --prefix design-prototype run dev   # Vite dev server for the SPA (port 5180)
npm test             # full suite
npm run typecheck
```

Without `DATABASE_URL` the platform runs on filesystem snapshots under
`data/` (or `BF_DATA_DIR`). Tests always use a temporary data directory and never
touch a developer's real data.

To develop against Neon, set `DATABASE_URL` in the environment — migrations are
applied automatically at boot.

---

## 8. Deploying

```bash
npm run build:frontend     # build the SPA into src/web/public/nexona
npx vercel --prod          # or let a push to the production branch trigger it
```

After the first deploy, set the environment variables in §2 and redeploy. Then
verify the live deployment:

```bash
curl -s https://<your-domain>/api/health | jq
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/api/projects   # 401 = auth enforced
```

`GET /api/health` must report `"persistence": "postgresql"`. If it reports
`json-file`, `DATABASE_URL` is not reaching the deployment and durable state
would not survive an instance being reclaimed — fix that before accepting the
deployment.