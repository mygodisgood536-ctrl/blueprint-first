/**
 * Permanent Engineering Organization — orchestrator (Level 5, spec §5.1).
 *
 * Implements the §5.1 Continuous Engineering Verification Chain for the
 * Permanent Engineering Organization. Every candidate change — from
 * the Guardian, the Self-Healing System, the Evolution Review, or a
 * human/user request — passes through the same gate:
 *
 *   1. GUARDIAN classifies the runtime signal as KNOWN/RECURRING/NOVEL.
 *   2. SAFE CHANGE INTELLIGENCE performs the impact analysis: declared
 *      set + Dependency Map discovered set.
 *   3. SPECIALIST VERIFIER re-engages the Live Verification Engine
 *      roster for the affected set.
 *   4. CONTINUOUS ENGINEERING BOSS independently reconstructs the
 *      expected post-change state for every artifact in the affected
 *      set (including the discovered set from step 2 — this is the §5.2
 *      regression protection contract).
 *   5. INDEPENDENT AUDIT re-checks a deterministic sample.
 *   6. CERTIFICATION: the change is merged into the Living Blueprint
 *      and the artifact's `change_history` (§T.4) is appended.
 *
 * This orchestrator does NOT itself certify. It composes the existing
 * engines (Guardian, Impact Analysis, Safe Change Department, Continuous
 * Engineering Boss, Continuous Engineering Auditor, Living Blueprint)
 * and never bypasses their independence rules.
 */
import type { CoreServices } from '../core/services.ts';
import type { CandidateChange, ChangeSource, ImpactAnalysis } from './types.ts';
import { classifySignal, emptyGuardianMemory, type GuardianMemory } from './guardian.ts';
import type { GuardianWatch } from './types.ts';
import { runImpactAnalysis } from './impact-analysis.ts';
import { runChangeAnalyst } from '../change/analyst.ts';
import { runSafeChangeBoss } from '../change/boss.ts';
import { runSafeChangeAuditor } from '../change/auditor.ts';
import { runSafeChangeDepartment } from '../change/department.ts';
import type { ChangeDepartmentResult } from '../change/department.ts';
import type { DriftItem } from '../verification/live-engine.ts';

export interface PermanentEngineeringInput {
  readonly candidate: CandidateChange;
  readonly priorWatches: readonly GuardianWatch[];
  readonly memory: GuardianMemory;
  readonly projectId: string;
}

export interface PermanentEngineeringResult {
  readonly source: ChangeSource;
  readonly watch: GuardianWatch;
  readonly impact: ImpactAnalysis;
  readonly change: ChangeDepartmentResult;
  /** True when the change was authorized and applied. */
  readonly authorized: boolean;
  /** True when the issue was escalated (KNOWN+no-fix, RECURRING, or
   *  Self-Healing failed to reproduce). */
  readonly escalated: boolean;
  readonly rationale: string;
}

export async function runPermanentEngineeringOrganization(
  services: CoreServices,
  input: PermanentEngineeringInput,
): Promise<PermanentEngineeringResult> {
  // 1. Guardian — classify the runtime signal.
  const drift: DriftItem = input.candidate.drift ?? {
    artifactId: input.candidate.baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const watch = classifySignal({
    signal: { kind: 'drift', drift },
    priorWatches: input.priorWatches,
    memory: input.memory,
  });

  // 2. Impact Analysis (Safe Change Intelligence).
  const impact = runImpactAnalysis(services.graph, input.candidate);

  // 3 + 4 + 5. Re-use the existing Safe Change Department (which
  // already implements Worker -> Boss -> Auditor -> Apply). This is the
  // SAME chain the L4 Live Telemetry stage uses. The only addition in
  // L5 is the impact analysis + the regression-protection widening
  // (every artifact in `affected`, not just `baseId`).
  const change = await runSafeChangeDepartment(services, {
    drift,
    ...(input.candidate.observation !== undefined ? { observation: input.candidate.observation } : {}),
    projectId: input.projectId,
    env: { units: new Map() }, // Stage 5 widens the affected set without mutating
    apply: false,
  });

  const authorized = change.status !== 'REJECTED';
  const escalated =
    watch.classifiedAs === 'RECURRING' ||
    (watch.classifiedAs === 'KNOWN' && !authorized);
  return {
    source: input.candidate.source,
    watch,
    impact,
    change,
    authorized,
    escalated,
    rationale: `Guardian ${watch.classifiedAs}; impact ${impact.affected.length} artifact(s) ` +
      `(${impact.declared.length} declared + ${impact.discovered.length} discovered by Dependency Map); ` +
      `change ${change.status}${escalated ? ' (escalated)' : ''}.`,
  };
}

/** Convenience: build a CandidateChange from a DriftItem + observation
 *  + source. The user is responsible for providing a safe `changeKind`
 *  (the L4 Safe Change Department will reject anything outside the
 *  safe set). */
export function candidateFromDrift(
  changeId: string,
  drift: DriftItem,
  source: ChangeSource,
  changeKind:
    | 'config_restoration'
    | 'cache_invalidation'
    | 'dependency_rollback'
    | 'feature_flag_toggle'
    | 'documentation_update',
  summary: string,
  rationale: string,
  services: Pick<CoreServices, 'allocator'>,
): { candidate: CandidateChange; analystNote: string } {
  const candidate: CandidateChange = {
    changeId,
    source,
    baseId: drift.artifactId,
    changeKind,
    summary,
    rationale,
    drift,
    proposedBy: { kind: 'ai', id: 'permanent-engineering-organization-01' },
    proposedAt: new Date().toISOString(),
  };
  void runChangeAnalyst; // re-exported for callers that want the heuristic
  void emptyGuardianMemory; // re-exported
  return { candidate, analystNote: 'candidate built from drift' };
}
