/**
 * Traceability foundation.
 *
 * Answers the questions the architecture demands at every stage:
 *   - Where does this artifact stand in its production lineage
 *     (BASE -> DESIGN -> IMPL -> TEST -> DEPLOY -> OPS), and which links are
 *     missing or out of order?
 *   - What does this artifact depend on / what depends on it?
 *   - Which requirements are actually traced by downstream artifacts?
 *
 * Lineage gap rule: a phase artifact may only exist if every earlier phase in
 * the canonical chain exists. Anything else is reported as a gap.
 */

import { lineageChain } from '../core/ids.ts';
import type { RelationType } from '../core/graph.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import type { ArtifactStore } from '../core/store.ts';

export interface LineageLink {
  id: string;
  exists: boolean;
  status?: string;
}

export interface LineageGap {
  id: string;
  reason: string;
}

export interface LineageStatus {
  baseId: string;
  links: LineageLink[];
  gaps: LineageGap[];
  completeThrough: string | null;
}

export async function lineageStatus(
  store: ArtifactStore,
  baseId: string,
): Promise<LineageStatus> {
  const chain = lineageChain(baseId);
  const links: LineageLink[] = [];
  for (const id of chain) {
    const artifact = await store.get(id);
    links.push({
      id,
      exists: artifact !== null,
      ...(artifact ? { status: artifact.status } : {}),
    });
  }
  const gaps = computeLineageGaps(links);
  let completeThrough: string | null = null;
  for (const link of links) {
    if (!link.exists) break;
    completeThrough = link.id;
  }
  return { baseId: chain[0] ?? baseId, links, gaps, completeThrough };
}

/**
 * Contiguity check over a lineage chain:
 *  - the first MISSING link is reported as the frontier gap;
 *  - any link that EXISTS after the chain broke is reported as an orphan
 *    (its predecessor chain must exist first).
 */
export function computeLineageGaps(links: readonly LineageLink[]): LineageGap[] {
  const gaps: LineageGap[] = [];
  const base = links[0];
  if (base === undefined) return [{ id: '?', reason: 'Empty lineage chain.' }];
  if (!base.exists) {
    gaps.push({ id: base.id, reason: 'Base artifact itself is missing.' });
    return gaps;
  }
  let broken = false;
  for (let i = 1; i < links.length; i++) {
    const link = links[i];
    if (link === undefined) continue;
    if (link.exists) {
      if (broken) {
        gaps.push({
          id: link.id,
          reason: 'Exists but predecessor links are missing (lineage must be contiguous).',
        });
      }
    } else if (!broken) {
      broken = true;
      gaps.push({ id: link.id, reason: 'Missing from the contiguous lineage.' });
    }
  }
  return gaps;
}

/** Everything transitively reachable downstream of an artifact. */
export function downstreamTrace(
  graph: KnowledgeGraph,
  id: string,
  relation?: RelationType,
): string[] {
  return graph.reachable(id, 'downstream', relation);
}

/** Everything transitively reachable upstream of an artifact. */
export function upstreamTrace(
  graph: KnowledgeGraph,
  id: string,
  relation?: RelationType,
): string[] {
  return graph.reachable(id, 'upstream', relation);
}

export interface CoverageSummary {
  totalRequirements: number;
  traced: number;
  untraced: string[];
  ratio: number;
}

/**
 * Requirement coverage: a requirement counts as traced when at least one
 * incoming edge of any of the given relations points at it.
 */
export function coverageSummary(
  graph: KnowledgeGraph,
  requirementIds: readonly string[],
  relations: readonly RelationType[] = ['TRACES_TO', 'DERIVED_FROM', 'CONTAINS'],
): CoverageSummary {
  const untraced: string[] = [];
  for (const requirement of requirementIds) {
    const hasIncoming = relations.some((rel) => graph.incoming(requirement, rel).length > 0);
    if (!hasIncoming) untraced.push(requirement);
  }
  const traced = requirementIds.length - untraced.length;
  return {
    totalRequirements: requirementIds.length,
    traced,
    untraced,
    ratio: requirementIds.length === 0 ? 1 : traced / requirementIds.length,
  };
}
