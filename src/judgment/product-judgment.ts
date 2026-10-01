/**
 * Product Judgment, Intent Preservation, Ambiguity Resolution and the
 * Decision Ledger (ARCHITECTURE 3.3, §105-§108).
 *
 * These laws sit BESIDE the completeness/correctness gates, never inside them:
 *
 *   §105 PRODUCT JUDGMENT IS DISTINCT FROM COMPLETENESS - a product can
 *        contain every discovered artifact and still be confusing,
 *        internally inconsistent, or poor at accomplishing the user's
 *        intended outcome. A separate capability evaluates that.
 *   §106 INTENT PRESERVATION - the original user intent / Product
 *        Understanding Brief is an immutable baseline; every major decision
 *        traces to intent, an explicit requirement, a justified inference, or
 *        an approved change. Drift is detected even when the code is
 *        internally consistent.
 *   §107 AMBIGUITY RESOLUTION - safe implementation inferences may be resolved
 *        by the engineering organization WITH recorded rationale; material
 *        decisions (money, permissions, identity, legal/compliance,
 *        destructive actions, external commitments, major product intent)
 *        must be escalated to a human decision rather than guessed.
 *   §108 DECISION LEDGER - material decisions carry durable IDs, the decision,
 *        rationale, evidence, alternatives, authorization, affected artifacts
 *        and downstream impact, so a later engineer can understand why.
 *
 * Every type here is judgment or governance state, never a completeness claim:
 * nothing in this file may mark an artifact complete, and nothing here may be
 * satisfied by a count.
 */

import { createHash } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';

// ── §106 INTENT PRESERVATION ────────────────────────────────────────────────

/** An immutable statement of what the user actually asked to build. */
export interface ProductIntent {
  readonly projectId: string;
  /** Stated goals, each traceable to a user statement (not an inference). */
  readonly goals: readonly string[];
  /** Stated target users, verbatim in the user's own terms. */
  readonly targetUsers: readonly string[];
  /** Explicit constraints the user stated. */
  readonly constraints: readonly string[];
  /** Explicit non-goals the user stated. */
  readonly nonGoals: readonly string[];
  /** sha256 anchor over the canonical intent text; the baseline is immutable. */
  readonly anchor: string;
  readonly establishedAt: string;
}

export function intentAnchor(
  goals: readonly string[],
  targetUsers: readonly string[],
  constraints: readonly string[],
  nonGoals: readonly string[],
): string {
  return createHash('sha256')
    .update(
      [goals, targetUsers, constraints, nonGoals]
        .map((g) => [...g].map((s) => s.trim()).sort().join('\u0000'))
        .join('\u0001'),
      'utf8',
    )
    .digest('hex');
}

export function establishIntent(
  input: Omit<ProductIntent, 'anchor' | 'establishedAt'> & { at?: string },
): ProductIntent {
  const anchor = intentAnchor(input.goals, input.targetUsers, input.constraints, input.nonGoals);
  return Object.freeze({
    projectId: input.projectId,
    goals: Object.freeze([...input.goals]),
    targetUsers: Object.freeze([...input.targetUsers]),
    constraints: Object.freeze([...input.constraints]),
    nonGoals: Object.freeze([...input.nonGoals]),
    anchor,
    establishedAt: input.at ?? new Date().toISOString(),
  });
}

/** How a decision or artifact relates back to the immutable intent baseline. */
export type IntentTrace =
  | { readonly kind: 'intent'; readonly reference: string; readonly detail: string }
  | { readonly kind: 'requirement'; readonly artifactId: string; readonly detail: string }
  | { readonly kind: 'justified-inference'; readonly rationale: string; readonly detail: string }
  | { readonly kind: 'approved-change'; readonly changeRequestId: string; readonly detail: string };

/** A detected departure from the original product purpose. */
export interface IntentDrift {
  readonly id: string;
  readonly projectId: string;
  readonly subject: string;
  readonly kind: 'untraceable' | 'contraindicated' | 'stale-baseline';
  readonly detail: string;
  readonly severity: 'warning' | 'error';
  readonly at: string;
}

function driftId(projectId: string, subject: string, kind: string): string {
  return `DRIFT-${createHash('sha256').update(`${projectId}\u0000${subject}\u0000${kind}`, 'utf8').digest('hex').slice(0, 12).toUpperCase()}`;
}

