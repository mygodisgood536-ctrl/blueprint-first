/**
 * §T — Cross-Lifecycle Traceability queries (Level 5, spec §T.2 / §T.3).
 *
 * The ID lineage is mandatory (§T.1) — every artifact's full chain from
 * its Discovery root ID to its current -OPS node lives in the
 * Knowledge Graph as DEPENDS_ON + DERIVED_FROM edges. This module
 * provides the standing queries the platform must always be able to
 * answer mechanically (§T.2), and the gap-localization queries (§T.3):
 * a missing edge in any direction is a coverage gap, and the platform
 * reports the specific broken edge by ID at the specific stage
 * transition where it broke.
 */
import type { KnowledgeGraph } from '../core/graph.ts';
import type { ArtifactStore } from '../core/store.ts';
import type { Artifact } from '../core/artifact.ts';

const PRODUCTION_PHASES = new Set(['DEPLOY', 'OPS', 'PERM']);
const KNOWN_PHASE_SUFFIXES = new Set([
  'DESIGN', 'IMPL', 'TEST', 'DEPLOY', 'OPS', 'PERM',
  'OBSERVATION', 'PROPOSAL', 'APPROVAL', 'CHANGE', 'EVAL',
]);

/** Returns the Discovery-level root ID of the chain containing `id`, or
 *  null if `id` is not in the graph. Walks upstream DERIVED_FROM edges
 *  deterministically. */
export function rootOfLineage(graph: KnowledgeGraph, id: string): string | null {
  if (!graph.allNodes().some((n) => n.id === id)) return null;
  let current: string = id;
  let root: string = id;
  let changed = true;
  let safety = 0;
  while (changed && safety < 1000) {
    safety += 1;
    changed = false;
    const oneHop = graph.neighbors(current, 'upstream', 'DERIVED_FROM');
    if (oneHop.length > 0) {
      oneHop.sort();
      const next = oneHop[0];
      if (next !== undefined) {
        current = next;
        root = next;
        changed = true;
      }
    }
  }
  return root;
}

/** Returns the full upstream chain (root -> ... -> id) by DERIVED_FROM
 *  edges, deterministic order. */
export function lineageChain(graph: KnowledgeGraph, id: string): readonly string[] {
  if (!graph.allNodes().some((n) => n.id === id)) return [];
  const chain: string[] = [id];
  let current = id;
  let safety = 0;
  while (safety < 1000) {
    safety += 1;
    const parents = graph.neighbors(current, 'upstream', 'DERIVED_FROM').sort();
    if (parents.length === 0) break;
    const parent = parents[0];
    if (parent === undefined) break;
    if (chain.includes(parent)) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** Every -TEST artifact whose derived coverage cites `id`. */
export function testsFor(graph: KnowledgeGraph, id: string): readonly string[] {
  const set = new Set<string>();
  const chain = lineageChain(graph, id);
  for (const chainId of chain) {
    for (const downstream of graph.reachable(chainId, 'downstream', 'DEPENDS_ON')) {
      if (downstream.endsWith('-TEST')) set.add(downstream);
    }
  }
  for (const downstream of graph.reachable(id, 'downstream', 'VERIFIED_BY')) {
    if (downstream.endsWith('-TEST')) set.add(downstream);
  }
  return [...set].sort();
}

/** The currently-live production artifact (e.g. -OPS node) that
 *  represents `id`, if any. */
export function productionComponentFor(graph: KnowledgeGraph, id: string): readonly string[] {
  const set = new Set<string>();
  for (const downstream of graph.reachable(id, 'downstream', 'DERIVED_FROM')) {
    for (const phase of PRODUCTION_PHASES) {
      if (downstream.endsWith(`-${phase}`)) set.add(downstream);
    }
  }
  return [...set].sort();
}

/** The -OPS / -DEPLOY / -PERM anchor for a baseId, if present. */
export function liveProductionIdsFor(graph: KnowledgeGraph, baseId: string): readonly string[] {
  const set = new Set<string>();
  for (const phase of ['OPS', 'DEPLOY', 'PERM']) {
    const id = `${baseId}-${phase}`;
    if (graph.allNodes().some((n) => n.id === id)) set.add(id);
  }
  return [...set].sort();
}

export interface LineageGap {
  readonly baseId: string;
  readonly reason:
    | 'no-design'
    | 'no-impl'
    | 'no-test'
    | 'no-deploy'
    | 'no-ops'
    | 'no-discovery';
  readonly missingPhase: string;
}

/** §T.3 — gap localization. Returns the specific broken edge for a
 *  baseId, or null if the chain is complete. */
export function locateLineageGap(graph: KnowledgeGraph, baseId: string): LineageGap | null {
  const exists = (id: string): boolean => graph.allNodes().some((n) => n.id === id);
  if (!exists(baseId)) return { baseId, reason: 'no-discovery', missingPhase: 'Discovery' };
  if (!exists(`${baseId}-DESIGN`)) return { baseId, reason: 'no-design', missingPhase: 'DESIGN' };
  if (!exists(`${baseId}-IMPL`)) return { baseId, reason: 'no-impl', missingPhase: 'IMPL' };
  if (!exists(`${baseId}-TEST`)) return { baseId, reason: 'no-test', missingPhase: 'TEST' };
  if (!exists(`${baseId}-DEPLOY`)) return { baseId, reason: 'no-deploy', missingPhase: 'DEPLOY' };
  if (!exists(`${baseId}-OPS`)) return { baseId, reason: 'no-ops', missingPhase: 'OPS' };
  return null;
}

interface ListCapable {
  list?: (q: object) => Promise<Artifact[]>;
}

async function maybeList(store: ArtifactStore, projectId: string): Promise<Artifact[]> {
  const candidate = store as unknown as ListCapable;
  if (typeof candidate.list === 'function') {
    return await candidate.list({ projectId });
  }
  return [];
}

/** Returns the list of every baseId in the project that has a known
 *  lineage gap, sorted deterministically. */
export async function allLineageGaps(
  store: ArtifactStore,
  graph: KnowledgeGraph,
  projectId: string,
): Promise<readonly LineageGap[]> {
  const all = await maybeList(store, projectId);
  const gaps: LineageGap[] = [];
  for (const artifact of all) {
    const lastDash = artifact.id.lastIndexOf('-');
    if (lastDash >= 0) {
      const suffix = artifact.id.slice(lastDash + 1);
      if (KNOWN_PHASE_SUFFIXES.has(suffix)) continue;
    }
    const gap = locateLineageGap(graph, artifact.id);
    if (gap !== null) gaps.push(gap);
  }
  return gaps.sort((a, b) => a.baseId.localeCompare(b.baseId));
}
