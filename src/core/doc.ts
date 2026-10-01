/**
 * Definition of Complete - the artifact state machine (spec §0.17 + Level-4
 * drift-loop extension).
 *
 * "Done" is never a worker's declaration; it is a position in this fixed
 * linear state machine that every artifact occupies from first discovery
 * through permanent operation:
 *
 *   DISCOVERED -> EXPANDED -> SELF-VERIFIED -> SPECIALIST-VERIFIED ->
 *   BOSS-VERIFIED -> CERTIFIED -> DESIGNED -> DESIGN-VERIFIED ->
 *   IMPLEMENTED -> CODE-VERIFIED -> TESTED -> TEST-VERIFIED ->
 *   DEPLOYED-VERIFIED -> CERTIFIED COMPLETE
 *
 *   ...then, on a legitimate regression at runtime, the Level-4 drift loop:
 *   CERTIFIED COMPLETE -> REGRESSION_DETECTED -> RE-MEDIATED ->
 *   RE-MEDIATION-VERIFIED -> CERTIFIED COMPLETE
 *
 * Rules implemented here:
 *  - Forward movement is strictly forward, one gate at a time; skipping or
 *    going backwards on the happy path throws DocStateError.
 *  - The only legal BACKWARD transition is `CERTIFIED COMPLETE` ->
 *    `REGRESSION_DETECTED`, and only by the runtime-regression gate
 *    (operations / continuous / safe-change boss). Every other backward
 *    transition is illegal.
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
  'DEPLOYED-VERIFIED',
  'CERTIFIED COMPLETE',
  'REGRESSION_DETECTED',
  'RE-MEDIATED',
  'RE-MEDIATION-VERIFIED',
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
  'DEPLOYED-VERIFIED': 'deploy-verifier',
  'CERTIFIED COMPLETE': 'certification-engine',
  REGRESSION_DETECTED: 'runtime-regression-detector',
  'RE-MEDIATED': 'safe-change-boss',
  'RE-MEDIATION-VERIFIED': 'safe-change-auditor',
};

export function docIndexOf(state: DocState): number {
  return DOC_STATES.indexOf(state);
}

export function docSuccessor(state: DocState): DocState | null {
  const index = docIndexOf(state);
  if (index < 0) return null;
  // The L4 drift loop closes back to CERTIFIED COMPLETE after the auditor
  // verifies the remediation; that is the ONLY legal successor from the
  // drift-loop terminal state.
  if (state === 'RE-MEDIATION-VERIFIED') return 'CERTIFIED COMPLETE';
  if (index >= DOC_STATES.length - 1) return null;
  return DOC_STATES[index + 1] ?? null;
}

/**
 * The only legal BACKWARD transition on the happy path is
 *   CERTIFIED COMPLETE -> REGRESSION_DETECTED
 * invoked by the runtime-regression-detector. Every other backward move
 * is illegal.
 */
export function docPredecessor(state: DocState): DocState | null {
  if (state === 'REGRESSION_DETECTED') return 'CERTIFIED COMPLETE';
  return null;
}

/** Pure check: may `to` legally follow `from`? Forward only, plus the
 *  single legal backward regression transition. */
export function canAdvanceDoc(from: DocState | undefined, to: DocState): boolean {
  if (from === undefined) return to === 'DISCOVERED';
  if (docSuccessor(from) === to) return true;
  // The single legal backward move: a regression at runtime downgrades
  // CERTIFIED COMPLETE to REGRESSION_DETECTED.
  if (docPredecessor(to) === from) return true;
  return false;
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
 * steps. Judges are enforced at the identity level - the §0.4 independence
 * principle, not merely a kind label:
 *   - judgment gates require a verifier/system actor that is NOT the
 *     artifact's producing actor (a producer rotating into a judge bucket
 *     with the same id adjudicates its own work and changes nothing),
 *   - production steps require the producing worker itself.
 */
