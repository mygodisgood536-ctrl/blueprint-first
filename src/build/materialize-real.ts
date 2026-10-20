/**
 * REAL IMPLEMENTATION MATERIALIZATION.
 *
 * The Build department's contract is that a `-IMPL` artifact exists because
 * real code implementing the certified `-DESIGN` artifact exists. Until now the
 * materializer wrote `-IMPL` artifacts from design DOCUMENTS, which asserted an
 * implementation that had never been observed anywhere.
 *
 * This materializer does the opposite: it takes the inventory read back out of
 * the real execution environment and writes `-IMPL` artifacts that name the real
 * files, their real byte counts, and their real content hashes. An artifact is
 * only created for a certified design that has at least one real file behind
 * it. A design with no real implementation behind it produces NO artifact and is
 * reported as an unimplemented gap, because silently certifying it would be the
 * exact failure mode the vision forbids.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { recordStatusChange } from '../core/store.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { PageDesignDoc } from '../design/types.ts';
import {
  classifyRealFile,
  realFilesForPage,
  type RealImplementation,
  type RealSourceFile,
} from './implementation-capture.ts';

export interface RealImplementationResult {
  readonly pageImplIds: readonly string[];
  readonly featureImplIds: readonly string[];
  readonly fileImplIds: readonly string[];
  /** Certified designs with NO real file behind them. Never silently certified. */
  readonly unimplementedDesignIds: readonly string[];
  readonly totalRealFiles: number;
}

/** Advances a newly created implementation artifact through its governance
 *  gates to VERIFIED, recording who verified it and on what evidence. */
async function advanceToVerified(
  services: CoreServices,
  id: string,
  actor: Actor,
  evidenceId?: string,
): Promise<void> {
  const artifact = await services.store.require(id);
  if (artifact.status === 'IN_REVIEW') {
    await recordStatusChange(services.store, id, 'VERIFIED', actor, { evidenceId });
    return;
  }
  if (artifact.status === 'DRAFT') {
    await recordStatusChange(services.store, id, 'IN_REVIEW', actor, { evidenceId });
    await recordStatusChange(services.store, id, 'VERIFIED', actor, { evidenceId });
    return;
  }
  if (artifact.status === 'VERIFIED') return;
  throw new Error(`Cannot advance ${id} from ${artifact.status} to VERIFIED`);
}

/** One real file recorded as a first-class implementation artifact. */
async function materializeFile(
  services: CoreServices,
  projectId: string,
  file: RealSourceFile,
  producer: Actor,
  at: string,
  verifier: Actor | undefined,
): Promise<string> {
  const id = services.allocator.nextId('COMPONENT');
  const artifact = createArtifact({
    id,
    type: 'COMPONENT',
    title: `Source file: ${file.path}`,
    description: `Real file captured from the execution environment (${file.bytes} bytes).`,
    projectId,
    actor: producer,
    at,
    attributes: {
      implKind: 'file',
      realFile: {
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        mtime: file.mtime,
        role: classifyRealFile(file.path),
      },
      // The build is only real if it is reproducible from inspected state.
      observedFrom: 'execution-environment',
    },
  });
  await services.store.append(artifact);
  syncArtifactToGraph(services.graph, artifact);
  if (verifier !== undefined) {
    await advanceToVerified(services, id, verifier);
  }
  return id;
}

/**
 * Writes `-IMPL` artifacts for a real implementation capture.
 *
 * `designs` is the certified Design baseline. Only designs with at least one
 * real file behind them receive an `-IMPL` artifact; the rest are returned as
 * `unimplementedDesignIds` so the caller can fail the stage honestly instead of
 * certifying a build that did not happen.
 */
export async function materializeRealImplementation(
  services: CoreServices,
  input: {
    readonly projectId: string;
    readonly implementation: RealImplementation;
    readonly pageDesigns: readonly PageDesignDoc[];
    readonly featureDesignIds: readonly string[];
    readonly featureTitles: Readonly<Record<string, string>>;
    readonly producer: Actor;
    /**
     * The Build Boss (or independent verification actor) that signs off the
     * real implementation. Without it no -IMPL artifact reaches VERIFIED and
     * acceptance testing cannot pass.
     */
    readonly verifier: Actor;
  },
): Promise<RealImplementationResult> {
  const {
    projectId,
    implementation,
    pageDesigns,
    featureDesignIds,
    featureTitles,
    producer,
    verifier,
  } = input;
  const at = new Date().toISOString();

  const fileImplIds: string[] = [];
  // One artifact per real file, so every produced file is individually
  // addressable and individually hashable in the Knowledge Graph.
  for (const file of implementation.files) {
    fileImplIds.push(await materializeFile(services, projectId, file, producer, at, verifier));
  }

  const pageImplIds: string[] = [];
  const unimplementedDesignIds: string[] = [];

  for (const design of pageDesigns) {
    const designId = `${design.pageArtifactId}-DESIGN`;
    const files = realFilesForPage(implementation, design.navigation.route);
    if (files.length === 0) {
      unimplementedDesignIds.push(designId);
      continue;
    }
    const id = `${design.pageArtifactId}-IMPL`;
    const artifact = createArtifact({
      id,
      type: 'PAGE',
      title: `Page implementation: ${design.title}`,
      description: `Implemented in ${implementation.adapterKind} environment ${implementation.environmentId}; ${files.length} real file(s) inspected.`,
      projectId,
      actor: producer,
      at,
      dependencies: [designId],
      attributes: {
        implKind: 'page',
        observedFrom: 'execution-environment',
        realFiles: files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
        inventoryHash: implementation.inventoryHash,
        environmentId: implementation.environmentId,
        adapterKind: implementation.adapterKind,
        transport: implementation.transport,
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', designId);
    await advanceToVerified(services, id, verifier);
    pageImplIds.push(id);
  }

  const featureImplIds: string[] = [];
  for (const featureId of featureDesignIds) {
    const designId = `${featureId}-DESIGN`;
    const title = featureTitles[featureId] ?? featureId;
    const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const files = slug === ''
      ? []
      : implementation.files.filter((f) => {
          const name = f.path.toLowerCase();
          return (name.includes(slug) || name.includes(featureId.toLowerCase()))
            && classifyRealFile(f.path) === 'module';
        });
    if (files.length === 0) {
      unimplementedDesignIds.push(designId);
      continue;
    }
    const id = `${featureId}-IMPL`;
    const artifact = createArtifact({
      id,
      type: 'FEATURE',
      title: `Feature implementation: ${title}`,
      description: `Implemented in ${implementation.adapterKind} environment ${implementation.environmentId}; ${files.length} real file(s) inspected.`,
      projectId,
      actor: producer,
      at,
      dependencies: [designId],
      attributes: {
        implKind: 'feature',
        observedFrom: 'execution-environment',
        realFiles: files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
        inventoryHash: implementation.inventoryHash,
        environmentId: implementation.environmentId,
        adapterKind: implementation.adapterKind,
        transport: implementation.transport,
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    services.graph.link(id, 'DERIVED_FROM', designId);
    await advanceToVerified(services, id, verifier);
    featureImplIds.push(id);
  }

  return {
    pageImplIds,
    featureImplIds,
    fileImplIds,
    unimplementedDesignIds,
    totalRealFiles: implementation.files.length,
  };
}