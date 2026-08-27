/**
 * Safe Change Intelligence - Change Analyst worker (Level 4, spec §5.1).
 *
 * The Analyst is a worker: it never certifies anything. It receives a drift
 * and (optionally) a runtime observation, and produces a structured
 * RemediationProposal describing the SMALLEST, MOST SPECIFIC, in-authorized
 * change it would apply. The proposal is sha256-anchored and is the input
 * to the Safe Change Boss.
 *
 * In a live deployment the Analyst may consult the AI Router for a
 * remediation strategy. In this repository the script-driven `analyst`
 * rule is the deterministic stand-in. The proposal content is then
 * validated against the architectural rules (change-kind whitelist,
 * per-base scope, evidence anchors) before being returned.
 */
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';
import type { CoreServices } from '../core/services.ts';
import { nextProposalId, proposalContentHash, type RemediationProposal, type RemediationScope } from './types.ts';

const WORKER: { kind: 'ai'; id: string } = { kind: 'ai', id: 'change-analyst-01' };

const SAFE_CHANGE_KINDS: ReadonlySet<RemediationScope['changeKind']> = new Set([
  'config_restoration',
  'cache_invalidation',
  'dependency_rollback',
  'feature_flag_toggle',
  'documentation_update',
]);

export interface AnalystProposalInput {
  readonly drift: DriftItem;
  readonly observation?: TelemetryObservation;
  /** Optional override of the chosen change kind; falls back to the heuristic. */
  readonly changeKind?: RemediationScope['changeKind'];
}

export interface AnalystProposalResult {
  readonly proposal: RemediationProposal;
  /** True when the heuristic derived a SAFE-kind from the drift; false means
   *  the worker attempted to propose something OUT_OF_AUTHORIZED_SCOPE and
   *  the proposal is so flagged (so the Boss can reject it). */
  readonly withinSafeKinds: boolean;
}

export async function runChangeAnalyst(
  services: CoreServices,
  input: AnalystProposalInput,
): Promise<AnalystProposalResult> {
  const proposalId = nextProposalId(services.allocator);
  const proposedAt = new Date().toISOString();
  const changeKind = input.changeKind ?? deriveChangeKind(input.drift, input.observation);
  const withinSafeKinds = SAFE_CHANGE_KINDS.has(changeKind);
  const scope: RemediationScope = {
    baseId: input.drift.artifactId,
    summary: buildSummary(input.drift, changeKind),
    changeKind,
  };
  const draft: Omit<RemediationProposal, 'proposalHash'> = {
    proposalId,
    driftId: input.drift.artifactId + '/' + input.drift.dimension,
    scope,
    proposedBy: WORKER.id,
    proposedAt,
    drift: input.drift,
    ...(input.observation !== undefined ? { observation: input.observation } : {}),
    rationale: buildRationale(input.drift, changeKind, withinSafeKinds),
  };
  const proposalHash = proposalContentHash(draft);
  const proposal: RemediationProposal = { ...draft, proposalHash };
  return { proposal, withinSafeKinds };
}

function deriveChangeKind(drift: DriftItem, obs?: TelemetryObservation): RemediationScope['changeKind'] {
  // The Analyst maps metric -> change kind deterministically. Anything it
  // would propose outside the safe set is still emitted (so the Boss can
  // reject) but the default heuristic stays inside the safe set.
  if (obs?.metric === 'config_drift') return 'config_restoration';
  if (obs?.metric === 'response_correctness') return 'dependency_rollback';
  if (obs?.metric === 'latency') return 'cache_invalidation';
  if (obs?.metric === 'error_rate') return 'dependency_rollback';
  if (drift.dimension === 'CONSISTENCY' && drift.kind === 'REGRESSED') return 'feature_flag_toggle';
  if (drift.dimension === 'EVIDENCE_OF_WORK') return 'documentation_update';
  return 'config_restoration';
}

function buildSummary(drift: DriftItem, changeKind: RemediationScope['changeKind']): string {
  return `Apply ${changeKind} to ${drift.artifactId} on dimension ${drift.dimension} (was ${drift.was} -> now ${drift.now}).`;
}

function buildRationale(drift: DriftItem, changeKind: RemediationScope['changeKind'], withinSafeKinds: boolean): string {
  if (!withinSafeKinds) {
    return `Proposed change kind "${changeKind}" is OUT_OF_AUTHORIZED_SCOPE; flagging for boss rejection.`;
  }
  return `Drift on ${drift.artifactId} dimension ${drift.dimension} (${drift.was} -> ${drift.now}) mapped to safe change kind "${changeKind}".`;
}
