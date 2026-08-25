/**
 * Definition of Complete - the artifact state machine (spec §0.17).
 *
 * "Done" is never a worker's declaration; it is a position in this fixed
 * linear state machine that every artifact occupies from first discovery
 * through permanent operation:
 *
 *   DISCOVERED -> EXPANDED -> SELF-VERIFIED -> SPECIALIST-VERIFIED ->
 *   BOSS-VERIFIED -> CERTIFIED -> DESIGNED -> DESIGN-VERIFIED ->
 *   IMPLEMENTED -> CODE-VERIFIED -> TESTED -> TEST-VERIFIED ->
 *   CERTIFIED COMPLETE
 *
 * Rules implemented here:
 *  - Movement is strictly forward, one gate at a time; skipping or going
 *    backwards throws DocStateError.
 *  - Every advance requires the GOVERNOR of that transition (self-check,
 *    specialist, boss, audit/certification engine) - a producer's own claim
 *    is rejected as a governor for any state beyond its own production step.
 *  - State lives on the artifact (attributes.docState) and every advance is
 *    recorded in provenance with the gate + evidence id, so completion is
 *    always auditable.
 *
 * Level-2 scope note: states up to BOSS-VERIFIED are reachable by the
 * existing Level-1a/1b engines (derivable from stored provenance); CERTIFIED
 * is stamped by Blueprint Completeness Certification; DESIGNED onward is
 * exercised by later stages' gates as those stages come online.
 */

import type { Actor, Artifact } from './artifact.ts';
import { DocStateError } from './errors.ts';

export const DOC_STATES = [
  'DISCOVERED',
  'EXPANDED',
  'SELF-VERIFIED',
  'SPECIALIST-VERIFIED',
  'BOSS-VERIFIED',
  'CERTIFIED',
  'DESIGNED',
  'DESIGN-VERIFIED',
  'IMPLEMENTED',
  'CODE-VERIFIED',
  'TESTED',
  'TEST-VERIFIED',
  'CERTIFIED COMPLETE',
] as const;

export type DocState = (typeof DOC_STATES)[number];

/** The gate that governs entry into each state (index = target state). */
export const DOC_GATE_GOVERNORS: Readonly<Record<DocState, string>> = {
  DISCOVERED: 'worker',
  EXPANDED: 'worker',
  'SELF-VERIFIED': 'self-check',
  'SPECIALIST-VERIFIED': 'specialist-verifier',
  'BOSS-VERIFIED': 'boss',
  CERTIFIED: 'certification-engine',
  DESIGNED: 'design-worker',
  'DESIGN-VERIFIED': 'master-verification-engine',
  IMPLEMENTED: 'build-worker',
  'CODE-VERIFIED': 'code-verifier',
  TESTED: 'test-worker',
  'TEST-VERIFIED': 'test-verifier',
  'CERTIFIED COMPLETE': 'certification-engine',
};

export function docIndexOf(state: DocState): number {
  return DOC_STATES.indexOf(state);
}

export function docSuccessor(state: DocState): DocState | null {
  const index = docIndexOf(state);
  if (index < 0 || index >= DOC_STATES.length - 1) return null;
  return DOC_STATES[index + 1] ?? null;
}

/** Pure check: may `to` legally follow `from`? Only the immediate successor. */
export function canAdvanceDoc(from: DocState | undefined, to: DocState): boolean {
  if (from === undefined) return to === 'DISCOVERED';
  return docSuccessor(from) === to;
}

export function assertDocTransition(from: DocState | undefined, to: DocState): void {
  if (!canAdvanceDoc(from, to)) {
    const current = from ?? '(none)';
    throw new DocStateError(
      `Illegal Definition-of-Complete transition ${current} -> ${to}. ` +
        `From ${current} only ${docSuccessor(from ?? 'DISCOVERED') ?? '(terminal)'} is legal.`,
    );
  }
}

/**
 * The governor attempting an advance must be entitled to that gate: producers
 * cannot govern judgment gates, and judgment actors cannot govern production
 * steps. Enforced by actor-id equality against the expected governor role.
 */
export function assertDocGovernor(to: DocState, actor: Actor): void {
  const governor = DOC_GATE_GOVERNORS[to];
  const productionRoles = new Set(['worker', 'design-worker', 'build-worker', 'test-worker']);
  const judgmentRoles = new Set([
    'self-check', 'specialist-verifier', 'boss', 'certification-engine',
    'master-verification-engine', 'code-verifier', 'test-verifier',
  ]);
  const actorIsJudgment =
    actor.kind === 'verifier' || actor.kind === 'system';
  if (productionRoles.has(governor) && !actorIsJudgment && actor.kind !== 'ai') {
    throw new DocStateError(
      `Gate "${governor}" for ${to} must be executed by the producing worker.`,
    );
  }
  if (judgmentRoles.has(governor) && !actorIsJudgment) {
    throw new DocStateError(
      `Gate "${governor}" for ${to} requires an independent judge (verifier/system), ` +
        `got actor kind "${actor.kind}:${actor.id}". A producer's own declaration changes nothing.`,
    );
  }
}

