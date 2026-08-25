/**
 * Discovery Department - Level 1b implementation (Minimum Viable Discovery
 * Department).
 *
 * Organization per spec §0.1–0.4 and the architecture roadmap's Level-1b line:
 *
 *   Cluster A  Understanding Worker        brief -> product understanding
 *     -> self-verification (§0.14, non-certifying)
 *     -> Understanding Specialist Verifier (one per cluster)
 *   Cluster B  Structural Worker           certified understanding + brief
 *                                          -> full structural inventory
 *     -> self-verification
 *     -> Structural Specialist Verifier
 *   Discovery Boss                         brief ONLY -> independent
 *                                          reconstruction of core types
 *                                          (pages, features, workflows)
 *     -> artifact-level diff -> FINDING-n deltas -> accept/reject gate
 *   Promotion                              VERIFIED | CHANGES_REQUESTED,
 *                                          confidence scored (§0.13)
 *
 * Independence is enforced BEFORE any work runs. The boss's reconstruction
 * call receives the brief and platform knowledge only - never worker output -
 * which is structurally guaranteed by what this engine passes into it.
 */

import { createHash } from 'node:crypto';
import type { CoreServices } from '../../core/services.ts';
import type { Actor } from '../../core/artifact.ts';
import type { ArtifactType } from '../../core/ids.ts';
import { assertIndependentVerifier } from '../../verification/independence.ts';
import type { VerificationReport } from '../../verification/verifier.ts';
import type { BossDecision } from '../../orchestration/worker-boss.ts';
import { validateBrief } from '../brief.ts';
import type { ProductUnderstandingBrief } from '../types.ts';
import { extractJson, renderBrief } from '../prompt.ts';
import {
  normalizeDepartmentInventory,
  parseUnderstanding,
  validateSelfCheck,
} from './parse.ts';
import type { NormalizedInventory } from '../normalize.ts';
import { artifactIdsOf, promoteBaseline } from '../baseline-utils.ts';
import { planDiscoveryMaterialization } from '../materialize-plan.ts';
import { executeMaterializationPlan } from '../materialize.ts';
import type { DiscoveryBaseline } from '../materialize.ts';
import { createUnderstandingSpecialist } from './specialists.ts';
import { createStructuralSpecialist } from './specialists.ts';
import { scoreConfidence } from './confidence.ts';
import {
  BOSS_MARKER,
  createBossFindings,
  diffReconstruction,
  parseBossExpectation,
  renderBossPrompt,
} from './boss.ts';
import type {
  DepartmentRunResult,
  RawStructuralResult,
  RawUnderstandingResult,
  ReconstructionDiffRecord,
} from './types.ts';

export const UNDERSTANDING_WORKER_ID = 'understanding-worker-01';
export const STRUCTURAL_WORKER_ID = 'structural-worker-01';
export const UNDERSTANDING_SPECIALIST_ID = 'understanding-specialist-01';
export const STRUCTURAL_SPECIALIST_ID = 'structural-specialist-01';
export const DISCOVERY_BOSS_ID = 'discovery-boss-01';

const UNDERSTANDING_WORKER: Actor = { kind: 'ai', id: UNDERSTANDING_WORKER_ID };
const STRUCTURAL_WORKER: Actor = { kind: 'ai', id: STRUCTURAL_WORKER_ID };
const DISCOVERY_BOSS: Actor = { kind: 'verifier', id: DISCOVERY_BOSS_ID };

/** Markers embedded in each call so providers can route deterministically. */
export const UNDERSTANDING_MARKER = '[DISCOVERY:CLUSTER-A]';
export const STRUCTURAL_MARKER = '[DISCOVERY:CLUSTER-B]';

/** spec §0.13 discovered_by labels for the Level-1b corps. */
const DISCOVERED_BY: Readonly<Partial<Record<ArtifactType, string>>> = {
  PROJECT: 'DW-A1 Product Understanding Worker',
  MODULE: 'DW-B2 Module Discovery Worker',
  FEATURE: 'DW-B3 Feature Discovery Worker',
  WORKFLOW: 'DW-B4 Workflow Discovery Worker',
  PAGE: 'DW-B5 Page Discovery Worker',
};

