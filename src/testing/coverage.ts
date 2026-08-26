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
  const features = await services.store.list({ types: ['FEATURE'], projectId });
  const pages = await services.store.list({ types: ['PAGE'], projectId });
  return [
    ...features
      .filter((f) => isBaseArtifactId(f.id))
      .map((f) => ({ baseId: f.id, kind: 'functional' as const })),
    ...pages
      .filter((p) => isBaseArtifactId(p.id))
      .map((p) => ({ baseId: p.id, kind: 'render' as const })),
  ];
}
