/**
 * Planning half of discovery materialization: converts a normalized inventory
 * into an ordered list of artifact plans. Pure - no I/O, no IDs assigned yet
 * (that happens in materialize.ts so numbering stays in one place).
 */

import type { Actor } from '../core/artifact.ts';
import type { ArtifactType } from '../core/ids.ts';
import type { NormalizedInventory } from './normalize.ts';

export interface ArtifactPlan {
  readonly type: ArtifactType;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly extraDeps: readonly { type: ArtifactType; key: string }[];
  readonly attributes: Record<string, unknown>;
}

export interface MaterializationPlan {
  readonly projectIdPlaceholder: string;
  readonly plans: readonly ArtifactPlan[];
}

export function planDiscoveryMaterialization(
  inventory: NormalizedInventory,
  _producer: Actor,
): MaterializationPlan {
  const { sorted } = inventory;
  const plans: ArtifactPlan[] = [];
  const add = (p: Omit<ArtifactPlan, 'extraDeps'> & { extraDeps?: ArtifactPlan['extraDeps'] }): void => {
    plans.push({ extraDeps: [], ...p });
  };

  // Fixed assignment order: PROJECT first.
  add({
    type: 'PROJECT',
    key: 'product',
    title: sorted.product.name,
    description: sorted.product.summary,
    attributes: { summary: sorted.product.summary },
  });

  for (const m of sorted.modules) {
    add({ type: 'MODULE', key: m.key, title: m.title, description: m.purpose, attributes: { purpose: m.purpose } });
  }
  for (const f of sorted.features) {
    add({
      type: 'FEATURE',
      key: f.key,
      title: f.title,
      description: f.description,
      parentId: `MODULE:${f.moduleKey}`,
      attributes: { moduleKey: f.moduleKey },
    });
  }
  for (const w of sorted.workflows) {
    add({ type: 'WORKFLOW', key: w.key, title: w.title, parentId: 'PROJECT:product', attributes: { steps: [...w.steps] } });
  }

  for (const p of sorted.pages) {
    add({
      type: 'PAGE',
      key: p.key,
      title: p.title,
      description: p.purpose,
      parentId: `MODULE:${p.moduleKey}`,
      attributes: { purpose: p.purpose },
    });
    for (const s of p.sections) {
      add({ type: 'SECTION', key: `${p.key}/${s.key}`, title: s.title, parentId: `PAGE:${p.key}`, attributes: { contentType: s.contentType, pageKey: p.key } });
    }
    for (const a of p.actions) {
      add({ type: 'ACTION', key: `${p.key}/${a.key}`, title: a.title, parentId: `PAGE:${p.key}`, attributes: { outcome: a.outcome, pageKey: p.key, actionKey: a.key } });
    }
    for (const st of p.states) {
      add({ type: 'STATE', key: `${p.key}/${st.key}`, title: st.name, parentId: `PAGE:${p.key}`, attributes: { whenVisible: st.whenVisible, pageKey: p.key } });
    }
    for (const v of p.validations) {
      add({
        type: 'VALIDATION',
        key: `${p.key}/${v.targetKey}`,
        title: `Validate ${v.targetKey} (${p.key})`,
        parentId: `PAGE:${p.key}`,
        extraDeps: [{ type: 'ACTION', key: `${p.key}/${v.targetKey}` }],
        attributes: { message: v.message, pageKey: p.key, targetActionKey: v.targetKey },
      });
    }
  }

  for (const r of sorted.rules) {
    add({ type: 'RULE', key: r.key, title: r.statement.slice(0, 80), attributes: { statement: r.statement } });
  }
  for (const perm of sorted.permissions) {
    add({ type: 'PERMISSION', key: perm.key, title: `${perm.resource} access`, attributes: { resource: perm.resource, roles: [...perm.roles] } });
  }
  for (const e of sorted.entities) {
    add({ type: 'ENTITY', key: e.key, title: e.name, attributes: { fields: e.fields.map((f) => ({ ...f })) } });
  }
  for (const api of sorted.apis) {
    const extraDeps: ArtifactPlan['extraDeps'] = [];
    if (api.requestEntityKey !== undefined) extraDeps.push({ type: 'ENTITY', key: api.requestEntityKey });
    if (api.responseEntityKey !== undefined) extraDeps.push({ type: 'ENTITY', key: api.responseEntityKey });
    add({
      type: 'API',
      key: api.key,
      title: `${api.method} ${api.path}`,
      extraDeps,
      attributes: {
        method: api.method,
        path: api.path,
        purpose: api.purpose,
        requestEntityKey: api.requestEntityKey,
        responseEntityKey: api.responseEntityKey,
      },
    });
  }
  for (const g of sorted.integrations) {
    add({ type: 'INTEGRATION', key: g.key, title: g.name, attributes: { direction: g.direction, purpose: g.purpose } });
  }

  return { projectIdPlaceholder: '', plans };
}
