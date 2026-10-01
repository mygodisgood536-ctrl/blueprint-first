/**
 * Safe Change Intelligence Department (Level 4, spec §5.1).
 *
 * Orchestrates the full drift -> analysis -> boss -> auditor -> (apply)
 * -> materialize flow. Returns a typed result the caller can inspect.
 *
 * The Department is fail-closed at every gate. The proposal worker cannot
 * certify; the boss cannot apply; the auditor cannot apply. The apply
 * step cannot run without both the boss and the auditor having accepted.
 */
import type { CoreServices } from '../core/services.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';
import { runChangeAnalyst, type AnalystProposalResult } from './analyst.ts';
import { runSafeChangeBoss } from './boss.ts';
import { runSafeChangeAuditor } from './auditor.ts';
import { applyAuthorizedRemediation } from './applier.ts';
import { materializeChangeTrail, type MaterializationResult } from './materialize.ts';
import type { DeployedUnit } from '../operations/deploy.ts';
import type { AppliedRemediation, RemediationAuditTrail, RemediationDecision, RemediationStatus } from './types.ts';

export type ChangeDepartmentResult =
  | {
      readonly status: 'AUTHORIZED_AND_APPLIED';
      readonly trail: RemediationAuditTrail;
      readonly materialization: MaterializationResult;
    }
  | {
      readonly status: 'AUTHORIZED_BUT_NOT_APPLIED';
      readonly trail: RemediationAuditTrail;
      readonly materialization: MaterializationResult;
    }
  | {
      readonly status: 'REJECTED';
      readonly reason: 'OUT_OF_AUTHORIZED_SCOPE' | 'DRIFT_NOT_CONFIRMED' | 'SCOPE_MISMATCH' | 'INDEPENDENCE_VIOLATION' | 'AUDIT_HASH_MISMATCH' | 'INVALID_INPUT';
      readonly trail: RemediationAuditTrail;
    };

export interface ChangeDepartmentInput {
  readonly drift: DriftItem;
  readonly observation?: TelemetryObservation;
  readonly projectId: string;
  readonly env: { units: Map<string, DeployedUnit> };
  /** When true, apply to the in-memory environment after authorization. */
  readonly apply: boolean;
}

export async function runSafeChangeDepartment(
  services: CoreServices,
  input: ChangeDepartmentInput,
): Promise<ChangeDepartmentResult> {
  if (!input.drift || input.drift.artifactId.length === 0) {
    return { status: 'REJECTED', reason: 'INVALID_INPUT', trail: emptyTrail() };
  }
  const analyst: AnalystProposalResult = await runChangeAnalyst(services, {
    drift: input.drift,
    ...(input.observation !== undefined ? { observation: input.observation } : {}),
  });
  const boss: RemediationDecision = runSafeChangeBoss(analyst.proposal);
  const auditor = runSafeChangeAuditor(analyst.proposal);
  const trailBase: RemediationAuditTrail = {
    proposal: analyst.proposal,
    bossDecision: boss,
    auditorDecision: auditor.decision,
    ...(input.observation !== undefined ? { preObservation: input.observation } : {}),
    finalStatus: 'OBSERVED',
  };
  // Side-channel: hash-match is consulted for the gate, but the audit
  // trail's auditorDecision field carries the wrapped decision (with the
  // mismatch marked in the rationale when applicable).
  if (boss.decidedBy === auditor.decision.decidedBy) {
    return { status: 'REJECTED', reason: 'INDEPENDENCE_VIOLATION', trail: { ...trailBase, finalStatus: 'REJECTED' } };
  }
  if (boss.verdict === 'rejected') {
    return {
      status: 'REJECTED',
      reason: boss.withinAuthorizedScope
        ? (boss.driftConfirmed ? 'SCOPE_MISMATCH' : 'DRIFT_NOT_CONFIRMED')
        : 'OUT_OF_AUTHORIZED_SCOPE',
      trail: { ...trailBase, finalStatus: 'REJECTED' },
    };
  }
  if (!auditor.hashMatch) {
    return { status: 'REJECTED', reason: 'AUDIT_HASH_MISMATCH', trail: { ...trailBase, finalStatus: 'REJECTED' } };
  }
  if (auditor.decision.verdict === 'rejected') {
    return {
      status: 'REJECTED',
      reason: auditor.decision.withinAuthorizedScope
        ? (auditor.decision.driftConfirmed ? 'SCOPE_MISMATCH' : 'DRIFT_NOT_CONFIRMED')
        : 'OUT_OF_AUTHORIZED_SCOPE',
      trail: { ...trailBase, finalStatus: 'REJECTED' },
    };
  }
  // The trail to materialize depends on whether we are applying: if so, we
  // want the CHANGE artifact in the chain, so we materialize ONCE at the
  // end with the final trail. If we are only authorizing, we materialize
  // the proposal + approval pair.
  if (!input.apply) {
    const materialization: MaterializationResult = await materializeChangeTrail(
      services,
      { ...trailBase, finalStatus: 'AUTHORIZED' },
      input.projectId,
    );
    return {
      status: 'AUTHORIZED_BUT_NOT_APPLIED',
      trail: { ...trailBase, finalStatus: 'AUTHORIZED' },
      materialization,
    };
  }
  const { application, updatedUnit } = applyAuthorizedRemediation(
    {
      proposal: analyst.proposal,
      bossDecision: boss,
      auditorDecision: auditor.decision,
    },
    input.env,
  );
  input.env.units.set(updatedUnit.baseId, updatedUnit);
  const appliedTrail: RemediationAuditTrail = {
    ...trailBase,
    application,
    finalStatus: 'APPLIED',
  };
  const materialization: MaterializationResult = await materializeChangeTrail(
    services,
    appliedTrail,
    input.projectId,
  );
  return {
    status: 'AUTHORIZED_AND_APPLIED',
    trail: { ...appliedTrail, finalStatus: 'APPLIED' },
    materialization,
  };
}

function emptyTrail(): RemediationAuditTrail {
  const stubDecision: RemediationDecision = {
    proposalId: '',
    decidedBy: '',
    decidedAt: new Date(0).toISOString(),
    verdict: 'rejected',
    rationale: 'invalid input',
    withinAuthorizedScope: false,
    driftConfirmed: false,
    decisionHash: '',
  };
  return {
    proposal: {
      proposalId: '',
      driftId: '',
      scope: { baseId: '', summary: '', changeKind: 'config_restoration' },
      proposedBy: '',
      proposedAt: new Date(0).toISOString(),
      proposalHash: '',
      drift: { artifactId: '', dimension: 'CORRECTNESS', was: 'absent', now: 'absent', kind: 'CHANGED', source: 'verification' },
      rationale: 'invalid input',
    },
    bossDecision: stubDecision,
    auditorDecision: stubDecision,
    finalStatus: 'REJECTED' as RemediationStatus,
  };
}
