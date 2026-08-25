/**
 * Blueprint approval - the Level 1a approval gate.
 *
 * Approval is a REAL gate over stored state: the blueprint must be VERIFIED,
 * every listed design must be VERIFIED and trace to a VERIFIED discovery base
 * via a graph edge, coverage must exactly match the certified baseline (no
 * missing pages/features, no invented ones), and the approver must be an
 * independent origin (not the producing AI worker).
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';

export const DESIGN_WORKER_ID = 'design-worker-01';
export const DEFAULT_APPROVER: Actor = { kind: 'human', id: 'product-owner-01' };

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reasons: readonly string[];
}

export async function evaluateApproval(
  services: CoreServices,
  blueprintId: string,
  approver: Actor,
): Promise<ApprovalDecision> {
  const reasons: string[] = [];
  const blueprint = await services.store.get(blueprintId);
  if (blueprint === null || blueprint.type !== 'BLUEPRINT') {
    return { approved: false, reasons: [`Artifact ${blueprintId} is not a blueprint.`] };
  }
  if (blueprint.status !== 'VERIFIED') {
    reasons.push(`Blueprint status is ${blueprint.status}; only VERIFIED blueprints are approvable.`);
  }

  const pageDesignIds = blueprint.attributes['pageDesignIds'] as readonly string[];
  const featureDesignIds = blueprint.attributes['featureDesignIds'] as readonly string[];
  const baseIdsFromDesigns: string[] = [];

  for (const designId of [...pageDesignIds, ...featureDesignIds]) {
    const design = await services.store.get(designId);
    if (design === null) {
      reasons.push(`Design ${designId} listed by the blueprint does not exist.`);
      continue;
    }
    if (design.status !== 'VERIFIED') {
      reasons.push(`Design ${designId} is ${design.status}, not VERIFIED.`);
    }
    const derivedEdge = services.graph.neighbors(designId, 'downstream', 'DERIVED_FROM');
    const baseId = derivedEdge[0];
    if (baseId === undefined) {
      reasons.push(`Design ${designId} has no DERIVED_FROM edge to a discovery artifact.`);
      continue;
    }
    baseIdsFromDesigns.push(baseId);
    const base = await services.store.get(baseId);
    if (base === null || base.status !== 'VERIFIED') {
      reasons.push(`Design ${designId} traces to ${baseId} which is missing or not VERIFIED.`);
    }
  }

  // Coverage must match the certified baseline exactly (both directions).
  const expectedBaseIds = (
    await services.store.list({
      types: ['PAGE', 'FEATURE'],
      ...(blueprint.projectId !== null ? { projectId: blueprint.projectId } : {}),
    })
  )
    .filter((a) => !a.id.endsWith('-DESIGN'))
    .map((a) => a.id)
    .sort();
  const actualBaseIds = [...new Set(baseIdsFromDesigns)].sort();
  const missing = expectedBaseIds.filter((id) => !actualBaseIds.includes(id));
  const extra = actualBaseIds.filter((id) => !expectedBaseIds.includes(id));
  for (const id of missing) reasons.push(`No design covers discovery artifact ${id}.`);
  for (const id of extra) reasons.push(`Design exists for non-baseline artifact ${id} (invented scope).`);

  // Approver independence. Identity rule (verification/independence.ts): two
  // actors are the same origin when their ids match, regardless of declared
  // kind - a worker account re-labeled as 'human' is still the same origin.
  if (approver.id === DESIGN_WORKER_ID) {
    reasons.push('Approver origin equals the producing worker; self-approval forbidden.');
  }

  return { approved: reasons.length === 0, reasons };
}

/** Applies approval when evaluation passes; records evidence and provenance. */
export async function approveBlueprint(
  services: CoreServices,
  blueprintId: string,
  approver: Actor = DEFAULT_APPROVER,
): Promise<ApprovalDecision & { evidenceId?: string }> {
  const decision = await evaluateApproval(services, blueprintId, approver);
  if (!decision.approved) return decision;

  const evidence = await services.evidence.append({
    kind: 'review',
    summary: `Blueprint ${blueprintId} approved by ${approver.kind}:${approver.id} after passing all Level-1a gates.`,
    artifactIds: [blueprintId],
    producer: { kind: 'verifier', id: 'approval-gate' },
  });
  const current = await services.store.require(blueprintId);
  const updated = await recordStatusChange(
    services.store,
    blueprintId,
    'APPROVED',
    approver,
    { note: 'Blueprint approval gate passed.', evidenceId: evidence.id },
  );
  void updated;
  void current;
  return { ...decision, evidenceId: evidence.id };
}

/** Records an explicit rejection with its reason on the blueprint. */
export async function rejectBlueprint(
  services: CoreServices,
  blueprintId: string,
  reason: string,
  actor: Actor = DEFAULT_APPROVER,
): Promise<void> {
  const blueprint = await services.store.get(blueprintId);
  if (blueprint === null) throw new Error(`Blueprint ${blueprintId} does not exist.`);
  // Legal path: VERIFIED -> IN_REVIEW -> CHANGES_REQUESTED (state machine
  // has no direct VERIFIED->CHANGES_REQUESTED edge by design).
  await recordStatusChange(services.store, blueprintId, 'IN_REVIEW', actor, {
    note: 'Reopened for reviewer rejection.',
  });
  await recordStatusChange(services.store, blueprintId, 'CHANGES_REQUESTED', actor, { note: reason });
}
