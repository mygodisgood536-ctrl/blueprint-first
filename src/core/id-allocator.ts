/**
 * Deterministic artifact ID allocation.
 *
 * The allocator hands out sequential IDs per artifact type and never reuses a
 * number, even across process restarts: it can be seeded from existing IDs or
 * from a persisted snapshot, so the same history always produces the same next
 * ID. Allocation itself is pure bookkeeping - persistence is the caller's
 * responsibility (the JSON-file store snapshots allocator state atomically).
 */

import { formatArtifactId, parseArtifactId } from './ids.ts';
import type { ArtifactType } from './ids.ts';

export interface AllocatorSnapshot {
  readonly counters: Readonly<Record<string, number>>;
}

export class ArtifactIdAllocator {
  private counters: Map<ArtifactType, number> = new Map();

  constructor(snapshot?: AllocatorSnapshot) {
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

  /** Allocates the next canonical ID for the given type (monotonic). */
  nextId(type: ArtifactType): string {
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
