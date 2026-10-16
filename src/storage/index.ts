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

export function getPool(): Pool | null {
  return pool;
}

/** The active backend, created on first use. */
export function resolveBackend(): DurableSnapshotBackend {
  if (backend !== null) return backend;
  if (selectStorageKind() === 'postgresql') {
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
  if (kind === 'json-file') {
    const required = process.env['BF_REQUIRE_DATABASE'] === '1';
    const root = resolve(dataRoot);
    await mkdir(root, { recursive: true });
    backend = jsonFileBackend(root);
    return {
      kind,
      ok: !required,
      detail: required
        ? 'BF_REQUIRE_DATABASE=1 but no database connection string is configured.'
        : `filesystem durable snapshots at ${root}`,
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