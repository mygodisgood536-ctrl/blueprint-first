/**
 * Durable JSON-file ArtifactStore with atomic writes.
 *
 * This is the Level-1a persistence adapter: a single snapshot file holding
 * every artifact plus ID allocator state, written atomically (temp file +
 * rename with Windows-safe fallback) on every mutation. It implements the
 * same port as MemoryArtifactStore, so swapping in a database-backed
 * Knowledge Graph later changes nothing upstream.
 *
 * Schema (file version 1):
 *   { schemaVersion, savedAt, allocatorState?: { counters }, artifacts: [...] }
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Artifact } from './artifact.ts';
import {
  ArtifactNotFoundError,
  BlueprintError,
  DuplicateArtifactError,
  VersionConflictError,
} from './errors.ts';
import type { ArtifactStore, ArtifactFilter } from './store.ts';
import { matchesFilter } from './store.ts';
import type { ArtifactIdAllocator } from './id-allocator.ts';

const SCHEMA_VERSION = 1;

export interface StoreFile {
  schemaVersion: number;
  savedAt: string;
  allocatorState?: { counters: Record<string, number> };
  artifacts: Artifact[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class JsonFileArtifactStore implements ArtifactStore {
  readonly kind = 'json-file';
  private readonly filePath: string;
  private readonly allocator?: ArtifactIdAllocator;
  private artifacts: Map<string, Artifact> = new Map();
  private loaded = false;

  constructor(options: { filePath: string; allocator?: ArtifactIdAllocator }) {
    this.filePath = options.filePath;
    this.allocator = options.allocator;
  }

  /** Loads the backing file if present. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch {
      raw = null; // first run - no store file yet
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new BlueprintError(
          'STORE_CORRUPT',
          `Artifact store file ${this.filePath} is not valid JSON: ${(error as Error).message}`,
        );
      }
      this.artifacts = deserializeStoreFile(parsed, this.filePath);
      for (const id of this.artifacts.keys()) this.allocator?.observe(id);
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.init();
  }

  private async persist(): Promise<void> {
    const payload: StoreFile = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      ...(this.allocator ? { allocatorState: this.allocator.snapshot() } : {}),
      artifacts: [...this.artifacts.values()],
    };
    await atomicWriteText(this.filePath, JSON.stringify(payload, null, 2));
  }

  async append(artifact: Artifact): Promise<void> {
    await this.ensureLoaded();
    if (this.artifacts.has(artifact.id)) throw new DuplicateArtifactError(artifact.id);
    this.artifacts.set(artifact.id, clone(artifact));
    await this.persist();
  }

  async get(id: string): Promise<Artifact | null> {
    await this.ensureLoaded();
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
    await this.ensureLoaded();
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
    await this.persist();
    return clone(next);
  }

  async list(filter?: ArtifactFilter): Promise<Artifact[]> {
    await this.ensureLoaded();
    return [...this.artifacts.values()]
      .filter((a) => (filter ? matchesFilter(a, filter) : true))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((a) => clone(a));
  }

  async countByType(): Promise<Record<string, number>> {
    await this.ensureLoaded();
    const counts: Record<string, number> = {};
    for (const artifact of this.artifacts.values()) {
      counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
    }
    return counts;
  }
}

function deserializeStoreFile(parsed: unknown, filePath: string): Map<string, Artifact> {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('schemaVersion' in parsed) ||
    (parsed as StoreFile).schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray((parsed as StoreFile).artifacts)
  ) {
    throw new BlueprintError(
      'STORE_CORRUPT',
      `Artifact store file ${filePath} does not match schema version ${SCHEMA_VERSION}.`,
    );
  }
  const map = new Map<string, Artifact>();
  for (const artifact of (parsed as StoreFile).artifacts) {
    if (typeof artifact?.id !== 'string') {
      throw new BlueprintError('STORE_CORRUPT', 'Stored artifact without string id.');
    }
    map.set(artifact.id, artifact);
  }
  return map;
}

/**
 * Atomic text write: write to a uniquely named temp sibling, then rename over
 * the destination. On platforms where rename-over-existing can fail (some
 * Windows configurations), fall back to unlink-then-rename.
 */
export async function atomicWriteText(filePath: string, contents: string): Promise<void> {
  const dir = dirname(filePath);
  if (dir.length > 0) {
    await fs.mkdir(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp-${randomBytes(6).toString('hex')}`;
  await fs.writeFile(tmp, contents, 'utf8');
  try {
    await fs.rename(tmp, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EEXIST' || code === 'EISDIR') {
      try {
        await fs.rm(filePath, { force: true });
        await fs.rename(tmp, filePath);
        return;
      } catch {
        // fall through to cleanup + rethrow
      }
    }
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

