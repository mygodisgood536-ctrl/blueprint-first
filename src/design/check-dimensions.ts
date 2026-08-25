/** Mechanical design-verification checks (Level 1a). */

import type { VerificationFinding } from '../verification/verifier.ts';
import type { CoreServices } from '../core/services.ts';
import type { DesignMaterializationResult } from './materialize.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';

export interface DesignDraft {
  readonly baseline: DiscoveryBaseline;
  readonly materialization: DesignMaterializationResult;
  /** sha256 of every AI rationale response, keyed by design artifact id. */
  readonly rationaleHashes: Readonly<Record<string, string>>;
}

export async function checkDesignCount(draft: DesignDraft): Promise<VerificationFinding> {
  const expected =
    draft.baseline.pages.length + draft.baseline.features.length;
  const created =
    draft.materialization.pageDesignIds.length +
    draft.materialization.featureDesignIds.length;
  return {
    dimension: 'COUNT',
    verdict: expected === created ? 'pass' : 'fail',
    detail: `Expected ${expected} design artifacts (pages+features); created ${created}.`,
  };
}

export async function checkDesignIdentity(
  services: CoreServices,
  draft: DesignDraft,
): Promise<VerificationFinding> {
  let failures = 0;
  for (const id of designIds(draft)) {
    const artifact = await services.store.get(id);
    if (artifact === null || !id.endsWith('-DESIGN')) failures += 1;
  }
  return {
    dimension: 'IDENTITY',
    verdict: failures === 0 ? 'pass' : 'fail',
    detail: failures === 0
      ? 'Every design artifact exists with the canonical -DESIGN phase suffix.'
      : `${failures} malformed or missing design artifacts.`,
  };
}

function designIds(draft: DesignDraft): string[] {
  return [...draft.materialization.pageDesignIds, ...draft.materialization.featureDesignIds];
}

export function checkDesignCoverage(draft: DesignDraft): VerificationFinding {
  const missingPages = draft.baseline.pages.filter(
    (p) => !draft.materialization.pageDesignIds.includes(`${p.artifactId}-DESIGN`),
  );
  const missingFeatures = draft.baseline.features.filter(
    (f) => !draft.materialization.featureDesignIds.includes(`${f.artifactId}-DESIGN`),
  );
  const total = missingPages.length + missingFeatures.length;
  return {
    dimension: 'COVERAGE',
    verdict: total === 0 ? 'pass' : 'fail',
    detail: total === 0
      ? `All ${draft.baseline.pages.length} pages and ${draft.baseline.features.length} features have designs.`
      : `Missing designs - pages [${missingPages.map((p) => p.key).join(', ')}]; features [${missingFeatures.map((f) => f.key).join(', ')}].`,
  };
}

export async function checkDesignTraceability(
  services: CoreServices,
  draft: DesignDraft,
): Promise<VerificationFinding> {
  const blueprint = await services.store.require(draft.materialization.blueprintId);
  const listedInBlueprint = new Set([
    ...(blueprint.attributes['pageDesignIds'] as readonly string[]),
    ...(blueprint.attributes['featureDesignIds'] as readonly string[]),
  ]);
  let failures = 0;
  for (const designId of designIds(draft)) {
    const design = await services.store.require(designId);
    const baseId = design.dependencies.find((d) => !d.startsWith('BLUEPRINT')) ?? '';
    if (!services.graph.hasEdge(designId, 'DERIVED_FROM', baseId)) failures += 1;
    if (!listedInBlueprint.has(designId)) failures += 1;
  }
  return {
    dimension: 'TRACEABILITY',
    verdict: failures === 0 ? 'pass' : 'fail',
    detail: failures === 0
      ? 'Every design has a DERIVED_FROM edge to its discovery base and is aggregated by the blueprint.'
      : `${failures} broken design->base / blueprint->design links.`,
  };
}

export async function checkDesignDependencies(
  services: CoreServices,
  draft: DesignDraft,
): Promise<VerificationFinding> {
  let dangling = 0;
  for (const id of [draft.materialization.blueprintId, ...designIds(draft)]) {
    const artifact = await services.store.get(id);
    if (!artifact) continue;
    for (const dep of artifact.dependencies) {
      if ((await services.store.get(dep)) === null) dangling += 1;
    }
  }
  return {
    dimension: 'DEPENDENCY_INTEGRITY',
    verdict: dangling === 0 ? 'pass' : 'fail',
    detail: dangling === 0
      ? 'All blueprint/design dependencies resolve to stored artifacts.'
      : `${dangling} dangling dependencies.`,
  };
}
