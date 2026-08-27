/**
 * Safe Change Intelligence - the data model (Level 4, spec §5.1).
 *
 * The lifecycle is explicit and append-only:
 *
 *   OBSERVED    - a runtime observation flagged as drift
 *   PROPOSED    - the Change Analyst produced a RemediationProposal for it
 *   REVIEWED    - the Safe Change Boss independently judged the proposal
 *   AUTHORIZED  - the Safe Change Auditor confirmed the proposal within scope
 *   APPLIED     - the authorized remediation was applied to the live env
 *   VERIFIED    - post-change verification re-engaged the Live Engine
 *   REJECTED    - any judge rejected; the proposal is closed, no application
 *   SUPERSEDED  - the drift was resolved by an external (non-platform) change
 *
 * Nothing advances without evidence (sha256-anchored) and without the
 * correct governor. The same Worker -> Self -> Specialist -> Boss -> Auditor
 * chain that governs every other stage governs this one.
 */
import { createHash } from 'node:crypto';
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';
import type { ArtifactIdAllocator } from '../core/id-allocator.ts';

export type RemediationStatus =
  | 'OBSERVED'
  | 'PROPOSED'
  | 'REVIEWED'
  | 'AUTHORIZED'
  | 'APPLIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface RemediationScope {
  /** Artifact baseId that the remediation targets. */
  readonly baseId: string;
  /** Free-form description of what will change, in a single sentence. */
  readonly summary: string;
  /**
   * The change-kind discriminator. Anything not in the safe list is rejected
   * by the Boss as OUT_OF_AUTHORIZED_SCOPE.
   */
  readonly changeKind:
    | 'config_restoration'
    | 'cache_invalidation'
    | 'dependency_rollback'
    | 'feature_flag_toggle'
    | 'documentation_update';
}

export interface RemediationProposal {
  readonly proposalId: string;
  readonly driftId: string;
  readonly scope: RemediationScope;
  readonly proposedBy: string;
  readonly proposedAt: string;
  /** sha256 anchor over the proposal content; not the input evidence. */
  readonly proposalHash: string;
  /**
   * The drift that motivates the proposal. Carried by reference (id) and
   * inlined for audit. The Boss independently re-derives the drift from
   * stored state, so this inlined copy is descriptive, not authoritative.
   */
  readonly drift: DriftItem;
  /** The observation (if any) that surfaced the drift. */
  readonly observation?: TelemetryObservation;
  /** The human-readable rationale the proposal worker recorded. */
  readonly rationale: string;
}

export interface RemediationDecision {
  readonly proposalId: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly verdict: 'accepted' | 'rejected';
  readonly rationale: string;
  /** True when the judge found the proposal within the authorized change kinds. */
  readonly withinAuthorizedScope: boolean;
  /** True when the judge found the drift actually occurred. */
  readonly driftConfirmed: boolean;
  /** sha256 anchor over the decision content. */
  readonly decisionHash: string;
}

export interface AppliedRemediation {
  readonly proposalId: string;
  readonly baseId: string;
  readonly appliedBy: string;
  readonly appliedAt: string;
  /** Pre-application sha256 of the unit's configuration (anchor). */
  readonly beforeHash: string;
  /** Post-application sha256 of the unit's configuration (anchor). */
  readonly afterHash: string;
  /** sha256 anchor over the application content. */
  readonly applicationHash: string;
  /** Plain description of what was changed in the unit (deterministic). */
  readonly changeApplied: string;
}

export interface RemediationAuditTrail {
  readonly proposal: RemediationProposal;
  readonly bossDecision: RemediationDecision;
  readonly auditorDecision: RemediationDecision;
  readonly application?: AppliedRemediation;
  /** Pre- and post-application drift observations. */
  readonly preObservation?: TelemetryObservation;
  readonly postObservation?: TelemetryObservation;
  readonly finalStatus: RemediationStatus;
}

export function nextProposalId(allocator: ArtifactIdAllocator): string {
  // The proposal/approval/change IDs are FINDING-type artifacts with no
  // production-lineage phase suffix. They are derived from the same FINDING
  // counter the rest of the platform uses; the discriminator (proposal vs
  // approval vs change) lives in the artifact's `attributes.kind`.
  return allocator.nextId('FINDING');
}

export function proposalContentHash(p: Omit<RemediationProposal, 'proposalHash'>): string {
  return createHash('sha256').update(JSON.stringify({
    proposalId: p.proposalId,
    driftId: p.driftId,
    scope: p.scope,
    proposedBy: p.proposedBy,
    proposedAt: p.proposedAt,
    drift: p.drift,
    observation: p.observation,
    rationale: p.rationale,
  })).digest('hex');
}
