/**
 * AI Operations & Observability Layer (Level 3, Stage 4) - orchestrator.
 *
 * Production and judgment stay separate jobs end to end, exactly as in the
 * Acceptance Testing Department:
 *
 *   Deployment Worker corps : deploys the mechanically derived release scope
 *                             (every base FEATURE/PAGE with a verified -TEST)
 *                             into the department-owned target environment.
 *   Deployment Boss         : independently reconstructs the expected
 *                             production state from the certified baselines
 *                             (§4.2); any delta rejects.
 *   Deployment Auditor      : performs live post-deployment reconciliation of
 *                             a deterministic sample; byte-for-byte or reject.
 *
 * Only after both judgments confirm does the run materialize -DEPLOY lineage
 * artifacts (T.1) and advance the Definition-of-Complete machine: release
 * units to DEPLOYED-VERIFIED. On any failure the department halts honestly -
 * nothing is materialized and no state advances.
 */

import type { CoreServices } from '../core/services.ts';
import { deriveDeployScope } from './scope.ts';
import type { DeployExpectation } from './scope.ts';
import { createDeploymentEnvironment, deployRelease, verifyDeployedUnit } from './deploy.ts';
import type { ExecutedDeploy, CorpsDefects } from './deploy.ts';
import { runDeployBoss } from './boss.ts';
import { runDeployAuditor } from './auditor.ts';
import { materializeDeploymentRun } from './materialize.ts';
import { advanceDocPath } from '../core/doc.ts';

export interface DeployJudgment {
  readonly verdict: 'accepted' | 'rejected' | 'confirmed';
  readonly rationale: string;
}

export interface OperationsDepartmentResult {
  readonly status: 'passed' | 'failed';
  readonly scope: readonly DeployExpectation[];
  readonly executed: readonly ExecutedDeploy[];
  readonly failedUnits: readonly string[];
  readonly boss: DeployJudgment;
  readonly auditor: DeployJudgment;
  readonly manifestId?: string;
  readonly deployIds: readonly string[];
  /** -IMPL artifacts that legitimately reached DoC DEPLOYED-VERIFIED. */
  readonly advancedToDeployedVerified: readonly string[];
  /** Artifacts whose walk stopped before the target gate. */
  readonly docHalts: readonly { id: string; haltedAt: string }[];
  readonly evidenceId?: string;
}

function failure(
  scope: readonly DeployExpectation[],
  executed: readonly ExecutedDeploy[],
  failedUnits: readonly string[],
  boss: DeployJudgment,
  auditorRationale: string,
): OperationsDepartmentResult {
  return {
    status: 'failed',
    scope,
    executed,
    failedUnits,
    boss,
    auditor: { verdict: 'rejected', rationale: auditorRationale },
    deployIds: [],
    advancedToDeployedVerified: [],
    docHalts: [],
  };
}

export async function runOperationsDepartment(
  services: CoreServices,
  projectId: string,
  options: {
    defects?: CorpsDefects;
    sampleSize?: number;
    environmentName?: string;
  } = {},
): Promise<OperationsDepartmentResult> {
  const scope = await deriveDeployScope(services, projectId);

  if (scope.length === 0) {
    return failure(
      [],
      [],
      ['(no verified -TEST artifacts found)'],
      {
        verdict: 'rejected',
        rationale:
          'The certified inventory yields an empty deployment scope - nothing has passed acceptance testing, so nothing may be deployed.',
      },
      'Not run: nothing is scheduled to deploy.',
    );
  }

  const env = createDeploymentEnvironment(options.environmentName ?? 'production');
  await deployRelease(services, scope, env, options.defects ?? {});
  const executed: ExecutedDeploy[] = [];
  for (const exp of scope) {
    executed.push(await verifyDeployedUnit(services, exp, env));
  }
  const failedUnits = executed.filter((d) => !d.passed).map((d) => d.baseId);

  if (failedUnits.length > 0) {
    return failure(
      scope,
      executed,
      failedUnits,
      {
        verdict: 'rejected',
        rationale:
          `The corps reported unfinished deployments: [${failedUnits.join(', ')}]. ` +
          `Nothing reaches DEPLOYED-VERIFIED without complete production evidence.`,
      },
      'Not run: mechanical reconciliation of the release did not pass.',
    );
  }

  const boss = await runDeployBoss(services, projectId, env, executed);
  if (boss.verdict === 'rejected') {
    return failure(scope, executed, [], boss, 'Not run: the Deployment Boss rejected.');
  }

  const sampleSize = options.sampleSize ?? Math.max(1, Math.ceil(executed.length / 2));
  const auditor = await runDeployAuditor(services, env, executed, sampleSize);
  if (auditor.verdict === 'rejected') {
    return failure(scope, executed, [], boss, auditor.rationale);
  }

  const mat = await materializeDeploymentRun(services, executed, {
    projectId,
    environment: env.name,
    bossRationale: boss.rationale,
    auditorRationale: auditor.rationale,
  });

  // Evidence precedes the DoC advancement so every stamped gate is linked to
  // the real deployment record that supports it.
  const evidence = await services.evidence.append({
    kind: 'inspection',
    summary:
      `Production deployment: ${executed.length}/${executed.length} unit(s) live in ${env.name}; ` +
      `boss accepted (${boss.rationale}); auditor reconciled ${auditor.sampledIds.length} sample(s).`,
    artifactIds: [mat.manifestId, ...mat.deployIds],
    producer: { kind: 'verifier', id: 'deploy-boss-01' },
  });

  const advancedToDeployedVerified: string[] = [];
  const docHalts: { id: string; haltedAt: string }[] = [];
  for (const exp of scope) {
    const implId = `${exp.baseId}-IMPL`;
    if ((await services.store.get(implId)) !== null) {
      const walk = await advanceDocPath(services.store, implId, 'DEPLOYED-VERIFIED', { evidenceId: evidence.id });
      if (walk.reachedTarget) advancedToDeployedVerified.push(implId);
      else if (walk.haltedAt !== undefined) docHalts.push({ id: implId, haltedAt: walk.haltedAt });
    }
  }

  return {
    status: 'passed',
    scope,
    executed,
    failedUnits: [],
    boss,
    auditor,
    manifestId: mat.manifestId,
    deployIds: mat.deployIds,
    advancedToDeployedVerified,
    docHalts,
    evidenceId: evidence.id,
  };
}

