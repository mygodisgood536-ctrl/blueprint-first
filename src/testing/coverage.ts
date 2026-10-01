/**
 * Mechanical test-scope derivation for the AI Acceptance Testing Department
 * (Level 3, Stage 3).
 *
 * The spec roadmap is explicit: test scope is "derived directly from the
 * certified Master Product Inventory" - never negotiated by a worker, never
 * taken from an AI's claims. One acceptance test per base FEATURE
 * (functional) and per base PAGE (render). Phase artifacts (-DESIGN/-IMPL)
 * are exercised through their base item's test, not as independent units.
 */

import type { CoreServices } from '../core/services.ts';
import { parseArtifactId } from '../core/ids.ts';

export interface CoverageExpectation {
  readonly baseId: string;
  readonly kind: 'functional' | 'render';
}

/** A base artifact id (TYPE-NNNN) vs a phase id (TYPE-NNNN-DESIGN...). */
export function isBaseArtifactId(id: string): boolean {
  try {
    return parseArtifactId(id).phases.length === 0;
  } catch {
    return false;
  }
}

/**
 * The required coverage matrix, recomputed from the stored certified
 * inventory. Deterministic: identical stores yield identical matrices,
 * which is what lets the Test Boss reconstruct it independently.
 */
export async function deriveExpectedCoverage(
  services: CoreServices,
  projectId: string,
): Promise<readonly CoverageExpectation[]> {
  // Test scope comes from the VERIFIED inventory only: items that the
  // discovery/delivery chain actually boss-verified (the "certified Master
  // Product Inventory"). Unverified raw discoveries are NOT testable subjects
  // and cannot enter the matrix or leak into any verdict.
  const features = await services.store.list({ types: ['FEATURE'], projectId });
  const pages = await services.store.list({ types: ['PAGE'], projectId });
  const verifiedBase = (group: readonly { id: string; status: string }[]): readonly string[] =>
    group
      .filter((f) => isBaseArtifactId(f.id) && f.status === 'VERIFIED')
      .map((f) => f.id);
  return [
    ...verifiedBase(features).map((baseId) => ({ baseId, kind: 'functional' as const })),
    ...verifiedBase(pages).map((baseId) => ({ baseId, kind: 'render' as const })),
  ];
}
