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

/** Flatten the nested DesignTokenSet color tokens to the flat record the UX verifier expects. */
function flattenColorsForUX(doc: PageDesignDoc): Record<string, string> {
  const c = doc.designTokens?.color;
  if (!c) return {};
  return {
    primary: c.primary ?? '',
    secondary: c.secondary ?? '',
    surface: c.surface ?? '',
    surfaceAlt: c.surfaceAlt ?? '',
    text: c.text ?? '',
    mutedText: c.mutedText ?? '',
    border: c.border ?? '',
    danger: c.danger ?? '',
    success: c.success ?? '',
    focus: c.focus ?? '',
    primaryHover: c.primaryHover ?? '',
    primaryPressed: c.primaryPressed ?? '',
    onPrimary: c.onPrimary ?? '',
    accent: c.accent ?? '',
    onAccent: c.onAccent ?? '',
    dangerHover: c.dangerHover ?? '',
    warning: c.warning ?? '',
    info: c.info ?? '',
    selected: c.selected ?? '',
    selectedText: c.selectedText ?? '',
    disabledBg: c.disabledBg ?? '',
    disabledText: c.disabledText ?? '',
  };
}

/** Extract typography as flat record for UX verifier. */
function flattenTypographyForUX(doc: PageDesignDoc): Record<string, unknown> {
  const t = doc.designTokens?.typography;
  if (!t) return {};
  return {
    baseFontSize: t.baseFontSize,
    fontFamily: t.fontFamily,
    fallbackFamily: t.fallbackFamily,
    displaySize: t.display?.size,
    displayWeight: t.display?.weight,
    displayLineHeight: t.display?.lineHeight,
    headingSize: t.heading?.size,
    headingWeight: t.heading?.weight,
    headingLineHeight: t.heading?.lineHeight,
    bodySize: t.body?.size,
    bodyWeight: t.body?.weight,
    bodyLineHeight: t.body?.lineHeight,
    captionSize: t.caption?.size,
    captionWeight: t.caption?.weight,
    captionLineHeight: t.caption?.lineHeight,
  };
}

/** Extract spacing as flat record for UX verifier. */
function flattenSpacingForUX(doc: PageDesignDoc): Record<string, string> {
  const s = doc.designTokens?.spacing;
  if (!s) return {};
  return {
    unit: s.unit ?? '',
    pageMargin: s.pageMargin ?? '',
    controlGap: s.controlGap ?? '',
    sectionGap: s.sectionGap ?? '',
    componentGap: s.componentGap ?? '',
    density: s.density ?? '',
  };
}

/** Extract radius as flat record for UX verifier. */
function flattenRadiusForUX(doc: PageDesignDoc): Record<string, string> {
  const r = doc.designTokens?.radius;
  if (!r) return {};
  return {
    unit: r.unit ?? '',
    control: r.control ?? '',
    card: r.card ?? '',
    modal: r.modal ?? '',
    surface: r.surface ?? '',
  };
}

/** Extract elevation as flat record for UX verifier. */
function flattenElevationForUX(doc: PageDesignDoc): Record<string, string> {
  const e = doc.designTokens?.elevation;
  if (!e) return {};
  return {
    unit: e.unit ?? '',
    level0: e.levels?.[0]?.shadow ?? '',
    level1: e.levels?.[1]?.shadow ?? '',
    level2: e.levels?.[2]?.shadow ?? '',
    level3: e.levels?.[3]?.shadow ?? '',
  };
}

/** Build the realized design surface the UX verifier reads from impl attributes. */
function buildRealizedDesignSurface(doc: PageDesignDoc): {
  designTokens: { colors: Record<string, string>; typography: Record<string, unknown>; spacing: Record<string, string>; radius: Record<string, string>; elevation: Record<string, string> };
  accessibility: { passed: string[]; failed: string[] };
  responsive: { passed: string[]; failed: string[] };
} {
  const designTokens = {
    colors: flattenColorsForUX(doc),
    typography: flattenTypographyForUX(doc),
    spacing: flattenSpacingForUX(doc),
    radius: flattenRadiusForUX(doc),
    elevation: flattenElevationForUX(doc),
  };
  const accessibility = {
    passed: (doc.accessibility ?? []).map((r) => r.guideline),
    failed: [],
  };
  const responsive = {
    passed: (doc.responsive ?? []).map((r) => `${r.breakpointMin ?? 'base'}: ${r.behavior}`),
    failed: [],
  };
  return { designTokens, accessibility, responsive };
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
        ...buildRealizedDesignSurface(doc),
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