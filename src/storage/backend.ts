/**
 * Storage backends (Decision D2 — "Neon-backed persistence").
 *
 * The platform must run on a managed control plane (Vercel) with durable
 * PostgreSQL (Neon), while local development and the test suite must stay fast
 * and network-free. Both requirements are met by one narrow port with two real
 * implementations:
 *
 *   - `json-file`      single-node durable snapshots on the local filesystem
 *                      (development and the automated test suite only)
 *   - `postgresql`     Neon/any PostgreSQL, selected whenever `DATABASE_URL`
 *                      (or `POSTGRES_URL` / `NEON_DATABASE_URL`) is present
 *
 * Nothing above this module knows which backend is live. The production boot
 * reports the live backend honestly through `GET /api/health` so a degraded
 * foundation is never represented as a database-backed one.
 *
 * Secret boundary: the connection string is read from the environment only. It
 * is never written to a file, echoed to a client, logged, or placed in evidence.
 */

export type StorageKind = 'json-file' | 'postgresql';

/**
 * A durable, schema-versioned snapshot slot. Every small durable structure in
 * the platform (accounts, projects, evidence, jobs, events, environments,
 * capabilities, judgment ledger, supervision trace, stage state) occupies
 * exactly one slot, keyed by a stable name.
 */
export interface DurableSnapshotBackend {
  readonly kind: StorageKind;
  /**
   * Where this slot is actually persisted, for backends that have a location on
   * disk, or null for a backend that has no file (PostgreSQL).
   *
   * The filesystem backend owns the file naming, so a caller cannot derive the
   * path it passed in: it names a *slot*, not a file. Anything that needs to
   * inspect the durable artefact directly - an operator, a diagnostic, a test -
   * asks the backend rather than assuming.
   */
  location?(key: string): string | null;
  /** Reads the current value, or null when the slot has never been written. */
  read(key: string): Promise<unknown | null>;
  /** Atomically replaces the slot's value. */
  write(key: string, value: unknown): Promise<void>;
  /**
   * Serialized read-modify-write for a single slot.
   *
   * Concurrency safety is a correctness requirement, not an optimization: two
   * concurrent writers must not lose one another's update. The filesystem
   * backend achieves it with a per-path promise chain; the PostgreSQL backend
   * with a transaction-scoped advisory lock on the slot key.
   */
  transact<T>(key: string, mutate: (current: unknown | null) => Promise<{ value: unknown | null; result: T }> | { value: unknown | null; result: T }): Promise<T>;
  /** Releases any pooled resources. Safe to call more than once. */
  close(): Promise<void>;
}

/** Reads the connection string from the environment, honouring Neon aliases. */
export function databaseUrlFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL', 'PGDATABASE_URL']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * The DIRECT (unpooled) connection string to the same database, when the
 * deployment provides one.
 *
 * Neon supplies both: a pooled URL for application traffic and an unpooled URL
 * for schema changes and session-scoped work. Migrations must use the direct
 * connection, because a pooled URL is served by a connection pooler rather
 * than a single PostgreSQL session.
 */
export function unpooledDatabaseUrlFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'PGHOST_UNPOOLED']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Chooses the backend the process must use. Never silently degrades. */
export function selectStorageKind(env: NodeJS.ProcessEnv = process.env): StorageKind {
  return databaseUrlFrom(env) === null ? 'json-file' : 'postgresql';
}