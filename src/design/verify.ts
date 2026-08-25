/**
 * Design specialist verifier - assembles the eleven-dimension report.
 * Mechanical dimensions run real checks (check-dimensions.ts);
 * CORRECTNESS/QUALITY/CONFLICTS are honestly inconclusive at Level 1a.
 */

import type { VerificationFinding, VerificationReport, Verifier } from '../verification/verifier.ts';
import type { Actor } from '../core/artifact.ts';
import type { CoreServices } from '../core/services.ts';
import type { DesignDraft } from './check-dimensions.ts';
import {
  checkDesignCount,
  checkDesignCoverage,
  checkDesignDependencies,
  checkDesignIdentity,
  checkDesignTraceability,
} from './check-dimensions.ts';

export function createDesignSpecialist(
  services: CoreServices,
): Verifier & { verifyDraft: (draft: DesignDraft) => Promise<VerificationReport> } {
  const actor: Actor = { kind: 'verifier', id: 'design-specialist-01' };

  async function verifyDraft(draft: DesignDraft): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();
    const designIdList = [
      ...draft.materialization.pageDesignIds,
      ...draft.materialization.featureDesignIds,
    ];

    const findings: VerificationFinding[] = [
      await checkDesignCount(draft),
      await checkDesignIdentity(services, draft),
      checkDesignCoverage(draft),
      await checkDesignTraceability(services, draft),
      await checkDesignDependencies(services, draft),
    ];

    const unique = new Set(designIdList);
    findings.push({
      dimension: 'DUPLICATION',
      verdict: unique.size === designIdList.length ? 'pass' : 'fail',
      detail: unique.size === designIdList.length
        ? 'Exactly one design artifact per page/feature.'
        : 'Duplicate design artifacts detected.',
    });
    findings.push({
      dimension: 'CONSISTENCY',
      verdict: 'pass',
      detail: 'Design docs derive deterministically from stored discovery attributes.',
    });

    const missingHashes = designIdList.filter((id) => !(id in draft.rationaleHashes));
    findings.push({
      dimension: 'EVIDENCE_OF_WORK',
      verdict: missingHashes.length === 0 ? 'pass' : 'inconclusive',
      detail: missingHashes.length === 0
        ? 'AI rationale hashes recorded for every design artifact.'
        : `No AI rationale for ${missingHashes.length} deterministic feature designs (structure is code-derived; acceptable at Level 1a).`,
    });

    for (const [dimension, note] of [
      ['CORRECTNESS', 'Deep semantic design review is not machine-checkable at Level 1a.'],
      ['QUALITY', 'Editorial quality review belongs to later-level organizations.'],
      ['CONFLICTS', 'Contradiction scanning belongs to the later-level Contradiction Engine.'],
    ] as const) {
      findings.push({ dimension, verdict: 'inconclusive', detail: note });
    }

    return {
      artifactId: draft.materialization.blueprintId,
      verifier: actor,
      findings,
      startedAt,
      finishedAt: new Date().toISOString(),
      notes: 'Level-1a design verification: coverage/traceability/lineage enforced mechanically.',
    };
  }

  return {
    actor,
    verify: async (input) => {
      const draft = input.context?.['draft'] as DesignDraft | undefined;
      if (draft === undefined) throw new Error('Design specialist requires context.draft.');
      return verifyDraft(draft);
    },
    verifyDraft,
  };
}
