/**
 * Design↔Code bidirectional traceability (Increment 7).
 *
 * Builds a forward (design→implementation) and reverse (implementation→design)
 * trace mapping for every PAGE/FEATURE design, backed by DERIVED_FROM graph
 * edges and per-link evidence counts. Distinguishes:
 *  - TRACED       : design and implementation both exist and are linked.
 *  - UNIMPLEMENTED: design exists but no implementation.
 *  - ORPHAN       : implementation exists without a corresponding design.
 *  - UNLINKED     : both exist but the DERIVED_FROM edge is missing.
 */
import type { ArtifactStore } from '../core/store.ts';
import { parseArtifactId } from '../core/ids.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import type { EvidenceLog, EvidenceRecord } from '../verification/evidence.ts';
import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';

export type TraceLinkStatus =
  | 'TRACED'
  | 'UNIMPLEMENTED'
  | 'ORPHAN'
  | 'UNLINKED';

export interface DesignCodeTraceRecord {
  readonly baseId: string;
  readonly kind: 'PAGE' | 'FEATURE';
  readonly designId: string;
  readonly designExists: boolean;
  readonly designStatus?: string;
  readonly designEvidenceCount: number;
  readonly implementationId: string;
  readonly implementationExists: boolean;
  readonly implementationStatus?: string;
  readonly implementationEvidenceCount: number;
  readonly status: TraceLinkStatus;
  readonly linked: boolean;
}

export interface DesignCodeTraceReport {
  readonly projectId: string;
  readonly records: readonly DesignCodeTraceRecord[];
  readonly total: number;
  readonly traced: number;
  readonly unimplemented: number;
  readonly orphans: number;
  readonly unlinked: number;
  readonly forwardComplete: boolean;
  readonly reverseComplete: boolean;
  readonly generatedAt: string;
}

const DESIGN_LINEAGE_CLASSES = ['PAGE', 'FEATURE'] as const;

function evidenceCountFor(evidence: readonly EvidenceRecord[], artifactId: string): number {
  return evidence.filter((e) => e.artifactIds.includes(artifactId)).length;
}

export async function buildDesignCodeTrace(
  services: CoreServices,
  projectId: string,
  actor: Actor,
): Promise<DesignCodeTraceReport> {
  const { store, graph, evidence: evidenceLog } = services;
  const at = new Date().toISOString();
  const allEvidence = await evidenceLog.all();

  const roots = (await store.list({ types: [...DESIGN_LINEAGE_CLASSES], projectId }))
    .filter((a) => parseArtifactId(a.id).phases.length === 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const records: DesignCodeTraceRecord[] = [];
  let traced = 0;
  let unimplemented = 0;
  let orphans = 0;
  let unlinked = 0;

  for (const root of roots) {
    const designId = `${root.id}-DESIGN`;
    const implementationId = `${root.id}-IMPL`;
    const design = await store.get(designId);
    const implementation = await store.get(implementationId);

    const designEvidenceCount = evidenceCountFor(allEvidence, designId);
    const implementationEvidenceCount = evidenceCountFor(allEvidence, implementationId);

    let status: TraceLinkStatus;
    let linked = false;

    if (design !== null && implementation !== null) {
      const forwardLinked = graph.hasEdge(designId, 'DERIVED_FROM', root.id);
      const implLinked = graph.hasEdge(implementationId, 'DERIVED_FROM', designId);
      linked = forwardLinked && implLinked;
      status = linked ? 'TRACED' : 'UNLINKED';
      if (!linked) unlinked += 1;
      else traced += 1;
    } else if (design !== null && implementation === null) {
      status = 'UNIMPLEMENTED';
      unimplemented += 1;
    } else if (design === null && implementation !== null) {
      status = 'ORPHAN';
      orphans += 1;
    } else {
      status = 'UNIMPLEMENTED';
      unimplemented += 1;
    }

    records.push({
      baseId: root.id,
      kind: root.type as 'PAGE' | 'FEATURE',
      designId,
      designExists: design !== null,
      ...(design !== null ? { designStatus: design.status } : {}),
      designEvidenceCount,
      implementationId,
      implementationExists: implementation !== null,
      ...(implementation !== null ? { implementationStatus: implementation.status } : {}),
      implementationEvidenceCount,
      status,
      linked,
    });
  }

  const forwardComplete = records.every((r) => r.status === 'TRACED');
  const reverseComplete = records.every((r) => r.designExists && r.implementationExists);

  const report: DesignCodeTraceReport = {
    projectId,
    records: records,
    total: records.length,
    traced,
    unimplemented,
    orphans,
    unlinked,
    forwardComplete,
    reverseComplete,
    generatedAt: at,
  };

  const artifact = createArtifact({
    id: services.allocator.nextId('TRACE_REPORT'),
    type: 'TRACE_REPORT',
    title: 'Design↔Code Traceability Report',
    projectId,
    actor,
    at,
    dependencies: records.filter((r) => r.designExists).map((r) => r.designId),
    attributes: { ...report },
  });
  await services.store.append(artifact);
  syncArtifactToGraph(services.graph, artifact);

  return report;
}