/**
 * Continuous Product Evolution (Level 5, spec §5).
 *
 * The Evolution Review is a standing review that surfaces improvement
 * recommendations even when no failure has occurred. It is a WORKER
 * (proposes), not a certifier. Every recommendation is queued for the
 * same impact-analysis + boss/auditor chain as a failure-driven change.
 *
 * Critically, the Evolution Review NEVER applies an improvement. It
 * produces a recommendation, the recommendation passes through the same
 * Safe Change Intelligence + Continuous Engineering Verification Chain
 * that a Guardian-driven change does, and the result is either an
 * authorized and applied change OR a rejected change. There is no
 * "autonomous improvement" path.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { EvolutionRecommendation } from './types.ts';

const EVOLUTION: Actor = { kind: 'ai', id: 'continuous-product-evolution-01' };

function hashHex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export interface EvolutionSeed {
  readonly baseId: string;
  /** Why this improvement is being recommended. */
  readonly rationale: string;
  /** What the platform would gain if applied. */
  readonly expectedBenefit: string;
}

/** Produces a recommendation record. Pure. */
export function recommendImprovement(seed: EvolutionSeed): EvolutionRecommendation {
  const at = new Date().toISOString();
  const id = hashHex([seed.baseId, seed.rationale, at]);
  return {
    recommendationId: `EVOL-${id.slice(0, 12)}`,
    baseId: seed.baseId,
    rationale: seed.rationale,
    expectedBenefit: seed.expectedBenefit,
    queuedForImpactAnalysis: true,
    proposedBy: EVOLUTION,
    proposedAt: at,
  };
}

/** Stable suggestion set: given a list of evolved bases, produce one
 *  EvolutionRecommendation per seed. This is the deterministic stand-in
 *  for the in-production evolution reviewer's heuristic. */
export function evolutionReviewFor(seeds: readonly EvolutionSeed[]): EvolutionRecommendation[] {
  return seeds.map(recommendImprovement);
}
