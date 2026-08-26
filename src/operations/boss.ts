/**
 * Deployment Boss (spec §4.2) - the judgment side of the deployment chain.
 *
 * Like every Boss in the architecture, it never trusts the worker's report as
 * input: it independently reconstructs BOTH the required release scope (from
 * the certified inventory's verified -TEST closure) AND each expected
 * production fact, then diffs that reconstruction against what the corps
 * actually deployed:
 *
 *   - missing deployments   : scheduled units silently dropped between build
 *                             and production ("nothing silently dropped")
 *   - out-of-scope releases : units deployed outside the certified closure
 *   - unfinished deployments: configuration drift vs the certified baselines,
 *                             missing rollback probes, absent live monitors
 *   - mis-reported verdicts : worker hashes diverging from reconstruction
 *
 * Any delta rejects. Zero deltas accepts with a reconstruction rationale -
 * the same reconstruct-and-diff discipline every earlier stage applies,
 * here governing the transition into production.
 */

import type { CoreServices } from '../core/services.ts';
import { deriveDeployScope } from './scope.ts';
import { verifyDeployedUnit } from './deploy.ts';
import type { ExecutedDeploy, DeploymentEnvironment } from './deploy.ts';

export interface DeployBossDecision {
  readonly verdict: 'accepted' | 'rejected';
  readonly rationale: string;
  readonly reconstructedCount: number;
}

export async function runDeployBoss(
  services: CoreServices,
  projectId: string,
  env: DeploymentEnvironment,
  workerDeploys: readonly ExecutedDeploy[],
): Promise<DeployBossDecision> {
  const expected = await deriveDeployScope(services, projectId);
  const workerById = new Map(workerDeploys.map((d) => [d.baseId, d]));

  const missing: string[] = [];
  const extra: string[] = [];
  const unfinished: string[] = [];
  const misreported: string[] = [];

  for (const exp of expected) {
    const claimed = workerById.get(exp.baseId);
    if (claimed === undefined) {
      missing.push(exp.baseId);
      continue;
    }
    const truth = await verifyDeployedUnit(services, exp, env);
    if (!truth.passed) {
      unfinished.push(`${exp.baseId} (${truth.observed})`);
    } else if (claimed.evidenceHash !== truth.evidenceHash) {
      misreported.push(
        `${exp.baseId}: claimed ${claimed.evidenceHash.slice(0, 8)}, reconstructed ${truth.evidenceHash.slice(0, 8)}`,
      );
    }
  }
  for (const deploy of workerDeploys) {
    const inScope = expected.some((e) => e.baseId === deploy.baseId);
    if (!inScope) extra.push(deploy.baseId);
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`scheduled deployments never executed: [${missing.join(', ')}]`);
  if (extra.length > 0) parts.push(`deployments outside the certified release scope: [${extra.join(', ')}]`);
  if (unfinished.length > 0) {
    parts.push(`deployed units not matching the certified production state: [${unfinished.join('; ')}]`);
  }
  if (misreported.length > 0) {
    parts.push(`verdicts contradicted by independent reconstruction: [${misreported.join('; ')}]`);
  }

  if (parts.length > 0) {
    return {
      verdict: 'rejected',
      rationale: `Independent reconstruction of the production state diverged from the release: ${parts.join(' | ')}`,
      reconstructedCount: expected.length,
    };
  }
  return {
    verdict: 'accepted',
    rationale:
      `Reconstruction from the certified baselines matches exactly: ${expected.length}/${expected.length} ` +
      `scheduled unit(s) present in ${env.name}, configured from certified baselines, monitored and rollback-exercised.`,
    reconstructedCount: expected.length,
  };
}
