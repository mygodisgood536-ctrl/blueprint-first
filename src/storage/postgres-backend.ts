/**
 * PostgreSQL durable-snapshot backend (production: Neon).
 *
 * A single `bf_state` table holds the platform's small durable snapshots. The
 * schema is created and migrated by `migrations.ts`; this module only reads and
 * writes rows.
 *
 * Concurrency: `transact` runs the read-modify-write inside a single
 * transaction holding a transaction-scoped advisory lock keyed on the slot
 * name, so two concurrent writers (two serverless instances, a cron tick and a
 * request) can never lose one another's update. Plain `write` is an upsert and
 * is used only by callers that already hold the authoritative state.
 */

import type { Pool, PoolClient } from 'pg';
import type { DurableSnapshotBackend, StorageKind } from './backend.ts';

export const STATE_TABLE = 'bf_state';

export function postgresBackend(pool: Pool): DurableSnapshotBackend {
  return {
    kind: 'postgresql' satisfies StorageKind,

    async read(key: string): Promise<unknown | null> {
      const result = await pool.query<{ value: unknown }>(
        `SELECT value FROM ${STATE_TABLE} WHERE slot = $1`,
        [key],
      );
      const row = result.rows[0];
      return row === undefined ? null : row.value;
    },

    async write(key: string, value: unknown): Promise<void> {
      await pool.query(
        `INSERT INTO ${STATE_TABLE} (slot, value, saved_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (slot) DO UPDATE SET value = EXCLUDED.value, saved_at = EXCLUDED.saved_at`,
        [key, JSON.stringify(value)],
      );
    },

    async transact<T>(
      key: string,
      mutate: (current: unknown | null) => Promise<{ value: unknown | null; result: T }> | { value: unknown | null; result: T },
    ): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        // hashtext() gives a stable int64 lock id for this slot name.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const existing = await client.query<{ value: unknown }>(
          `SELECT value FROM ${STATE_TABLE} WHERE slot = $1 FOR UPDATE`,
          [key],
        );
        const row = existing.rows[0];
        const { value, result } = await mutate(row === undefined ? null : row.value);
        if (value !== null) {
          await client.query(
            `INSERT INTO ${STATE_TABLE} (slot, value, saved_at)
             VALUES ($1, $2::jsonb, now())
             ON CONFLICT (slot) DO UPDATE SET value = EXCLUDED.value, saved_at = EXCLUDED.saved_at`,
            [key, JSON.stringify(value)],
          );
        }
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}