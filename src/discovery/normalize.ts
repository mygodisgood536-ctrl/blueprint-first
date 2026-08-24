/**
 * Semantic normalization of a structurally-valid discovery result.
 *
 * Enforces the rules structural parsing cannot express: slug-format keys,
 * per-collection key uniqueness, and referential integrity across
 * collections (features→modules, pages→modules, validations→actions,
 * apis→entities). Every collection is then sorted by key so that identical
 * input always produces identical artifact numbering downstream.
 */

import type { RawDiscoveryResult } from './types.ts';
import { DiscoveryValidationError } from './errors.ts';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function checkKeys(
  label: string,
  items: readonly { key: string }[],
  problems: string[],
): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    if (!SLUG.test(item.key)) {
      problems.push(`${label} key "${item.key}" must match ${SLUG.source}.`);
    }
    const count = seen.get(item.key) ?? 0;
    if (count === 1) {
      problems.push(`${label}: duplicate key "${item.key}".`);
    }
    seen.set(item.key, count + 1);
  }
}

function indexBy<T extends { key: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((i) => [i.key, i]));
}

export interface NormalizedInventory {
  readonly raw: RawDiscoveryResult;
  /** Deterministic ordering applied to every collection. */
  readonly sorted: RawDiscoveryResult;
  readonly counts: {
    modules: number;
    features: number;
    workflows: number;
    pages: number;
    sections: number;
    actions: number;
    states: number;
    validations: number;
    rules: number;
    permissions: number;
    entities: number;
    apis: number;
    integrations: number;
  };
}

export function normalizeDiscovery(raw: RawDiscoveryResult): NormalizedInventory {
  const problems: string[] = [];

  checkKeys('modules', raw.modules, problems);
  checkKeys('features', raw.features, problems);
  checkKeys('workflows', raw.workflows, problems);
  checkKeys('rules', raw.rules, problems);
  checkKeys('permissions', raw.permissions, problems);
  checkKeys('entities', raw.entities, problems);
  checkKeys('apis', raw.apis, problems);
  checkKeys('integrations', raw.integrations, problems);

  const moduleIds = indexBy(raw.modules);
  for (const f of raw.features) {
    if (!moduleIds.has(f.moduleKey)) {
      problems.push(`feature "${f.key}" references unknown module "${f.moduleKey}".`);
    }
  }

  let sections = 0;
  let actions = 0;
  let states = 0;
  let validations = 0;
  for (const page of raw.pages) {
    checkKeys(`page "${page.key}" sections`, page.sections, problems);
    checkKeys(`page "${page.key}" actions`, page.actions, problems);
    checkKeys(`page "${page.key}" states`, page.states, problems);
    if (!moduleIds.has(page.moduleKey)) {
      problems.push(`page "${page.key}" references unknown module "${page.moduleKey}".`);
    }
    const actionKeys = new Set(page.actions.map((a) => a.key));
    for (const v of page.validations) {
      if (!actionKeys.has(v.targetKey)) {
        problems.push(
          `validation on page "${page.key}" references unknown action "${v.targetKey}".`,
        );
      }
    }
    sections += page.sections.length;
    actions += page.actions.length;
    states += page.states.length;
    validations += page.validations.length;
  }
  checkKeys(
    'pages',
    raw.pages.map((p) => ({ key: p.key })),
    problems,
  );

  const entityKeys = new Set(raw.entities.map((e) => e.key));
  for (const api of raw.apis) {
    for (const ref of ['requestEntityKey', 'responseEntityKey'] as const) {
      const target = api[ref];
      if (target !== undefined && !entityKeys.has(target)) {
        problems.push(`api "${api.key}" references unknown entity "${target}" in ${ref}.`);
      }
    }
  }

  // A single-pass discovery must have discovered SOMETHING actionable.
  if (raw.modules.length === 0 || raw.pages.length === 0) {
    problems.push(
      'inventory must contain at least one module and one page to be actionable.',
    );
  }
  for (const page of raw.pages) {
    if (page.actions.length === 0 && page.states.length === 0 && page.sections.length === 0) {
      problems.push(
        `page "${page.key}" has no sections, actions or states - an empty page is not a discovery.`,
      );
    }
  }

  if (problems.length > 0) throw new DiscoveryValidationError(problems);

  const byKey = <T extends { key: string }>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const sortedPages = byKey(raw.pages).map((p) => ({
    ...p,
    sections: byKey(p.sections),
    actions: byKey(p.actions),
    states: byKey(p.states),
    validations: [...p.validations].sort((a, b) =>
      a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0,
    ),
  }));

  const sorted: RawDiscoveryResult = {
    product: { name: raw.product.name.trim(), summary: raw.product.summary.trim() },
    modules: byKey(raw.modules),
    features: byKey(raw.features),
    workflows: byKey(raw.workflows),
    pages: sortedPages,
    rules: byKey(raw.rules),
    permissions: byKey(raw.permissions),
    entities: byKey(raw.entities),
    apis: byKey(raw.apis),
    integrations: byKey(raw.integrations),
  };

  return {
    raw,
    sorted,
    counts: {
      modules: sorted.modules.length,
      features: sorted.features.length,
      workflows: sorted.workflows.length,
      pages: sorted.pages.length,
      sections,
      actions,
      states,
      validations,
      rules: sorted.rules.length,
      permissions: sorted.permissions.length,
      entities: sorted.entities.length,
      apis: sorted.apis.length,
      integrations: sorted.integrations.length,
    },
  };
}
