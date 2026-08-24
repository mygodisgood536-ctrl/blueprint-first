/**
 * Execution half of discovery materialization: allocates IDs in plan order,
 * creates artifacts with provenance, persists them, and registers everything
 * in the Knowledge Graph (CONTAINS hierarchy + DEPENDS_ON cross-references).
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor } from '../core/artifact.ts';
import { createArtifact } from '../core/artifact.ts';
import { syncArtifactToGraph } from '../core/graph.ts';
import type { ArtifactPlan, MaterializationPlan } from './materialize-plan.ts';

export interface BaselineEntry {
  readonly key: string;
  readonly artifactId: string;
  readonly parentId?: string;
}

export interface DiscoveryBaseline {
  readonly projectId: string;
  readonly modules: readonly BaselineEntry[];
  readonly features: readonly BaselineEntry[];
  readonly workflows: readonly BaselineEntry[];
  readonly pages: readonly BaselineEntry[];
  readonly sections: readonly BaselineEntry[];
  readonly actions: readonly BaselineEntry[];
  readonly rules: readonly BaselineEntry[];
  readonly permissions: readonly BaselineEntry[];
  readonly entities: readonly BaselineEntry[];
  readonly apis: readonly BaselineEntry[];
  readonly integrations: readonly BaselineEntry[];
  readonly totalArtifacts: number;
}

const TYPED_ENTRIES = [
  'MODULE', 'FEATURE', 'WORKFLOW', 'PAGE', 'SECTION', 'ACTION',
  'RULE', 'PERMISSION', 'ENTITY', 'API', 'INTEGRATION',
] as const;

export async function executeMaterializationPlan(
  services: CoreServices,
  plan: MaterializationPlan,
  producer: Actor,
): Promise<DiscoveryBaseline> {
  const at = new Date().toISOString();

  // Pass 1: allocate IDs in fixed plan order.
  const allocated = plan.plans.map((p) => ({ ...p, id: services.allocator.nextId(p.type) }));
  const idByRef = new Map<string, string>();
  for (const p of allocated) idByRef.set(`${p.type}:${p.key}`, p.id);

  const projectId =
    allocated.find((p) => p.type === 'PROJECT')?.id ??
    (() => { throw new Error('Materialization plan is missing its PROJECT artifact.'); })();

  const entries: Record<string, BaselineEntry[]> = {};
  for (const t of TYPED_ENTRIES) entries[t] = [];
  let total = 0;

  // Pass 2: create + persist + graph.
  for (const p of allocated) {
    const deps: string[] = [];
    let parentId: string | undefined;
    if (p.parentId !== undefined && !p.parentId.startsWith('PROJECT:')) {
      parentId = idByRef.get(p.parentId);
      if (parentId === undefined) {
        throw new Error(`Plan reference "${p.parentId}" did not resolve to an artifact.`);
      }
    }
    if (parentId !== undefined && parentId !== '') deps.push(parentId);
    if (p.parentId === 'PROJECT:product' && p.type !== 'PROJECT') deps.push(projectId);
    for (const ref of p.extraDeps) {
      const depId = idByRef.get(`${ref.type}:${ref.key}`);
      if (depId === undefined) {
        throw new Error(`Extra dependency "${ref.type}:${ref.key}" did not resolve.`);
      }
      deps.push(depId);
    }

    const artifact = createArtifact({
      id: p.id,
      type: p.type,
      title: p.title,
      ...(p.description !== undefined ? { description: p.description } : {}),
      projectId,
      actor: producer,
      at,
      dependencies: [...new Set(deps)],
      attributes: { ...p.attributes, discoveryKey: p.key },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    if (parentId !== undefined && parentId !== '') {
      services.graph.link(parentId, 'CONTAINS', p.id);
    }

    if ((entries[p.type] ?? undefined) !== undefined) {
      entries[p.type].push({
        key: p.key,
        artifactId: p.id,
        ...(parentId !== undefined && parentId !== '' ? { parentId } : {}),
      });
    }
    total += 1;
  }

  return {
    projectId,
    modules: entries['MODULE'],
    features: entries['FEATURE'],
    workflows: entries['WORKFLOW'],
    pages: entries['PAGE'],
    sections: entries['SECTION'],
    actions: entries['ACTION'],
    rules: entries['RULE'],
    permissions: entries['PERMISSION'],
    entities: entries['ENTITY'],
    apis: entries['API'],
    integrations: entries['INTEGRATION'],
    totalArtifacts: total,
  };
}
