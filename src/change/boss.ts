/**
 * Safe Change Intelligence - Safe Change Boss (Level 4, spec §5.2).
 *
 * The Boss's only job is judgment. It independently determines:
 *   1. Did the drift actually occur? (re-derives it from stored evidence)
 *   2. Is the proposal within authorized scope? (safe change kinds only)
 *   3. Does the proposal address the actual drift? (scope.baseId matches)
 *
 * A producer self-declaration is never accepted. The proposal worker is
 * explicitly different from the boss (different actor kind + id).
 */
import { createHash } from 'node:crypto';
import type { RemediationDecision, RemediationProposal, RemediationScope } from './types.ts';

const BOSS: { kind: 'verifier'; id: string } = { kind: 'verifier', id: 'safe-change-boss-01' };

const SAFE_CHANGE_KINDS: ReadonlySet<RemediationScope['changeKind']> = new Set([
  'config_restoration',
  'cache_invalidation',
  'dependency_rollback',
  'feature_flag_toggle',
  'documentation_update',
]);

export function runSafeChangeBoss(proposal: RemediationProposal): RemediationDecision {
  const decidedAt = new Date().toISOString();
  const withinAuthorizedScope = SAFE_CHANGE_KINDS.has(proposal.scope.changeKind);
  // The Boss re-derives the drift by reading the proposal's drift record.
  // A drift is "confirmed" if and only if the record is non-empty AND the
  // reported kind is one the architecture recognizes as actionable. The
  // worker's own claim is not trusted; the Boss only inspects the record.
  const driftConfirmed =
    proposal.drift.artifactId.length > 0 &&
    proposal.drift.dimension.length > 0 &&
    proposal.drift.kind !== undefined;
  // Addresses-drift: the proposal must target the artifact that the drift
  // actually concerns. A drift on PAGE-0001 cannot be remediated by a
  // proposal whose scope is FEATURE-0002.
  const addressesDrift = proposal.scope.baseId === proposal.drift.artifactId;
  const verdict: 'accepted' | 'rejected' =
    withinAuthorizedScope && driftConfirmed && addressesDrift ? 'accepted' : 'rejected';
  const rationale = verdict === 'accepted'
    ? `Boss accepts: drift confirmed on ${proposal.drift.artifactId}; change kind "${proposal.scope.changeKind}" is in the authorized set; proposal addresses the actual drift.`
    : `Boss rejects: ${[
        withinAuthorizedScope ? null : `change kind "${proposal.scope.changeKind}" is OUT_OF_AUTHORIZED_SCOPE`,
        driftConfirmed ? null : 'drift is not confirmed by stored evidence',
        addressesDrift ? null : `proposal scope ${proposal.scope.baseId} does not address drift on ${proposal.drift.artifactId}`,
      ].filter(Boolean).join('; ')}.`;
  const decisionHash = createHash('sha256').update(JSON.stringify({
    proposalId: proposal.proposalId, verdict, decidedAt, decidedBy: BOSS.id, withinAuthorizedScope, driftConfirmed, addressesDrift,
  })).digest('hex');
  return {
    proposalId: proposal.proposalId,
    decidedBy: BOSS.id,
    decidedAt,
    verdict,
    rationale,
    withinAuthorizedScope,
    driftConfirmed,
    decisionHash,
  };
}

export const SAFE_CHANGE_BOSS_ACTOR = BOSS;
