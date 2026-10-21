/**
 * PostgreSQL ArtifactStore (production control plane).
 *
 * Implements the same `ArtifactStore` port as the filesystem store, but with a
 * real relational table instead of one snapshot file. This matters for two
 * architecture requirements that a single snapshot file cannot satisfy once the
 * control plane runs as many concurrent serverless instances:
 *
 *   - Optimistic concurrency (§ durable, conflict-free project state): the
 *     version check is enforced by `UPDATE ... WHERE version = $expected`, so a
 *     stale writer loses at the database rather than silently overwriting a
 *     newer certified state.
 *   - Tenant/project scoping: `project_id` is a first-class indexed column, so
 *     every project-scoped read is a filtered query rather than a full scan
 *     followed by an in-process filter.
 *
 * ID allocation is likewise transactional: `bf_id_counters` is incremented with
 * `UPDATE ... RETURNING`, which is atomic, so two instances can never mint the
 * same canonical artifact ID.
 */

import type { Pool } from 'pg';
import type { Artifact } from '../core/artifact.ts';
import {
  ArtifactNotFoundError,
  DuplicateArtifactError,
  VersionConflictError,
} from '../core/errors.ts';
import type { ArtifactFilter, ArtifactStore } from '../core/store.ts';
import { matchesFilter } from '../core/store.ts';
import type { ArtifactIdAllocator, IdReservation } from '../core/id-allocator.ts';

const ARTIFACTS = 'bf_artifacts';
const COUNTERS = 'bf_id_counters';

export interface PostgresArtifactStoreOptions {
  readonly pool: Pool;
  readonly allocator?: ArtifactIdAllocator;
}

export class PostgresArtifactStore implements ArtifactStore {
  readonly kind = 'postgresql';
  private readonly pool: Pool;
  private readonly allocator?: ArtifactIdAllocator;

  constructor(options: PostgresArtifactStoreOptions) {
    this.pool = options.pool;
    this.allocator = options.allocator;
  }

  /**
   * Seeds the in-process allocator from the IDs that were actually minted.
   *
   * The counter table is NOT a source for the allocator's high-water mark: it
   * records RESERVED ranges, because reserving a block advances it before a
   * single ID from that block is minted. Seeding from it would place the
   * allocator at the end of the block this very instance had just reserved,
   * and the first ID it tried to hand out would look exhausted.
   *
   * The minted high-water mark is the highest artifact ID that actually
   * exists, which is what the allocator must continue above.
   */
  async init(): Promise<void> {
    if (this.allocator === undefined) return;
    const max = await this.pool.query<{ id: string }>(`SELECT id FROM ${ARTIFACTS}`);
    for (const row of max.rows) {
      try {
        this.allocator.observe(row.id);
      } catch {
        /* non-canonical legacy id: never a counter source */
      }
    }
  }

  async append(artifact: Artifact): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ${ARTIFACTS} (id, type, project_id, status, version, doc, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
        [
          artifact.id,
          artifact.type,
          artifact.projectId,
          artifact.status,
          artifact.version,
          JSON.stringify(artifact),
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DuplicateArtifactError(artifact.id);
      throw error;
    }
    this.allocator?.observe(artifact.id);
  }

  async get(id: string): Promise<Artifact | null> {
    const result = await this.pool.query<{ doc: Artifact }>(
      `SELECT doc FROM ${ARTIFACTS} WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : (row.doc as Artifact);
  }

  async require(id: string): Promise<Artifact> {
    const found = await this.get(id);
    if (found === null) throw new ArtifactNotFoundError(id);
    return found;
  }

  async update(
    id: string,
    expectedVersion: number,
    mutate: (draft: Artifact) => Artifact,
  ): Promise<Artifact> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ doc: Artifact; version: number }>(
        `SELECT doc, version FROM ${ARTIFACTS} WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = existing.rows[0];
      if (row === undefined) throw new ArtifactNotFoundError(id);
      const current = row.doc as Artifact;
      if (current.version !== expectedVersion) {
        throw new VersionConflictError(id, expectedVersion, current.version);
      }
      const mutated = mutate(structuredClone(current));
      const next: Artifact = { ...mutated, id, version: current.version + 1 };
      await client.query(
        `UPDATE ${ARTIFACTS} SET status = $2, version = $3, doc = $4::jsonb, updated_at = now()
          WHERE id = $1`,
        [id, next.status, next.version, JSON.stringify(next)],
      );
      await client.query('COMMIT');
      return structuredClone(next);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(filter?: ArtifactFilter): Promise<Artifact[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filter?.projectId !== undefined) conditions.push(`project_id = ${push(filter.projectId)}`);
    if (filter?.types !== undefined && filter.types.length > 0) {
      conditions.push(`type = ANY(${push(filter.types as string[])}::text[])`);
    }
    if (filter?.statuses !== undefined && filter.statuses.length > 0) {
      conditions.push(`status = ANY(${push(filter.statuses as string[])}::text[])`);
    }
    if (filter?.ids !== undefined && filter.ids.length > 0) {
      conditions.push(`id = ANY(${push(filter.ids as string[])}::text[])`);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<{ doc: Artifact }>(
      `SELECT doc FROM ${ARTIFACTS}${where} ORDER BY id ASC`,
      params,
    );
    const artifacts = result.rows.map((r) => r.doc as Artifact);
    // `tag` is not indexed; it is rare and cheap to apply in process.
    return filter?.tag !== undefined ? artifacts.filter((a) => matchesFilter(a, filter)) : artifacts;
  }

  async countByType(): Promise<Record<string, number>> {
    const result = await this.pool.query<{ type: string; n: string }>(
      `SELECT type, COUNT(*)::text AS n FROM ${ARTIFACTS} GROUP BY type`,
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.type] = Number(row.n);
    return counts;
  }
}

/**
 * Database-backed atomic ID block reservation.
 *
 * `reserve` performs `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside one
 * statement, which PostgreSQL guarantees to serialize. The returned number is
 * the block's exclusive upper bound; the block's lower bound is
 * `next_value - size + 1`. No two callers can ever receive an overlapping block.
 */
export function postgresIdReservation(pool: Pool, blockSize: number): IdReservation {
  return {
    async reserve(type: string, size: number) {
      const result = await pool.query<{ next_value: number }>(
        `INSERT INTO ${COUNTERS} (artifact_type, next_value)
         VALUES ($1, $2)
         ON CONFLICT (artifact_type)
         DO UPDATE SET next_value = ${COUNTERS}.next_value + $2
         RETURNING next_value`,
        [type, size],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error(`ID block reservation for ${type} returned no row.`);
      const to = row.next_value - 1;
      const from = to - size + 1;
      return { from, to: Math.max(from, to) };
    },
  };
}