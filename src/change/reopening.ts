/**
 * §2.4 Change / Reopening Process — fail-closed gate (Level 2+, spec §2.4).
 *
 * When Build, Test, or Deployment/Operations discovers a genuine gap against
 * the certified baseline, the discovering stage can NEVER close the gap by
 * acting alone. This gate is the neutral, mechanical admission point for the
 * Change/Reopen Request:
 *
 *   - It validates the request (must name certified artifacts or propose a
 *     new artifact base, with a reason).
 *   - It fails closed on SELF-ADJUDICATION: no verifier (and in particular
 *     neither the Design Boss nor any Safe Change certifier) may be the
 *     stage that opens a request, and a verifier may never be the discovering
 *     stage. Only a producing stage (ai/system) can open a request.
 *   - It runs the Safe Change Intelligence Impact Analysis semantics over the
 *     named set (declared + Dependency-Map discovered -> affected) so the
 *     request records what else the change touches before any re-evaluation.
 *
 * The gate does NOT certify. Certification of re-evaluated scope is solely
 * the Design Boss's job (§1.3), so the request is admitted to the discovery /
 * design re-evaluation chain and the certified baseline stays unchanged until
 * that chain clears it. Nothing enters the Master Product Inventory through a
 * side door (§2.4 property 3).
 */
import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import { DESIGN_BOSS } from '../design/studio.ts';
import { SAFE_CHANGE_BOSS_ACTOR } from './boss.ts';
import { SAFE_CHANGE_AUDITOR_ACTOR } from './auditor.ts';
import { downstreamArtifacts } from '../perm/dependency-map.ts';

const GATE: Actor = { kind: 'system', id: 'change-reopening-gate-01' };

export interface ChangeReopenRequest {
  readonly requestId: string;
  /** The stage that discovered the gap (Build / Test / Deployment / Ops). */
  readonly discoveredBy: Actor;
  /** Certified artifact(s) the gap affects; empty only when proposing anew. */
  readonly namedArtifacts?: readonly string[];
  /** A new artifact base when nothing already certified covers the gap. */
  readonly newProposalBaseId?: string;
  readonly reason: string;
  readonly openedAt?: string;
}

export type ReopenVerdict =
  | 'ACCEPTED_FOR_RE_EVALUATION'
  | 'REJECTED_INVALID'
  | 'REJECTED_SELF_ADJUDICATION';

export interface ReopenDecision {
  readonly requestId: string;
  readonly verdict: ReopenVerdict;
  readonly declared: readonly string[];
  readonly discovered: readonly string[];
  readonly affected: readonly string[];
  readonly analysisHash: string;
  readonly rationale: string;
  readonly reviewedBy: Actor;
  readonly reviewedAt: string;
}

const CERTIFIERS: ReadonlySet<string> = new Set([
  DESIGN_BOSS.id,
  SAFE_CHANGE_BOSS_ACTOR.id,
  SAFE_CHANGE_AUDITOR_ACTOR.id,
]);

/** The discovering stage must be a producer. A verifier (or explicitly a
 *  certifier) opening a request is the §2.4 self-adjudication failure mode
 *  and fails the request closed. */
function isProducer(actor: Actor): boolean {
  return (actor.kind === 'ai' || actor.kind === 'system') && !CERTIFIERS.has(actor.id);
}

export function evaluateChangeReopenRequest(
  graph: KnowledgeGraph,
  request: ChangeReopenRequest,
): ReopenDecision {
  const reviewedAt = request.openedAt ?? new Date().toISOString();
  const base: Omit<ReopenDecision, 'verdict' | 'rationale'> = {
    requestId: request.requestId,
    declared: [],
    discovered: [],
    affected: [],
    analysisHash: '',
    reviewedBy: GATE,
    reviewedAt,
  };

  const named = [...new Set(request.namedArtifacts ?? [])].filter(
    (id) => typeof id === 'string' && id.length > 0,
  );
  const proposed = typeof request.newProposalBaseId === 'string'
    ? [request.newProposalBaseId]
    : [];
  if (
    request.requestId.length === 0 ||
    request.reason.trim().length === 0 ||
    (named.length === 0 && proposed.length === 0)
  ) {
    return {
      ...base,
      verdict: 'REJECTED_INVALID',
      rationale:
        'Change/Reopen Request rejected: a request needs an id, a reason, and ' +
        'at least one named certified artifact or a new-artifact proposal.',
    };
  }
  if (!isProducer(request.discoveredBy)) {
    return {
      ...base,
      verdict: 'REJECTED_SELF_ADJUDICATION',
      rationale:
        `Change/Reopen Request rejected: the discovering stage ` +
        `${request.discoveredBy.kind}/${request.discoveredBy.id} may not open or ` +
        'adjudicate its own request; only a producing stage may, and only the ' +
        'Design Boss certifies re-evaluated scope (§2.4).',
    };
  }

  const declared = [...new Set([...named, ...proposed])].sort();
  const related = new Set<string>();
  const knownIds = new Set(graph.allNodes().map((n) => n.id));
  for (const id of declared) {
    // A brand-new proposal base is not yet registered in the graph and has
    // no downstream to discover; only traverse declared ids that exist.
    if (!knownIds.has(id)) continue;
    for (const down of downstreamArtifacts(graph, id)) {
      related.add(down);
    }
  }
  const discovered: string[] = [];
  for (const id of related) {
    if (!declared.includes(id)) discovered.push(id);
  }
  discovered.sort();
  const affected = [...new Set([...declared, ...discovered])].sort();
  const analysisHash = createHash('sha256').update(
    JSON.stringify({ requestId: request.requestId, reason: request.reason, affected }),
  ).digest('hex');

  return {
    ...base,
    declared,
    discovered,
    affected,
    analysisHash,
    verdict: 'ACCEPTED_FOR_RE_EVALUATION',
    rationale:
      `Change/Reopen Request ${request.requestId} admitted to re-evaluation: ` +
      `affects ${declared.length} declared + ${discovered.length} Dependency-Map ` +
      `discovered artifact(s) (${affected.length} total). Certification of any ` +
      'revised scope remains solely the Design Boss’s authority (§2.4).',
  };
}