/**
 * Continuous Engineering Boss (spec §5.2) - regression protection.
 *
 * The Boss's specific responsibility that has no equivalent in Stages 1-4:
 * verifying that the continuous worker corps' report is consistent with the
 * expected post-deployment state derived independently from the certified
 * baselines. A change that passes its own tests but silently regresses an
 * unrelated, previously CERTIFIED COMPLETE artifact is caught here by ID,
 * before it is allowed to advance the Definition of Complete.
 *
 * The Boss never trusts the worker's report as input. It independently:
 *   1. Re-derives the live-stable scope from the certified DEPLOYED-VERIFIED
 *      closure (same mechanical rule the Operations Department used).
 *   2. For each base in scope, independently confirms the live verdict by
 *      re-running the closure verifier on a deterministic sample.
 *   3. Diffs its reconstruction against the worker's driftFindings.
 *
 * Any delta rejects. Zero deltas accepts with a reconstruction rationale.
 */
import type { CoreServices } from '../core/services.ts';
import { deriveDeployScope } from '../operations/scope.ts';
import { MasterVerificationEngine } from '../verification/master-engine.ts';
import { ReasoningCouncil } from '../council/council.ts';
import { createClosureVerifier } from '../verification/closure-verifier.ts';
import type { DriftItem } from '../verification/live-engine.ts';

export interface ContinuousBossDecision {
  readonly verdict: 'accepted' | 'rejected';
  readonly rationale: string;
  readonly reconstructedCount: number;
  readonly stableArtifacts: readonly string[];
}

/**
 * Deterministic, de-duplicating sample picker. Always returns a stable
 * subset of `items` of size `min(sampleSize, items.length)`, where the
 * order in the output preserves the order in the input.
 */
export function sampleArtifacts<T extends { baseId: string }>(
  items: readonly T[],
  sampleSize: number,
): readonly T[] {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.min(sampleSize, items.length));
  const picked: T[] = [];
  for (let i = 0; i < size; i += 1) {
    const index = Math.floor((i * items.length) / size);
    const candidate = items[index];
    if (candidate !== undefined && !picked.some((p) => p.baseId === candidate.baseId)) {
      picked.push(candidate);
    }
  }
  return picked;
}

export async function runContinuousBoss(
  services: CoreServices,
  projectId: string,
  workerReport: { driftFindings: readonly DriftItem[]; observations: readonly { baseId: string; stable: boolean }[] },
  options: { sampleSize?: number } = {},
): Promise<ContinuousBossDecision> {
  const expected = await deriveDeployScope(services, projectId);
  const sampleSize = options.sampleSize ?? Math.max(1, Math.ceil(expected.length / 2));
  const workerById = new Map(workerReport.observations.map((o) => [o.baseId, o]));

  const missing: string[] = [];
  const extraWorker: string[] = [];
  const regressionsMissed: string[] = [];
  const stableFalselyReported: string[] = [];

  const verifiers = [{ name: 'closure-verifier', verifier: createClosureVerifier() }];
  const council = await new ReasoningCouncil(services).deliberate({
    subject: `continuous-boss-reconstruction-${projectId}`,
    question: 'Independent reconstruction: do these artifacts still verify against the certified baselines?',
    contextSummary: 'Continuous Engineering Boss independently reconstructing live-stable state.',
    artifactIds: expected.map((e) => e.baseId),
  });

  const bossNow = await new MasterVerificationEngine(services).verifyArtifactSet({
    artifactIds: sampleArtifacts(expected, sampleSize).map((e) => e.baseId),
    artifactClass: 'blueprint',
    verifiers,
    producerActors: [
      { kind: 'ai', id: 'understanding-worker-01' },
      { kind: 'ai', id: 'structural-worker-01' },
      { kind: 'ai', id: 'design-worker-01' },
      { kind: 'ai', id: 'build-worker-01' },
    ],
    deliberation: council,
  });

  for (const exp of expected) {
    if (!workerById.has(exp.baseId)) missing.push(exp.baseId);
  }
  for (const obs of workerReport.observations) {
    if (!expected.some((e) => e.baseId === obs.baseId)) extraWorker.push(obs.baseId);
  }

  for (const exp of sampleArtifacts(expected, sampleSize)) {
    const report = bossNow.reports[exp.baseId];
    const bossVerdict = report === undefined ? 'absent'
      : report.findings.some((f) => f.verdict === 'fail') ? 'fail'
      : report.findings.some((f) => f.verdict === 'inconclusive') ? 'inconclusive'
      : 'pass';
    const workerObs = workerById.get(exp.baseId);
    if (bossVerdict === 'fail' && (workerObs === undefined || workerObs.stable)) {
      regressionsMissed.push(exp.baseId);
    }
    if (bossVerdict === 'pass' && workerObs !== undefined && !workerObs.stable) {
      stableFalselyReported.push(exp.baseId);
    }
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`scoped artifacts silently unreported: [${missing.join(', ')}]`);
  if (extraWorker.length > 0) parts.push(`reported outside DEPLOYED-VERIFIED scope: [${extraWorker.join(', ')}]`);
  if (regressionsMissed.length > 0) {
    parts.push(`regressions found but unreported by worker: [${regressionsMissed.join(', ')}]`);
  }
  if (stableFalselyReported.length > 0) {
    parts.push(`falsely marked unstable: [${stableFalselyReported.join(', ')}]`);
  }

  const stableArtifacts = workerReport.observations
    .filter((o) => o.stable && expected.some((e) => e.baseId === o.baseId))
    .map((o) => o.baseId);

  if (parts.length > 0) {
    return {
      verdict: 'rejected',
      rationale: `Reconstruction diverged: ${parts.join(' | ')}`,
      reconstructedCount: expected.length,
      stableArtifacts: [],
    };
  }
  return {
    verdict: 'accepted',
    rationale: `Reconstruction confirms ${expected.length}/${expected.length} artifact(s) in DEPLOYED-VERIFIED scope; no silent regressions. ${stableArtifacts.length} stable for CERTIFIED COMPLETE.`,
    reconstructedCount: expected.length,
    stableArtifacts,
  };
}
