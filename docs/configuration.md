# Configuration & Security

## Environment variables

Copy `.env.example` to `.env` (gitignored) and set values there or in your
shell. All variables are optional; secure/deterministic defaults apply.

| Variable | Default | Purpose |
|---|---|---|
| `BF_ENV` | `development` | Environment name surfaced in logs. |
| `BF_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. Invalid values fail fast. |
| `BF_DATA_DIR` | `./data` | Where the JSON artifact store writes. Gitignored. |
| `BF_AI_DEFAULT_PROVIDER` | `scripted` | Provider used when no task rule matches. |
| `BF_AI_ROUTING` | *(empty)* | Per-task overrides: `TASK=PROVIDER,...` e.g. `DISCOVERY=openai-compatible,DESIGN=scripted`. Unknown tasks fail fast. |
| `OPENAI_COMPATIBLE_BASE_URL` | — | Base URL of an OpenAI-compatible endpoint. |
| `OPENAI_COMPATIBLE_MODEL` | — | Model id requested from that endpoint. |
| `OPENAI_COMPATIBLE_API_KEY` | — | Secret key. **Resolved from the environment at call time only.** |

## Security rules enforced by code and tests

1. **No secrets in source.** The repo contains no credentials; `.env*` is
   gitignored except `.env.example` (placeholders only).
2. **No secrets in logs.** `core/logging.ts` redacts any field whose key
   matches /api-key|authorization|secret|password|token|credential/i before it
   reaches a sink (tested).
3. **No secrets in errors.** Credential resolution names the *missing variable*
   and never includes provided values; HTTP error bodies are truncated and
   tested to exclude the key.
4. **Fail fast, fail loud.** Missing/malformed configuration throws typed
   errors at load/request time instead of degrading silently.
5. **No fabricated AI output.** Without configured providers the platform uses
   the deterministic ScriptedProvider and labels it as scripted everywhere;
   the scripted provider refuses requests once its script is exhausted.
6. **No arbitrary generated code executes.** Nothing in this repository
   evaluates AI output as code; generated content is stored as data/evidence.
7. **Unvalidated AI responses cannot enter the graph silently** — provider
   mis-stamping is detected (`RoutingError`) and all graph mutations require
   registered endpoints with integrity checks.

## Running with a real model

```bash
set OPENAI_COMPATIBLE_BASE_URL=https://your-endpoint/v1
set OPENAI_COMPATIBLE_MODEL=your-model
set OPENAI_COMPATIBLE_API_KEY=...        # never committed, never logged
set BF_AI_DEFAULT_PROVIDER=openai-compatible
```

Status: the HTTP client is unit-tested against an injected fetch double only;
a live end-to-end call has NOT been performed yet (no credentials available at
implementation time). Treat it as unverified until exercised for real.