function discoveredByFor(type: ArtifactType): string {
  return (
    DISCOVERED_BY[type] ??
    'DW-B consolidated structural worker (Level-1b minimum viable corps)'
  );
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function blockingReasons(report: VerificationReport): string[] {
  return report.findings
    .filter((f) => f.verdict === 'fail')
    .map((f) => `${f.dimension}: ${f.detail}`);
}

export class DiscoveryDepartment {
  readonly descriptor = {
    name: 'DiscoveryDepartment',
    targetLevel: '1b',
    status: 'implemented' as const,
  };

  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  async discover(brief: ProductUnderstandingBrief): Promise<DepartmentRunResult> {
    const services = this.services;
    validateBrief(brief);

    // Fail fast on independence violations before ANY work runs.
    assertIndependentVerifier(UNDERSTANDING_WORKER, { kind: 'verifier', id: UNDERSTANDING_SPECIALIST_ID });
    assertIndependentVerifier(STRUCTURAL_WORKER, { kind: 'verifier', id: STRUCTURAL_SPECIALIST_ID });
    assertIndependentVerifier(UNDERSTANDING_WORKER, DISCOVERY_BOSS);
    assertIndependentVerifier(STRUCTURAL_WORKER, DISCOVERY_BOSS);

    try {
      // --- CLUSTER A: Understanding ---------------------------------------
      const responseA = await services.router.complete({
        taskType: 'DISCOVERY',
        messages: [
          {
            role: 'system',
            content:
              `${UNDERSTANDING_MARKER} You are the Cluster A Understanding Worker ` +
              '(DW-A1). State what the user is asking to build, in the user\'s own ' +
              'terms, plus a short domain profile. Do NOT enumerate modules, ' +
              'features, pages or any other structure - that is Cluster B\'s job. ' +
              'Surface uncertainties via selfCheck.uncertainties instead of guessing.',
          },
          { role: 'user', content: renderBrief(brief) },
        ],
        temperature: 0.2,
      });
      UNDERSTANDING_WORKER.modelId = responseA.modelId;
      const shaA = sha256(responseA.content);
      const understanding: RawUnderstandingResult = parseUnderstanding(
        extractJson(responseA.content),
      );
      const uncertaintiesA = understanding.selfCheck?.uncertainties ?? [];

      const understandingSpecialist = createUnderstandingSpecialist(services);
      const understandingReport = await understandingSpecialist.verifyDraft({
        brief,
        understanding,
        responseSha256: shaA,
      });
      const understandingFailures = blockingReasons(understandingReport);
      if (understandingFailures.length > 0) {
        services.logger?.warn('discovery.department.failed', { stage: 'understanding' });
        return {
          status: 'failed',
          error: {
            code: 'UNDERSTANDING_REJECTED',
            message: `Cluster A understanding rejected by its specialist: ${understandingFailures.join(' | ')}`,
          },
          artifactIds: [],
        };
      }


      // --- CLUSTER B: Structural -------------------------------------------
      // Input: the brief PLUS Cluster A's specialist-cleared understanding -
      // a certified upstream baseline, which is authoritative input per the
      // §0.15 general principle (never a same-stage worker conclusion).
      const responseB = await services.router.complete({
        taskType: 'DISCOVERY',
        messages: [
          {
            role: 'system',
            content:
              `${STRUCTURAL_MARKER} You are the Cluster B Structural Worker. ` +
              'Enumerate what the product is made of: modules, features, ' +
              'workflows, pages (with sections/actions/states/validations), ' +
              'rules, permissions, entities, apis, integrations. Use slug keys; ' +
              'reference existing modules/entities/actions only. Surface ' +
              'uncertainties via selfCheck.uncertainties instead of guessing.',
          },
          {
            role: 'user',
            content:
              `${renderBrief(brief)}\n\nCertified product understanding ` +
              `(upstream baseline):\n${JSON.stringify({
                product: understanding.product,
                domainProfile: understanding.domainProfile ?? '',
              })}`,
          },
        ],
        temperature: 0.2,
      });
      STRUCTURAL_WORKER.modelId = responseB.modelId;
      const shaB = sha256(responseB.content);
      let structuralValue: Record<string, unknown>;
      try {
        // JSON extraction + schema validation are part of the B-side contract:
        // every enumerated collection and cross-reference lives on this side.
        structuralValue = extractJson(responseB.content) as Record<string, unknown>;
      } catch (error) {
        const info = error as { code?: string; message?: string };
        services.logger?.warn('discovery.department.failed', { stage: 'structural' });
        return {
          status: 'failed',
          error: {
            code: info.code ?? 'DISCOVERY_PARSE_FAILED',
            message: `Cluster B inventory rejected: ${info.message ?? String(error)}`,
          },
          artifactIds: [],
        };
      }
      const structuralProblems: string[] = [];
      validateSelfCheck(structuralValue, structuralProblems);
      if (structuralProblems.length > 0) {
        services.logger?.warn('discovery.department.failed', { stage: 'structural-selfcheck' });
        return {
          status: 'failed',
          error: { code: 'DISCOVERY_PARSE_FAILED', message: structuralProblems.join(' | ') },
          artifactIds: [],
        };
      }
      const structural = structuralValue as unknown as RawStructuralResult;
      const uncertaintiesB = structural.selfCheck?.uncertainties ?? [];

      let inventory: NormalizedInventory;
      try {
        inventory = normalizeDepartmentInventory(understanding, structural);
      } catch (error) {
        // Every enumerated collection and cross-reference lives on the B side,
        // so parse/normalization failures are attributed to Cluster B.
        const info = error as { code?: string; message?: string };
        services.logger?.warn('discovery.department.failed', { stage: 'structural' });
        return {
          status: 'failed',
          error: {
            code: info.code ?? 'DISCOVERY_VALIDATION_FAILED',
            message: `Cluster B inventory rejected: ${info.message ?? String(error)}`,
          },
          artifactIds: [],
        };
      }

      const structuralSpecialist = createStructuralSpecialist(services);
      const structuralReport = await structuralSpecialist.verifyDraft({
        inventory,
        responseSha256: shaB,
      });
      const structuralFailures = blockingReasons(structuralReport);
      if (structuralFailures.length > 0) {
        services.logger?.warn('discovery.department.failed', { stage: 'structural-specialist' });
        return {
          status: 'failed',
          error: {
            code: 'STRUCTURAL_REJECTED',
            message: `Cluster B inventory rejected by its specialist: ${structuralFailures.join(' | ')}`,
          },
          artifactIds: [],
        };
      }


      // --- MATERIALIZATION --------------------------------------------------
      // The combined inventory carries the product from Cluster A; the plan
      // and executor are the exact Level-1a machinery (no duplication).
      const baseline: DiscoveryBaseline = await executeMaterializationPlan(
        services,
        planDiscoveryMaterialization(inventory, STRUCTURAL_WORKER),
        STRUCTURAL_WORKER,
      );
      const projectId = baseline.projectId;

      // Full artifact list INCLUDING trivial leaves (states/validations),
      // parents before children, so confidence inheritance works downstream.
      const coreIds = artifactIdsOf(baseline);
      const leafIds = baseline.pages.flatMap((page) =>
        services.graph.neighbors(page.artifactId, 'downstream', 'CONTAINS'),
      );
      const allIds = [...new Set([...coreIds, ...leafIds])];

      // --- DISCOVERY BOSS: independent reconstruction ------------------------
      // The call receives the brief and platform knowledge ONLY.
      const responseBoss = await services.router.complete({
        taskType: 'REVIEW',
        messages: [
          {
            role: 'system',
            content:
              'You are the Discovery Boss. Your judgment is independent of the ' +
              'worker corps by construction: this conversation contains no ' +
              'worker output and must never receive any.',
          },
          { role: 'user', content: renderBossPrompt(brief) },
        ],
        temperature: 0.2,
      });
      const shaBoss = sha256(responseBoss.content);
      const expectation = parseBossExpectation(extractJson(responseBoss.content));
      const diff: ReconstructionDiffRecord = diffReconstruction(expectation, inventory);
      const findingIds = await createBossFindings(services, diff, projectId, DISCOVERY_BOSS);

      let bossDecision: BossDecision;
      if (expectation.productName.trim() !== brief.name.trim()) {
        bossDecision = {
          decision: 'rejected',
          rationale:
            `Rejected: boss expectation is inconsistent with the brief product name ` +
            `"${brief.name.trim()}" (got "${expectation.productName.trim()}").`,
        };
      } else if (diff.deltas.length > 0) {
        const summary = diff.deltas
          .map((d) =>
            `${d.kind} ${d.coreType} ${d.kind === 'missing' ? d.bossKey : d.workerKey}`,
          )
          .join('; ');
        bossDecision = {
          decision: 'rejected',
          rationale: `Rejected: ${diff.deltas.length} reconstruction delta(s) - ${summary}. Findings: ${findingIds.join(', ') || 'none'}.`,
        };
      } else {
        bossDecision = {
          decision: 'accepted',
          rationale: `Accepted: independent reconstruction matched the worker inventory across pages, features and workflows (${Object.keys(diff.matches).length} correlations, 0 deltas).`,
        };
      }

      // --- CONFIDENCE STAMPING (§0.13) --------------------------------------
      // Parents first (allIds order), leaves inherit their parent's score.
      const confidenceById = new Map<string, number>();
      for (const id of allIds) {
        const artifact = await services.store.require(id);
        const parentConfidence =
          artifact.type === 'STATE' || artifact.type === 'VALIDATION'
            ? confidenceById.get(artifact.dependencies[0] ?? '')
            : undefined;
        const confidence = scoreConfidence({
          hasDescription: artifact.description.trim().length > 0,
          referenceCount: services.graph.neighbors(id, 'upstream').length,
          crossReferencesResolved: true,
          specialistPassed: true,
          ...(parentConfidence !== undefined ? { parentConfidence } : {}),
        });
        confidenceById.set(id, confidence);
        await services.store.update(artifact.id, artifact.version, (draft) => ({
          ...draft,
          confidence,
          attributes: {
            ...draft.attributes,
            discoveredBy: discoveredByFor(artifact.type),
          },
        }));
      }


      // --- PROMOTION ---------------------------------------------------------
      const target = bossDecision.decision === 'accepted' ? 'VERIFIED' : 'CHANGES_REQUESTED';
      await promoteBaseline(services, allIds, target, DISCOVERY_BOSS, bossDecision.rationale);

      // --- EVIDENCE (post-decision, anchored to the project) -----------------
      const evidenceAppends: Promise<unknown>[] = [
        services.evidence.append({
          kind: 'external-response',
          summary: `CLUSTER-A understanding (${responseA.providerId}/${responseA.modelId}) sha256=${shaA.slice(0, 16)}…`,
          artifactIds: [projectId],
          payloadRef: `sha256:${shaA}`,
          producer: { kind: 'ai', id: responseA.providerId, modelId: responseA.modelId },
        }),
        services.evidence.append({
          kind: 'external-response',
          summary: `CLUSTER-B structural (${responseB.providerId}/${responseB.modelId}) sha256=${shaB.slice(0, 16)}…`,
          artifactIds: [projectId],
          payloadRef: `sha256:${shaB}`,
          producer: { kind: 'ai', id: responseB.providerId, modelId: responseB.modelId },
        }),
        services.evidence.append({
          kind: 'external-response',
          summary: `BOSS reconstruction (${responseBoss.providerId}/${responseBoss.modelId}) sha256=${shaBoss.slice(0, 16)}…`,
          artifactIds: [projectId],
          payloadRef: `sha256:${shaBoss}`,
          producer: { kind: 'ai', id: responseBoss.providerId, modelId: responseBoss.modelId },
        }),
        services.evidence.append({
          kind: 'inspection',
          summary: `§0.14 self-check: Cluster A surfaced ${uncertaintiesA.length} uncertainty(ies).`,
          artifactIds: [projectId],
          producer: UNDERSTANDING_WORKER,
        }),
        services.evidence.append({
          kind: 'inspection',
          summary: `§0.14 self-check: Cluster B surfaced ${uncertaintiesB.length} uncertainty(ies).`,
          artifactIds: [projectId],
          producer: STRUCTURAL_WORKER,
        }),
        services.evidence.append({
          kind: 'inspection',
          summary:
            `Reconstruction diff record: ${diff.deltas.length} delta(s) across ` +
            `pages/features/workflows; correlations: ${Object.keys(diff.matches).length}; ` +
            `findings: ${findingIds.join(', ') || 'none'}.`,
          artifactIds: [projectId],
          payloadRef: `sha256:${shaBoss}`,
          producer: DISCOVERY_BOSS,
        }),
      ];
      await Promise.all(evidenceAppends);

      services.logger?.info('discovery.department.run', {
        status: bossDecision.decision,
        artifacts: baseline.totalArtifacts,
        projectId,
        deltas: diff.deltas.length,
        findings: findingIds.length,
      });

      return {
        status: bossDecision.decision === 'accepted' ? 'accepted' : 'rejected',
        baseline,
        inventory,
        understandingReport,
        structuralReport,
        bossDecision,
        diff,
        findingIds,
        uncertainties: { understanding: uncertaintiesA, structural: uncertaintiesB },
        artifactIds: [...allIds],
      };
    } catch (error) {
      const info =
        error instanceof Error
          ? { code: (error as { code?: string }).code ?? 'UNCAUGHT_ERROR', message: error.message }
          : { code: 'UNCAUGHT_ERROR', message: String(error) };
      services.logger?.warn('discovery.department.failed', { code: info.code });
      return { status: 'failed', error: info, artifactIds: [] };
    }
  }
}