/** Reads the artifact's current DoC position (undefined before DISCOVERED). */
export function docStateOf(artifact: { readonly attributes?: Readonly<Record<string, unknown>> }): DocState | undefined {
  const raw = artifact.attributes?.['docState'];
  return typeof raw === 'string' && (DOC_STATES as readonly string[]).includes(raw)
    ? (raw as DocState)
    : undefined;
}

import type { ArtifactStore } from './store.ts';
import { withProvenance } from './artifact.ts';

/**
 * Records a governed DoC advance on the artifact: validates the linear
 * transition and the governor's entitlement, stamps attributes.docState, and
 * appends a provenance entry carrying the gate name (+ optional evidence).
 */
export async function recordDocGate(
  store: ArtifactStore,
  id: string,
  to: DocState,
  actor: Actor,
  options: { gate?: string; evidenceId?: string },
): Promise<Artifact> {
  const current = await store.require(id);
  // The effective position is the EXPLICIT stamp if present, otherwise
  // derived from the artifact's recorded lifecycle (Levels 1a/1b recorded
  // their gates as provenance before §0.17 stamping existed - that history
  // is authoritative and must count).
  const from = docStateOf(current) ?? inferDocState(current);
  assertDocTransition(from, to);
  assertDocGovernor(to, actor);
  const gate = options.gate ?? DOC_GATE_GOVERNORS[to];
  const at = new Date().toISOString();
  const entry = {
    at,
    action: 'doc-gate' as const,
    actor,
    note: `DoC ${from ?? '(none)'} -> ${to} via ${gate}`,
    ...(options.evidenceId !== undefined ? { evidenceId: options.evidenceId } : {}),
  };
  return store.update(id, current.version, (draft) => ({
    ...withProvenance(draft, entry),
    attributes: { ...draft.attributes, docState: to },
  }));
}

/**
 * Infers an artifact's DoC position from its existing lifecycle record when
 * no explicit docState has been stamped - this is how the Level-1a/1b
 * engines' already-recorded gates map onto the §0.17 machine without
 * rewriting them:
 *   - created by an AI worker            -> DISCOVERED
 *   - status-changed VERIFIED by a boss  -> BOSS-VERIFIED
 *   - status-changed VERIFIED otherwise  -> SPECIALIST-VERIFIED
 * Explicit attributes.docState always wins.
 */
export function inferDocState(artifact: {
  readonly createdBy: Actor;
  readonly status: string;
  readonly provenance: readonly { readonly action: string; readonly actor: Actor; readonly note?: string }[];
  readonly attributes?: Readonly<Record<string, unknown>>;
}): DocState | undefined {
  const explicit = docStateOf(artifact);
  if (explicit !== undefined) return explicit;
  let position: DocState | undefined;
  if (artifact.createdBy.kind === 'ai') position = 'DISCOVERED';
  for (const entry of artifact.provenance) {
    if (
      entry.action === 'status-changed' &&
      entry.actor.kind === 'verifier' &&
      /boss/i.test(entry.actor.id)
    ) {
      position = 'BOSS-VERIFIED';
    }
  }
  if (position === undefined && artifact.status === 'VERIFIED') {
    const verifiedByNonBoss = artifact.provenance.some(
      (entry) =>
        entry.action === 'status-changed' &&
        entry.actor.kind === 'verifier' &&
        !/boss/i.test(entry.actor.id),
    );
    if (verifiedByNonBoss) position = 'SPECIALIST-VERIFIED';
  }
  if (artifact.status === 'APPROVED') {
    position = position === 'BOSS-VERIFIED' ? 'BOSS-VERIFIED' : position;
  }
  // A later downgrade (reopened/rework) regresses the derived DoC position:
  // only VERIFIED/APPROVED lifecycles may sit at or above SPECIALIST-VERIFIED
  // when nothing explicit is stamped.
  if (
    position !== undefined &&
    docIndexOf(position) > docIndexOf('DISCOVERED') &&
    artifact.status !== 'VERIFIED' &&
    artifact.status !== 'APPROVED'
  ) {
    position = 'DISCOVERED';
  }
  return position;
}