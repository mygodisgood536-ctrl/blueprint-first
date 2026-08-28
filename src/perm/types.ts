/**
 * Permanent Engineering Organization — shared data model (Level 5, spec §5).
 *
 * The Permanent Engineering Organization (PEO) is the system that owns the
 * application after launch. It is structurally distinct from the Continuous
 * Engineering Department (L4's Stage 5) — which observes and certifies the
 * live system — and from the Safe Change Department (L4's §5.1) — which
 * applies a single remediation under a Boss+Auditor chain. The PEO adds:
 *
 *   1. AI Engineering Guardian  — a continuous root-cause-tracing watch that
 *      classifies a runtime signal as KNOWN / RECURRING / NOVEL.
 *   2. AI Self-Healing Engineering System — reproduces a NOVEL signal in an
 *      isolated replica, generates candidate fixes, and runs the full
 *      eleven-dimension verification before any change reaches production.
 *   3. Continuous Product Evolution — a standing review that surfaces
 *      improvement recommendations even when no failure has occurred.
 *   4. Safe Change Intelligence (Impact Analysis) — given a candidate change,
 *      traverses the Dependency Map to identify every downstream artifact
 *      the change might affect, including artifacts the change-maker did not
 *      think to touch. This is §5.1's impact analysis step.
 *   5. Engineering Memory (§5.5) — every artifact now carries an append-only
 *      `change_history` (§T.4) so a previous certified state is never
 *      silently overwritten.
 *   6. Continuous Learning Engine — lessons from the full lifecycle feed
 *      back into the AI Router's standing routing decisions.
 *
 * Every type here is pure data. Every behavior is in the corresponding
 * engine file. No worker here ever certifies its own work; the Continuous
 * Engineering Boss and Independent Audit roles already in `src/continuous/`
 * are the only certifiers.
 */
import type { Actor } from '../core/artifact.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';

export type ChangeSource = 'guardian' | 'self-healing' | 'evolution' | 'user-request';

export interface CandidateChange {
  readonly changeId: string;
  readonly source: ChangeSource;
  readonly baseId: string;
  readonly changeKind:
    | 'config_restoration'
    | 'cache_invalidation'
    | 'dependency_rollback'
    | 'feature_flag_toggle'
    | 'documentation_update';
  readonly summary: string;
  readonly rationale: string;
  readonly observation?: TelemetryObservation;
  readonly drift?: DriftItem;
  readonly proposedBy: Actor;
  readonly proposedAt: string;
}

/** The output of the Safe Change Intelligence impact analysis (§5.1, step 2).
 *  Lists every artifact the change might affect, with a per-artifact reason
 *  for inclusion. Includes artifacts the change-maker did not think to touch
 *  but the Dependency Map shows are downstream — this is the §5.2 contract. */
export interface ImpactAnalysis {
  readonly analysisId: string;
  readonly changeId: string;
  readonly analyzedBy: Actor;
  readonly analyzedAt: string;
  /** Artifacts the change-maker explicitly mentioned. */
  readonly declared: readonly string[];
  /** Artifacts surfaced by the Dependency Map (the surprise set). */
  readonly discovered: readonly string[];
  /** Union, in deterministic order. */
  readonly affected: readonly string[];
  /** sha256 over the affected list; anchors the analysis record. */
  readonly analysisHash: string;
  readonly rationale: string;
}

export type GuardianClassification = 'KNOWN' | 'RECURRING' | 'NOVEL';

export interface GuardianWatch {
  readonly watchId: string;
  readonly baseId: string;
  readonly classifiedAs: GuardianClassification;
  readonly rootCause: string;
  readonly relatedWatchIds: readonly string[];
  readonly evidenceHash: string;
  readonly watchedBy: Actor;
  readonly watchedAt: string;
}

export interface SelfHealingProposal {
  readonly proposalId: string;
  readonly baseId: string;
  readonly reproduction: string;
  readonly reproduced: boolean;
  readonly evidenceHash: string;
  readonly candidate?: CandidateChange;
  readonly producedBy: Actor;
  readonly producedAt: string;
}

export interface EvolutionRecommendation {
  readonly recommendationId: string;
  readonly baseId: string;
  readonly rationale: string;
  readonly expectedBenefit: string;
  readonly queuedForImpactAnalysis: boolean;
  readonly proposedBy: Actor;
  readonly proposedAt: string;
}

export interface LearningEntry {
  readonly entryId: string;
  readonly stage: 'discovery' | 'design' | 'build' | 'test' | 'deployment' | 'continuous' | 'permanent';
  readonly title: string;
  readonly body: string;
  readonly sourceArtifactIds: readonly string[];
  readonly entryHash: string;
  readonly recordedBy: Actor;
  readonly recordedAt: string;
}

export interface ChangeHistoryEntry {
  readonly entryId: string;
  readonly recordedAt: string;
  readonly reason: string;
  readonly affectedArtifacts: readonly string[];
  readonly entryHash: string;
  readonly impactAnalysisHash: string;
  readonly revisedArtifactHash: string;
  readonly verificationEvidenceHash: string;
  readonly certifiedBy: Actor;
}
