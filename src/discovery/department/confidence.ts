/**
 * Deterministic discovery-confidence scoring (spec §0.13 "confidence").
 *
 * Confidence at Level 1b is a MECHANICAL signal over defined completeness and
 * corroboration facts - it is never invented, never copied from worker prose,
 * and never treated as evidence by certification. Formula (clamped to
 * [0.05, 0.99] so nothing claims certainty):
 *
 *   start at 0.50
 *   +0.20 required descriptive fields present (purpose/description non-empty)
 *   +0.15 corroborated by at least one downstream reference (feature->module,
 *         page->module, validation->action, api->entity, ...)
 *   +0.10 all declared cross-references resolve inside the inventory
 *   +0.04 passed independent specialist verification
 *
 * Trivial leaves (STATE, VALIDATION - spec §0.13 allows inheritance) take the
 * parent's score when available instead of being scored independently.
 */

export interface ConfidenceInputs {
  readonly hasDescription: boolean;
  readonly referenceCount: number;
  readonly crossReferencesResolved: boolean;
  readonly specialistPassed: boolean;
  /** STATE/VALIDATION inheritance: when provided, the parent's score wins. */
  readonly parentConfidence?: number;
}

export function scoreConfidence(inputs: ConfidenceInputs): number {
  if (inputs.parentConfidence !== undefined) {
    return clampScore(inputs.parentConfidence);
  }
  let score = 0.5;
  if (inputs.hasDescription) score += 0.2;
  if (inputs.referenceCount > 0) score += 0.15;
  if (inputs.crossReferencesResolved) score += 0.1;
  if (inputs.specialistPassed) score += 0.04;
  return clampScore(score);
}

function clampScore(score: number): number {
  return Math.min(0.99, Math.max(0.05, Math.round(score * 100) / 100));
}