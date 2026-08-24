/**
 * Persistence abstraction (port) for artifacts.
 *
 * This is the seam that lets the platform start on in-memory / JSON storage
 * today and move to a database-backed Knowledge Graph adapter later without
 * rewriting call sites. All operations are async and all reads return cloned
 * snapshots so callers can never mutate stored state through a reference.
 *
 * Implementations provided now:
 *   - MemoryArtifactStore   (tests, ephemeral runs)
 *   - JsonFileArtifactStore (durable single-node persistence, atomic writes)
 * Planned (roadmap): SQLite/Postgres adapter implementing this same port.
 */

import type { Artifact } from './artifact.ts';
import { createArtifact, withProvenance } from './artifact.ts';
import type { Actor, ProvenanceEntry } from './artifact.ts';
import type { ArtifactStatus } from './status.ts';
import { assertTransition } from './status.ts';
import type { ArtifactType } from './ids.ts';

export interface ArtifactFilter {
  types?: readonly ArtifactType[];
  statuses?: readonly ArtifactStatus[];
  projectId?: string;
  ids?: readonly string[];
  tag?: string;
}

export function matchesFilter(artifact: Artifact, filter: ArtifactFilter): boolean {
  if (filter.types && !filter.types.includes(artifact.type)) return false;
  if (filter.statuses && !filter.statuses.includes(artifact.status)) return false;
  if (filter.projectId !== undefined && artifact.projectId !== filter.projectId) return false;
  if (filter.ids && !filter.ids.includes(artifact.id)) return false;
  if (filter.tag !== undefined && !artifact.tags.includes(filter.tag)) return false;
  return true;
}

export interface ArtifactStore {
  readonly kind: string;
  append(artifact: Artifact): Promise<void>;
  get(id: string): Promise<Artifact | null>;
  require(id: string): Promise<Artifact>;
  /**
   * Optimistic-concurrency update: fails unless the stored version equals
   * expectedVersion. The mutator receives a private draft; whatever it
   * returns replaces the stored artifact with version + 1.
   */
  update(
    id: string,
    expectedVersion: number,
    mutate: (draft: Artifact) => Artifact,
  ): Promise<Artifact>;
  list(filter?: ArtifactFilter): Promise<Artifact[]>;
  countByType(): Promise<Record<string, number>>;
}

/**
 * Convenience operation used by orchestration and review flows: performs a
 * guarded status transition and records who/what caused it, optionally tied
 * to an evidence record.
 */
export async function recordStatusChange(
  store: ArtifactStore,
  id: string,
  to: ArtifactStatus,
  actor: Actor,
  options?: { note?: string; evidenceId?: string; at?: string },
): Promise<Artifact> {
  const current = await store.require(id);
  assertTransition(current.status, to);
  const entry: ProvenanceEntry = {
    at: options?.at ?? new Date().toISOString(),
    action: 'status-changed',
    actor,
    ...(options?.note !== undefined ? { note: options.note } : {}),
    ...(options?.evidenceId !== undefined ? { evidenceId: options.evidenceId } : {}),
  };
  return store.update(id, current.version, (draft) => ({
    ...withProvenance(draft, entry),
    status: to,
  }));
}

/** Convenience: append-and-return for flows that build artifacts first. */
export async function putNewArtifact(store: ArtifactStore, input: Parameters<typeof createArtifact>[0]): Promise<Artifact> {
  const artifact = createArtifact(input);
  await store.append(artifact);
  return artifact;
}