/**
 * Detects drift from the original intent. A subject is untraceable when it
 * claims no lineage back to intent at all; contraindicated when the intent
 * baseline explicitly excludes it (a stated non-goal); and the baseline itself
 * is reported as stale when the recorded anchor no longer matches the intent it
 * describes - i.e. something tried to quietly rewrite the baseline.
 */
export function detectIntentDrift(input: {
  projectId: string;
  intent: ProductIntent;
  subjects: readonly { id: string; label: string; trace: IntentTrace | null }[];
  at?: string;
}): IntentDrift[] {
  const at = input.at ?? new Date().toISOString();
  const findings: IntentDrift[] = [];

  // The baseline is immutable: if its recorded anchor disagrees with its own
  // contents, the baseline was tampered with and that is itself drift.
  const recomputed = intentAnchor(input.intent.goals, input.intent.targetUsers, input.intent.constraints, input.intent.nonGoals);
  if (recomputed !== input.intent.anchor) {
    findings.push(
      Object.freeze({
        id: driftId(input.projectId, 'intent-baseline', 'stale-baseline'),
        projectId: input.projectId,
        subject: 'Product intent baseline',
        kind: 'stale-baseline' as const,
        detail:
          'The immutable product intent baseline no longer matches its own anchor; the baseline was rewritten instead of being amended through the Change/Reopening process.',
        severity: 'error' as const,
        at,
      }),
    );
  }

  const nonGoals = new Set(input.intent.nonGoals.map((g) => g.trim().toLowerCase()).filter((g) => g.length > 0));
  for (const subject of input.subjects) {
    if (subject.trace === null) {
      findings.push(
        Object.freeze({
          id: driftId(input.projectId, subject.id, 'untraceable'),
          projectId: input.projectId,
          subject: `${subject.id} ${subject.label}`.trim(),
          kind: 'untraceable' as const,
          detail:
            'This artifact traces to no user statement, explicit requirement, justified inference, or approved change, so it cannot be shown to serve the original product purpose.',
          severity: 'error' as const,
          at,
        }),
      );
      continue;
    }
    if (nonGoals.has(subject.label.trim().toLowerCase())) {
      findings.push(
        Object.freeze({
          id: driftId(input.projectId, subject.id, 'contraindicated'),
          projectId: input.projectId,
          subject: `${subject.id} ${subject.label}`.trim(),
          kind: 'contraindicated' as const,
          detail:
            'The immutable intent baseline lists this subject as an explicit non-goal, yet it exists in the product inventory.',
          severity: 'error' as const,
          at,
        }),
      );
    }
  }
  return findings;
}

// ── §107 AMBIGUITY RESOLUTION ───────────────────────────────────────────────

/** Decision classes whose wrong answer is expensive, irreversible or external. */
export type MaterialDecisionClass =
  | 'business-behavior'
  | 'money'
  | 'permissions'
  | 'identity'
  | 'legal-compliance'
  | 'destructive-action'
  | 'external-commitment'
  | 'product-intent';

const MATERIAL_CLASSES: ReadonlySet<MaterialDecisionClass> = new Set<MaterialDecisionClass>([
  'business-behavior',
  'money',
  'permissions',
  'identity',
  'legal-compliance',
  'destructive-action',
  'external-commitment',
  'product-intent',
]);

export function isMaterialDecisionClass(value: string): value is MaterialDecisionClass {
  return MATERIAL_CLASSES.has(value as MaterialDecisionClass);
}

export type AmbiguityResolution =
  /** The engineering organization may resolve this, with recorded rationale. */
  | { readonly kind: 'safe-inference'; readonly rationale: string; readonly decidedBy: string; readonly at: string }
  /** This must stop for a human decision; guessing is prohibited. */
  | { readonly kind: 'human-decision-required'; readonly reason: string; readonly escalatedAt: string }
  /** Explicitly out of scope, with the reason recorded. */
  | { readonly kind: 'not-applicable'; readonly reason: string; readonly decidedBy: string; readonly at: string };

/**
 * Fail-closed ambiguity routing. Anything the architecture names as material is
 * escalated; a safe inference must carry a rationale, and an unclassified
 * decision is escalated rather than assumed safe.
 */
