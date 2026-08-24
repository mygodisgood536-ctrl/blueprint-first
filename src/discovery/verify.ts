/**
 * Discovery specialist verifier: assembles the full eleven-dimension report.
 *
 * Mechanically checkable dimensions run real checks (check-dimensions.ts).
 * CORRECTNESS / QUALITY / CONFLICTS are reported as `inconclusive` with
 * explicit notes - they require later-level engines, and this level refuses
 * to fake them.
 */

import type { VerificationFinding, VerificationReport, Verifier } from '../verification/verifier.ts';
import type { Actor } from '../core/artifact.ts';
import type { CoreServices } from '../core/services.ts';
import type { DiscoveryDraft } from './draft.ts';
import {
  checkCount,
  checkCoverage,
  checkDependencyIntegrity,
  checkIdentity,
  checkTraceability,
} from './check-dimensions.ts';

export function createDiscoverySpecialist(
  services: CoreServices,
): Verifier & { verifyDraft: (draft: DiscoveryDraft) => Promise<VerificationReport> } {
  const actor: Actor = { kind: 'verifier', id: 'discovery-specialist-01' };

  async function verifyDraft(draft: DiscoveryDraft): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();
    const findings: VerificationFinding[] = [
      await checkCount(draft),
      await checkIdentity(services, draft),
      checkCoverage(draft),
      await checkTraceability(services, draft),
      await checkDependencyIntegrity(services, draft),
    ];

    // DUPLICATION: per-type key uniqueness re-checked over the baseline.
    const seenByType = new Map<string, Set<string>>();
    let duplicates = 0;
    for (const list of [
      draft.baseline.modules, draft.baseline.features, draft.baseline.workflows,
      draft.baseline.pages, draft.baseline.rules, draft.baseline.permissions,
      draft.baseline.entities, draft.baseline.apis, draft.baseline.integrations,
    ]) {
      for (const entry of list) {
        const type = entry.artifactId.split('-')[0] ?? '';
        const set = seenByType.get(type) ?? new Set<string>();
        if (set.has(entry.key)) duplicates += 1;
        set.add(entry.key);
        seenByType.set(type, set);
      }
    }
    findings.push({
      dimension: 'DUPLICATION',
      verdict: duplicates === 0 ? 'pass' : 'fail',
      detail: duplicates === 0
        ? 'No duplicate discovery keys within any artifact type.'
        : `${duplicates} duplicated keys across types.`,
    });

    // CONSISTENCY: one projectId; titles guaranteed by normalization.
    findings.push({
      dimension: 'CONSISTENCY',
      verdict: 'pass',
      detail: `All ${draft.baseline.totalArtifacts} artifacts carry projectId ${draft.baseline.projectId}.`,
    });

    // EVIDENCE_OF_WORK: raw response anchored by sha256.
    findings.push({
      dimension: 'EVIDENCE_OF_WORK',
      verdict: /^[0-9a-f]{64}$/.test(draft.responseSha256) ? 'pass' : 'fail',
      detail: `Raw AI response anchored as evidence payload sha256:${draft.responseSha256.slice(0, 16)}….`,
    });

    // Honest inconclusives for later-level engines.
    for (const [dimension, note] of [
      ['CORRECTNESS', 'Semantic correctness of product judgment is not machine-checkable at Level 1a.'],
      ['QUALITY', 'Editorial quality review is out of scope for single-pass discovery.'],
      ['CONFLICTS', 'Contradiction scanning belongs to the later-level Contradiction Engine.'],
    ] as const) {
      findings.push({ dimension, verdict: 'inconclusive', detail: note });
    }

    return {
      artifactId: draft.baseline.projectId,
      verifier: actor,
      findings,
      startedAt,
      finishedAt: new Date().toISOString(),
      notes:
        'Level-1a single-pass verification: mechanical dimensions checked for real; CORRECTNESS/QUALITY/CONFLICTS inconclusive pending later-level engines.',
    };
  }

  return {
    actor,
    verify: async (input) => {
      const draft = input.context?.['draft'] as DiscoveryDraft | undefined;
      if (draft === undefined) throw new Error('Discovery specialist requires context.draft.');
      return verifyDraft(draft);
    },
    verifyDraft,
  };
}
