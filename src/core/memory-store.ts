/**
 * In-memory ArtifactStore implementation.
 *
 * Semantics shared by every implementation of the port:
 *  - append() rejects duplicate IDs.
 *  - update() enforces optimistic concurrency (expectedVersion).
 *  - reads return deep clones, so external mutation cannot corrupt state.
 *  - list() results are ordered by ID for determinism.
 */

import type { Artifact } from './artifact.ts';
import { DuplicateArtifactError, ArtifactNotFoundError, VersionConflictError } from './errors.ts';
import type { ArtifactStore, ArtifactFilter } from './store.ts';
import { matchesFilter } from './store.ts';

const structuredCloneAvailable = typeof structuredClone === 'function';

function clone<T>(value: T): T {
  if (structuredCloneAvailable) return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly kind = 'memory';
  private readonly artifacts: Map<string, Artifact> = new Map();

  async append(artifact: Artifact): Promise<void> {
    if (this.artifacts.has(artifact.id)) {
      throw new DuplicateArtifactError(artifact.id);
    }
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async get(id: string): Promise<Artifact | null> {
    const found = this.artifacts.get(id);
    return found ? clone(found) : null;
  }

  async require(id: string): Promise<Artifact> {
    const found = await this.get(id);
    if (!found) throw new ArtifactNotFoundError(id);
    return found;
  }

  async update(
    id: string,
    expectedVersion: number,
    mutate: (draft: Artifact) => Artifact,
  ): Promise<Artifact> {
    const found = this.artifacts.get(id);
    if (!found) throw new ArtifactNotFoundError(id);
    if (found.version !== expectedVersion) {
      throw new VersionConflictError(id, expectedVersion, found.version);
    }
    // The STORE owns versioning: whatever the mutator produces is stored with
    // version = found.version + 1. Callers never manage version numbers.
    const mutated = mutate(clone(found));
    const next: Artifact = { ...mutated, id, version: found.version + 1 };
    this.artifacts.set(id, clone(next));
    return clone(next);
  }

  async list(filter?: ArtifactFilter): Promise<Artifact[]> {
    const all = [...this.artifacts.values()]
      .filter((a) => (filter ? matchesFilter(a, filter) : true))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return all.map((a) => clone(a));
  }

  async countByType(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const artifact of this.artifacts.values()) {
      counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
    }
    return counts;
  }
}
