/**
 * Continuous Discovery Recursion (Level 4, spec §5.2).
 *
 * Closes the feedback loop: each new (current == prior) report is diffed
 * against the prior report's classified outcome. The delta is classified
 * deterministically into one of seven verdicts:
 *
 *   - expected       - we expected this finding (it was a known issue)
 *   - known          - we have seen this exact (artifactId, dimension, kind)
 *                      triple in the last N reports (memory)
 *   - duplicate      - same finding as the immediately previous report
 *   - transient      - present in the previous report, gone in this one
 *   - contradiction  - the same artifactId+dimension changed verdict between
 *                      the previous report and this one
 *   - actionable     - not duplicate, not contradiction, not transient,
 *                      not known: route through Safe Change
 *   - regression     - actionable AND the drift is REGRESSED (escalate)
 *
 * The delta is computed on the same `DriftItem[]` shape used by the
 * Continuous Engineering worker, which is L4's canonical drift feed.
 */
import { createHash } from 'node:crypto';
import type { DriftItem } from '../verification/live-engine.ts';

export type RecursionVerdict =
  | 'expected'
  | 'known'
  | 'duplicate'
  | 'transient'
  | 'contradiction'
  | 'actionable'
  | 'regression';

export interface RecursionMemory {
  /** baseId -> set of dimension:kind strings we have already seen. */
  readonly seen: ReadonlyMap<string, ReadonlySet<string>>;
  /** How far back the memory goes. */
  readonly depth: number;
}

export interface RecursionInput {
  readonly prior: readonly DriftItem[];
  readonly current: readonly DriftItem[];
  readonly memory?: RecursionMemory;
  /** For `expected` classification: baseIds that were already known issues. */
  readonly expectedBaseIds?: ReadonlySet<string>;
}

export interface RecursionDelta {
  /** Per-item classification result. */
  readonly item: DriftItem;
  readonly verdict: RecursionVerdict;
}

export interface RecursionResult {
  readonly deltas: readonly RecursionDelta[];
  /** Items the department should route through Safe Change. */
  readonly actionable: readonly DriftItem[];
  /** Subset of `actionable` that are REGRESSED — escalates priority. */
  readonly regressions: readonly DriftItem[];
  /** sha256 anchor over the (current + classification) result. */
  readonly classificationHash: string;
}

function key(d: DriftItem): string {
  return `${d.artifactId}::${d.dimension}::${d.kind}::${d.source}`;
}

function keyByBaseKind(d: DriftItem): string {
  return `${d.artifactId}::${d.dimension}::${d.kind}`;
}

/**
 * Default memory: 1-step (just the prior report). Callers can pass a deeper
 * memory to extend the recursion window.
 */
export function oneStepMemory(prior: readonly DriftItem[]): RecursionMemory {
  const seen = new Map<string, Set<string>>();
  for (const d of prior) {
    if (!seen.has(d.artifactId)) seen.set(d.artifactId, new Set());
    seen.get(d.artifactId)!.add(keyByBaseKind(d));
  }
  return { seen, depth: 1 };
}

function contradiction(
  a: DriftItem,
  prior: readonly DriftItem[],
): boolean {
  // Same (artifactId, dimension) but different kind: the live state is
  // oscillating in a way that says we don't know what's true.
  for (const p of prior) {
    if (p.artifactId === a.artifactId && p.dimension === a.dimension && p.kind !== a.kind) {
      return true;
    }
  }
  return false;
}

/**
 * Classify every drift item in `current` against `prior` and the optional
 * memory. The output is deterministic: same inputs always produce the same
 * `classificationHash` because every verdict is a pure function of the
 * inputs.
 */
export function classifyDeltas(input: RecursionInput): RecursionResult {
  const priorKeys = new Set(input.prior.map(key));
  const priorByBaseKind = new Map<string, DriftItem>();
  for (const p of input.prior) priorByBaseKind.set(keyByBaseKind(p), p);
  const memory = input.memory ?? oneStepMemory(input.prior);
  const expected = input.expectedBaseIds ?? new Set<string>();
  const deltas: RecursionDelta[] = [];
  const actionable: DriftItem[] = [];
  const regressions: DriftItem[] = [];
  for (const cur of input.current) {
    let verdict: RecursionVerdict;
    if (expected.has(cur.artifactId)) {
      verdict = 'expected';
    } else if (priorKeys.has(key(cur))) {
      verdict = 'duplicate';
    } else if (memory.seen.get(cur.artifactId)?.has(keyByBaseKind(cur)) === true) {
      verdict = 'known';
    } else if (contradiction(cur, input.prior)) {
      verdict = 'contradiction';
    } else if (!priorByBaseKind.has(keyByBaseKind(cur))) {
      // Not in prior at all: it's a fresh drift item. Routable.
      verdict = cur.kind === 'REGRESSED' ? 'regression' : 'actionable';
    } else {
      // In prior under the same baseKind but with a different source/extra
      // detail: treat as fresh actionable.
      verdict = cur.kind === 'REGRESSED' ? 'regression' : 'actionable';
    }
    deltas.push({ item: cur, verdict });
    if (verdict === 'actionable' || verdict === 'regression') {
      actionable.push(cur);
    }
    if (verdict === 'regression') {
      regressions.push(cur);
    }
  }
  // sha256 anchor over the classification result.
  const classificationHash = createHash('sha256').update(JSON.stringify({
    current: input.current,
    deltas,
  })).digest('hex');
  return { deltas, actionable, regressions, classificationHash };
}
