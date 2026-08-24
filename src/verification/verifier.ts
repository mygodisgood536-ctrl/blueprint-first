/**
 * Verifier port and verification report aggregation.
 *
 * A Verifier is any component (specialist verifier, audit engine, test suite
 * adapter) that produces a VerificationReport: findings per verification
 * dimension with verdicts and optional evidence references.
 *
 * Aggregation here is judgment logic, deliberately separated from production:
 * workers produce artifacts; verifiers judge them. `summarizeReport` computes
 * coverage across the eleven dimensions so certification logic can demand
 * full-dimensional coverage before anything is certified.
 */

import type { Artifact } from '../core/artifact.ts';
import type { Actor } from '../core/artifact.ts';
import { VERIFICATION_DIMENSIONS } from './dimensions.ts';
import type { VerificationDimension } from './dimensions.ts';

export type Verdict = 'pass' | 'fail' | 'inconclusive';

export interface VerificationFinding {
  dimension: VerificationDimension;
  verdict: Verdict;
  detail: string;
  evidenceId?: string;
}

export interface VerificationReport {
  artifactId: string;
  verifier: Actor;
  findings: readonly VerificationFinding[];
  startedAt: string;
  finishedAt: string;
  notes?: string;
}

export interface Verifier {
  readonly actor: Actor;
  verify(input: {
    artifact: Artifact;
    context?: Record<string, unknown>;
  }): Promise<VerificationReport>;
}

export interface ReportSummary {
  passed: number;
  failed: number;
  inconclusive: number;
  coveredDimensions: readonly VerificationDimension[];
  missingDimensions: readonly VerificationDimension[];
  coversAllEleven: boolean;
  hasBlockingFailure: boolean;
}

export function summarizeReport(report: VerificationReport): ReportSummary {
  let passed = 0;
  let failed = 0;
  let inconclusive = 0;
  const covered = new Set<VerificationDimension>();
  for (const finding of report.findings) {
    if (finding.verdict === 'pass') passed += 1;
    else if (finding.verdict === 'fail') failed += 1;
    else inconclusive += 1;
    covered.add(finding.dimension);
  }
  const coveredDimensions = VERIFICATION_DIMENSIONS.filter((d) => covered.has(d));
  const missingDimensions = VERIFICATION_DIMENSIONS.filter((d) => !covered.has(d));
  return {
    passed,
    failed,
    inconclusive,
    coveredDimensions,
    missingDimensions,
    coversAllEleven: missingDimensions.length === 0 && covered.size === VERIFICATION_DIMENSIONS.length,
    hasBlockingFailure: failed > 0,
  };
}
