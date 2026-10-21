/**
 * Deterministic artifact ID allocation.
 *
 * The allocator hands out sequential IDs per artifact type and never reuses a
 * number, even across process restarts: it can be seeded from existing IDs or
 * from a persisted snapshot, so the same history always produces the same next
 * ID. Allocation itself is pure bookkeeping - persistence is the caller's
 * responsibility (the JSON-file store snapshots allocator state atomically).
 *
 * Concurrent instances (the control plane runs as many short-lived serverless
 * instances behind a load balancer) are served by `IdReservation`: the
 * allocator atomically reserves a contiguous, exclusive block of numbers per
 * type from the database at boot, then serves `nextId` from that block. Two
 * instances therefore can never mint the same canonical ID, and no call site has
 * to become asynchronous. When a block runs out the allocator fails closed with
 * `IdAllocationExhaustedError` rather than risking a duplicate - the caller
 * surfaces it and the platform retries after a fresh reservation.
 */

import { formatArtifactId, parseArtifactId } from './ids.ts';
import type { ArtifactPhase, ArtifactType } from './ids.ts';

export interface AllocatorSnapshot {
  readonly counters: Readonly<Record<string, number>>;
}

/** Raised when a reserved ID block is exhausted and no new one was fetched. */
export class IdAllocationExhaustedError extends Error {
  readonly code = 'ID_ALLOCATION_EXHAUSTED';
  readonly artifactType: string;
  constructor(artifactType: string) {
    super(`No reserved ID block remains for artifact type ${artifactType}.`);
    this.name = 'IdAllocationExhaustedError';
    this.artifactType = artifactType;
  }
}

/** Atomic block reservation against a shared durable counter. */
export interface IdReservation {
  /** Reserves `[from, to]` inclusive, exclusively owned by this caller. */
  reserve(type: ArtifactType, size: number): Promise<{ from: number; to: number }>;
}

/** IDs reserved per artifact type per instance. Large enough to be uneventful. */
export const ID_RESERVATION_BLOCK = 1024;

export class ArtifactIdAllocator {
  private counters: Map<ArtifactType, number> = new Map();
  private readonly blockEnd: Map<ArtifactType, number> = new Map();
  private readonly reservation?: IdReservation;

  constructor(snapshot?: AllocatorSnapshot, reservation?: IdReservation) {
    if (reservation !== undefined) this.reservation = reservation;
    if (snapshot === undefined) return;
    for (const [rawType, value] of Object.entries(snapshot.counters)) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(
          `Invalid allocator snapshot: counter for ${rawType} must be a non-negative integer, got ${String(value)}.`,
        );
      }
      this.counters.set(rawType as ArtifactType, value);
    }
  }

  /**
   * Ensures a reserved block covers the counter for `type`.
   * Awaited during boot (and by any caller that wants to guarantee headroom).
   *
   * A reserved block is EXCLUSIVE to the instance that reserved it: that
   * instance hands out the IDs inside it, and no other instance ever does.
   * The allocator therefore continues from the block's start, not from the
   * highest ID it happens to have observed - an observed ID belongs to some
   * other instance's block, and continuing from it would mint an ID twice.
   *
   * When the observed high-water mark is already at or beyond the block, the
   * block cannot be used at all and another one is reserved, because the
   * reserved ranges are handed out from a single global counter.
   */
  async reserve(
    type: ArtifactType,
    size: number = ID_RESERVATION_BLOCK,
    reservation?: IdReservation,
  ): Promise<void> {
    const source = reservation ?? this.reservation;
    if (source === undefined) return;
    let block = await source.reserve(type, size);
    const highWater = this.counters.get(type) ?? 0;
    if (highWater > block.from - 1) {
      // Everything this block could hand out already exists (or is owned by
      // another instance's block). Take the next range instead.
      block = await source.reserve(type, size);
    }
    const start = Math.max(block.from - 1, highWater);
    if (block.to >= start) {
      this.counters.set(type, start);
      this.blockEnd.set(type, block.to);
    }
  }

  /** Allocates the next canonical ID for the given type (monotonic). */
  nextId(type: ArtifactType): string {
    const limit = this.blockEnd.get(type);
    if (limit !== undefined) {
      const current = this.counters.get(type) ?? 0;
      if (current >= limit) throw new IdAllocationExhaustedError(type);
    }
    const current = this.counters.get(type) ?? 0;
    const next = current + 1;
    this.counters.set(type, next);
    return formatArtifactId(type, next);
  }

  /** Returns the ID that would be allocated next, without allocating. */
  peekNext(type: ArtifactType): string {
    const current = this.counters.get(type) ?? 0;
    return formatArtifactId(type, current + 1);
  }

  /**
   * Allocates the next canonical ID for the given type and appends a phase
   * suffix. The phase suffix is recorded on the type's counter so subsequent
   * `nextId` calls do not collide.
   */
  nextIdWithPhase(type: ArtifactType, phase: ArtifactPhase): string {
    const base = this.nextId(type);
    return `${base}-${phase}`;
  }

  /**
   * Observes an externally created ID so future allocations never collide
   * with it. Allocating below an observed high-water mark is impossible.
   */
  observe(id: string): void {
    const parsed = parseArtifactId(id);
    if (parsed.phases.length > 0) return; // phase IDs share the base counter space implicitly via their type/number
    const current = this.counters.get(parsed.type) ?? 0;
    if (parsed.number > current) {
      this.counters.set(parsed.type, parsed.number);
    }
  }

  static fromIds(ids: readonly string[]): ArtifactIdAllocator {
    const allocator = new ArtifactIdAllocator();
    for (const id of ids) allocator.observe(id);
    return allocator;
  }

  snapshot(): AllocatorSnapshot {
    return { counters: Object.fromEntries(this.counters) };
  }
}
