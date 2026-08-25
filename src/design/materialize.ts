/**
 * Design materialization: persist design artifacts with exact phase lineage.
 *
 *   PAGE-0001   -> PAGE-0001-DESIGN   (DERIVED_FROM edge)
 *   FEATURE-0001-> FEATURE-0001-DESIGN
 *   BLUEPRINT-0001 aggregates every design (CONTAINS edges).
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { DesignPackageDocs } from './generate.ts';

export interface DesignMaterializationResult {
  readonly blueprintId: string;
  readonly pageDesignIds: readonly string[];
  readonly featureDesignIds: readonly string[];
  readonly allArtifactIds: readonly string[];
}

export async function materializeDesignPackage(
  services: CoreServices,
  docs: DesignPackageDocs,
  producer: Actor,
): Promise<DesignMaterializationResult> {
  const at = new Date().toISOString();
  const pageDesignIds: string[] = [];
  const featureDesignIds: string[] = [];

  for (const doc of docs.pageDesigns) {
    const id = `${doc.pageArtifactId}-DESIGN`;
    const artifact = createArtifact({
      id,
      type: 'PAGE',
      title: `Page design: ${doc.title}`,
      description: doc.purpose,
      projectId: docs.projectId,
      actor: producer,
      at,
      dependencies: [doc.pageArtifactId],
      attributes: { designDoc: JSON.parse(JSON.stringify(doc)), designKind: 'page' },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', doc.pageArtifactId);
    pageDesignIds.push(id);
  }

  for (const doc of docs.featureDesigns) {
    const id = `${doc.featureArtifactId}-DESIGN`;
    const artifact = createArtifact({
      id,
      type: 'FEATURE',
      title: `Feature design: ${doc.title}`,
      description: doc.description,
      projectId: docs.projectId,
      actor: producer,
      at,
      dependencies: [doc.featureArtifactId],
      attributes: { designDoc: JSON.parse(JSON.stringify(doc)), designKind: 'feature' },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', doc.featureArtifactId);
    featureDesignIds.push(id);
  }

  const blueprintId = services.allocator.nextId('BLUEPRINT');
  const blueprint = createArtifact({
    id: blueprintId,
    type: 'BLUEPRINT',
    title: `Approvable blueprint for ${docs.projectId}`,
    description: 'Aggregation of verified page/feature designs derived from the discovery baseline.',
    projectId: docs.projectId,
    actor: producer,
    at,
    dependencies: [
      docs.projectId,
      ...pageDesignIds,
      ...featureDesignIds,
    ],
    attributes: {
      pageDesignIds: [...pageDesignIds],
      featureDesignIds: [...featureDesignIds],
    },
  });
  await services.store.append(blueprint);
  syncArtifactToGraph(services.graph, blueprint);
  for (const designId of [...pageDesignIds, ...featureDesignIds]) {
    services.graph.link(blueprintId, 'CONTAINS', designId);
  }

  return {
    blueprintId,
    pageDesignIds,
    featureDesignIds,
    allArtifactIds: [blueprintId, ...pageDesignIds, ...featureDesignIds],
  };
}
