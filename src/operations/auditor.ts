/**
 * Deployment Auditor (spec §4.1, independent audit) - performs live
 * post-deployment reconciliation: a deterministic sample of deployed units is
 * re-reconciled against the certified expected behavior and compared
 * byte-for-byte with what the Deployment Worker reported.
 *
 * The Auditor's charter is distinct from the Boss's: the Boss reconstructs the
 * EXPECTED production state; the Auditor re-RUNS reconciliation to catch
 * nondeterministic or mis-reported execution. A mismatch on either the pass
 * flag or the evidence hash rejects the whole release.
 */

import type { CoreServices } from '../core/services.ts';
import { verifyDeployedUnit } from './deploy.ts';
import type { ExecutedDeploy, DeploymentEnvironment } from './deploy.ts';

export interface DeployAuditorDecision {
  readonly verdict: 'confirmed' | 'rejected';
  readonly rationale: string;
  readonly sampledIds: readonly string[];
}

/** Evenly spaced deterministic sample (never random: runs must replay). */
export function sampleDeploys(
  deploys: readonly ExecutedDeploy[],
  sampleSize: number,
): readonly ExecutedDeploy[] {
  if (deploys.length === 0) return [];
  const size = Math.max(1, Math.min(sampleSize, deploys.length));
  const picked: ExecutedDeploy[] = [];
  for (let i = 0; i < size; i += 1) {
    const index = Math.floor((i * deploys.length) / size);
    const candidate = deploys[index];
    if (candidate !== undefined && !picked.some((p) => p.baseId === candidate.baseId)) {
      picked.push(candidate);
    }
  }
  return picked;
}

export async function runDeployAuditor(
  services: CoreServices,
  env: DeploymentEnvironment,
  workerDeploys: readonly ExecutedDeploy[],
  sampleSize: number,
): Promise<DeployAuditorDecision> {
  const sample = sampleDeploys(workerDeploys, sampleSize);
  if (sample.length === 0) {
    return {
      verdict: 'rejected',
      rationale: 'Nothing was deployed, so there is nothing to reconcile.',
      sampledIds: [],
    };
  }

  const mismatches: string[] = [];
  for (const claimed of sample) {
    const rerun = await verifyDeployedUnit(
      services,
      { baseId: claimed.baseId, kind: claimed.kind },
      env,
    );
    if (rerun.passed !== claimed.passed || rerun.evidenceHash !== claimed.evidenceHash) {
      mismatches.push(
        `${claimed.baseId}: claimed ${claimed.passed ? 'pass' : 'fail'}/${claimed.evidenceHash.slice(0, 8)}, ` +
          `reconciliation produced ${rerun.passed ? 'pass' : 'fail'}/${rerun.evidenceHash.slice(0, 8)}`,
      );
    }
  }

  if (mismatches.length > 0) {
    return {
      verdict: 'rejected',
      rationale: `Post-deployment reconciliation of ${sample.length} sampled unit(s) diverged: ${mismatches.join(' | ')}`,
      sampledIds: sample.map((s) => s.baseId),
    };
  }
  return {
    verdict: 'confirmed',
    rationale:
      `Reconciled ${sample.length}/${workerDeploys.length} deployed unit(s) independently in ${env.name}; ` +
      `every result and evidence hash reproduced exactly.`,
    sampledIds: sample.map((s) => s.baseId),
  };
}
