/**
 * §5.1 — Safe Change Intelligence: the Dependency Map (Level 5, spec §5.2).
 *
 * The Dependency Map is the platform's source of truth for "what artifacts
 * does a change to X potentially affect?". It is built mechanically from
 * the Knowledge Graph by traversing:
 *   - DEPENDS_ON edges (forward and backward), AND
 *   - DERIVED_FROM edges (forward and backward, which mirror the ID
 *     lineage: PAGE-0042-DESIGN --DERIVED_FROM--> PAGE-0042).
 *
 * This module is the §5.2 surprise-set generator. The Safe Change
 * Intelligence impact analysis declares the change-maker's known set; the
 * Dependency Map is then consulted for every artifact that the change did
 * NOT explicitly mention but might still affect. The two are unioned into
 * the canonical affected set.
 *
 * Critically: this engine never reads a worker's CLAIM about what is
 * affected — it reads only the persisted graph. The graph itself is built
 * by every stage's materialization (DESIGN->IMPL, IMPL->TEST, TEST->DEPLOY,
 * DEPLOY->OPS), so by the time Stage 5 runs, the Dependency Map reflects
 * the whole pipeline, not just the worker's mental model.
 */
import type { KnowledgeGraph } from '../core/graph.ts';

/** The set of relation types the Dependency Map follows. Anything else
 *  (CONFLICTS_WITH, RELATES_TO, etc.) is intentionally excluded — those
 *  edges are not causal dependencies, and following them would over-blow
 *  the affected set. */
const DEPENDENCY_RELATIONS = ['DEPENDS_ON', 'DERIVED_FROM'] as const;

export interface DependencyMapEntry {
  readonly startId: string;
  /** Artifacts that the startId transitively depends on (upstream). */
  readonly upstream: readonly string[];
  /** Artifacts that transitively depend on the startId (downstream). */
  readonly downstream: readonly string[];
}

export interface DependencyMap {
  readonly projectId: string | null;
  readonly entries: ReadonlyMap<string, DependencyMapEntry>;
}

/** Builds a Dependency Map for a single artifact. The map covers every
 *  node reachable from `startId` in either direction across the
 *  DEPENDS_ON + DERIVED_FROM edge set, and is anchored to the project
 *  the artifact belongs to. */
export function buildDependencyMapFor(
  graph: KnowledgeGraph,
  startId: string,
  projectId: string | null = null,
): DependencyMap {
  let upstream: string[] = [];
  let downstream: string[] = [];
  for (const relation of DEPENDENCY_RELATIONS) {
    upstream = [...upstream, ...graph.reachable(startId, 'upstream', relation)];
    downstream = [...downstream, ...graph.reachable(startId, 'downstream', relation)];
  }
  // Deduplicate and deterministically order.
  upstream = [...new Set(upstream)].sort();
  downstream = [...new Set(downstream)].sort();
  const entries = new Map<string, DependencyMapEntry>();
  entries.set(startId, { startId, upstream, downstream });
  return { projectId, entries };
}

/** Convenience: returns only the DOWNSTREAM set (artifacts that depend
 *  on startId). The §5.2 surprise set lives here — a change to X
 *  risks breaking things that consume X. */
export function downstreamArtifacts(
  graph: KnowledgeGraph,
  startId: string,
): readonly string[] {
  let set: string[] = [];
  for (const relation of DEPENDENCY_RELATIONS) {
    set = [...set, ...graph.reachable(startId, 'downstream', relation)];
  }
  return [...new Set(set)].sort();
}

/** Returns the union of upstream and downstream (every artifact the
 *  startId is connected to via DEPENDS_ON + DERIVED_FROM, in either
 *  direction). */
export function allRelatedArtifacts(
  graph: KnowledgeGraph,
  startId: string,
): readonly string[] {
  let set: string[] = [];
  for (const relation of DEPENDENCY_RELATIONS) {
    set = [...set, ...graph.reachable(startId, 'downstream', relation), ...graph.reachable(startId, 'upstream', relation)];
  }
  return [...new Set(set)].sort();
}
