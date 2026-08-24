/**
 * Single-pass Product Discovery Engine - the Level 1a implementation.
 *
 * Pipeline (all steps real, all failures explicit):
 *   brief validation -> AI router call (DISCOVERY) -> JSON extraction ->
 *   structural parsing -> semantic normalization -> deterministic
 *   materialization -> evidence anchor -> independent specialist verification
 *   -> boss decision -> status promotion.
 *
 * Rejected baselines are never silently deleted: they remain in the store
 * marked CHANGES_REQUESTED with the boss rationale in provenance.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { assertIndependentVerifier } from '../verification/independence.ts';
import { summarizeReport } from '../verification/verifier.ts';
import type { VerificationReport } from '../verification/verifier.ts';
import type { BossDecision } from '../orchestration/worker-boss.ts';
import { validateBrief } from './brief.ts';
import type { ProductUnderstandingBrief } from './types.ts';
import { parseDiscoveryResult } from './parse.ts';
import { normalizeDiscovery } from './normalize.ts';
import type { NormalizedInventory } from './normalize.ts';
import { planDiscoveryMaterialization } from './materialize-plan.ts';
import { executeMaterializationPlan } from './materialize.ts';
import type { DiscoveryBaseline } from './materialize.ts';
import { createDiscoverySpecialist } from './verify.ts';
import { artifactIdsOf, promoteBaseline } from './baseline-utils.ts';
import { extractJson, renderBrief } from './prompt.ts';

export const DISCOVERY_WORKER_ID = 'discovery-worker-01';
export const DISCOVERY_BOSS: Actor = { kind: 'verifier', id: 'discovery-boss-01' };

export interface DiscoveryRunResult {
  readonly status: 'accepted' | 'rejected' | 'failed';
  readonly baseline?: DiscoveryBaseline;
  readonly inventory?: NormalizedInventory;
  readonly report?: VerificationReport;
  readonly decision?: BossDecision;
  readonly error?: { code: string; message: string };
  readonly evidenceId?: string;
  readonly artifactIds: readonly string[];
}

export class SinglePassDiscoveryEngine {
  readonly descriptor = {
    name: 'ProductDiscoveryEngine',
    targetLevel: '1a',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  async discover(brief: ProductUnderstandingBrief): Promise<DiscoveryRunResult> {
    const services = this.services;
    validateBrief(brief);

    const workerActor: Actor = { kind: 'ai', id: DISCOVERY_WORKER_ID };
    const specialist = createDiscoverySpecialist(services);
    assertIndependentVerifier(workerActor, specialist.actor);
    assertIndependentVerifier(workerActor, DISCOVERY_BOSS);

    try {
      // --- AI call through the router --------------------------------------
      const response = await services.router.complete({
        taskType: 'DISCOVERY',
        messages: [
          {
            role: 'system',
            content:
              'You are a single-pass product discovery worker. Reply with ONLY a JSON object matching the agreed discovery schema.',
          },
          { role: 'user', content: renderBrief(brief) },
        ],
        temperature: 0.2,
      });
      workerActor.modelId = response.modelId;

      // --- parse + normalize (never trust raw output) -----------------------
      const parsed = parseDiscoveryResult(extractJson(response.content));
      const inventory = normalizeDiscovery(parsed);
      const responseSha256 = createHash('sha256').update(response.content).digest('hex');

      // --- materialize -------------------------------------------------------
      const baseline = await executeMaterializationPlan(
        services,
        planDiscoveryMaterialization(inventory, workerActor),
        workerActor,
      );

      const evidence = await services.evidence.append({
        kind: 'external-response',
        summary: `DISCOVERY response (${response.providerId}/${response.modelId}), sha256=${responseSha256.slice(0, 16)}…`,
        artifactIds: [baseline.projectId],
        payloadRef: `sha256:${responseSha256}`,
        producer: { kind: 'ai', id: response.providerId, modelId: response.modelId },
      });

      // --- independent verification + boss decision --------------------------
      const report = await specialist.verifyDraft({ inventory, baseline, responseSha256 });
      const summary = summarizeReport(report);
      const decision: BossDecision =
        summary.hasBlockingFailure
          ? { decision: 'rejected', rationale: `Rejected: ${summary.failed} failing finding(s).` }
          : {
              decision: 'accepted',
              rationale: `Accepted: ${summary.passed} findings pass; ${summary.inconclusive} inconclusive reserved for later-level engines.`,
            };

      await promoteBaseline(
        services,
        artifactIdsOf(baseline),
        decision.decision === 'accepted' ? 'VERIFIED' : 'CHANGES_REQUESTED',
        decision.decision === 'accepted' ? DISCOVERY_BOSS : specialist.actor,
        decision.rationale,
      );
      services.logger?.info('discovery.run', {
        status: decision.decision,
        artifacts: baseline.totalArtifacts,
        projectId: baseline.projectId,
        modelId: response.modelId,
      });
      return {
        status: decision.decision,
        baseline,
        inventory,
        report,
        decision,
        evidenceId: evidence.id,
        artifactIds: artifactIdsOf(baseline),
      };
    } catch (error) {
      const info =
        error instanceof Error
          ? { code: (error as { code?: string }).code ?? 'UNCAUGHT_ERROR', message: error.message }
          : { code: 'UNCAUGHT_ERROR', message: String(error) };
      services.logger?.warn('discovery.run.failed', { code: info.code });
      return { status: 'failed', error: info, artifactIds: [] };
    }
  }
}

