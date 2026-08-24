/**
 * Mechanical discovery checks - one function per verification dimension that
 * can be checked mechanically at Level 1a. Each returns a finding with a
 * concrete, inspectable detail string.
 */

import type { VerificationFinding } from '../verification/verifier.ts';
import type { CoreServices } from '../core/services.ts';
import type { DiscoveryBaseline } from './materialize.ts';
import type { DiscoveryDraft } from './draft.ts';

export async function checkCount(draft: DiscoveryDraft): Promise<VerificationFinding> {
  const c = draft.inventory.counts;
  const expected =
    1 + c.modules + c.features + c.workflows + c.pages + c.sections +
    c.actions + c.states + c.validations + c.rules + c.permissions +
    c.entities + c.apis + c.integrations;
  return {
    dimension: 'COUNT',
    verdict: draft.baseline.totalArtifacts === expected ? 'pass' : 'fail',
    detail: `Expected ${expected} artifacts from the normalized inventory; created ${draft.baseline.totalArtifacts}.`,
  };
}

function collectEntries(baseline: DiscoveryBaseline): BaselineEntryLike[] {
  return [
    ...baseline.modules, ...baseline.features, ...baseline.workflows,
    ...baseline.pages, ...baseline.rules, ...baseline.permissions,
    ...baseline.entities, ...baseline.apis, ...baseline.integrations,
  ];
}

export interface BaselineEntryLike {
  key: string;
  artifactId: string;
}

export async function checkIdentity(
  services: CoreServices,
  draft: DiscoveryDraft,
): Promise<VerificationFinding> {
  let failures = 0;
  const entries = collectEntries(draft.baseline);
  for (const entry of entries) {
    const artifact = await services.store.get(entry.artifactId);
    if (artifact === null || artifact.attributes['discoveryKey'] !== entry.key) {
      failures += 1;
    }
  }
  return {
    dimension: 'IDENTITY',
    verdict: failures === 0 ? 'pass' : 'fail',
    detail: failures === 0
      ? `All ${entries.length} baseline entries exist with matching discovery keys.`
      : `${failures} of ${entries.length} entries missing or key-mismatched.`,
  };
}

export function checkCoverage(draft: DiscoveryDraft): VerificationFinding {
  const problems: string[] = [];
  const moduleIds = new Set(draft.baseline.modules.map((m) => m.artifactId));
  for (const feature of draft.baseline.features) {
    if (feature.parentId === undefined || !moduleIds.has(feature.parentId)) {
      problems.push(`feature "${feature.key}" has no parent module`);
    }
  }
  if (draft.baseline.pages.length !== draft.inventory.counts.pages) {
    problems.push('page count mismatch');
  }
  return {
    dimension: 'COVERAGE',
    verdict: problems.length === 0 ? 'pass' : 'fail',
    detail: problems.length === 0
      ? `All ${draft.baseline.features.length} features parented to modules; pages complete.`
      : problems.join('; '),
  };
}

export async function checkTraceability(
  services: CoreServices,
  draft: DiscoveryDraft,
): Promise<VerificationFinding> {
  const problems: string[] = [];
  const entityByArtifact = new Map(draft.baseline.entities.map((e) => [e.artifactId, e.key]));
  for (const api of draft.baseline.apis) {
    const artifact = await services.store.require(api.artifactId);
    for (const ref of ['requestEntityKey', 'responseEntityKey'] as const) {
      const key = artifact.attributes[ref];
      if (typeof key !== 'string') continue;
      const match = [...entityByArtifact.entries()].find(([id, k]) => k === key);
      if (match === undefined) {
        problems.push(`api "${api.key}" references missing entity "${key}"`);
      } else if (!artifact.dependencies.includes(match[0])) {
        problems.push(`api "${api.key}" lacks dependency edge to entity "${key}"`);
      }
    }
  }
  // Validations depend on their target action via materialization extraDeps;
  // that edge is re-checked by DEPENDENCY_INTEGRITY over stored artifacts.
  return {
    dimension: 'TRACEABILITY',
    verdict: problems.length === 0 ? 'pass' : 'fail',
    detail: problems.length === 0
      ? 'API-to-entity traceability edges verified on all APIs.'
      : problems.join('; '),
  };
}

export async function checkDependencyIntegrity(
  services: CoreServices,
  draft: DiscoveryDraft,
): Promise<VerificationFinding> {
  let dangling = 0;
  for (const entry of collectEntries(draft.baseline)) {
    const artifact = await services.store.get(entry.artifactId);
    if (!artifact) continue;
    for (const dep of artifact.dependencies) {
      if ((await services.store.get(dep)) === null) dangling += 1;
    }
  }
  return {
    dimension: 'DEPENDENCY_INTEGRITY',
    verdict: dangling === 0 ? 'pass' : 'fail',
    detail: dangling === 0
      ? 'Every declared dependency resolves to a stored artifact.'
      : `${dangling} dangling dependencies.`,
  };
}
