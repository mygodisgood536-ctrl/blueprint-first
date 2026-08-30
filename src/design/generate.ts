/**
 * Deterministic discovery -> design package derivation (Level 1a).
 *
 * Reads VERIFIED discovery artifacts back from the store/graph and derives
 * the full design package. Structure is pure derivation - no AI in the loop
 * - so the blueprint cannot silently contradict the certified baseline. An
 * optional AI design rationale is attached later via the router and recorded
 * as evidence only.
 */

import type { CoreServices } from '../core/services.ts';
import type { FeatureDesignDoc, PageDesignDoc } from './types.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';
import { generatePageDesign } from './generate-page.ts';
import { buildVisualDesignSystem } from './system/visual-system.ts';
import type { BusinessModel } from '../discovery/business-model.ts';

/** Fails unless every anchor artifact of the baseline is VERIFIED. */
export async function assertVerifiedBaseline(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<void> {
  const ids = [
    baseline.projectId,
    ...baseline.modules,
    ...baseline.features,
    ...baseline.workflows,
    ...baseline.pages,
  ].map((e) => (typeof e === 'string' ? e : e.artifactId));
  for (const id of ids) {
    const artifact = await services.store.get(id);
    if (artifact === null) {
      throw new Error(`Discovery artifact ${id} is missing; refusing to design.`);
    }
    if (artifact.status !== 'VERIFIED') {
      throw new Error(
        `Discovery artifact ${id} has status ${artifact.status}; design requires a VERIFIED baseline.`,
      );
    }
  }
}

export interface DesignPackageDocs {
  readonly projectId: string;
  readonly pageDesigns: readonly PageDesignDoc[];
  readonly featureDesigns: readonly FeatureDesignDoc[];
}

export async function generateDesignPackage(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  businessModel?: BusinessModel | null,
): Promise<DesignPackageDocs> {
  // Build the shared, project-specific visual design system ONCE so every page
  // derives its tokens/identity/components/strategies from the same source
  // (consistency across pages) while still being fully project-driven.
  const visual = buildVisualDesignSystem(baseline, businessModel);
  const pageDesigns: PageDesignDoc[] = [];
  for (const pageEntry of baseline.pages) {
    pageDesigns.push(await generatePageDesign(services, baseline, pageEntry, visual));
  }

  // Page keys grouped by their owning module artifact id (parentId).
  const pageKeysByModuleId = new Map<string, string[]>();
  for (const page of baseline.pages) {
    if (page.parentId === undefined) continue;
    const list = pageKeysByModuleId.get(page.parentId) ?? [];
    list.push(page.key);
    pageKeysByModuleId.set(page.parentId, list);
  }

  // Each feature realizes the pages of the module that contains it.
  const featureArtifacts = await Promise.all(
    baseline.features.map((f) => services.store.require(f.artifactId)),
  );
  const featureDesigns: FeatureDesignDoc[] = baseline.features.map((feature, index) => {
    const featureArtifact = featureArtifacts[index];
    if (featureArtifact === undefined) {
      throw new Error(`Feature artifact ${feature.artifactId} is missing from the store.`);
    }
    const moduleId = feature.parentId;
    return {
      featureArtifactId: feature.artifactId,
      featureKey: feature.key,
      title: featureArtifact.title,
      description: featureArtifact.description,
      pageKeys:
        moduleId === undefined
          ? []
          : [...(pageKeysByModuleId.get(moduleId) ?? [])],
      workflowSteps: [], // product-level workflows are not per-feature at Level 1a
    };
  });

  return { projectId: baseline.projectId, pageDesigns, featureDesigns };
}