export function resolveAmbiguity(input: {
  decisionClass: string;
  rationale?: string;
  decidedBy?: string;
  at?: string;
}): AmbiguityResolution {
  const at = input.at ?? new Date().toISOString();
  if (isMaterialDecisionClass(input.decisionClass)) {
    return {
      kind: 'human-decision-required',
      reason: `"${input.decisionClass}" is a material decision class under §107; it may not be resolved by the engineering organization on its own.`,
      escalatedAt: at,
    };
  }
  if (input.rationale === undefined || input.rationale.trim().length === 0) {
    return {
      kind: 'human-decision-required',
      reason:
        'A safe inference must record why the inference is safe. With no rationale recorded, this decision is escalated rather than guessed.',
      escalatedAt: at,
    };
  }
  return {
    kind: 'safe-inference',
    rationale: input.rationale,
    decidedBy: input.decidedBy ?? 'engineering-organization',
    at,
  };
}

// ── §108 DECISION LEDGER ────────────────────────────────────────────────────

export interface DecisionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly decision: string;
  readonly decisionClass: string;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly alternativesConsidered: readonly string[];
  /** Who authorized the decision: an account for escalated material ones. */
  readonly authorizedBy: string | null;
  readonly affectedArtifactIds: readonly string[];
  readonly downstreamImpact: string;
  readonly resolution: AmbiguityResolution['kind'];
  readonly at: string;
}

export interface DecisionLedger {
  record(decision: Omit<DecisionRecord, 'id'> & { id?: string }): DecisionRecord;
  forProject(projectId: string): readonly DecisionRecord[];
  byId(id: string): DecisionRecord | null;
}

export class InMemoryDecisionLedger implements DecisionLedger {
  private readonly records: DecisionRecord[] = [];
  private counter = 0;

  record(decision: Omit<DecisionRecord, 'id'> & { id?: string }): DecisionRecord {
    this.counter += 1;
    const id = decision.id ?? `DEC-${String(this.counter).padStart(6, '0')}`;
    if (this.byId(id) !== null) {
      throw new Error(`Decision "${id}" already exists in the ledger; decisions are append-only.`);
    }
    const record: DecisionRecord = Object.freeze({
      ...decision,
      id,
      evidenceIds: Object.freeze([...decision.evidenceIds]),
      alternativesConsidered: Object.freeze([...decision.alternativesConsidered]),
      affectedArtifactIds: Object.freeze([...decision.affectedArtifactIds]),
    });
    this.records.push(record);
    return record;
  }

  forProject(projectId: string): readonly DecisionRecord[] {
    return this.records.filter((r) => r.projectId === projectId);
  }

  byId(id: string): DecisionRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }
}

// ── §105 PRODUCT JUDGMENT ───────────────────────────────────────────────────

/** A usability/meaningfulness observation from the independent judgment pass. */
export interface JudgmentFinding {
  readonly id: string;
  readonly projectId: string;
  readonly dimension: 'navigability' | 'comprehensibility' | 'consistency' | 'outcome-clarity' | 'intent-coherence';
  readonly severity: 'observation' | 'defect';
  readonly detail: string;
  /** The artifacts actually examined to reach this finding - never fabricated. */
  readonly examinedArtifactIds: readonly string[];
  readonly at: string;
}

export interface ProductJudgmentReport {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly findings: readonly JudgmentFinding[];
  /** Dimension scores in [0,1]; a low score is a judgment signal, not a count. */
  readonly dimensionScores: Readonly<Record<JudgmentFinding['dimension'], number>>;
  /** Honest verdict: judgment never certifies, it only reports. */
  readonly verdict: 'SOUND' | 'CONCERNED' | 'AT-RISK';
  readonly summary: string;
}

function judgmentFindingId(projectId: string, dimension: string, subject: string): string {
  return `PJ-${createHash('sha256').update(`${projectId}\u0000${dimension}\u0000${subject}`, 'utf8').digest('hex').slice(0, 12).toUpperCase()}`;
}

/**
 * The independent product-judgment pass. It reads the real certified inventory
 * and asks whether the assembled product actually makes sense AS A PRODUCT -
 * a question the completeness and correctness gates deliberately do not ask.
 * It produces observations and defects; it never advances any artifact state
 * and never substitutes for a certification gate.
 */
