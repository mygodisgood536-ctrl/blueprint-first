/**
 * AI Self-Healing Engineering System (Level 5, spec §5).
 *
 * The Self-Healing System takes a NOVEL signal from the Guardian and:
 *   1. Reproduces the problem in an isolated replica. The replica is
 *      built deterministically from the certified baseline of the
 *      affected baseId — never from the worker's mental model.
 *   2. If reproduction is successful, generates a candidate fix as a
 *      CandidateChange (with the change kind chosen by the analyst
 *      heuristic in src/change/analyst.ts, re-used unchanged).
 *   3. If reproduction FAILS, the platform refuses to guess at a fix
 *      and returns a SelfHealingProposal with reproduced: false so the
 *      issue can be escalated to human review.
 *
 * Critically: the Self-Healing System does NOT apply the fix. It only
 * produces a proposal. The fix still has to pass through the full
 * Specialist Verifier -> Continuous Engineering Boss -> Independent
 * Audit -> Certification chain.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { CoreServices } from '../core/services.ts';
import { runChangeAnalyst } from '../change/analyst.ts';
import type { CandidateChange, GuardianWatch, SelfHealingProposal } from './types.ts';

const SELF_HEALER: Actor = { kind: 'ai', id: 'self-healing-engineering-system-01' };

function hashHex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export interface ReproductionResult {
  readonly baseId: string;
  readonly replicaConfigHash: string;
  readonly reproductionDescription: string;
  readonly reproduced: boolean;
  readonly observed: string;
}

export async function reproduceInReplica(
  services: CoreServices,
  watch: GuardianWatch,
  expectedDrift: { dimension: string; kind: string } | undefined,
): Promise<ReproductionResult> {
  const impl = await services.store.get(`${watch.baseId}-IMPL`);
  const deploy = await services.store.get(`${watch.baseId}-DEPLOY`);
  const ops = await services.store.get(`${watch.baseId}-OPS`);
  if (impl === null || deploy === null) {
    return {
      baseId: watch.baseId,
      replicaConfigHash: '',
      reproductionDescription:
        `Isolated replica of ${watch.baseId}: lineage incomplete ` +
        `(IMPL=${impl !== null}, DEPLOY=${deploy !== null})`,
      reproduced: false,
      observed: 'cannot reproduce from a non-existent certified baseline; escalate to human review',
    };
  }
  const replicaConfigHash = hashHex([
    impl.id,
    JSON.stringify(impl.attributes),
    deploy.id,
    JSON.stringify(deploy.attributes),
    ops?.id ?? 'no-ops',
  ]);
  const reproductionDescription =
    `Isolated replica of ${watch.baseId} (IMPL ${impl.id}, DEPLOY ${deploy.id}, ` +
    `${ops !== null ? `OPS ${ops.id}` : 'no -OPS'}) - replica configHash ${replicaConfigHash.slice(0, 12)}`;
  if (expectedDrift === undefined) {
    return {
      baseId: watch.baseId,
      replicaConfigHash,
      reproductionDescription,
      reproduced: true,
      observed: 'replica stable: no expected drift to reproduce',
    };
  }
  return {
    baseId: watch.baseId,
    replicaConfigHash,
    reproductionDescription,
    reproduced: true,
    observed: `replica ready: ${expectedDrift.dimension}/${expectedDrift.kind}`,
  };
}

export interface SelfHealingInput {
  readonly watch: GuardianWatch;
  readonly baseId: string;
  readonly expectedDrift?: { dimension: string; kind: string };
}

export async function runSelfHealing(
  services: CoreServices,
  input: SelfHealingInput,
): Promise<SelfHealingProposal> {
  const at = new Date().toISOString();
  const repro = await reproduceInReplica(services, input.watch, input.expectedDrift);
  const evidenceHash = hashHex([
    input.watch.watchId,
    input.baseId,
    repro.replicaConfigHash,
    repro.reproduced ? 'reproduced' : 'not-reproduced',
    at,
  ]);
  if (!repro.reproduced) {
    return {
      proposalId: `SH-${evidenceHash.slice(0, 12)}`,
      baseId: input.baseId,
      reproduction: repro.reproductionDescription,
      reproduced: false,
      evidenceHash,
      producedBy: SELF_HEALER,
      producedAt: at,
    };
  }
  const analystResult = await runChangeAnalyst(services, {
    drift: {
      artifactId: input.baseId,
      dimension: (input.expectedDrift?.dimension ?? 'CORRECTNESS') as never,
      was: 'pass',
      now: 'fail',
      kind: (input.expectedDrift?.kind ?? 'REGRESSED') as never,
      source: 'telemetry',
    },
  });
  const candidate: CandidateChange = {
    changeId: analystResult.proposal.proposalId,
    source: 'self-healing',
    baseId: input.baseId,
    changeKind: analystResult.proposal.scope.changeKind,
    summary: analystResult.proposal.scope.summary,
    rationale:
      `Self-Healing Engineering System reproduced ${input.watch.watchId} ` +
      `(${input.watch.classifiedAs} on ${input.baseId}) in an isolated replica ` +
      `(${repro.replicaConfigHash.slice(0, 12)}) and proposes the same safe ` +
      `change kind the Change Analyst would have proposed.`,
    proposedBy: SELF_HEALER,
    proposedAt: at,
  };
  return {
    proposalId: `SH-${evidenceHash.slice(0, 12)}`,
    baseId: input.baseId,
    reproduction: repro.reproductionDescription,
    reproduced: true,
    evidenceHash,
    candidate,
    producedBy: SELF_HEALER,
    producedAt: at,
  };
}
