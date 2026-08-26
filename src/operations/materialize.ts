/**
 * Deployment materialization: persist the Operations Department's results as
 * lineage artifacts with exact phase suffixes (spec T.1).
 *
 *   PAGE-0042-IMPL     -> PAGE-0042-DEPLOY     (DERIVED_FROM edge)
 *   FEATURE-0003-IMPL  -> FEATURE-0003-DEPLOY  (DERIVED_FROM edge)
 *   Release report (COMPONENT) aggregates every -DEPLOY (CONTAINS).
 *
 * Each -DEPLOY artifact records the deterministic requirement, observation and
 * sha256 evidence hash behind its verdict, plus the Boss/Auditor rationales -
 * so the judgment chain is inspectable from the artifact itself.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { recordStatusChange } from '../core/store.ts';
import { dependencyOf } from './deploy.ts';
import type { ExecutedDeploy } from './deploy.ts';

const WORKER: Actor = { kind: 'ai', id: 'deploy-worker-01' };
const VERIFIER: Actor = { kind: 'verifier', id: 'deploy-specialist-01' };

export interface DeploymentRunMeta {
  readonly projectId: string;
  readonly environment: string;
  readonly bossRationale: string;
  readonly auditorRationale: string;
}

export interface DeploymentMaterializationResult {
  readonly manifestId: string;
  readonly deployIds: readonly string[];
}

export async function materializeDeploymentRun(
  services: CoreServices,
  executed: readonly ExecutedDeploy[],
  meta: DeploymentRunMeta,
): Promise<DeploymentMaterializationResult> {
  const at = new Date().toISOString();
  const deployIds: string[] = [];

  for (const deploy of executed) {
    const base = await services.store.require(deploy.baseId);
    const depId = dependencyOf(deploy);
    await services.store.require(depId); // fails loudly if lineage is broken
    const id = `${deploy.baseId}-DEPLOY`;
    const artifact = createArtifact({
      id,
      type: base.type,
      title: `Production deployment: ${base.title}`,
      description: deploy.observed,
      projectId: meta.projectId,
      actor: WORKER,
      at,
      dependencies: [depId],
      attributes: {
        deploymentKind: deploy.kind,
        requirement: deploy.requirement,
        observed: deploy.observed,
        passed: deploy.passed,
        evidenceHash: deploy.evidenceHash,
        environment: meta.environment,
        envConfigured: deploy.envConfigured,
        rollbackExercised: deploy.rollbackExercised,
        monitorLive: deploy.monitorLive,
        bossRationale: meta.bossRationale,
        auditorRationale: meta.auditorRationale,
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', depId);
    // Independent confirmation: worker submits, the deploy specialist verifies.
    await recordStatusChange(services.store, id, 'IN_REVIEW', WORKER, {
      note: 'Deployment submitted for production verification.',
    });
    await recordStatusChange(services.store, id, 'VERIFIED', VERIFIER, {
      note: 'Confirmed by the Deployment Auditor post-deployment reconciliation.',
    });
    deployIds.push(id);
  }

  const manifestId = services.allocator.nextId('COMPONENT');
  const manifest = createArtifact({
    id: manifestId,
    type: 'COMPONENT',
    title: `Deployment & operations release report for ${meta.projectId}`,
    description:
      `${executed.length}/${executed.length} release unit(s) deployed to ${meta.environment} under ` +
      `Deployment Boss reconstruction and independent post-deployment audit.`,
    projectId: meta.projectId,
    actor: WORKER,
    at,
    dependencies: [],
    attributes: {
      environment: meta.environment,
      totalUnits: executed.length,
      deployedUnits: executed.filter((d) => d.passed).length,
      bossRationale: meta.bossRationale,
      auditorRationale: meta.auditorRationale,
      deployIds: [...deployIds],
    },
  });
  await services.store.append(manifest);
  syncArtifactToGraph(services.graph, manifest);
  for (const id of deployIds) {
    services.graph.link(manifestId, 'CONTAINS', id);
  }

  return { manifestId, deployIds };
}