export function judgeProduct(input: {
  projectId: string;
  stages: readonly { id: string; label: string; inScope: boolean; status: string }[];
  pageCount: number;
  roleCount: number;
  workflowCount: number;
  driftofIntent: readonly IntentDrift[];
  openDecisions: readonly DecisionRecord[];
  at?: string;
}): ProductJudgmentReport {
  const at = input.at ?? new Date().toISOString();
  const findings: JudgmentFinding[] = [];
  const push = (
    dimension: JudgmentFinding['dimension'],
    severity: JudgmentFinding['severity'],
    subject: string,
    detail: string,
    examined: readonly string[],
  ): void => {
    findings.push(
      Object.freeze({
        id: judgmentFindingId(input.projectId, dimension, subject),
        projectId: input.projectId,
        dimension,
        severity,
        detail,
        examinedArtifactIds: Object.freeze([...examined]),
        at,
      }),
    );
  };

  // Navigability: a product with pages but no role or no workflow has no
  // navigable path for anyone to be described as.
  if (input.pageCount > 0 && input.roleCount === 0) {
    push(
      'navigability',
      'defect',
      'roles',
      'The inventory contains pages but no role inventory, so no user path through the product can be described or judged.',
      [],
    );
  }
  if (input.pageCount > 0 && input.workflowCount === 0) {
    push(
      'navigability',
      'defect',
      'workflows',
      'The inventory contains pages but no workflow, so the product is a set of screens rather than something a user can accomplish anything in.',
      [],
    );
  }

  // Outcome clarity: in-scope stages that never recorded leave the product
  // without a demonstrable outcome.
  const stalled = input.stages.filter((s) => s.inScope && s.status !== 'RECORDED');
  for (const stage of stalled) {
    push(
      'outcome-clarity',
      'observation',
      `stage:${stage.id}`,
      `In-scope stage "${stage.label}" has not produced a recorded outcome yet; the product cannot yet demonstrate this part of its intent.`,
      [stage.id],
    );
  }

  // Intent coherence: real drift findings are judgment defects, not paperwork.
  for (const drift of input.driftofIntent) {
    if (drift.severity !== 'error') continue;
    push(
      'intent-coherence',
      'defect',
      drift.subject,
      `Intent drift detected: ${drift.detail}`,
      [drift.id],
    );
  }

  // Material decisions still awaiting a human are a live product risk: the
  // product is being built on an undecided foundation.
  const awaitingHuman = input.openDecisions.filter((d) => d.resolution === 'human-decision-required');
  for (const decision of awaitingHuman) {
    push(
      'consistency',
      'defect',
      `decision:${decision.id}`,
      `Material decision ${decision.id} ("${decision.decisionClass}") is still awaiting a human decision; product behavior here is undefined until it is made.`,
      [...decision.affectedArtifactIds],
    );
  }

  const dimensions: JudgmentFinding['dimension'][] = [
    'navigability',
    'comprehensibility',
    'consistency',
    'outcome-clarity',
    'intent-coherence',
  ];
  const dimensionScores = Object.fromEntries(
    dimensions.map((dim) => {
      const dimFindings = findings.filter((f) => f.dimension === dim);
      const defects = dimFindings.filter((f) => f.severity === 'defect').length;
      const score = dimFindings.length === 0 ? 1 : Math.max(0, 1 - defects / dimFindings.length - 0.001 * (dimFindings.length - defects));
      return [dim, Number(score.toFixed(3))];
    }),
  ) as Record<JudgmentFinding['dimension'], number>;

  const defects = findings.filter((f) => f.severity === 'defect').length;
  const verdict: ProductJudgmentReport['verdict'] =
    defects === 0 ? 'SOUND' : defects <= 2 ? 'CONCERNED' : 'AT-RISK';
  const summary =
    verdict === 'SOUND'
      ? 'Product judgment found no product-level defect beyond the completeness and correctness gates. This is a judgment observation, not a certification.'
      : `Product judgment raised ${defects} product-level defect(s) that the completeness and correctness gates do not cover. Completeness may still be satisfied; whether the product actually makes sense is a separate question, and it is currently at "${verdict}". Product judgment reports; it never certifies, and nothing here advances any artifact's state.`;

  return Object.freeze({
    projectId: input.projectId,
    generatedAt: at,
    findings: Object.freeze(findings),
    dimensionScores,
    verdict,
    summary,
  });
}

export type { Actor };
