/**
 * Discovery Boss - independent reconstruction (spec §0.15, Level-1b scope).
 *
 * The boss reasons from EXACTLY two sources: the raw Product Understanding
 * Brief and the platform's trusted foundational knowledge (here: the fixed
 * minimal-taxonomy rules embedded in its prompt). It never sees Cluster A/B
 * outputs before its expectation is complete - the engine structurally
 * enforces this by passing only the brief into the reconstruction call.
 *
 * The Level-1b reconstruction covers the core artifact types only: features,
 * workflows, pages. The diff is artifact-level: every delta becomes an
 * addressable FINDING artifact; bare count mismatches are never reported.
 */

import type { CoreServices } from '../../core/services.ts';
import type { Actor } from '../../core/artifact.ts';
import { createArtifact } from '../../core/artifact.ts';
import { syncArtifactToGraph } from '../../core/graph.ts';
import { isObj } from '../parse-util.ts';
import type { ProductUnderstandingBrief } from '../types.ts';
import { renderBrief } from '../prompt.ts';
import { DiscoveryParseError } from '../errors.ts';
import type {
  BossExpectationItem,
  ReconstructionDelta,
  ReconstructionDiffRecord,
  ReconstructionExpectation,
} from './types.ts';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Marker embedded in the boss call so providers can route deterministically. */
export const BOSS_MARKER = '[DISCOVERY:BOSS-RECONSTRUCTION]';

/**
 * Trusted foundational knowledge available to the boss at Level 1b: the
 * platform's minimal taxonomy rules, stated as expectations the boss applies
 * to whatever it reconstructs. Later levels extend this layer (Product DNA
 * Library, Genome Engine) without changing the boss's contract.
 */
export const FOUNDATIONAL_KNOWLEDGE_PREAMBLE = [
  'Platform foundational knowledge (minimal taxonomy rules):',
  '- Every product decomposes into modules; every module groups related features.',
  '- Every feature that implies user interaction is realized by at least one page.',
  '- Multi-step behavior is expressed as workflows with ordered steps.',
  '- Page, feature and workflow identities are slug-style keys with human titles.',
].join('\n');

export function renderBossPrompt(brief: ProductUnderstandingBrief): string {
  return [
    BOSS_MARKER,
    'You are the Discovery Boss. Reconstruct your INDEPENDENT expectation of',
    'the core product skeleton BEFORE seeing any worker output. Reason ONLY',
    'from the brief below and the platform knowledge provided - you have not',
    'read and must not imagine any worker conclusions.',
    '',
    renderBrief(brief),
    '',
    FOUNDATIONAL_KNOWLEDGE_PREAMBLE,
    '',
    'Reply with ONLY a JSON object:',
    '{"productName":"<exactly the brief\'s product name>",',
    ' "features":[{"key":"slug","title":"..."}],',
    ' "workflows":[{"key":"slug","title":"..."}],',
    ' "pages":[{"key":"slug","title":"..."}]}',
  ].join('\n');
}

/** Validates the boss's own reconstruction output. */
export function parseBossExpectation(value: unknown): ReconstructionExpectation {
  const problems: string[] = [];
  if (!isObj(value)) {
    throw new DiscoveryParseError(['Boss reconstruction is not a JSON object.']);
  }
  const productName = value['productName'];
  if (typeof productName !== 'string' || productName.trim() === '') {
    problems.push('productName: required non-empty string.');
  }
  const list = (field: string): BossExpectationItem[] => {
    const raw = value[field];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      problems.push(`${field}: must be an array.`);
      return [];
    }
    const items: BossExpectationItem[] = [];
    raw.forEach((entry, i) => {
      const label = `${field}[${i}]`;
      if (!isObj(entry)) {
        problems.push(`${label}: must be an object.`);
        return;
      }
      const key = entry['key'];
      const title = entry['title'];
      if (typeof key !== 'string' || !SLUG.test(key)) {
        problems.push(`${label}.key must match ${SLUG.source}.`);
      }
      if (typeof title !== 'string' || title.trim() === '') {
        problems.push(`${label}.title: required non-empty string.`);
      }
      if (typeof key === 'string' && typeof title === 'string') {
        items.push({ key, title });
      }
    });
    return items;
  };
  const expectation: ReconstructionExpectation = {
    productName: typeof productName === 'string' ? productName : '',
    features: list('features'),
    workflows: list('workflows'),
    pages: list('pages'),
  };
  if (problems.length > 0) throw new DiscoveryParseError(problems);
  return expectation;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface WorkerItem {
  readonly key: string;
  readonly title: string;
}

/**
 * Deterministic artifact-level diff for one core type. Matching correlation
 * (strongest first): exact key, normalized-title equality, token overlap
 * >= 0.5. Unmatched boss items become 'missing'; unmatched worker items
 * become 'extra'. Output ordering is deterministic.
 */
