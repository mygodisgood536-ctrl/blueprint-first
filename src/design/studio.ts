/**
 * AI Design Studio - Level 1a implementation.
 *
 * Consumes a VERIFIED discovery baseline (never re-discovers), derives the
 * design package deterministically from stored artifacts, enriches each page
 * design with an AI rationale through the router (sha256-anchored evidence,
 * never trusted as structure), materializes lineage artifacts, runs
 * independent specialist verification, and applies the boss decision. The
 * blueprint then sits in VERIFIED state awaiting the approval gate.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { summarizeReport } from '../verification/verifier.ts';
import type { VerificationReport } from '../verification/verifier.ts';
import type { BossDecision } from '../orchestration/worker-boss.ts';
import { assertIndependentVerifier } from '../verification/independence.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';
import { assertVerifiedBaseline, generateDesignPackage } from './generate.ts';
import type { DesignPackageDocs } from './generate.ts';
import { materializeDesignPackage } from './materialize.ts';
import type { DesignMaterializationResult } from './materialize.ts';
import { createDesignSpecialist } from './verify.ts';
import type { DesignDraft } from './check-dimensions.ts';
import { promoteDesignPackage } from './promote.ts';

export const DESIGN_BOSS: Actor = { kind: 'verifier', id: 'design-boss-01' };

export interface DesignRunResult {
  readonly status: 'accepted' | 'rejected' | 'failed';
  readonly blueprintId?: string;
  readonly report?: VerificationReport;
  readonly decision?: BossDecision;
  readonly error?: { code: string; message: string };
  readonly artifactIds: readonly string[];
}

function designIdList(m: DesignMaterializationResult): string[] {
  return [...m.pageDesignIds, ...m.featureDesignIds];
}

export class AiDesignStudio {
  readonly descriptor = {
    name: 'AiDesignStudio',
    targetLevel: '1a',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  async designFromBaseline(baseline: DiscoveryBaseline): Promise<DesignRunResult> {
    const services = this.services;
    const workerActor: Actor = { kind: 'ai', id: 'design-worker-01' };

    try {
      await assertVerifiedBaseline(services, baseline);
      const docs = await generateDesignPackage(services, baseline);

      // --- AI rationales per page through the router (evidence-anchored) ----
      interface RationaleRecord {
        readonly designId: string;
        readonly providerId: string;
        readonly modelId: string;
        readonly content: string;
        readonly sha256: string;
      }
      const rationales: RationaleRecord[] = [];
      for (const doc of docs.pageDesigns) {
        const response = await services.router.complete({
          taskType: 'DESIGN',
          messages: [
            { role: 'system', content: 'You are a design specialist. Provide a concise rationale.' },
            {
              role: 'user',
              content: `Page "${doc.title}" (${doc.pageKey}): purpose=${doc.purpose}; sections=${doc.layout.map((l) => l.contentType).join(',')}; actions=${doc.interactions.length}.`,
            },
          ],
          temperature: 0.3,
        });
        workerActor.modelId = response.modelId;
        rationales.push({
          designId: `${doc.pageArtifactId}-DESIGN`,
          providerId: response.providerId,
          modelId: response.modelId,
          content: response.content,
          sha256: createHash('sha256').update(response.content).digest('hex'),
        });
      }

      // Attach each rationale as a NEW doc object (docs stay immutable) -
      // recorded as labeled commentary, never trusted as structure.
      const rationaleTextByDesignId = new Map(
        rationales.map((r) => [r.designId, r.content.slice(0, 400)] as const),
      );
      const docsForMaterialization: DesignPackageDocs = {
        projectId: docs.projectId,
        pageDesigns: docs.pageDesigns.map((doc) => {
          const rationale = rationaleTextByDesignId.get(`${doc.pageArtifactId}-DESIGN`);
          return rationale === undefined ? doc : { ...doc, aiRationale: rationale };
        }),
        featureDesigns: docs.featureDesigns,
      };

      // Feature designs are fully code-derived; their "rationale" hash anchors
      // the exact deterministic content they were materialized from.
      const rationaleHashes: Record<string, string> = {};
      for (const r of rationales) rationaleHashes[r.designId] = r.sha256;
      for (const fd of docs.featureDesigns) {
        rationaleHashes[`${fd.featureArtifactId}-DESIGN`] = createHash('sha256')
          .update(JSON.stringify(fd))
          .digest('hex');
      }

      // --- materialize + evidence ------------------------------------------
      const materialization = await materializeDesignPackage(services, docsForMaterialization, workerActor);
      for (const r of rationales) {
        await services.evidence.append({
          kind: 'external-response',
          summary: `DESIGN rationale (${r.providerId}/${r.modelId}) sha256=${r.sha256.slice(0, 16)}…`,
          artifactIds: [r.designId],
          payloadRef: `sha256:${r.sha256}`,
          producer: { kind: 'ai', id: r.providerId, modelId: r.modelId },
        });
      }
      // Feature designs are code-derived; their evidence anchors the exact
      // deterministic content they were materialized from.
      for (const fd of docs.featureDesigns) {
        const designId = `${fd.featureArtifactId}-DESIGN`;
        const sha = rationaleHashes[designId];
        if (sha === undefined) continue;
        await services.evidence.append({
          kind: 'inspection',
          summary: `FEATURE-DESIGN derivation (${fd.featureKey}) sha256=${sha.slice(0, 16)}…`,
          artifactIds: [designId],
          payloadRef: `sha256:${sha}`,
          producer: workerActor,
        });
      }

      // --- independent specialist verification + boss decision --------------
      const specialist = createDesignSpecialist(services);
      assertIndependentVerifier(workerActor, specialist.actor);
      const draft: DesignDraft = { baseline, materialization, rationaleHashes };
      const report = await specialist.verifyDraft(draft);
      const summary = summarizeReport(report);
      const decision: BossDecision =
        summary.hasBlockingFailure
          ? { decision: 'rejected', rationale: `Rejected: ${summary.failed} failing finding(s).` }
          : {
              decision: 'accepted',
              rationale: `Accepted: ${summary.passed} findings pass; ${summary.inconclusive} inconclusive deferred to later levels.`,
            };
      await promoteDesignPackage(
        services,
        materialization,
        decision.decision === 'accepted' ? 'VERIFIED' : 'CHANGES_REQUESTED',
        decision.decision === 'accepted' ? DESIGN_BOSS : specialist.actor,
        decision.rationale,
      );
      services.logger?.info('design.run', {
        status: decision.decision,
        blueprintId: materialization.blueprintId,
        designs: designIdList(materialization).length,
      });

      return {
        status: decision.decision,
        blueprintId: materialization.blueprintId,
        report,
        decision,
        artifactIds: [materialization.blueprintId, ...designIdList(materialization)],
      };
    } catch (error) {
      const info =
        error instanceof Error
          ? { code: (error as { code?: string }).code ?? 'UNCAUGHT_ERROR', message: error.message }
          : { code: 'UNCAUGHT_ERROR', message: String(error) };
      services.logger?.warn('design.run.failed', { code: info.code });
      return { status: 'failed', error: info, artifactIds: [] };
    }
  }
}
