/**
 * Blueprint Completeness Certification & Blueprint Confidence (Level 2,
 * spec §0.23).
 *
 * Certification is a FORMAL EVENT with mechanical preconditions - it is never
 * "the boss said so":
 *   0. the foundation gate (certificationDecision) passes on the master run;
 *   1. the blueprint is APPROVED and the approval gate still re-derives clean
 *      from stored state;
 *   2. the Master Verification Engine passed the whole blueprint set with no
 *      blocking fails and full class coverage;
 *   3. the Reasoning Council endorsed the blueprint with zero objections;
 *   4. the Requirements Traceability matrix is complete - no missing links,
 *      no orphaned artifacts, no unsupported transitions, evidence-backed rows;
 *   5. every inventory artifact sits at least at BOSS-VERIFIED on the §0.17
 *      Definition-of-Complete machine;
 *   6. no open contradictions are registered (the Contradiction Engine itself
 *      is later-level scope; its absence means an empty register, not a fake one).
 *
 * On success the engine stamps CERTIFIED across the closure via governed DoC
 * gates, anchors a review evidence record, and stores the per-dimension
 * Blueprint Confidence on the blueprint. Confidence is EXPLAINABLE and always
 * reported separately from the boolean certification.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';
import { docStateOf, inferDocState, docIndexOf, recordDocGate } from '../core/doc.ts';
import { DOC_STATES } from '../core/doc.ts';
import { certificationDecision } from '../verification/independence.ts';
import type { MasterVerificationResult } from '../verification/master-engine.ts';
import type { CouncilDeliberation } from '../council/council.ts';
import type { RequirementsTraceabilityMatrix } from '../traceability/trace.ts';

export const CERTIFIER_ACTOR: Actor = {
  kind: 'system',
  id: 'blueprint-completeness-certification',
};

// ---------------------------------------------------------------------------
// Blueprint Confidence (§0.23): per-dimension, evidence-backed, explainable.
// ---------------------------------------------------------------------------

export interface ConfidenceDimension {
  readonly id: string;
  /** null when the dimension's subject does not exist yet at this level. */
  readonly score: number | null;
  readonly basis: string;
  readonly relatedIds: readonly string[];
}

