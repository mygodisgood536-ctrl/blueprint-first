/**
 * The eleven verification dimensions established by the architecture.
 *
 * Every verification report must ultimately be expressible against these
 * dimensions. The runtime guard below makes accidental narrowing of this list
 * a loud failure rather than a silent one.
 */

export const VERIFICATION_DIMENSIONS = [
  'COUNT',
  'COVERAGE',
  'IDENTITY',
  'CORRECTNESS',
  'QUALITY',
  'TRACEABILITY',
  'DEPENDENCY_INTEGRITY',
  'DUPLICATION',
  'CONFLICTS',
  'CONSISTENCY',
  'EVIDENCE_OF_WORK',
] as const;

export type VerificationDimension = (typeof VERIFICATION_DIMENSIONS)[number];

/** Expected number of dimensions; asserted at runtime by the guard below. */
export const EXPECTED_DIMENSION_COUNT = 11;

export function assertElevenDimensions(): readonly VerificationDimension[] {
  if (VERIFICATION_DIMENSIONS.length !== EXPECTED_DIMENSION_COUNT) {
    throw new Error(
      `Verification dimensions corrupted: expected ${EXPECTED_DIMENSION_COUNT}, found ${VERIFICATION_DIMENSIONS.length}.`,
    );
  }
  return VERIFICATION_DIMENSIONS;
}

export function dimensionIndex(dimension: VerificationDimension): number {
  return VERIFICATION_DIMENSIONS.indexOf(dimension);
}
