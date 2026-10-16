/**
 * Schema migrations for the PostgreSQL (Neon) control-plane database.
 *
 * Migrations are additive, ordered and applied exactly once. They run at boot
 * before any request is served, inside a single transaction, and record the
 * applied migration in `bf_schema_migrations` so a redeploy is idempotent.
 *
 * No migration ever drops or rewrites certified data: the platform's durable
 * state is authoritative project history (Architecture §T.4 append-only
 * certification history) and is never destroyed by a deploy.
 */

import type { Pool } from 'pg';

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_state',
    sql: `
      CREATE TABLE IF NOT EXISTS bf_schema_migrations (
        id          text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: '0002_durable_snapshots',
    sql: `
      CREATE TABLE IF NOT EXISTS bf_state (
        slot        text PRIMARY KEY,
        value       jsonb NOT NULL,
        saved_at    timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: '0003_artifacts',
    sql: `
      CREATE TABLE IF NOT EXISTS bf_artifacts (
        id          text PRIMARY KEY,
        type        text        NOT NULL,
        project_id  text,
        status      text        NOT NULL,
        version     integer     NOT NULL,
        doc         jsonb       NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS bf_artifacts_project_idx ON bf_artifacts (project_id);
      CREATE INDEX IF NOT EXISTS bf_artifacts_type_idx    ON bf_artifacts (type);
      CREATE INDEX IF NOT EXISTS bf_artifacts_status_idx  ON bf_artifacts (status);
    `,
  },
  {
    id: '0004_id_counters',
    sql: `
      CREATE TABLE IF NOT EXISTS bf_id_counters (
        artifact_type text PRIMARY KEY,
        next_value    integer NOT NULL
      );
    `,
  },
  {
    id: '0005_execution_events',
    sql: `
      CREATE TABLE IF NOT EXISTS bf_execution_events (
        seq        bigserial PRIMARY KEY,
        project_id text,
        kind       text NOT NULL,
        payload    jsonb NOT NULL,
        at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS bf_execution_events_project_idx
        ON bf_execution_events (project_id, seq DESC);
    `,
  },
];

const MIGRATIONS_TABLE = 'bf_schema_migrations';

/** Applies every pending migration. Returns the ids that were applied. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const bootstrap = await pool.query<{ id: string }>(
    `SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ANY($1::text[])`,
    [MIGRATIONS.map((m) => m.id)],
  );
  const applied = new Set(bootstrap.rows.map((r) => r.id));
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1) ON CONFLICT DO NOTHING`, [
        migration.id,
      ]);
      await client.query('COMMIT');
      ran.push(migration.id);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${migration.id} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Verifies connectivity and that the schema is present and current. */
export async function checkSchema(pool: Pool): Promise<{ ok: boolean; detail: string }> {
  try {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'bf\\_%' ESCAPE '\\'`,
    );
    const present = new Set(tables.rows.map((r) => r.table_name));
    const required = ['bf_state', 'bf_artifacts', 'bf_id_counters', 'bf_schema_migrations'];
    const missing = required.filter((t) => !present.has(t));
    return missing.length === 0
      ? { ok: true, detail: `${required.length} control-plane tables present` }
      : { ok: false, detail: `missing table(s): ${missing.join(', ')}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}