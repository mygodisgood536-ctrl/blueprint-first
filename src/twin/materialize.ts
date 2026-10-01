/**
 * Digital Twin materialization (§1.4, §T.1–3).
 *
 * Builds the twin from certified discovery state + the design package +
 * the evidence log. Nothing is invented:
 *   - pages come from the discovery baseline (PAGE artifacts, VERIFIED),
 *   - elements are the discovery artifact children of each page
 *     (SECTION/ACTION/STATE/VALIDATION/CONTENT/A11Y/PERF/SEC_REQ),
 *   - design bindings come from the PAGE-*-DESIGN document referencing each
 *     element (layout sectionKeys, interaction actionArtifactIds,
 *     stateHandling stateArtifactIds, validation messages, NFR sections),
 *   - evidence comes from the real evidence log.
 *
 * The result is also persisted as a TWIN manifest artifact so the twin is a
 * durable, traceable deliverable of the pipeline rather than a transient view.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';
import type {
  DigitalTwin,
  TwinEdge,
  TwinElement,
  TwinGap,
  TwinPage,
  TwinTraceStep,
} from './types.ts';

export type {
  DigitalTwin,
  TwinEdge,
  TwinElement,
  TwinGap,
  TwinPage,
  TwinTraceStep,
  TwinElementKind,
} from './types.ts';

export const ELEMENT_TYPES: readonly { readonly prefix: string; readonly kind: TwinElement['kind'] }[] = [
  { prefix: 'SECTION', kind: 'section' },
  { prefix: 'ACTION', kind: 'action' },
  { prefix: 'STATE', kind: 'state' },
  { prefix: 'VALIDATION', kind: 'validation' },
  { prefix: 'CONTENT', kind: 'content' },
  { prefix: 'A11Y', kind: 'requirement' },
  { prefix: 'PERF', kind: 'requirement' },
  { prefix: 'SEC_REQ', kind: 'requirement' },
];

function kindFor(id: string): TwinElement['kind'] | null {
  for (const entry of ELEMENT_TYPES) {
    if (id.startsWith(`${entry.prefix}-`)) return entry.kind;
  }
  return null;
}

function requirementReference(attributes: Readonly<Record<string, unknown>>): string {
  if (attributes['a11yGuideline'] !== undefined) return 'accessibility';
  if (attributes['perfDimension'] !== undefined) return 'performance';
  if (attributes['securityCategory'] !== undefined) return 'security';
  return '';
}

async function childrenOfType(
  services: CoreServices,
  parentId: string,
  type: string,
): Promise<string[]> {
  return services.graph
    .neighbors(parentId, 'downstream', 'CONTAINS')
    .filter((id) => id.startsWith(`${type}-`));
}

export interface DigitalTwinOptions {
  readonly producer?: Actor;
}

export function buildDigitalTwin(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  blueprintId: string | null,
  options: DigitalTwinOptions = {},
): Promise<DigitalTwin> {
  return materializeDigitalTwin(services, baseline, blueprintId, options);
}

export async function materializeDigitalTwin(
  services: CoreServices,
  baseline: DiscoveryBaseline,
  blueprintId: string | null,
  options: DigitalTwinOptions = {},
): Promise<DigitalTwin> {
  const producer: Actor = options.producer ?? { kind: 'system', id: 'digital-twin-engine' };
  const at = new Date().toISOString();
  const pages: TwinPage[] = [];
  let elementCount = 0;
  let boundElementCount = 0;
  let evidenceCount = 0;
  let gapCount = 0;

  for (const pageEntry of baseline.pages) {
    const pageArtifact = await services.store.require(pageEntry.artifactId);
    const designId = `${pageEntry.artifactId}-DESIGN`;
    const designArtifact = (await services.store.get(designId)) ?? null;
    const designDoc = designArtifact
      ? (designArtifact.attributes['designDoc'] as Record<string, unknown> | undefined)
      : undefined;

    const elementIds: string[] = [];
    // Page-level children (SECTION/ACTION/STATE/VALIDATION/A11Y/SEC_REQ).
    for (const prefix of ['SECTION', 'ACTION', 'STATE', 'VALIDATION', 'A11Y', 'SEC_REQ']) {
      elementIds.push(...(await childrenOfType(services, pageEntry.artifactId, prefix)));
    }
    // Section-level children (CONTENT regions and PERF requirements) are part
    // of the twin surface too — §1.4 covers the entire navigable application.
    for (const sectionId of await childrenOfType(services, pageEntry.artifactId, 'SECTION')) {
      elementIds.push(
        ...(await childrenOfType(services, sectionId, 'CONTENT')),
        ...(await childrenOfType(services, sectionId, 'PERF')),
      );
    }

    const elements: TwinElement[] = [];
    const gaps: TwinGap[] = [];
    if (designArtifact === null) {
      gapCount += 1;
      gaps.push({
        severity: 'error',
        pageId: pageEntry.artifactId,
        message: `Page ${pageEntry.key} has no ${designId} artifact; the twin surface is unrealizable.`,
      });
    }

    for (const id of elementIds) {
      const artifact = await services.store.require(id);
      const kind = kindFor(id);
      const trace: TwinTraceStep[] = [{ artifactId: id, kind: 'discovery', label: artifact.title }];
      let designBound = false;

      if (kind === 'requirement') {
        const reference = requirementReference(artifact.attributes);
        if (reference === 'accessibility') {
          designBound = Array.isArray(designDoc?.accessibility) && designDoc.accessibility.length > 0;
        }
        if (reference === 'performance') {
          const nfr = (designDoc?.nonFunctionalRequirements as string[] | undefined) ?? [];
          designBound = nfr.some((t) => /paginat|performance|scale/i.test(t));
        }
        if (reference === 'security') {
          designBound = Array.isArray(designDoc?.securityNotes) && designDoc.securityNotes.length > 0;
        }
      } else if (designDoc !== undefined) {
        switch (kind) {
          case 'section': {
            const key = String(artifact.attributes['discoveryKey'] ?? '');
            const layout = (designDoc.layout as readonly { readonly sectionKey: string }[] | undefined) ?? [];
            designBound = layout.some((l) => l.sectionKey === key);
            break;
          }
          case 'action': {
            const interactions = (designDoc.interactions as readonly { readonly actionArtifactId: string }[] | undefined) ?? [];
            designBound = interactions.some((i) => i.actionArtifactId === id);
            break;
          }
          case 'state': {
            const stateHandling = (designDoc.stateHandling as readonly { readonly stateArtifactId: string }[] | undefined) ?? [];
            designBound = stateHandling.some((s) => s.stateArtifactId === id);
            break;
          }
          case 'validation': {
            const target = String(artifact.attributes['targetActionKey'] ?? '');
            const interactions = (designDoc.interactions as readonly { readonly actionKey: string; readonly validationMessages: readonly string[] }[] | undefined) ?? [];
            designBound = interactions.some(
              (i) => i.actionKey === target && i.validationMessages.length > 0,
            );
            break;
          }
          case 'content': {
            const parentId = artifact.dependencies[0];
            let parentKey = '';
            if (parentId !== undefined) {
              const parent = await services.store.get(parentId);
              parentKey = String(parent?.attributes['discoveryKey'] ?? '');
            }
            const layout = (designDoc.layout as readonly { readonly sectionKey: string }[] | undefined) ?? [];
            designBound = parentKey !== '' && layout.some((l) => l.sectionKey === parentKey);
            break;
          }
          default:
            designBound = false;
        }
      }

      if (designArtifact !== null) {
        trace.push({ artifactId: designId, kind: 'design', label: designArtifact.title });
      }
      // §0.18: discovery cluster calls anchor their evidence on the PROJECT
      // record, so an element is traceable when it OR its project carries
      // evidence. The twin mirrors the Discovery Auditor's rule rather than
      // penalizing the anchor location.
      const directEvidence = await services.evidence.forArtifact(id);
      const projectEvidence =
        directEvidence.length > 0 ? [] : await services.evidence.forArtifact(baseline.projectId);
      const evidenceRecords = [...directEvidence, ...projectEvidence];
      const evidenceIds = evidenceRecords.map((record) => record.id);
      evidenceCount += evidenceIds.length;
      for (const record of evidenceRecords) {
        trace.push({ artifactId: record.id, kind: 'evidence', label: record.summary });
      }

      const surfaceKey = String(artifact.attributes['discoveryKey'] ?? artifact.id);
      elements.push({
        id: `${pageEntry.artifactId}#${kind ?? 'element'}:${id}`,
        kind: kind ?? 'section',
        label: artifact.title,
        surface: surfaceKey,
        discoveryArtifactId: id,
        designArtifactId: designArtifact === null ? null : designId,
        designBound,
        evidenceIds,
        trace,
      });

      if (!designBound && kind !== 'requirement') {
        gapCount += 1;
        gaps.push({
          severity: 'warning',
          pageId: pageEntry.artifactId,
          artifactId: id,
          message: `Element "${artifact.title}" (§T.2) is not realized by any surface of the ${designId} design.`,
        });
      }
      if (evidenceIds.length === 0) {
        gapCount += 1;
        gaps.push({
          severity: 'warning',
          pageId: pageEntry.artifactId,
          artifactId: id,
          message: `Element "${artifact.title}" carries no traceable evidence records in the evidence log.`,
        });
      }
      if (designBound) boundElementCount += 1;
    }
    elementCount += elements.length;

    // Navigation edges: module -> page (CONTAINS), page -> design (DERIVED_FROM),
    // page -> element (CONTAINS).
    const edges: TwinEdge[] = [];
    if (pageEntry.parentId !== undefined) {
      edges.push({ from: pageEntry.parentId, to: pageEntry.artifactId, relation: 'CONTAINS' });
    }
    if (designArtifact !== null) {
      edges.push({ from: pageEntry.artifactId, to: designId, relation: 'DERIVED_FROM' });
    }
    for (const element of elements) {
      edges.push({ from: pageEntry.artifactId, to: element.discoveryArtifactId, relation: 'CONTAINS' });
    }

    pages.push({
      pageId: pageEntry.artifactId,
      pageKey: pageEntry.key,
      title: pageArtifact.title,
      designId: designArtifact === null ? null : designId,
      designBound: designArtifact !== null,
      elements,
      edges,
      gaps,
    });
  }

  // Persist the twin as a durable manifest artifact.
  const twinId = services.allocator.nextId('TWIN');
  const twin = createArtifact({
    id: twinId,
    type: 'TWIN',
    title: `Digital Twin manifest — ${baseline.projectId}`,
    description: '§1.4 interactive Digital Twin derived from the certified discovery inventory and the design package.',
    projectId: baseline.projectId,
    actor: producer,
    at,
    dependencies: blueprintId === null ? [baseline.projectId] : [blueprintId, baseline.projectId],
    attributes: {
      twinSpec: '§1.4 / §T.1 / §T.2 / §T.3',
      pages: pages.map((p) => p.pageId),
      elementCount,
      boundElementCount,
      gapCount,
      evidenceCount,
      blueprintId: blueprintId ?? null,
      builtAt: at,
    },
  });
  await services.store.append(twin);
  await services.evidence.append({
    kind: 'inspection',
    summary: `Digital Twin manifest ${twinId} materialized: ${pages.length} page(s), ${elementCount} element(s), ${boundElementCount} design-bound, ${gapCount} gap(s).`,
    artifactIds: [twinId],
    producer,
  });
  syncArtifactToGraph(services.graph, twin);
  if (blueprintId !== null) {
    services.graph.link(blueprintId, 'CONTAINS', twinId);
  }

  const note =
    pages.length === 0
      ? 'No pages in the certified inventory; twin is empty by definition, not failure.'
      : `Twin built from ${pages.length} certified page(s); ${boundElementCount}/${elementCount} elements realized by the design package (§T.2).`;
  return {
    projectId: baseline.projectId,
    blueprintId,
    twinArtifactId: twinId,
    pages,
    elementCount,
    boundElementCount,
    gapCount,
    evidenceCount,
    built: true,
    note,
  };
}