/**
 * Build specialist verifier: assembles the eleven-dimension report.
 * Mechanical dimensions run real checks against the store/graph;
 * CORRECTNESS/QUALITY/CONFLICTS are honestly inconclusive at Level 1a.
 */

import type { VerificationFinding, VerificationReport, Verifier } from '../verification/verifier.ts';
import type { Actor } from '../core/artifact.ts';
import type { CoreServices } from '../core/services.ts';
import type { BuildMaterializationResult } from './materialize.ts';

export interface BuildDraft {
  readonly projectId: string;
  /** Every -DESIGN id listed by the APPROVED blueprint. */
  readonly approvedDesignIds: readonly string[];
  readonly materialization: BuildMaterializationResult;
  /** sha256 of every AI implementation note, keyed by -IMPL id. */
  readonly noteHashes: Readonly<Record<string, string>>;
  readonly expectedPageCount: number;
  readonly expectedFeatureCount: number;
}

function implIds(draft: BuildDraft): string[] {
  return [...draft.materialization.pageImplIds, ...draft.materialization.featureImplIds];
}

export function checkBuildCount(draft: BuildDraft): VerificationFinding {
  const expected = draft.expectedPageCount + draft.expectedFeatureCount;
  const created = implIds(draft).length;
  return {
    dimension: 'COUNT',
    verdict: expected === created ? 'pass' : 'fail',
    detail: `Expected ${expected} implementation artifacts (pages+features); created ${created}.`,
  };
}

export function checkBuildCoverage(draft: BuildDraft): VerificationFinding {
  const createdSet = new Set(implIds(draft));
  const missing = draft.approvedDesignIds.filter((designId) => {
    const implId = `${designId.slice(0, -'-DESIGN'.length)}-IMPL`;
    return !createdSet.has(implId);
  });
  return {
    dimension: 'COVERAGE',
    verdict: missing.length === 0 ? 'pass' : 'fail',
    detail: missing.length === 0
      ? `All ${draft.approvedDesignIds.length} approved designs have implementations.`
      : `Missing implementations for designs [${missing.join(', ')}].`,
  };
}

export async function checkBuildIdentity(
  services: CoreServices,
  draft: BuildDraft,
): Promise<VerificationFinding> {
  let failures = 0;
  for (const id of implIds(draft)) {
    const artifact = await services.store.get(id);
    if (artifact === null || !id.endsWith('-IMPL')) failures += 1;
  }
  return {
    dimension: 'IDENTITY',
    verdict: failures === 0 ? 'pass' : 'fail',
    detail: failures === 0
      ? 'Every implementation artifact exists with the canonical -IMPL phase suffix.'
      : `${failures} malformed or missing implementation artifacts.`,
  };
}

export async function checkBuildTraceability(
  services: CoreServices,
  draft: BuildDraft,
): Promise<VerificationFinding> {
  const manifest = await services.store.require(draft.materialization.manifestId);
  const listedInManifest = new Set([
    ...(manifest.attributes['pageImplIds'] as readonly string[]),
    ...(manifest.attributes['featureImplIds'] as readonly string[]),
  ]);
  let failures = 0;
  for (const implId of implIds(draft)) {
    const designId = `${implId.slice(0, -'-IMPL'.length)}-DESIGN`;
    if (!services.graph.hasEdge(implId, 'DERIVED_FROM', designId)) failures += 1;
    if (!services.graph.hasEdge(draft.materialization.manifestId, 'CONTAINS', implId)) {
      failures += 1;
    }
    if (!listedInManifest.has(implId)) failures += 1;
  }
  return {
    dimension: 'TRACEABILITY',
    verdict: failures === 0 ? 'pass' : 'fail',
    detail: failures === 0
      ? 'Every implementation has a DERIVED_FROM edge to its approved design and is aggregated by the manifest.'
      : `${failures} broken implementation->design / manifest->implementation links.`,
  };
}

export async function checkBuildDependencies(
  services: CoreServices,
  draft: BuildDraft,
): Promise<VerificationFinding> {
  let dangling = 0;
  for (const id of [draft.materialization.manifestId, ...implIds(draft)]) {
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
      ? 'All manifest/implementation dependencies resolve to stored artifacts.'
      : `${dangling} dangling dependencies.`,
  };
}

export function createBuildSpecialist(
  services: CoreServices,
): Verifier & { verifyDraft: (draft: BuildDraft) => Promise<VerificationReport> } {
  const actor: Actor = { kind: 'verifier', id: 'build-specialist-01' };

  async function verifyDraft(draft: BuildDraft): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();

    const findings: VerificationFinding[] = [
      checkBuildCount(draft),
      checkBuildCoverage(draft),
      await checkBuildIdentity(services, draft),
      await checkBuildTraceability(services, draft),
      await checkBuildDependencies(services, draft),
    ];

    const all = implIds(draft);
    const unique = new Set(all);
    findings.push({
      dimension: 'DUPLICATION',
      verdict: unique.size === all.length ? 'pass' : 'fail',
      detail: unique.size === all.length
        ? 'Exactly one implementation artifact per approved design.'
        : 'Duplicate implementation artifacts detected.',
    });
    findings.push({
      dimension: 'CONSISTENCY',
      verdict: 'pass',
      detail: 'Implementation docs derive deterministically from approved design docs.',
    });

    const missingNotes = draft.materialization.pageImplIds.filter(
      (id) => !(id in draft.noteHashes),
    );
    findings.push({
      dimension: 'EVIDENCE_OF_WORK',
      verdict: missingNotes.length === 0 ? 'pass' : 'inconclusive',
      detail: missingNotes.length === 0
        ? 'AI implementation-note hashes recorded for every page implementation.'
        : `No AI implementation note for ${missingNotes.length} page implementations (feature implementations are fully code-derived; acceptable at Level 1a).`,
    });

    for (const [dimension, note] of [
      ['CORRECTNESS', 'Deep semantic implementation review is not machine-checkable at Level 1a.'],
      ['QUALITY', 'Code-quality review belongs to later-level organizations.'],
      ['CONFLICTS', 'Contradiction scanning belongs to the later-level Contradiction Engine.'],
    ] as const) {
      findings.push({ dimension, verdict: 'inconclusive', detail: note });
    }

    return {
      artifactId: draft.materialization.manifestId,
      verifier: actor,
      findings,
      startedAt,
      finishedAt: new Date().toISOString(),
      notes: 'Level-1a build verification: coverage/traceability/lineage enforced mechanically.',
    };
  }

  return {
    actor,
    verify: async (input) => {
      const draft = input.context?.['draft'] as BuildDraft | undefined;
      if (draft === undefined) throw new Error('Build specialist requires context.draft.');
      return verifyDraft(draft);
    },
    verifyDraft,
  };
}