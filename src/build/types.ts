/**
 * Build domain types - Level 1a AI Build Studio.
 *
 * The studio consumes an APPROVED blueprint (never a merely verified one) and
 * produces implementation artifacts along the exact production lineage:
 *
 *   PAGE-0001-DESIGN -> PAGE-0001-IMPL
 *   FEATURE-0001-DESIGN -> FEATURE-0001-IMPL
 *   COMPONENT-n (implementation manifest) aggregates every -IMPL artifact
 *
 * Structure derives deterministically from stored design docs and discovery
 * artifacts so the implementation can never silently contradict the approved
 * blueprint. An AI model contributes clearly-labeled implementation notes per
 * page through the router; they are recorded as sha256-anchored evidence,
 * never trusted as structure.
 */

export interface ImplementationUnit {
  readonly kind: 'component' | 'api' | 'entity' | 'integration';
  /** Discovered base artifact realized by this unit (API-0001 etc.). */
  readonly baseArtifactId?: string;
  /** -DESIGN origin when the unit implements an approved design. */
  readonly fromDesignId?: string;
  readonly title: string;
  readonly description: string;
}

export interface BuildRunResult {
  readonly status: 'accepted' | 'rejected' | 'failed';
  readonly manifestId?: string;
  readonly report?: import('../verification/verifier.ts').VerificationReport;
  readonly error?: { code: string; message: string };
  readonly artifactIds: readonly string[];
}