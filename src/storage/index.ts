/**
 * Storage wiring (Decision D2).
 *
 * One process-wide backend, resolved once from the environment, shared by every
 * durable store. Production (any `DATABASE_URL`) is PostgreSQL; development and
 * the automated test suite run on the filesystem. `BF_REQUIRE_DATABASE=1`
 * removes the fallback entirely so a misconfigured production deploy fails at
 * boot instead of quietly writing to an ephemeral disk.
 */

import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Pool } from 'pg';
import {
  databaseUrlFrom,
  selectStorageKind,
  type DurableSnapshotBackend,
  type StorageKind,
} from './backend.ts';
import { jsonFileBackend } from './json-file-backend.ts';
import { postgresBackend } from './postgres-backend.ts';
import { createPostgresPool } from './pool.ts';
import { checkSchema, runMigrations } from './migrations.ts';

export type { DurableSnapshotBackend, StorageKind } from './backend.ts';
export { databaseUrlFrom, selectStorageKind } from './backend.ts';
export { STATE_TABLE } from './postgres-backend.ts';
export { runMigrations, checkSchema } from './migrations.ts';
export { createPostgresPool, probeDatabase } from './pool.ts';

let backend: DurableSnapshotBackend | null = null;
let pool: Pool | null = null;

/** Overrides the data root for the filesystem backend (tests). */
let dataRoot = process.env['BF_DATA_DIR'] ?? join(process.cwd(), 'data');

export function setDataRoot(dir: string): void {
  dataRoot = resolve(dir);
}

/** Injects a backend explicitly (tests, or a host with its own wiring). */
export function setBackend(next: DurableSnapshotBackend | null): void {
  backend = next;
}

/** True when the live backend is the managed database. */
export function usingPostgres(): boolean {
  return resolveBackend().kind === 'postgresql';
}

/** True when the operator has refused the filesystem fallback. */
export function databaseRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['BF_REQUIRE_DATABASE'] === '1';
}

/**
 * Enforces `BF_REQUIRE_DATABASE=1`: production must persist to Neon, and a
 * missing connection string has to stop the boot rather than quietly downgrade
 * to an ephemeral disk that loses every project on the next cold start.
 *
 * Checked by both `initStorage` and `resolveBackend`, because refusing it only
 * at boot is not enough — any later resolution of the backend would otherwise
 * fall back silently and the refusal would be decorative.
 */
function assertStorageIsReal(kind: StorageKind): void {
  if (kind === 'postgresql' || !databaseRequired()) return;
  throw new Error(
    'BF_REQUIRE_DATABASE=1 but no database connection string is configured, so the ' +
      'filesystem fallback is refused. Set DATABASE_URL to the Neon database ' +
      '(POSTGRES_URL and NEON_DATABASE_URL are honoured), or unset BF_REQUIRE_DATABASE ' +
      'to run on local filesystem snapshots.',
  );
}

export function getPool(): Pool | null {
  return pool;
}

/** The active backend, created on first use. */
export function resolveBackend(): DurableSnapshotBackend {
  if (backend !== null) return backend;
  const kind = selectStorageKind();
  assertStorageIsReal(kind);
  if (kind === 'postgresql') {
    const connectionString = databaseUrlFrom();
    if (connectionString === null) {
      throw new Error('Storage kind is postgresql but no database connection string is configured.');
    }
    pool = createPostgresPool({ connectionString });
    backend = postgresBackend(pool);
    return backend;
  }
  const root = resolve(dataRoot);
  void mkdir(root, { recursive: true }).catch(() => undefined);
  backend = jsonFileBackend(root);
  return backend;
}

/**
 * Boots durable storage: creates the pool, applies migrations, and reports the
 * live backend honestly. Never returns "ready" for a backend that is not real.
 */
export async function initStorage(): Promise<{
  kind: StorageKind;
  ok: boolean;
  detail: string;
  migrations: string[];
}> {
  const kind = selectStorageKind();
  // Throws when BF_REQUIRE_DATABASE=1 and no connection string is configured,
  // so a misconfigured production deploy never boots on the filesystem.
  assertStorageIsReal(kind);
  if (kind === 'json-file') {
    const root = resolve(dataRoot);
    await mkdir(root, { recursive: true });
    backend = jsonFileBackend(root);
    return {
      kind,
      ok: true,
      detail: `filesystem durable snapshots at ${root}`,
      migrations: [],
    };
  }
  const connectionString = databaseUrlFrom();
  if (connectionString === null) {
    throw new Error('Storage kind is postgresql but no database connection string is configured.');
  }
  pool = createPostgresPool({ connectionString });
  const applied = await runMigrations(pool);
  backend = postgresBackend(pool);
  const schema = await checkSchema(pool);
  return {
    kind,
    ok: schema.ok,
    detail: schema.ok
      ? `${applied.length > 0 ? `applied ${applied.length} migration(s); ` : ''}${schema.detail}`
      : schema.detail,
    migrations: applied,
  };
}

/** Releases pooled connections. Safe to call more than once. */
export async function closeStorage(): Promise<void> {
  await backend?.close().catch(() => undefined);
  backend = null;
  pool = null;
}