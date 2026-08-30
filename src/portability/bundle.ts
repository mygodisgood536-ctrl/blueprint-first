/**
 * Project portability: export/import (Increment 9).
 *
 * Serializes a project's artifacts, Knowledge Graph structure, and evidence
 * into a self-contained JSON bundle (with an integrity SHA-256), and restores
 * that bundle into fresh services so a project can move between environments,
 * stores, or machines without losing identity or provenance.
 */
import { createHash } from 'node:crypto';
import type { CoreServices } from '../core/services.ts';
import type { Artifact } from '../core/artifact.ts';
import type { EvidenceRecord } from '../verification/evidence.ts';
import type { GraphEdge, GraphNode } from '../core/graph.ts';

export interface ProjectBundle {
  readonly format: 'blueprint-first-project' | string;
  readonly formatVersion: number;
  readonly projectId: string;
  readonly exportedAt: string;
  readonly artifactCount: number;
  readonly edgeCount: number;
  readonly evidenceCount: number;
  readonly artifacts: readonly Artifact[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly EvidenceRecord[];
  /** SHA-256 over the canonicalized payload (integrity check on import). */
  readonly integrityHash: string;
}

function canonicalize(bundle: {
  format: string;
  formatVersion: number;
  projectId: string;
  exportedAt: string;
  artifacts: readonly Artifact[];
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  evidence: readonly EvidenceRecord[];
}): string {
  return JSON.stringify({
    format: bundle.format,
    formatVersion: bundle.formatVersion,
    projectId: bundle.projectId,
    exportedAt: bundle.exportedAt,
    artifacts: bundle.artifacts,
    nodes: bundle.nodes,
    edges: bundle.edges,
    evidence: bundle.evidence,
  });
}

/**
 * Exports every artifact scoped to a project, the graph structure spanning
 * those artifacts, and the evidence associated with them.
 */
export async function exportProjectBundle(
  services: CoreServices,
  projectId: string,
): Promise<ProjectBundle> {
  const artifacts = (await services.store.list({ projectId })).sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const artifactIds = new Set(artifacts.map((a) => a.id));

  const nodes = services.graph.allNodes().filter((n) => artifactIds.has(n.id));
  const edges = services.graph.allEdges().filter(
    (e) => artifactIds.has(e.from) && artifactIds.has(e.to),
  );

  const allEvidence = await services.evidence.all();
  const evidence = allEvidence.filter((e) => e.artifactIds.some((id) => artifactIds.has(id)));

  const base = {
    format: 'blueprint-first-project',
    formatVersion: 1,
    projectId,
    exportedAt: new Date().toISOString(),
    artifactCount: artifacts.length,
    edgeCount: edges.length,
    evidenceCount: evidence.length,
    artifacts,
    nodes,
    edges,
    evidence,
  };

  return {
    ...base,
    integrityHash: `sha256:${createHash('sha256').update(canonicalize(base)).digest('hex')}`,
  };
}

export interface ImportResult {
  readonly projectId: string;
  readonly artifactCount: number;
  readonly edgeCount: number;
  readonly evidenceCount: number;
  readonly integrityVerified: boolean;
}

/** Restores a bundle into fresh services, verifying integrity first. */
export async function importProjectBundle(
  services: CoreServices,
  bundle: ProjectBundle,
): Promise<ImportResult> {
  const expected = bundle.integrityHash;
  const computed = `sha256:${createHash('sha256')
    .update(
      canonicalize({
        format: bundle.format,
        formatVersion: bundle.formatVersion,
        projectId: bundle.projectId,
        exportedAt: bundle.exportedAt,
        artifacts: bundle.artifacts,
        nodes: bundle.nodes,
        edges: bundle.edges,
        evidence: bundle.evidence,
      }),
    )
    .digest('hex')}`;
  const integrityVerified = expected === computed;

  // Register graph nodes and edges in a deterministic order (parents before use
  // is guaranteed because addNode precedes link, but we add both first).
  for (const node of bundle.nodes) {
    services.graph.addNode(node.id, node.addedAt);
  }
  for (const edge of bundle.edges) {
    services.graph.link(edge.from, edge.relation, edge.to);
  }

  // Restore artifacts (already canonical; append preserves identity/status).
  for (const artifact of bundle.artifacts) {
    await services.store.append(artifact);
  }

  // Restore evidence records, preserving producers/time/references.
  let evidenceCount = 0;
  for (const record of bundle.evidence) {
    await services.evidence.append({
      kind: record.kind,
      summary: record.summary,
      artifactIds: record.artifactIds,
      payloadRef: record.payloadRef,
      producer: record.producer,
      at: record.createdAt,
    });
    evidenceCount += 1;
  }

  return {
    projectId: bundle.projectId,
    artifactCount: bundle.artifacts.length,
    edgeCount: bundle.edges.length,
    evidenceCount,
    integrityVerified,
  };
}

/** Convenience: round-trip export→import into fresh services. */
export async function transferProject(
  source: CoreServices,
  target: CoreServices,
  projectId: string,
): Promise<ImportResult> {
  const bundle = await exportProjectBundle(source, projectId);
  return importProjectBundle(target, bundle);
}