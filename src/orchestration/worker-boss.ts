/**
 * Worker-Boss flow with enforced verification independence.
 *
 * Implements the architecture's judgment pipeline:
 *
 *   WORKER (produces a draft artifact)
 *     -> SELF-VERIFICATION (same origin allowed, explicitly non-certifying)
 *     -> SPECIALIST VERIFICATION (MUST be a different origin)
 *     -> BOSS DECISION           (MUST be a different origin than the worker)
 *
 * Independence is checked BEFORE any work runs, so a self-certifying flow
 * fails fast instead of producing reports that only look trustworthy. The
 * boss still receives the specialist report even when it contains failures -
 * rejecting with full information is the boss's job, not the runner's.
 */

import { assertIndependentVerifier } from '../verification/independence.ts';
import type { Actor } from '../core/artifact.ts';
import type { VerificationReport, Verdict, VerificationFinding } from '../verification/verifier.ts';

export interface WorkTask {
  title: string;
  detail?: string;
}

/** Non-certifying first pass by the worker's own side. */
export interface SelfCheckResult {
  passed: boolean;
  notes: string;
  findings?: readonly VerificationFinding[];
}

export interface WorkerDef<TDraft> {
  actor: Actor;
  produce(task: WorkTask): Promise<TDraft>;
}

export interface SelfVerifierDef<TDraft> {
  actor: Actor;
  selfVerify(task: WorkTask, draft: TDraft): Promise<SelfCheckResult>;
}

export interface SpecialistVerifierDef<TDraft> {
  actor: Actor;
  verify(task: WorkTask, draft: TDraft, self: SelfCheckResult): Promise<VerificationReport>;
}

export interface BossDecision {
  decision: 'accepted' | 'rejected';
  rationale: string;
}

export interface BossDef<TDraft> {
  actor: Actor;
  decide(
    task: WorkTask,
    draft: TDraft,
    self: SelfCheckResult,
    specialist: VerificationReport,
  ): Promise<BossDecision>;
}

export interface FlowStepRecord {
  step: 'produce' | 'self-verify' | 'specialist-verify' | 'boss-decide';
  actorId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
}

export interface FlowOutcome<TDraft> {
  accepted: boolean;
  decision: BossDecision | null;
  draft: TDraft | null;
  self: SelfCheckResult | null;
  specialistReport: VerificationReport | null;
  verdictCounts: Record<Verdict, number>;
  steps: FlowStepRecord[];
}

/** Runs fn, records the step outcome (success or failure), rethrows originals. */
async function timed<T>(
  step: FlowStepRecord['step'],
  actorId: string,
  steps: FlowStepRecord[],
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  try {
    const value = await fn();
    steps.push({ step, actorId, startedAt, finishedAt: new Date().toISOString(), ok: true });
    return value;
  } catch (error) {
    steps.push({ step, actorId, startedAt, finishedAt: new Date().toISOString(), ok: false });
    throw error;
  }
}

export async function runWorkerBossFlow<TDraft>(config: {
  task: WorkTask;
  worker: WorkerDef<TDraft>;
  selfVerifier?: SelfVerifierDef<TDraft>;
  specialistVerifier: SpecialistVerifierDef<TDraft>;
  boss: BossDef<TDraft>;
}): Promise<FlowOutcome<TDraft>> {
  const { task, worker, selfVerifier, specialistVerifier, boss } = config;

  // Fail fast on independence violations before any work is done.
  assertIndependentVerifier(worker.actor, specialistVerifier.actor);
  assertIndependentVerifier(worker.actor, boss.actor);

  const steps: FlowStepRecord[] = [];

  const draft = await timed('produce', worker.actor.id, steps, () => worker.produce(task));

  let self: SelfCheckResult = { passed: true, notes: 'No self-verification configured.' };
  if (selfVerifier !== undefined) {
    // Same origin IS allowed for self-verification by design; it never certifies.
    self = await timed('self-verify', selfVerifier.actor.id, steps, () =>
      selfVerifier.selfVerify(task, draft),
    );
  }

  const report = await timed('specialist-verify', specialistVerifier.actor.id, steps, () =>
    specialistVerifier.verify(task, draft, self),
  );

  const decision = await timed('boss-decide', boss.actor.id, steps, () =>
    boss.decide(task, draft, self, report),
  );

  const verdictCounts: Record<Verdict, number> = { pass: 0, fail: 0, inconclusive: 0 };
  for (const finding of report.findings) verdictCounts[finding.verdict] += 1;

  return {
    accepted: decision.decision === 'accepted',
    decision,
    draft,
    self,
    specialistReport: report,
    verdictCounts,
    steps,
  };
}
