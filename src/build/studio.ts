/**
 * AI Build Studio - Level 1a implementation.
 *
 * Consumes an APPROVED blueprint (never a merely verified one), derives the
 * implementation package deterministically from stored design docs and
 * discovery artifacts (components per page/feature; api/entity/integration
 * units from the certified inventory), enriches each page implementation with
 * an AI note through the router (sha256-anchored evidence, never trusted as
 * structure), materializes -IMPL lineage artifacts plus a COMPONENT manifest,
 * runs independent specialist verification, and applies the boss decision.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { Actor, Artifact } from '../core/artifact.ts';
import { summarizeReport } from '../verification/verifier.ts';
import type { VerificationReport } from '../verification/verifier.ts';
import { assertIndependentVerifier } from '../verification/independence.ts';
import type { BossDecision } from '../orchestration/worker-boss.ts';
import type {
  FeatureDesignDoc,
  PageDesignDoc,
} from '../design/types.ts';
import { materializeImplementationPackage } from './materialize.ts';
import type { BuildMaterializationResult } from './materialize.ts';
import { createBuildSpecialist } from './verify.ts';
import type { BuildDraft } from './verify.ts';
import { promoteImplementationPackage } from './promote.ts';
import type { BuildRunResult, ImplementationUnit } from './types.ts';

export const BUILD_WORKER_ID = 'build-worker-01';
export const BUILD_BOSS: Actor = { kind: 'verifier', id: 'build-boss-01' };

/**
 * Real gate: the blueprint must exist, be APPROVED, list only VERIFIED
 * designs, and every design must trace back to a VERIFIED discovery base.
 */
export async function assertBuildableBlueprint(
  services: CoreServices,
  blueprintId: string,
): Promise<Artifact> {
  const blueprint = await services.store.get(blueprintId);
  if (blueprint === null || blueprint.type !== 'BLUEPRINT') {
    throw new Error(`Blueprint ${blueprintId} does not exist.`);
  }
  if (blueprint.status !== 'APPROVED') {
    throw new Error(
      `Blueprint ${blueprintId} is ${blueprint.status}; only APPROVED blueprints may be built.`,
    );
  }
  const listedDesignIds = [
    ...(blueprint.attributes['pageDesignIds'] as readonly string[]),
    ...(blueprint.attributes['featureDesignIds'] as readonly string[]),
  ];
  for (const designId of listedDesignIds) {
    const design = await services.store.get(designId);
    if (design === null) {
      throw new Error(`Listed design ${designId} is missing.`);
    }
    if (design.status !== 'VERIFIED') {
      throw new Error(
        `Listed design ${designId} is ${design.status}; build requires VERIFIED designs.`,
      );
    }
    const baseEdge = services.graph.neighbors(designId, 'downstream', 'DERIVED_FROM')[0];
    if (baseEdge === undefined) {
      throw new Error(`Design ${designId} has no discovery origin edge.`);
    }
    const base = await services.store.get(baseEdge);
    if (base === null || base.status !== 'VERIFIED') {
      throw new Error(`Design ${designId} traces to ${baseEdge} which is not VERIFIED.`);
    }
  }
  return blueprint;
}