export interface BlueprintConfidenceResult {
  readonly dimensions: readonly ConfidenceDimension[];
  readonly aggregateScore: number | null;
  readonly explanation: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

function seatStance(
  council: CouncilDeliberation,
  seatId: string,
): 'endorse' | 'concern' | 'object' | 'absent' {
  const seat = council.seats.find((s) => s.seatId === seatId);
  return seat?.stance ?? 'absent';
}

function stanceScore(stance: ReturnType<typeof seatStance>): number | null {
  switch (stance) {
    case 'endorse':
      return 1;
    case 'concern':
      return 0.6;
    case 'object':
      return 0;
    default:
      return null;
  }
}

/**
 * Computes per-dimension Blueprint Confidence from mechanical state plus the
 * council deliberation. Every score carries its basis and related IDs; a
 * dimension whose subject is not yet produced at this level is reported as
 * null ("not yet produced at Level 2 scope") instead of being faked.
 */
export function computeBlueprintConfidence(
  _services: CoreServices,
  input: {
    readonly blueprintId: string;
    readonly master: MasterVerificationResult;
    readonly council: CouncilDeliberation;
    readonly trace: RequirementsTraceabilityMatrix;
  },
): BlueprintConfidenceResult {
  const dimensions: ConfidenceDimension[] = [];

  // Requirements completeness: fully evidence-backed trace rows.
  dimensions.push({
    id: 'requirements-completeness',
    score:
      input.trace.totalRequirements === 0
        ? null
        : clamp01(input.trace.fullyTraced / input.trace.totalRequirements),
    basis: `${input.trace.fullyTraced}/${input.trace.totalRequirements} requirement rows fully traced with design+implementation evidence.`,
    relatedIds: input.trace.rows.map((r) => r.requirementId),
  });

  // Module→feature and page coverage: rows by type that have designs.
  for (const [id, typePrefix] of [
    ['module-feature-coverage', 'FEATURE'],
    ['page-coverage', 'PAGE'],
  ] as const) {
    const rows = input.trace.rows.filter((r) => r.requirementId.startsWith(`${typePrefix}-`));
    dimensions.push({
      id,
      score:
        rows.length === 0
          ? null
          : clamp01(rows.filter((r) => r.designExists).length / rows.length),
      basis:
        rows.length === 0
          ? `No ${typePrefix.toLowerCase()} requirements discovered.`
          : `${rows.filter((r) => r.designExists).length}/${rows.length} ${typePrefix} requirements have designs.`,
      relatedIds: rows.map((r) => r.requirementId),
    });
  }

  const workflowRows = input.trace.rows.filter((r) =>
    r.requirementId.startsWith('WORKFLOW-'),
  );
  dimensions.push({
    id: 'workflow-coverage',
    score:
      workflowRows.length === 0
        ? null
        : clamp01(workflowRows.filter((r) => r.designExists).length / workflowRows.length),
    basis:
      workflowRows.length === 0
        ? 'No workflows discovered.'
        : `${workflowRows.filter((r) => r.designExists).length}/${workflowRows.length} workflows designed.`,
    relatedIds: workflowRows.map((r) => r.requirementId),
  });

  // Database/API coverage: API rows with designs AND implementations.
  const apiRows = input.trace.rows.filter((r) => r.requirementId.startsWith('API-'));
  dimensions.push({
    id: 'database-api-coverage',
    score:
      apiRows.length === 0
        ? null
        : clamp01(
            apiRows.filter((r) => r.designExists && r.implementationExists).length /
              apiRows.length,
          ),
    basis:
      apiRows.length === 0
        ? 'No APIs discovered.'
        : `${apiRows.filter((r) => r.designExists && r.implementationExists).length}/${apiRows.length} APIs designed and implemented.`,
    relatedIds: apiRows.map((r) => r.requirementId),
  });

  // Business rule / permission coverage.
  const ruleRows = input.trace.rows.filter((r) => r.requirementId.startsWith('RULE-'));
  const permissionRows = input.trace.rows.filter((r) =>
    r.requirementId.startsWith('PERMISSION-'),
  );
  const rulePermissionTotal = ruleRows.length + permissionRows.length;
  dimensions.push({
    id: 'business-rule-permission-coverage',
    score:
      rulePermissionTotal === 0
        ? null
        : clamp01(
            [...ruleRows, ...permissionRows].filter((r) => r.designExists).length /
              rulePermissionTotal,
          ),
    basis:
      rulePermissionTotal === 0
        ? 'No rules or permissions were discovered; the dimension has no subject.'
        : `${[...ruleRows, ...permissionRows].filter((r) => r.designExists).length}/${rulePermissionTotal} rules/permissions designed.`,
    relatedIds: [...ruleRows, ...permissionRows].map((r) => r.requirementId),
  });

  // UI/UX consistency and security resolve through their council seats -
  // attributable, sha256-anchored judgment rather than self-assessment.
  const seatEvidence = (seatId: string): string =>
    input.council.seats.find((s) => s.seatId === seatId)?.evidenceId ?? 'n/a';
  for (const [id, seatId] of [
    ['ui-ux-consistency', 'ux-designer'],
    ['security', 'security-architect'],
  ] as const) {
    const stance = seatStance(input.council, seatId);
    dimensions.push({
      id,
      score: stanceScore(stance),
      basis: `Council ${seatId} seat stance: ${stance} (seat evidence ${seatEvidence(seatId)}).`,
      relatedIds: [input.blueprintId],
    });
  }

  // Product understanding: master verification health over the full set
  // (which includes the PROJECT artifact from Cluster A).
  const masterHealthy = input.master.masterPassed && input.master.blockingFails === 0;
  const projectEntry = Object.entries(input.master.reports).find(([id]) =>
    id.startsWith('PROJECT-'),
  );
  dimensions.push({
    id: 'product-understanding',
    score: projectEntry === undefined ? null : masterHealthy ? 1 : 0.4,
    basis: masterHealthy
      ? `Master verification passed across ${input.master.subjectCount} artifact(s).`
      : `Master verification carries ${input.master.blockingFails} blocking fail(s).`,
    relatedIds: projectEntry !== undefined ? [projectEntry[0]] : [],
  });

  // Honestly unproduced at Level 2 scope - reported as null, never faked.
  for (const [id, note] of [
    ['accessibility', 'No accessibility review engine exists at Level 2 scope.'],
    ['scalability', 'No scalability analysis exists at Level 2 scope.'],
    ['test-coverage', 'The acceptance-testing department arrives at a later level.'],
    ['documentation-coverage', 'Documentation discovery arrives at a later level.'],
  ] as const) {
    dimensions.push({ id, score: null, basis: note, relatedIds: [] });
  }

  const scored = dimensions.filter((d) => d.score !== null);
  const aggregateScore =
    scored.length === 0
      ? null
      : clamp01(scored.reduce((acc, d) => acc + (d.score ?? 0), 0) / scored.length);
  return {
    dimensions,
    aggregateScore,
    explanation:
      `Aggregate = mean of ${scored.length} evidence-backed dimension(s); ` +
      `${dimensions.length - scored.length} dimension(s) have no subject at this ` +
      'level and are excluded rather than faked.',
  };
}

export interface BlueprintCertificationInput {
  readonly blueprintId: string;
  readonly master: MasterVerificationResult;
  readonly council: CouncilDeliberation;
  readonly trace: RequirementsTraceabilityMatrix;
}

export interface BlueprintCertificationResult {
  readonly certified: boolean;
  readonly reasons: readonly string[];
  readonly confidence?: BlueprintConfidenceResult;
  readonly stampedArtifactIds: readonly string[];
  readonly evidenceId?: string;
}

const BOSS_INDEX = docIndexOf('BOSS-VERIFIED');

/**
 * The Level-2 formal event. Every precondition is re-derived from stored
 * state at call time; nothing is trusted from the caller beyond the already
 * -recorded master run, council deliberation and traceability matrix (which
 * are themselves evidence products). On success the whole closure is stamped
 * CERTIFIED through governed DoC gates.
 */
export async function certifyBlueprintCompleteness(
  services: CoreServices,
  input: BlueprintCertificationInput,
): Promise<BlueprintCertificationResult> {
  const reasons: string[] = [];
  const blueprint = await services.store.get(input.blueprintId);

  if (blueprint === null || blueprint.type !== 'BLUEPRINT') {
    return {
      certified: false,
      reasons: [`Artifact ${input.blueprintId} is not a blueprint.`],
      stampedArtifactIds: [],
    };
  }

  // 1. Approval already granted AND the design layer still holds: the
  // blueprint is APPROVED, every listed design is VERIFIED, and every design
  // traces via DERIVED_FROM to its VERIFIED discovery base. (The Level-1a
  // evaluateApproval gate cannot be re-run after Build because its coverage
  // rule predates -IMPL artifacts; these inline checks are its post-build
  // equivalent and are re-derived from stored state.)
  if (blueprint.status !== 'APPROVED') {
    reasons.push(`Blueprint status is ${blueprint.status}; only APPROVED blueprints certify.`);
  }
  const listedDesignIds = [
    ...(blueprint.attributes['pageDesignIds'] as readonly string[]),
    ...(blueprint.attributes['featureDesignIds'] as readonly string[]),
  ];
  for (const designId of listedDesignIds) {
    const designArtifact = await services.store.get(designId);
    if (designArtifact === null) {
      reasons.push(`Listed design ${designId} is missing.`);
      continue;
    }
    if (designArtifact.status !== 'VERIFIED') {
      reasons.push(`Listed design ${designId} is ${designArtifact.status}; VERIFIED required.`);
    }
    const baseId = services.graph.neighbors(designId, 'downstream', 'DERIVED_FROM')[0];
    if (baseId === undefined) {
      reasons.push(`Design ${designId} has no discovery origin edge.`);
      continue;
    }
    const base = await services.store.get(baseId);
    if (base === null || base.status !== 'VERIFIED') {
      reasons.push(`Design ${designId} traces to ${baseId}, which is not VERIFIED.`);
    }
  }

  // 2. Foundation certification gate on every merged master report...
  for (const [id, report] of Object.entries(input.master.reports)) {
    const foundation = certificationDecision(report, CERTIFIER_ACTOR);
    if (!foundation.certifiable) {
      reasons.push(`Foundation gate on ${id}: ${foundation.reasons.join('; ')}`);
    }
  }
  // ...plus the set-level master verdict.
  if (!input.master.masterPassed) {
    reasons.push(
      `Master verification did not pass (${input.master.blockingFails} blocking fail(s); ` +
        `unresolved: ${input.master.unresolvedInconclusive.join(', ') || 'none'}).`,
    );
  }

  // 3. Council endorsement about THIS blueprint, zero objections.
  if (input.council.subject !== input.blueprintId) {
    reasons.push(
      `Council deliberation subject "${input.council.subject}" does not match ${input.blueprintId}.`,
    );
  }
  if (input.council.verdict !== 'endorsed') {
    reasons.push(
      `Council verdict is "${input.council.verdict}" - objections/concerns must be resolved ` +
        `before certification (${[...input.council.objections, ...input.council.concerns]
          .map((f) => `${f.seatId}: ${f.statement}`)
          .join('; ')}).`,
    );
  }

  // 4. Traceability must be complete and fully evidence-backed.
  if (!input.trace.complete) {
    reasons.push(
      `Traceability incomplete: missing [${input.trace.missingLinkIds.join(', ') || 'none'}]; ` +
        `orphans [${input.trace.orphanedArtifacts.join(', ') || 'none'}]; ` +
        `${input.trace.unsupportedTransitions} unsupported transition(s); ` +
        `${input.trace.fullyTraced}/${input.trace.totalRequirements} rows fully traced.`,
    );
  }

  // 5. Every closure artifact sits at least at BOSS-VERIFIED on the §0.17
  // machine (explicit stamp or derived from recorded provenance).
  const closureIds = new Set<string>([input.blueprintId]);
  for (const row of input.trace.rows) {
    closureIds.add(row.requirementId);
    if (row.designExists) closureIds.add(row.designId);
    if (row.implementationExists) closureIds.add(row.implementationId);
  }
  const docReasons: string[] = [];
  for (const id of closureIds) {
    const artifact = await services.store.get(id);
    if (artifact === null) {
      docReasons.push(`${id}: missing from the store.`);
      continue;
    }
    const position = inferDocState(artifact);
    if (position === undefined || docIndexOf(position) < BOSS_INDEX) {
      docReasons.push(
        `${id}: DoC position ${position ?? '(none)'} is below BOSS-VERIFIED.`,
      );
    }
  }
  if (docReasons.length > 0) reasons.push(...docReasons);

  // 6. Contradiction register: the Contradiction Engine is later-level scope;
  // its register is therefore empty by construction - stated, not faked.
  const contradictionNote = 'Contradiction register: empty (engine arrives at a later level).';

  if (reasons.length > 0) {
    services.logger?.warn('certification.refused', { blueprintId: input.blueprintId });
    return { certified: false, reasons, stampedArtifactIds: [] };
  }

  // --- SUCCESS: confidence, then governed CERTIFIED stamps -----------------
  const confidence = computeBlueprintConfidence(services, {
    blueprintId: input.blueprintId,
    master: input.master,
    council: input.council,
    trace: input.trace,
  });

  const evidence = await services.evidence.append({
    kind: 'review',
    summary:
      `BLUEPRINT COMPLETENESS CERTIFIED for ${input.blueprintId}: ` +
      `${closureIds.size} artifact(s) stamped CERTIFIED; council endorsed by ` +
      `${input.council.seats.length} seat(s); traceability complete; aggregate ` +
      `confidence ${confidence.aggregateScore ?? 'n/a'}. ${contradictionNote}`,
    artifactIds: [input.blueprintId],
    producer: CERTIFIER_ACTOR,
  });

  const stampedArtifactIds: string[] = [];
  for (const id of [...closureIds].sort()) {
    await recordDocGate(services.store, id, 'CERTIFIED', CERTIFIER_ACTOR, {
      gate: 'blueprint-completeness-certification',
      evidenceId: evidence.id,
    });
    stampedArtifactIds.push(id);
  }

  const currentBlueprint = await services.store.require(input.blueprintId);
  await services.store.update(currentBlueprint.id, currentBlueprint.version, (draft) => ({
    ...draft,
    attributes: {
      ...draft.attributes,
      certificationEvidenceId: evidence.id,
      certifiedAt: new Date().toISOString(),
      blueprintConfidence: JSON.parse(JSON.stringify(confidence)) as Record<string, unknown>,
    },
  }));

  services.logger?.info('certification.granted', {
    blueprintId: input.blueprintId,
    stamped: stampedArtifactIds.length,
    confidence: confidence.aggregateScore,
  });

  return {
    certified: true,
    reasons: [],
    confidence,
    stampedArtifactIds,
    evidenceId: evidence.id,
  };
}