function diffCoreType(
  coreType: 'FEATURE' | 'WORKFLOW' | 'PAGE',
  bossItems: readonly BossExpectationItem[],
  workerItems: readonly WorkerItem[],
): { deltas: ReconstructionDelta[]; matches: Record<string, 'key' | 'title' | 'tokens'> } {
  const deltas: ReconstructionDelta[] = [];
  const matches: Record<string, 'key' | 'title' | 'tokens'> = {};
  const unmatchedWorkers = new Set(workerItems.map((w) => w.key));

  for (const boss of bossItems) {
    const normBoss = normalizeTitle(boss.title);
    const tokBoss = tokens(boss.title);
    let matchedVia: 'key' | 'title' | 'tokens' | undefined;
    let matchedKey: string | undefined;
    for (const worker of workerItems) {
      if (!unmatchedWorkers.has(worker.key)) continue;
      if (worker.key === boss.key) matchedVia = 'key';
      else if (normBoss !== '' && normalizeTitle(worker.title) === normBoss) matchedVia = 'title';
      else if (tokBoss.size > 0 && jaccard(tokBoss, tokens(worker.title)) >= 0.5) {
        matchedVia = 'tokens';
      }
      if (matchedVia !== undefined) {
        matchedKey = worker.key;
        break;
      }
    }
    if (matchedVia !== undefined && matchedKey !== undefined) {
      matches[matchedKey] = matchedVia;
      unmatchedWorkers.delete(matchedKey);
    } else {
      deltas.push({ kind: 'missing', coreType, bossKey: boss.key, bossTitle: boss.title });
    }
  }
  for (const worker of workerItems) {
    if (unmatchedWorkers.has(worker.key)) {
      deltas.push({ kind: 'extra', coreType, workerKey: worker.key, workerTitle: worker.title });
    }
  }
  deltas.sort((a, b) => {
    const ka = `${a.kind}:${a.coreType}:${a.bossKey ?? a.workerKey ?? ''}`;
    const kb = `${b.kind}:${b.coreType}:${b.bossKey ?? b.workerKey ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { deltas, matches };
}

/** Runs the artifact-level reconstruction diff across all three core types. */
export function diffReconstruction(
  expectation: ReconstructionExpectation,
  inventory: {
    readonly sorted: {
      readonly features: readonly { key: string; title: string }[];
      readonly workflows: readonly { key: string; title: string }[];
      readonly pages: readonly { key: string; title: string }[];
    };
  },
): ReconstructionDiffRecord {
  const featureDiff = diffCoreType(
    'FEATURE',
    expectation.features,
    inventory.sorted.features.map((f) => ({ key: f.key, title: f.title })),
  );
  const workflowDiff = diffCoreType(
    'WORKFLOW',
    expectation.workflows,
    inventory.sorted.workflows.map((w) => ({ key: w.key, title: w.title })),
  );
  const pageDiff = diffCoreType(
    'PAGE',
    expectation.pages,
    inventory.sorted.pages.map((p) => ({ key: p.key, title: p.title })),
  );
  return {
    expectation,
    deltas: [...featureDiff.deltas, ...workflowDiff.deltas, ...pageDiff.deltas],
    matches: { ...featureDiff.matches, ...workflowDiff.matches, ...pageDiff.matches },
  };
}

/**
 * Materializes every delta as an addressable FINDING artifact (spec §0.15:
 * "identify every delta by artifact ID, never report a bare count mismatch").
 * Findings persist regardless of the final decision so rejections remain
 * inspectable and the correction cycle can cite them by ID.
 */
export async function createBossFindings(
  services: CoreServices,
  diff: ReconstructionDiffRecord,
  projectId: string,
  producer: Actor,
): Promise<string[]> {
  const ids: string[] = [];
  for (const delta of diff.deltas) {
    const id = services.allocator.nextId('FINDING');
    const isMissing = delta.kind === 'missing';
    const subject = isMissing
      ? `${delta.coreType} "${delta.bossKey}" (${delta.bossTitle ?? ''})`
      : `${delta.coreType} "${delta.workerKey}" (${delta.workerTitle ?? ''})`;
    const artifact = createArtifact({
      id,
      type: 'FINDING',
      title: `Boss reconstruction ${delta.kind}: ${subject}`,
      description: isMissing
        ? `The Discovery Boss independently expected this ${delta.coreType.toLowerCase()} from the brief alone; the worker inventory has no counterpart.`
        : `The worker inventory produced this ${delta.coreType.toLowerCase()}; the Discovery Boss's independent expectation from the brief alone contains no counterpart.`,
      projectId,
      actor: producer,
      dependencies: [projectId],
      attributes: {
        findingKind: 'boss-reconstruction-delta',
        deltaKind: delta.kind,
        coreType: delta.coreType,
        ...(delta.bossKey !== undefined ? { bossKey: delta.bossKey } : {}),
        ...(delta.bossTitle !== undefined ? { bossTitle: delta.bossTitle } : {}),
        ...(delta.workerKey !== undefined ? { workerKey: delta.workerKey } : {}),
        ...(delta.workerTitle !== undefined ? { workerTitle: delta.workerTitle } : {}),
      },
    });
    await services.store.append(artifact);
    syncArtifactToGraph(services.graph, artifact);
    ids.push(id);
  }
  return ids;
}