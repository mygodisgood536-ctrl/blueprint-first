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

import { lineageChain, parseArtifactId } from '../core/ids.ts';
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

// ---------------------------------------------------------------------------
// Level 2 — Requirements Traceability Engine (product-grade)
//
// Extends the foundation above without replacing it. Grounded in §0.12/§T:
// a broken trace is a MECHANICALLY detectable condition on the artifact-ID
// graph, checked in three directions at once:
//   1. MISSING LINKS   - a phase artifact that should exist but doesn't.
//   2. ORPHANS         - a downstream phase artifact whose upstream base is
//                        absent from the requirement set (invented scope).
//   3. UNSUPPORTED EDGES - a phase artifact that EXISTS but lacks its
//                        DERIVED_FROM edge to its actual predecessor.
// Every row also carries per-phase evidence counts so "traced" always means
// evidence-backed tracing (§0.18), never a bare edge tally.
// ---------------------------------------------------------------------------

import type { EvidenceLog } from '../verification/evidence.ts';

export interface TraceRow {
  readonly requirementId: string;
  readonly requirementStatus: string;
  readonly designId: string;
  readonly designExists: boolean;
  readonly designStatus?: string;
  readonly implementationId: string;
  readonly implementationExists: boolean;
  readonly implementationStatus?: string;
  readonly missingLinks: readonly string[];
  readonly unsupportedEdges: readonly string[];
  readonly designEvidenceCount: number;
  readonly implementationEvidenceCount: number;
}

export interface RequirementsTraceabilityMatrix {
  readonly projectId: string;
  readonly rows: readonly TraceRow[];
  readonly totalRequirements: number;
  readonly fullyTraced: number;
  readonly missingLinkIds: readonly string[];
  readonly orphanedArtifacts: readonly string[];
  readonly unsupportedTransitions: number;
  readonly complete: boolean;
}

const LINEAGE_CLASSES = ['FEATURE', 'PAGE'] as const;

function stripLastPhase(id: string): string {
  return id.slice(0, id.lastIndexOf('-'));
}

export async function requirementsTraceability(
  store: ArtifactStore,
  graph: KnowledgeGraph,
  evidence: EvidenceLog,
  projectId: string,
): Promise<RequirementsTraceabilityMatrix> {
  // Requirement roots are the classes whose production flows through
  // DESIGN -> IMPL phase lineage (spec §T); other classes (rules,
  // permissions, entities, apis, integrations, modules, workflows) are
  // carried INSIDE design documents rather than as phase artifacts, so they
  // are audited via their designs instead of via their own chains.
  const roots = (await store.list({ types: [...LINEAGE_CLASSES], projectId }))
    .filter((a) => parseArtifactId(a.id).phases.length === 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const knownBaseIds = new Set(roots.map((r) => r.id));
  const rows: TraceRow[] = [];
  const missingLinkIds = new Set<string>();
  const orphanedArtifacts = new Set<string>();
  let unsupportedTransitions = 0;

  for (const root of roots) {
    const designId = `${root.id}-DESIGN`;
    const implementationId = `${root.id}-IMPL`;
    const design = await store.get(designId);
    const implementation = await store.get(implementationId);

    const rowMissing: string[] = [];
    if (design === null) {
      rowMissing.push(designId);
      missingLinkIds.add(designId);
    }
    if (implementation === null) {
      rowMissing.push(implementationId);
      missingLinkIds.add(implementationId);
    }

    const rowUnsupported: string[] = [];
    for (const [phaseId, baseId] of [
      [designId, root.id],
      [implementationId, designId],
    ] as const) {
      const phase = await store.get(phaseId);
      if (phase !== null && !graph.hasEdge(phaseId, 'DERIVED_FROM', baseId)) {
        rowUnsupported.push(phaseId);
        unsupportedTransitions += 1;
      }
    }

    rows.push({
      requirementId: root.id,
      requirementStatus: root.status,
      designId,
      designExists: design !== null,
      ...(design !== null ? { designStatus: design.status } : {}),
      implementationId,
      implementationExists: implementation !== null,
      ...(implementation !== null ? { implementationStatus: implementation.status } : {}),
      missingLinks: rowMissing,
      unsupportedEdges: rowUnsupported,
      designEvidenceCount:
        design === null ? 0 : (await evidence.forArtifact(designId)).length,
      implementationEvidenceCount:
        implementation === null ? 0 : (await evidence.forArtifact(implementationId)).length,
    });
  }

  // Project-wide orphan sweep: any phased PAGE/FEATURE artifact whose
  // stripped base was never a requirement root in this project.
  const phasedAll = await store.list({ types: ['PAGE', 'FEATURE'], projectId });
  for (const artifact of phasedAll) {
    if (parseArtifactId(artifact.id).phases.length === 0) continue; // base artifact
    const baseId = stripLastPhase(artifact.id);
    if (!knownBaseIds.has(baseId)) {
      orphanedArtifacts.add(artifact.id);
    }
  }

  const fullyTraced = rows.filter(
    (row) =>
      row.designExists &&
      row.implementationExists &&
      row.missingLinks.length === 0 &&
      row.unsupportedEdges.length === 0 &&
      row.designEvidenceCount > 0 &&
      row.implementationEvidenceCount > 0,
  ).length;

  return {
    projectId,
    rows,
    totalRequirements: rows.length,
    fullyTraced,
    missingLinkIds: [...missingLinkIds].sort(),
    orphanedArtifacts: [...orphanedArtifacts].sort(),
    unsupportedTransitions,
    complete:
      missingLinkIds.size === 0 &&
      orphanedArtifacts.size === 0 &&
      unsupportedTransitions === 0 &&
      rows.every((row) => row.designEvidenceCount > 0 && row.implementationEvidenceCount > 0),
  };
}