export class AiBuildStudio {
  readonly descriptor = {
    name: 'AiBuildStudio',
    targetLevel: '1a',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  async buildFromBlueprint(blueprintId: string): Promise<BuildRunResult> {
    const services = this.services;
    const workerActor: Actor = { kind: 'ai', id: BUILD_WORKER_ID };

    try {
      const blueprint = await assertBuildableBlueprint(services, blueprintId);
      const projectId = blueprint.projectId ?? '';

      // --- read the approved design docs back from the store ----------------
      const pageDesignIds = blueprint.attributes['pageDesignIds'] as readonly string[];
      const featureDesignIds = blueprint.attributes['featureDesignIds'] as readonly string[];
      const pageDesigns: PageDesignDoc[] = [];
      for (const id of pageDesignIds) {
        pageDesigns.push((await services.store.require(id)).attributes['designDoc'] as PageDesignDoc);
      }
      const featureDesigns: FeatureDesignDoc[] = [];
      for (const id of featureDesignIds) {
        featureDesigns.push(
          (await services.store.require(id)).attributes['designDoc'] as FeatureDesignDoc,
        );
      }

      // --- deterministic implementation units --------------------------------
      const units: ImplementationUnit[] = [];
      for (const doc of pageDesigns) {
        units.push({
          kind: 'component',
          fromDesignId: `${doc.pageArtifactId}-DESIGN`,
          title: `Implement page ${doc.title}`,
          description:
            `Route ${doc.navigation.route}; ${doc.layout.length} sections; ` +
            `${doc.interactions.length} interactions; ${doc.stateHandling.length} states.`,
        });
      }
      for (const doc of featureDesigns) {
        units.push({
          kind: 'component',
          fromDesignId: `${doc.featureArtifactId}-DESIGN`,
          title: `Implement feature ${doc.title}`,
          description: `Realizes pages [${doc.pageKeys.join(', ') || 'none'}]; ${doc.description}`,
        });
      }
      // API/entity/integration units come straight from the certified
      // inventory; the typed store filter already yields base artifacts only.
      const apiArtifacts = await services.store.list({ types: ['API'], projectId });
      for (const artifact of apiArtifacts) {
        units.push({
          kind: 'api',
          baseArtifactId: artifact.id,
          title: `Expose ${artifact.title}`,
          description: String(artifact.attributes['purpose'] ?? ''),
        });
      }
      const entityArtifacts = await services.store.list({ types: ['ENTITY'], projectId });
      for (const artifact of entityArtifacts) {
        units.push({
          kind: 'entity',
          baseArtifactId: artifact.id,
          title: `Persist ${artifact.title}`,
          description: 'Entity contract from certified discovery.',
        });
      }
      const integrationArtifacts = await services.store.list({ types: ['INTEGRATION'], projectId });
      for (const artifact of integrationArtifacts) {
        units.push({
          kind: 'integration',
          baseArtifactId: artifact.id,
          title: `Integrate ${artifact.title}`,
          description: String(artifact.attributes['purpose'] ?? ''),
        });
      }

      // --- AI implementation notes per page through the router (evidence) ---
      interface NoteRecord {
        readonly implId: string;
        readonly providerId: string;
        readonly modelId: string;
        readonly content: string;
        readonly sha256: string;
      }
      const notes: NoteRecord[] = [];
      for (const doc of pageDesigns) {
        const response = await services.router.complete({
          taskType: 'BUILD',
          messages: [
            { role: 'system', content: 'You are an implementation worker. Provide a concise note.' },
            {
              role: 'user',
              content:
                `Implement page "${doc.title}" (${doc.pageKey}) at ${doc.navigation.route}: ` +
                `${doc.layout.length} sections, ${doc.interactions.length} interactions, ` +
                `${doc.stateHandling.length} states.`,
            },
          ],
          temperature: 0.3,
        });
        workerActor.modelId = response.modelId;
        notes.push({
          implId: `${doc.pageArtifactId}-IMPL`,
          providerId: response.providerId,
          modelId: response.modelId,
          content: response.content,
          sha256: createHash('sha256').update(response.content).digest('hex'),
        });
      }
      const aiNotes: Record<string, string> = {};
      for (const n of notes) aiNotes[n.implId] = n.content.slice(0, 400);

      // --- materialize + evidence ------------------------------------------
      const materialization: BuildMaterializationResult =
        await materializeImplementationPackage(
          services,
          { blueprintId, projectId, pageDesigns, featureDesigns, units, aiNotes },
          workerActor,
        );
      for (const n of notes) {
        await services.evidence.append({
          kind: 'external-response',
          summary: `BUILD implementation note (${n.providerId}/${n.modelId}) sha256=${n.sha256.slice(0, 16)}…`,
          artifactIds: [n.implId],
          payloadRef: `sha256:${n.sha256}`,
          producer: { kind: 'ai', id: n.providerId, modelId: n.modelId },
        });
      }

      // --- independent specialist verification + boss decision --------------
      const specialist = createBuildSpecialist(services);
      assertIndependentVerifier(workerActor, specialist.actor);
      assertIndependentVerifier(workerActor, BUILD_BOSS);
      const draft: BuildDraft = {
        projectId,
        approvedDesignIds: [...pageDesignIds, ...featureDesignIds],
        materialization,
        noteHashes: Object.fromEntries(notes.map((n) => [n.implId, n.sha256])),
        expectedPageCount: pageDesigns.length,
        expectedFeatureCount: featureDesigns.length,
      };
      const report: VerificationReport = await specialist.verifyDraft(draft);
      const summary = summarizeReport(report);
      const decision: BossDecision =
        summary.hasBlockingFailure
          ? { decision: 'rejected', rationale: `Rejected: ${summary.failed} failing finding(s).` }
          : {
              decision: 'accepted',
              rationale: `Accepted: ${summary.passed} findings pass; ${summary.inconclusive} inconclusive deferred to later levels.`,
            };
      await promoteImplementationPackage(
        services,
        materialization,
        decision.decision === 'accepted' ? 'VERIFIED' : 'CHANGES_REQUESTED',
        decision.decision === 'accepted' ? BUILD_BOSS : specialist.actor,
        decision.rationale,
      );
      services.logger?.info('build.run', {
        status: decision.decision,
        manifestId: materialization.manifestId,
        implementations: implCount(materialization),
        units: units.length,
      });

      return {
        status: decision.decision,
        manifestId: materialization.manifestId,
        report,
        artifactIds: [...materialization.allArtifactIds],
      };
    } catch (error) {
      const info =
        error instanceof Error
          ? { code: (error as { code?: string }).code ?? 'UNCAUGHT_ERROR', message: error.message }
          : { code: 'UNCAUGHT_ERROR', message: String(error) };
      services.logger?.warn('build.run.failed', { code: info.code });
      return { status: 'failed', error: info, artifactIds: [] };
    }
  }
}

function implCount(m: BuildMaterializationResult): number {
  return m.pageImplIds.length + m.featureImplIds.length;
}