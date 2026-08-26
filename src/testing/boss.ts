/**
 * Test Boss (spec §3.3) - the judgment side of the Acceptance Testing
 * Department.
 *
 * The Boss never trusts the worker's execution report as its input: it
 * independently reconstructs BOTH the required coverage matrix AND each
 * expected outcome by recomputing them from the certified stored baselines
 * (the same deterministic inputs the worker had). It then diffs:
 *
 *   - coverage deltas  : tested-but-not-required / required-but-not-tested
 *   - fabricated passes: worker claims a pass the recomputation denies
 *   - hidden failures  : worker reports a failure recomputation refutes
 *
 * Any delta rejects. Zero deltas accepts with a reconstruction rationale.
 */

import type { CoreServices } from '../core/services.ts';
import { deriveExpectedCoverage } from './coverage.ts';
import { executeCheck } from './execute.ts';
import type { ExecutedCheck } from './execute.ts';

export interface TestBossDecision {
  readonly verdict: 'accepted' | 'rejected';
  readonly rationale: string;
  readonly reconstructedCount: number;
}

export async function runTestBoss(
  services: CoreServices,
  projectId: string,
  workerChecks: readonly ExecutedCheck[],
): Promise<TestBossDecision> {
  const expected = await deriveExpectedCoverage(services, projectId);
  const workerById = new Map(workerChecks.map((c) => [c.baseId, c]));

  const missing: string[] = [];
  const extra: string[] = [];
  const fabricated: string[] = [];
  const hidden: string[] = [];

  for (const exp of expected) {
    const claimed = workerById.get(exp.baseId);
    if (claimed === undefined) {
      missing.push(exp.baseId);
      continue;
    }
    if (claimed.kind !== exp.kind) {
      fabricated.push(`${exp.baseId} (wrong check kind)`);
      continue;
    }
    const truth = await executeCheck(services, exp);
    if (claimed.passed && !truth.passed) {
      fabricated.push(`${exp.baseId} (${truth.observed})`);
    } else if (!claimed.passed && truth.passed) {
      hidden.push(`${exp.baseId} (${truth.observed})`);
    }
  }
  for (const check of workerChecks) {
    const isExpected = expected.some((e) => e.baseId === check.baseId);
    if (!isExpected) extra.push(check.baseId);
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`required tests not run: [${missing.join(', ')}]`);
  if (extra.length > 0) parts.push(`tests outside the certified scope: [${extra.join(', ')}]`);
  if (fabricated.length > 0) parts.push(`claimed passes contradicted by stored state: [${fabricated.join('; ')}]`);
  if (hidden.length > 0) parts.push(`reported failures contradicted by stored state: [${hidden.join('; ')}]`);

  if (parts.length > 0) {
    return {
      verdict: 'rejected',
      rationale: `Independent reconstruction diverged from the corps' execution: ${parts.join(' | ')}`,
      reconstructedCount: expected.length,
    };
  }
  return {
    verdict: 'accepted',
    rationale: `Reconstruction from the certified baselines matches exactly: ${expected.length}/${expected.length} required checks executed and passed.`,
    reconstructedCount: expected.length,
  };
}