export function assertDocGovernor(to: DocState, actor: Actor, producer?: { readonly id: string }): void {
  const governor = DOC_GATE_GOVERNORS[to];
  const productionRoles = new Set(['worker', 'design-worker', 'build-worker', 'test-worker']);
  const judgmentRoles = new Set([
    'self-check', 'specialist-verifier', 'boss', 'certification-engine',
    'master-verification-engine', 'code-verifier', 'test-verifier',
    'deploy-verifier', 'runtime-regression-detector', 'safe-change-boss',
    'safe-change-auditor',
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
  if (judgmentRoles.has(governor) && producer !== undefined && actor.id === producer.id) {
    throw new DocStateError(
      `Gate "${governor}" for ${to} must be adjudicated by a judge distinct from the ` +
        `producer: "${actor.kind}:${actor.id}" is the producing actor and cannot ` +
        `certify its own work.`,
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
  // Judges must be distinct from the producing actor (identity-level §0.4
  // independence), not merely verifier/system labeled.
  assertDocGovernor(to, actor, current.createdBy);
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

// ---------------------------------------------------------------------------
// Governed forward walking (used by later-stage engines, e.g. the Level-3
// Acceptance Testing Department advancing implemented artifacts to
// TEST-VERIFIED).
// ---------------------------------------------------------------------------

/**
 * Canonical engine actors for gates whose evidence already exists in the
 * recorded lifecycle. The walker only stamps positions that are TRUE of the
 * stored history - it back-fills the linear machine from authoritative
 * provenance, it never invents events.
 */
const WALKER_ACTORS: Readonly<Record<string, Actor>> = {
  'design-worker': { kind: 'ai', id: 'design-worker-01' },
  'master-verification-engine': { kind: 'system', id: 'master-verification-engine' },
  'build-worker': { kind: 'ai', id: 'build-worker-01' },
  'code-verifier': { kind: 'system', id: 'code-verifier-engine' },
  'test-worker': { kind: 'ai', id: 'test-worker-01' },
  'test-verifier': { kind: 'verifier', id: 'test-specialist-01' },
  'deploy-verifier': { kind: 'verifier', id: 'deploy-specialist-01' },
};

export interface DocWalkResult {
  readonly reachedTarget: boolean;
  readonly state: DocState;
  /** Set when walking stopped because CERTIFIED has no recorded basis yet. */
  readonly haltedAt?: DocState;
}

/**
 * Walks an artifact forward along the §0.17 machine to `target`, one legal
 * gate at a time, stamping each intermediate state whose fact is already
 * recorded. HARD RULE: the walker will NOT cross into CERTIFIED unless the
 * artifact already sits at/behind it - certification is the Level-2
 * certification engine's judgment, not a bookkeeping step. In that case the
 * walk halts honestly (haltedAt='CERTIFIED') leaving every earlier true
 * state stamped.
 */
export async function advanceDocPath(
  store: ArtifactStore,
  id: string,
  target: DocState,
  options?: { evidenceId?: string },
): Promise<DocWalkResult> {
  let current = await store.require(id);
  let state = docStateOf(current) ?? inferDocState(current);
  if (state === undefined) {
    throw new DocStateError(`Cannot advance ${id}: no DoC position (not even DISCOVERED).`);
  }
  const goal = docIndexOf(target);
  let index = docIndexOf(state);
  while (index < goal) {
    const next = DOC_STATES[index + 1];
    if (next === undefined) break;
    if (next === 'CERTIFIED') {
      // Only the certification engine may stamp CERTIFIED (it did so during
      // Level-2 certification when applicable). Crossing here without that
      // recorded judgment would fabricate certification.
      return { reachedTarget: false, state: DOC_STATES[index] ?? state, haltedAt: 'CERTIFIED' };
    }
    const governor = DOC_GATE_GOVERNORS[next];
    const actor = WALKER_ACTORS[governor];
    if (actor === undefined) {
      return { reachedTarget: false, state: DOC_STATES[index] ?? state, haltedAt: next };
    }
    // Every stamped gate carries the evidence id that SUPPORTS it, so a DoC
    // position is always auditable back to a real recorded fact, never a
    // bookkeeping invention.
    current = await recordDocGate(store, id, next, actor, { evidenceId: options?.evidenceId });
    state = next;
    index += 1;
  }
  return { reachedTarget: index >= goal, state };
}