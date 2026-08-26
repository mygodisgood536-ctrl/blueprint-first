/**
 * Test Auditor (spec §3.3) - re-executes a deterministic sample of the
 * acceptance suite and compares results byte-for-byte against what the Test
 * Worker reported.
 *
 * The Auditor's charter is distinct from the Boss's: the Boss reconstructs
 * the EXPECTED coverage matrix; the Auditor re-RUNS sampled tests to catch
 * nondeterministic or mis-reported execution. A mismatch on either the pass
 * flag or the evidence hash rejects the whole run.
 */

import type { CoreServices } from '../core/services.ts';
import { executeCheck } from './execute.ts';
import type { ExecutedCheck } from './execute.ts';

export interface TestAuditorDecision {
  readonly verdict: 'confirmed' | 'rejected';
  readonly rationale: string;
  readonly sampledIds: readonly string[];
}

/** Evenly spaced deterministic sample (never random: runs must replay). */
export function sampleChecks(
  checks: readonly ExecutedCheck[],
  sampleSize: number,
): readonly ExecutedCheck[] {
  if (checks.length === 0) return [];
  const size = Math.max(1, Math.min(sampleSize, checks.length));
  const picked: ExecutedCheck[] = [];
  for (let i = 0; i < size; i += 1) {
    const index = Math.floor((i * checks.length) / size);
    const candidate = checks[index];
    if (candidate !== undefined && !picked.some((p) => p.baseId === candidate.baseId)) {
      picked.push(candidate);
    }
  }
  return picked;
}

export async function runTestAuditor(
  services: CoreServices,
  workerChecks: readonly ExecutedCheck[],
  sampleSize: number,
): Promise<TestAuditorDecision> {
  const sample = sampleChecks(workerChecks, sampleSize);
  if (sample.length === 0) {
    return { verdict: 'rejected', rationale: 'Nothing was executed, so there is nothing to audit.', sampledIds: [] };
  }

  const mismatches: string[] = [];
  for (const claimed of sample) {
    const rerun = await executeCheck(services, {
      baseId: claimed.baseId,
      kind: claimed.kind,
    });
    if (rerun.passed !== claimed.passed || rerun.evidenceHash !== claimed.evidenceHash) {
      mismatches.push(
        `${claimed.baseId}: claimed ${claimed.passed ? 'pass' : 'fail'}/${claimed.evidenceHash.slice(0, 8)}, ` +
          `re-execution produced ${rerun.passed ? 'pass' : 'fail'}/${rerun.evidenceHash.slice(0, 8)}`,
      );
    }
  }

  if (mismatches.length > 0) {
    return {
      verdict: 'rejected',
      rationale: `Re-execution of ${sample.length} sampled test(s) diverged: ${mismatches.join(' | ')}`,
      sampledIds: sample.map((s) => s.baseId),
    };
  }
  return {
    verdict: 'confirmed',
    rationale: `Re-executed ${sample.length}/${workerChecks.length} tests independently; every result and evidence hash reproduced exactly.`,
    sampledIds: sample.map((s) => s.baseId),
  };
}
