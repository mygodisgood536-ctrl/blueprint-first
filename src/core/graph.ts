/**
 * Application Knowledge Graph foundation.
 *
 * Nodes are artifact IDs; edges are typed relations between them. The graph
 * enforces referential integrity (both endpoints must be registered nodes),
 * rejects impossible edges (self-dependency), deduplicates exact triples, and
 * provides deterministic traversal plus dependency-cycle detection.
 *
 * Relation direction convention:
 *   from --CONTAINS-->        to   parent contains child
 *   from --DEPENDS_ON-->      to   from requires to to exist/hold
 *   from --DERIVED_FROM-->    to   from was produced based on to
 *   from --TRACES_TO-->       to   from exists to satisfy requirement "to"
 *   from --VERIFIED_BY-->     to   to is evidence/verification of from
 *   from --PRODUCED_BY-->     to   actor/model node that produced from
 *   from --CONFLICTS_WITH-->  to   known contradiction between artifacts
 *   from --RELATES_TO-->      to   weak, non-directional association
 *
 * This module is deliberately storage-free; a future database-backed graph
 * adapter will implement the same query surface.
 */

import { GraphIntegrityError } from './errors.ts';

export const RELATION_TYPES = [
  'CONTAINS',
  'DEPENDS_ON',
  'DERIVED_FROM',
  'TRACES_TO',
  'VERIFIED_BY',
  'PRODUCED_BY',
  'CONFLICTS_WITH',
  'RELATES_TO',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export interface GraphEdge {
  from: string;
  relation: RelationType;
  to: string;
}

export interface GraphNode {
  id: string;
  addedAt: string;
}

export class KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edgeList: GraphEdge[] = [];
  private edgeKeys: Set<string> = new Set();

  addNode(id: string, at?: string): 'created' | 'existing' {
    if (this.nodes.has(id)) return 'existing';
    this.nodes.set(id, { id, addedAt: at ?? new Date().toISOString() });
    return 'created';
  }

  requireNode(id: string): void {
    if (!this.nodes.has(id)) {
      throw new GraphIntegrityError(
        `Graph node "${id}" is not registered. Register both endpoints before linking.`,
      );
    }
  }

  link(from: string, relation: RelationType, to: string): 'created' | 'existing' {
    this.requireNode(from);
    this.requireNode(to);
    if (from === to && (relation === 'DEPENDS_ON' || relation === 'DERIVED_FROM')) {
      throw new GraphIntegrityError(`Self-referential ${relation} edge on "${from}" is forbidden.`);
    }
    const key = `${from}|${relation}|${to}`;
    if (this.edgeKeys.has(key)) return 'existing';
    this.edgeKeys.add(key);
    this.edgeList.push({ from, relation, to });
    return 'created';
  }

  hasEdge(from: string, relation: RelationType, to: string): boolean {
    return this.edgeKeys.has(`${from}|${relation}|${to}`);
  }

  /** Direct neighbors one hop away in the requested direction. */
  neighbors(id: string, direction: 'upstream' | 'downstream', relation?: RelationType): string[] {
    const result = new Set<string>();
    for (const edge of this.edgeList) {
      if (relation !== undefined && edge.relation !== relation) continue;
      if (direction === 'downstream' && edge.from === id) result.add(edge.to);
      if (direction === 'upstream' && edge.to === id) result.add(edge.from);
    }
    return [...result].sort();
  }

  /** Incoming edges pointing AT the given node (used for coverage tracing). */
  incoming(id: string, relation?: RelationType): GraphEdge[] {
    return this.edgeList.filter(
      (e) => e.to === id && (relation === undefined || e.relation === relation),
    );
  }

  /** Transitive traversal with cycle guard; deterministic ordering. */
  reachable(startId: string, direction: 'upstream' | 'downstream', relation?: RelationType): string[] {
    this.requireNode(startId);
    const visited = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of this.neighbors(current, direction, relation)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    visited.delete(startId);
    return [...visited].sort();
  }

  /**
   * Finds dependency cycles along DEPENDS_ON edges using iterative DFS.
   * Each distinct cycle is returned once, ordered deterministically.
   */
  findDependencyCycles(): string[][] {
    const adjacency = new Map<string, string[]>();
    for (const edge of this.edgeList) {
      if (edge.relation !== 'DEPENDS_ON') continue;
      const list = adjacency.get(edge.from) ?? [];
      list.push(edge.to);
      adjacency.set(edge.from, list);
    }
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const node of this.nodes.keys()) color.set(node, WHITE);

    const cycles: string[][] = [];
    const seenCycles = new Set<string>();
    for (const start of [...this.nodes.keys()].sort()) {
      if ((color.get(start) ?? WHITE) !== WHITE) continue;
      const path: string[] = [];
      const stack: Array<{ node: string; iter: Iterator<string> }> = [];
      stack.push({ node: start, iter: (adjacency.get(start) ?? [])[Symbol.iterator]() });
      color.set(start, GRAY);
      path.push(start);
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top === undefined) break;
        const step = top.iter.next();
        if (step.done) {
          color.set(top.node, BLACK);
          stack.pop();
          path.pop();
          continue;
        }
        const next = step.value;
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          const cycleStart = path.indexOf(next);
          const cycle = path.slice(cycleStart).concat([next]);
          const key = [...cycle].sort().join('>');
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push(cycle);
          }
        } else if (nextColor === WHITE) {
          color.set(next, GRAY);
          path.push(next);
          stack.push({ node: next, iter: (adjacency.get(next) ?? [])[Symbol.iterator]() });
        }
      }
    }
    return cycles.sort((a, b) => a.join(',').localeCompare(b.join(',')));
  }

  stats(): { nodeCount: number; edgeCount: number; byRelation: Record<string, number> } {
    const byRelation: Record<string, number> = {};
    for (const edge of this.edgeList) {
      byRelation[edge.relation] = (byRelation[edge.relation] ?? 0) + 1;
    }
    return { nodeCount: this.nodes.size, edgeCount: this.edgeList.length, byRelation };
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  allEdges(): GraphEdge[] {
    return [...this.edgeList];
  }
}

/** Registers an artifact and its declared dependencies as DEPENDS_ON edges. */
export function syncArtifactToGraph(
  graph: KnowledgeGraph,
  artifact: { id: string; dependencies: readonly string[] },
): void {
  graph.addNode(artifact.id);
  for (const dep of artifact.dependencies) {
    graph.addNode(dep);
    graph.link(artifact.id, 'DEPENDS_ON', dep);
  }
}

