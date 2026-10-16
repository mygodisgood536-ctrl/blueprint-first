/**
 * Storage composition root (Decision D2).
 *
 * Chooses the real artifact store for the live backend and, on the database
 * backend, reserves an exclusive block of canonical IDs per artifact class so
 * two concurrent serverless instances can never mint the same ID.
 *
 * This module is the only place that knows both the core stores and the storage
 * backends exist; everything above it depends on the `ArtifactStore` port.
 */

import { JsonFileArtifactStore } from '../core/json-file-store.ts';
import { ARTIFACT_TYPES } from '../core/ids.ts';
import { ArtifactIdAllocator, ID_RESERVATION_BLOCK } from '../core/id-allocator.ts';
import type { ArtifactStore } from '../core/store.ts';
import { PostgresArtifactStore, postgresIdReservation } from './postgres-artifact-store.ts';
import { getPool, resolveBackend } from './index.ts';

export interface ComposedStore {
  readonly store: ArtifactStore;
  readonly kind: string;
}

/** Builds the artifact store matching the live durable backend. */
export function composeArtifactStore(options: {
  filePath: string;
  allocator: ArtifactIdAllocator;
}): ComposedStore {
  const live = resolveBackend();
  const pool = getPool();
  if (live.kind === 'postgresql' && pool !== null) {
    return { store: new PostgresArtifactStore({ pool, allocator: options.allocator }), kind: live.kind };
  }
  return {
    store: new JsonFileArtifactStore({ filePath: options.filePath, allocator: options.allocator }),
    kind: live.kind,
  };
}

/** Loads persisted state for either real store implementation. */
export async function initArtifactStore(store: ArtifactStore): Promise<void> {
  const loadable = store as ArtifactStore & { init?: () => Promise<void> };
  await loadable.init?.();
}

/**
 * Reserves ID headroom for every artifact class.
 *
 * Safe and cheap to call on every boot: reservation is atomic per type and the
 * reserved range is only ever handed out once.
 */
export async function reserveIdBlocks(allocator: ArtifactIdAllocator): Promise<boolean> {
  const pool = getPool();
  if (pool === null) return false;
  const reservation = postgresIdReservation(pool, ID_RESERVATION_BLOCK);
  for (const type of ARTIFACT_TYPES) {
    await allocator.reserve(type, ID_RESERVATION_BLOCK, reservation);
  }
  return true;
}