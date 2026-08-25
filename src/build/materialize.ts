/**
 * Build materialization: persist implementation artifacts with exact phase
 * lineage.
 *
 *   PAGE-0001-DESIGN    -> PAGE-0001-IMPL     (DERIVED_FROM edge)
 *   FEATURE-0001-DESIGN -> FEATURE-0001-IMPL  (DERIVED_FROM edge)
 *   COMPONENT-n (implementation manifest) aggregates every -IMPL (CONTAINS).
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { FeatureDesignDoc, PageDesignDoc } from '../design/types.ts';
import type { ImplementationUnit } from './types.ts';

export interface ImplementationPackageDocs {
  readonly blueprintId: string;
  readonly projectId: string;
  readonly pageDesigns: readonly PageDesignDoc[];
  readonly featureDesigns: readonly FeatureDesignDoc[];
  /** Deterministic implementation plan derived by the studio. */
  readonly units: readonly ImplementationUnit[];
  /**
   * Optional labeled AI implementation notes keyed by -IMPL id. They are
   * stored verbatim as commentary and never influence structure.
   */
  readonly aiNotes?: Readonly<Record<string, string>>;
}

export interface BuildMaterializationResult {
  readonly manifestId: string;
  readonly pageImplIds: readonly string[];
  readonly featureImplIds: readonly string[];
  readonly allArtifactIds: readonly string[];
}

export async function materializeImplementationPackage(
  services: CoreServices,
  docs: ImplementationPackageDocs,
  producer: Actor,
): Promise<BuildMaterializationResult> {
  const at = new Date().toISOString();
  const pageImplIds: string[] = [];
  const featureImplIds: string[] = [];

  for (const doc of docs.pageDesigns) {
    const designId = `${doc.pageArtifactId}-DESIGN`;
    const id = `${doc.pageArtifactId}-IMPL`;
    const note = docs.aiNotes?.[id];
    const artifact = createArtifact({
      id,
      type: 'PAGE',
      title: `Page implementation: ${doc.title}`,
      description: doc.purpose,
      projectId: docs.projectId,
      actor: producer,
      at,
      dependencies: [designId],
      attributes: {
        implementationDoc: JSON.parse(JSON.stringify(doc)),
        implKind: 'page',
        ...(note !== undefined ? { aiNote: note } : {}),
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', designId);
    pageImplIds.push(id);
  }

  for (const doc of docs.featureDesigns) {
    const designId = `${doc.featureArtifactId}-DESIGN`;
    const id = `${doc.featureArtifactId}-IMPL`;
    const artifact = createArtifact({
      id,
      type: 'FEATURE',
      title: `Feature implementation: ${doc.title}`,
      description: doc.description,
      projectId: docs.projectId,
      actor: producer,
      at,
      dependencies: [designId],
      attributes: {
        implementationDoc: JSON.parse(JSON.stringify(doc)),
        implKind: 'feature',
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', designId);
    featureImplIds.push(id);
  }

  const manifestId = services.allocator.nextId('COMPONENT');
  const manifest = createArtifact({
    id: manifestId,
    type: 'COMPONENT',
    title: `Implementation manifest for ${docs.blueprintId}`,
    description: 'Aggregation of verified implementations derived from the approved blueprint.',
    projectId: docs.projectId,
    actor: producer,
    at,
    dependencies: [docs.blueprintId, ...pageImplIds, ...featureImplIds],
    attributes: {
      blueprintId: docs.blueprintId,
      pageImplIds: [...pageImplIds],
      featureImplIds: [...featureImplIds],
      units: JSON.parse(JSON.stringify(docs.units)) as ImplementationUnit[],
    },
  });
  await services.store.append(manifest);
  syncArtifactToGraph(services.graph, manifest);
  for (const implId of [...pageImplIds, ...featureImplIds]) {
    services.graph.link(manifestId, 'CONTAINS', implId);
  }

  return {
    manifestId,
    pageImplIds,
    featureImplIds,
    allArtifactIds: [manifestId, ...pageImplIds, ...featureImplIds],
  };
}