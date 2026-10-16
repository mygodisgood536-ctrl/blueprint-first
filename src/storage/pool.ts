/**
 * Connection pool factory for the managed PostgreSQL control plane.
 *
 * The connection string is read from the environment and held only in memory.
 * It is never persisted, logged, echoed into a response, or attached to an
 * evidence record. Pool sizing is deliberately small: a serverless control plane
 * is many short-lived instances, each needing a couple of connections, not a
 * long-lived daemon holding a large pool.
 */

import pg from 'pg';

export interface PostgresOptions {
  readonly connectionString: string;
  /** Maximum connections per instance. Defaults to 5. */
  readonly max?: number;
  /** Connection timeout in ms. Defaults to 10000. */
  readonly connectionTimeoutMs?: number;
  /** Statement timeout in ms. Defaults to 15000. */
  readonly statementTimeoutMs?: number;
  /** 'require' on a TLS-less URL is only valid for a local socket. */
  readonly ssl?: { rejectUnauthorized: false };
}

export function createPostgresPool(options: PostgresOptions): pg.Pool {
  const ssl = options.ssl ?? (/sslmode=disable/i.test(options.connectionString) ? undefined : { rejectUnauthorized: false });
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idleTimeoutMillis: 30_000,
    ...(ssl !== undefined ? { ssl } : {}),
    application_name: 'blueprint-first-control-plane',
  });
}

/**
 * Verifies a connection string is syntactically usable without ever printing it.
 * Returns an honest readiness record suitable for the startup gate.
 */
export async function probeDatabase(connectionString: string): Promise<{ ok: boolean; detail: string }> {
  let pool: pg.Pool | null = null;
  try {
    pool = createPostgresPool({ connectionString, max: 1, connectionTimeoutMs: 8000, statementTimeoutMs: 8000 });
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1
      ? { ok: true, detail: 'database reachable' }
      : { ok: false, detail: 'unexpected probe response' };
  } catch (error) {
    const message = (error as Error).message;
    // Never surface the DSN; the driver's message may embed it.
    return { ok: false, detail: `database unreachable: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted>')}` };
  } finally {
    await pool?.end().catch(() => undefined);
  }
}