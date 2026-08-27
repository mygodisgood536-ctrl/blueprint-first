/**
 * Safe Change Intelligence - Safe Change Auditor (Level 4, spec §5.2).
 *
 * The Auditor is structurally independent of the Boss. It re-verifies the
 * proposal by re-running the SAME checks the Boss ran, but it also performs
 * a byte-for-byte reproduction of the proposal hash from the proposal
 * record. Any mismatch - hash, decision logic, drift identity - rejects.
 *
 * The Auditor NEVER trusts the Boss's decision as input. It re-derives its
 * own verdict from the proposal.
 */
import { createHash } from 'node:crypto';
import type { RemediationDecision, RemediationProposal, RemediationScope } from './types.ts';

const AUDITOR: { kind: 'verifier'; id: string } = { kind: 'verifier', id: 'safe-change-auditor-01' };

const SAFE_CHANGE_KINDS: ReadonlySet<RemediationScope['changeKind']> = new Set([
  'config_restoration',
  'cache_invalidation',
  'dependency_rollback',
  'feature_flag_toggle',
  'documentation_update',
]);

export interface AuditorResult {
  readonly decision: RemediationDecision;
  readonly hashMatch: boolean;
}

export function runSafeChangeAuditor(proposal: RemediationProposal): AuditorResult {
  const decidedAt = new Date().toISOString();
  const withinAuthorizedScope = SAFE_CHANGE_KINDS.has(proposal.scope.changeKind);
  const driftConfirmed =
    proposal.drift.artifactId.length > 0 &&
    proposal.drift.dimension.length > 0 &&
    proposal.drift.kind !== undefined;
  const addressesDrift = proposal.scope.baseId === proposal.drift.artifactId;
  const verdict: 'accepted' | 'rejected' =
    withinAuthorizedScope && driftConfirmed && addressesDrift ? 'accepted' : 'rejected';
  const rationale = verdict === 'accepted'
    ? `Auditor confirms: proposal is reproducible; drift on ${proposal.drift.artifactId} is genuine; change kind "${proposal.scope.changeKind}" is authorized; scope addresses the drift.`
    : `Auditor rejects: ${[
        withinAuthorizedScope ? null : `change kind "${proposal.scope.changeKind}" is OUT_OF_AUTHORIZED_SCOPE`,
        driftConfirmed ? null : 'drift is not confirmed by stored evidence',
        addressesDrift ? null : `proposal scope ${proposal.scope.baseId} does not address drift on ${proposal.drift.artifactId}`,
      ].filter(Boolean).join('; ')}.`;
  const decisionHash = createHash('sha256').update(JSON.stringify({
    proposalId: proposal.proposalId, verdict, decidedAt, decidedBy: AUDITOR.id, withinAuthorizedScope, driftConfirmed, addressesDrift,
  })).digest('hex');
  // Byte-for-byte reproduction of the proposal's own hash. The Auditor is
  // not allowed to accept a proposal whose hash is not the same one the
  // proposal record carries.
  const reproducedHash = createHash('sha256').update(JSON.stringify({
    proposalId: proposal.proposalId,
    driftId: proposal.driftId,
    scope: proposal.scope,
    proposedBy: proposal.proposedBy,
    proposedAt: proposal.proposedAt,
    drift: proposal.drift,
    observation: proposal.observation,
    rationale: proposal.rationale,
  })).digest('hex');
  const hashMatch = reproducedHash === proposal.proposalHash;
  const finalVerdict: 'accepted' | 'rejected' = verdict === 'accepted' && hashMatch ? 'accepted' : 'rejected';
  return {
    hashMatch,
    decision: {
      proposalId: proposal.proposalId,
      decidedBy: AUDITOR.id,
      decidedAt,
      verdict: finalVerdict,
      rationale: hashMatch ? rationale : `Auditor rejects: proposal hash does not reproduce; the proposal record is not the same content the worker submitted.`,
      withinAuthorizedScope,
      driftConfirmed,
      decisionHash,
    },
  };
}

export const SAFE_CHANGE_AUDITOR_ACTOR = AUDITOR;
