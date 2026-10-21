/**
 * Generic durable store for application-layer state.
 *
 * Accounts, sessions, projects, documents, evidence, jobs, events, environments,
 * capabilities, the judgment ledger, the supervision trace and per-project stage
 * state all occupy one slot of this store. The constructor signature is
 * unchanged — callers still pass a file path — but the bytes now land in the
 * backend selected for the process (Decision D2):
 *
 *   - `json-file`    local disk, development and the test suite
 *   - `postgresql`   Neon, production (a `DATABASE_URL` is present)
 *
 * The file path is therefore a *slot name*, not a write location, and the schema
 * version is still enforced on read so an incompatible store fails closed
 * instead of being silently misread.
 *
 * The implementation lives in `src/storage/snapshot-store.ts`, beside the
 * backends it talks to; this module re-exports it so existing call sites keep
 * their import path.
 */

export { JsonFileStore, slotNameFrom } from '../storage/snapshot-store.ts';
