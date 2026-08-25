/**
 * Eleven-dimension coverage per artifact class (spec §0.16 applied per class).
 *
 * For each artifact class this module defines:
 *  - which dimensions are MECHANICALLY checkable by the existing specialists,
 *  - which dimensions the Level-2 Multi-Perspective Reasoning Council may
 *    resolve into conclusive verdicts (CORRECTNESS / QUALITY / CONFLICTS),
 *  - and therefore when an `inconclusive` verdict is HONEST versus a gap.
 *
 * Rule preserved from Levels 1a/1b: inconclusive ≠ pass. A dimension that is
 * neither pass nor backed by an allowed-inconclusive reason blocks
 * certification; the council is what lets judgment dimensions become
 * conclusive without fabricating evidence.
 */

import type { VerificationDimension } from './dimensions.ts';
import type { VerificationReport } from './verifier.ts';

export type ArtifactClass = 'discovery' | 'design' | 'build' | 'blueprint';

export interface ClassCoverageProfile {
  readonly artifactClass: ArtifactClass;
  /** Dimensions the class's specialist checks mechanically. */
  readonly mechanical: readonly VerificationDimension[];
  /**
   * Judgment dimensions the Council may resolve for this class. When the
   * council delivers an endorsement with no objections on the subject, these
   * become conclusive passes citing the deliberation; objections become
   * fails citing the seat findings.
   */
  readonly councilResolvable: readonly VerificationDimension[];
}

const JUDGMENT_DIMENSIONS: readonly VerificationDimension[] = [
  'CORRECTNESS',
  'QUALITY',
  'CONFLICTS',
];

export const CLASS_COVERAGE_PROFILES: Readonly<Record<ArtifactClass, ClassCoverageProfile>> = {
  discovery: {
    artifactClass: 'discovery',
    mechanical: ['COUNT', 'COVERAGE', 'IDENTITY', 'TRACEABILITY', 'DEPENDENCY_INTEGRITY', 'DUPLICATION', 'CONSISTENCY', 'EVIDENCE_OF_WORK'],
    councilResolvable: JUDGMENT_DIMENSIONS,
  },
  design: {
    artifactClass: 'design',
    mechanical: ['COUNT', 'COVERAGE', 'IDENTITY', 'TRACEABILITY', 'DEPENDENCY_INTEGRITY', 'DUPLICATION', 'CONSISTENCY', 'EVIDENCE_OF_WORK'],
    councilResolvable: JUDGMENT_DIMENSIONS,
  },
  build: {
    artifactClass: 'build',
    mechanical: ['COUNT', 'COVERAGE', 'IDENTITY', 'TRACEABILITY', 'DEPENDENCY_INTEGRITY', 'DUPLICATION', 'CONSISTENCY', 'EVIDENCE_OF_WORK'],
    councilResolvable: JUDGMENT_DIMENSIONS,
  },
  blueprint: {
    artifactClass: 'blueprint',
    mechanical: ['COUNT', 'COVERAGE', 'IDENTITY', 'TRACEABILITY', 'DEPENDENCY_INTEGRITY', 'DUPLICATION', 'CONSISTENCY', 'EVIDENCE_OF_WORK'],
    councilResolvable: JUDGMENT_DIMENSIONS,
  },
};

/**
 * Audits one report against its class profile:
 *  - every dimension must be present;
 *  - every inconclusive must be a council-resolvable judgment dimension;
 *  - any other inconclusive (a mechanical dimension left unresolved) is a
 *    coverage GAP and blocks certification until fixed.
 */
export interface ClassCoverageAudit {
  readonly artifactClass: ArtifactClass;
  readonly missingDimensions: readonly VerificationDimension[];
  readonly unjustifiedInconclusive: readonly VerificationDimension[];
  readonly complete: boolean;
}

export function auditClassCoverage(
  report: VerificationReport,
  artifactClass: ArtifactClass,
): ClassCoverageAudit {
  const profile = CLASS_COVERAGE_PROFILES[artifactClass];
  const present = new Set(report.findings.map((f) => f.dimension));
  const missingDimensions = profile.mechanical
    .concat(profile.councilResolvable)
    .filter((d) => !present.has(d));
  const unjustifiedInconclusive = report.findings
    .filter(
      (f) =>
        f.verdict === 'inconclusive' &&
        !profile.councilResolvable.includes(f.dimension),
    )
    .map((f) => f.dimension);
  return {
    artifactClass,
    missingDimensions,
    unjustifiedInconclusive,
    complete: missingDimensions.length === 0 && unjustifiedInconclusive.length === 0,
  };
}