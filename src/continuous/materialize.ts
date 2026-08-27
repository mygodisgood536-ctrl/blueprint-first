/**
 * Continuous Engineering materialization: persist the Continuous Department's
 * results as lineage artifacts with exact phase suffixes (spec T.1 + §5).
 *
 *   PAGE-0042-DEPLOY    -> PAGE-0042-OPS       (DERIVED_FROM edge)
 *   FEATURE-0003-DEPLOY -> FEATURE-0003-OPS    (DERIVED_FROM edge)
 *   Continuous Living Blueprint manifest (COMPONENT) aggregates every -OPS
 *   (CONTAINS). When zero drift remains, the manifest is also the final
 *   PERM-anchored record of the Permanent Engineering Organization.
 *
 * Each -OPS artifact records the worker's observation, the Boss's
 * reconstruction rationale, and the Auditor's confirmation - so the judgment
 * chain is inspectable from the artifact itself.
 */
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import { recordStatusChange } from '../core/store.ts';
import type { ContinuousObservation } from './worker.ts';

const WORKER: Actor = { kind: 'ai', id: 'continuous-worker-01' };
const VERIFIER: Actor = { kind: 'verifier', id: 'continuous-boss-01' };

export interface ContinuousRunMeta {
  readonly projectId: string;
  readonly observedAt: string;
  readonly bossRationale: string;
  readonly auditorRationale: string;
  readonly stableCount: number;
  readonly regressedCount: number;
  readonly degradedCount: number;
  readonly resolvedCount: number;
  readonly reportHash: string;
}

export interface ContinuousMaterializationResult {
  readonly manifestId: string;
  readonly opsIds: readonly string[];
}

export async function materializeContinuousRun(
  services: CoreServices,
  observations: readonly ContinuousObservation[],
  meta: ContinuousRunMeta,
): Promise<ContinuousMaterializationResult> {
  const at = meta.observedAt;
  const opsIds: string[] = [];

  for (const obs of observations) {
    const deployId = `${obs.baseId}-DEPLOY`;
    const dep = await services.store.get(deployId);
    if (dep === null) continue; // no deploy artifact -> no OPS lineage
    const base = await services.store.require(obs.baseId);
    const id = `${obs.baseId}-OPS`;
    const artifact = createArtifact({
      id,
      type: base.type,
      title: `Continuous monitoring record: ${base.title}`,
      description: obs.driftKind,
      projectId: meta.projectId,
      actor: WORKER,
      at,
      dependencies: [deployId],
      attributes: {
        monitoringKind: obs.driftKind,
        requirement: 'live artifact matches the certified baseline',
        observed: obs.liveVerdict,
        passed: obs.stable,
        evidenceHash: obs.evidenceHash,
        observedAt: meta.observedAt,
        priorVerdict: obs.priorVerdict,
        bossRationale: meta.bossRationale,
        auditorRationale: meta.auditorRationale,
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', deployId);
    // Worker submits, Boss verifies - never the same actor for both.
    await recordStatusChange(services.store, id, 'IN_REVIEW', WORKER, {
      note: 'Continuous monitoring observation submitted for verification.',
    });
    await recordStatusChange(services.store, id, 'VERIFIED', VERIFIER, {
      note: 'Confirmed by the Continuous Engineering Boss reconstruction.',
    });
    opsIds.push(id);
  }

  // Build the Living Blueprint manifest (COMPONENT-level PERM anchor). The
  // manifest is its own lineage artifact: a fresh COMPONENT base id stamped
  // with the terminal -PERM phase suffix, aggregated by CONTAINS over every
  // -OPS record produced by this run.
  const manifestId = services.allocator.nextIdWithPhase('COMPONENT', 'PERM');
  const manifest = createArtifact({
    id: manifestId,
    type: 'COMPONENT',
    title: `Continuous Engineering Department — Permanent Operation Manifest for ${meta.projectId}`,
    description:
      `Living Blueprint snapshot at ${meta.observedAt}. ` +
      `Stable: ${meta.stableCount} | Regressed: ${meta.regressedCount} | ` +
      `Degraded: ${meta.degradedCount} | Resolved: ${meta.resolvedCount}. ` +
      `Boss: ${meta.bossRationale}. Auditor: ${meta.auditorRationale}.`,
    projectId: meta.projectId,
    actor: { kind: 'ai', id: 'continuous-engineering-boss-01' },
    at,
    dependencies: opsIds,
    attributes: {
      monitoringRun: meta.reportHash,
      stableCount: meta.stableCount,
      regressedCount: meta.regressedCount,
      degradedCount: meta.degradedCount,
      resolvedCount: meta.resolvedCount,
      observedAt: meta.observedAt,
      bossRationale: meta.bossRationale,
      auditorRationale: meta.auditorRationale,
    },
  });
  await services.store.append(manifest);
  syncArtifactToGraph(services.graph, manifest);
  for (const opsId of opsIds) {
    services.graph.link(manifestId, 'CONTAINS', opsId);
  }
  // Worker submits, Boss verifies - never the same actor for both.
  await recordStatusChange(services.store, manifestId, 'IN_REVIEW', WORKER, {
    note: 'Permanent Operation Manifest submitted for verification.',
  });
  await recordStatusChange(services.store, manifestId, 'VERIFIED', VERIFIER, {
    note: 'Continuous Engineering Boss certified this manifest as the current Living Blueprint state.',
  });

  return { manifestId, opsIds };
}
