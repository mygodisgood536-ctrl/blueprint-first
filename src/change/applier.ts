/**
 * Safe Change Intelligence - Authorized Applier (Level 4, spec §5.1).
 *
 * The Applier mutates the in-memory deployment environment, but ONLY after
 * both the Safe Change Boss AND the Safe Change Auditor have accepted the
 * proposal. The Applier is structurally distinct from the Analyst (different
 * actor), so no worker can both propose and apply.
 *
 * The application is sha256-anchored before and after. The resulting
 * AppliedRemediation record is the only thing the post-change verification
 * can trust to determine whether the change actually landed.
 */
import { createHash } from 'node:crypto';
import type { DeployedUnit } from '../operations/deploy.ts';
import type { AppliedRemediation, RemediationDecision, RemediationProposal, RemediationScope } from './types.ts';

const APPLIER: { kind: 'system'; id: string } = { kind: 'system', id: 'safe-change-applier-01' };

export interface ApplierInput {
  readonly proposal: RemediationProposal;
  readonly bossDecision: RemediationDecision;
  readonly auditorDecision: RemediationDecision;
}

export interface ApplierResult {
  readonly application: AppliedRemediation;
  readonly updatedUnit: DeployedUnit;
}

export function applyAuthorizedRemediation(
  input: ApplierInput,
  env: { units: Map<string, DeployedUnit> },
  now: string = new Date().toISOString(),
): ApplierResult {
  if (input.bossDecision.verdict !== 'accepted') {
    throw new Error('Applier refused: boss did not accept the proposal.');
  }
  if (input.auditorDecision.verdict !== 'accepted') {
    throw new Error('Applier refused: auditor did not confirm the proposal.');
  }
  if (input.auditorDecision.decidedBy === input.bossDecision.decidedBy) {
    throw new Error('Applier refused: boss and auditor share identity; independence violated.');
  }
  const unit = env.units.get(input.proposal.scope.baseId);
  if (unit === undefined) {
    throw new Error(`Applier refused: no deployed unit for ${input.proposal.scope.baseId} in environment.`);
  }
  const beforeHash = unit.configHash;
  const updatedUnit = performChange(unit, input.proposal.scope);
  const afterHash = updatedUnit.configHash;
  const applicationHash = createHash('sha256').update(JSON.stringify({
    proposalId: input.proposal.proposalId,
    baseId: updatedUnit.baseId,
    beforeHash,
    afterHash,
    changeApplied: describe(input.proposal.scope),
    appliedAt: now,
  })).digest('hex');
  return {
    application: {
      proposalId: input.proposal.proposalId,
      baseId: updatedUnit.baseId,
      appliedBy: APPLIER.id,
      appliedAt: now,
      beforeHash,
      afterHash,
      applicationHash,
      changeApplied: describe(input.proposal.scope),
    },
    updatedUnit,
  };
}

function performChange(unit: DeployedUnit, scope: RemediationScope): DeployedUnit {
  // Each change kind is a deterministic, small, well-bounded mutation of
  // the unit. The mutation is fully described by the new configHash, so
  // any future re-verifier can re-derive the same hash.
  switch (scope.changeKind) {
    case 'config_restoration': {
      // Restoration returns the unit to a known-good configuration by
      // appending a config-restored anchor to the existing configHash.
      const newConfigHash = createHash('sha256').update(unit.configHash + '\u0000config-restored').digest('hex');
      return { ...unit, configHash: newConfigHash };
    }
    case 'cache_invalidation': {
      const newConfigHash = createHash('sha256').update(unit.configHash + '\u0000cache-invalidated').digest('hex');
      return { ...unit, configHash: newConfigHash };
    }
    case 'dependency_rollback': {
      const newConfigHash = createHash('sha256').update(unit.configHash + '\u0000dependency-rolled-back').digest('hex');
      return { ...unit, configHash: newConfigHash };
    }
    case 'feature_flag_toggle': {
      const newConfigHash = createHash('sha256').update(unit.configHash + '\u0000flag-toggled').digest('hex');
      return { ...unit, configHash: newConfigHash };
    }
    case 'documentation_update': {
      const newConfigHash = createHash('sha256').update(unit.configHash + '\u0000documentation-updated').digest('hex');
      return { ...unit, configHash: newConfigHash };
    }
    default: {
      // Exhaustive guard - if a new kind is added, this branch becomes
      // reachable; the compiler will warn via the switch coverage check.
      const exhaustive: never = scope.changeKind;
      throw new Error(`Unhandled change kind: ${String(exhaustive)}`);
    }
  }
}

function describe(scope: RemediationScope): string {
  return `Applied ${scope.changeKind} to ${scope.baseId}: ${scope.summary}`;
}

export const SAFE_CHANGE_APPLIER_ACTOR = APPLIER;
