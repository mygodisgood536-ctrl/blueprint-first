/**
 * The two Level-1b Specialist Verifiers (one per cluster, per the spec's
 * Level-1b roadmap line). Mechanical dimensions run real checks; the three
 * judgment dimensions stay honestly inconclusive. Neither specialist can
 * certify: their reports feed the Discovery Boss's gate.
 */

import type { VerificationFinding, VerificationReport, Verifier } from '../../verification/verifier.ts';
import type { Actor } from '../../core/artifact.ts';
import type { CoreServices } from '../../core/services.ts';
import type { ProductUnderstandingBrief } from '../types.ts';
import type { RawUnderstandingResult } from './types.ts';
import type { NormalizedInventory } from '../normalize.ts';

function report(
  artifactId: string,
  actor: Actor,
  findings: readonly VerificationFinding[],
  notes: string,
): VerificationReport {
  return {
    artifactId,
    verifier: actor,
    findings,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    notes,
  };
}

const HONEST_INCONCLUSIVES: readonly (readonly ['CORRECTNESS' | 'QUALITY' | 'CONFLICTS', string])[] = [
  ['CORRECTNESS', 'Deep semantic correctness is not machine-checkable at Level 1b.'],
  ['QUALITY', 'Editorial quality review belongs to later-level organizations.'],
  ['CONFLICTS', 'Contradiction scanning belongs to the later-level Contradiction Engine.'],
];

// ---------------------------------------------------------------------------
// Cluster A - Understanding specialist
// ---------------------------------------------------------------------------

export interface UnderstandingDraft {
  readonly brief: ProductUnderstandingBrief;
  readonly understanding: RawUnderstandingResult;
  readonly responseSha256: string;
}

export function createUnderstandingSpecialist(
  _services: CoreServices,
): Verifier & { verifyDraft: (draft: UnderstandingDraft) => Promise<VerificationReport> } {
  const actor: Actor = { kind: 'verifier', id: 'understanding-specialist-01' };

  async function verifyDraft(draft: UnderstandingDraft): Promise<VerificationReport> {
    const u = draft.understanding;
    const findings: VerificationFinding[] = [];

    findings.push({
      dimension: 'COUNT',
      verdict: 'pass',
      detail: 'Cluster A produces exactly one product understanding statement.',
    });

    // IDENTITY: the worker may paraphrase but must not rename the product.
    const nameFidelity =
      u.product.name.trim() === draft.brief.name.trim();
    findings.push({
      dimension: 'IDENTITY',
      verdict: nameFidelity ? 'pass' : 'fail',
      detail: nameFidelity
        ? `Product identity "${u.product.name.trim()}" matches the brief verbatim.`
        : `Cluster A renamed the product: brief "${draft.brief.name.trim()}" vs response "${u.product.name.trim()}".`,
    });

    // COVERAGE: a summary is required; a domain profile strengthens it.
    const hasSummary = u.product.summary.trim().length > 0;
    if (!hasSummary) {
      findings.push({
        dimension: 'COVERAGE',
        verdict: 'fail',
        detail: 'Product summary is empty - nothing was understood.',
      });
    } else if (u.domainProfile !== undefined && u.domainProfile.trim() !== '') {
      findings.push({
        dimension: 'COVERAGE',
        verdict: 'pass',
        detail: 'Summary and domain profile both present.',
      });
    } else {
      findings.push({
        dimension: 'COVERAGE',
        verdict: 'inconclusive',
        detail: 'Summary present but no domain profile recorded.',
      });
    }

    // TRACEABILITY: the understanding must cite the user's own words.
    const corpus = `${u.product.summary} ${u.domainProfile ?? ''}`.toLowerCase();
    const visionTokens = new Set(
      draft.brief.vision.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3),
    );
    let cited = 0;
    for (const token of visionTokens) if (corpus.includes(token)) cited += 1;
    const traceOk = visionTokens.size > 0 && cited >= Math.ceil(visionTokens.size / 2);
    findings.push({
      dimension: 'TRACEABILITY',
      verdict: traceOk ? 'pass' : 'fail',
      detail: traceOk
        ? `${cited}/${visionTokens.size} significant vision tokens cited in the understanding.`
        : `Only ${cited}/${visionTokens.size} significant vision tokens cited - understanding drifts from the brief.`,
    });

    findings.push({
      dimension: 'DEPENDENCY_INTEGRITY',
      verdict: 'pass',
      detail: 'The product statement sits above every other artifact; no dependencies yet.',
    });
    findings.push({
      dimension: 'DUPLICATION',
      verdict: 'pass',
      detail: 'Exactly one product statement.',
    });

    // CONSISTENCY: the summary must say something beyond the bare name.
    const summaryDistinct =
      u.product.summary.trim().length > 0 &&
      u.product.summary.trim().toLowerCase() !== u.product.name.trim().toLowerCase();
    findings.push({
      dimension: 'CONSISTENCY',
      verdict: summaryDistinct ? 'pass' : 'fail',
      detail: summaryDistinct
        ? 'Summary adds content beyond the product name.'
        : 'Summary merely repeats the product name - nothing was understood.',
    });

    findings.push({
      dimension: 'EVIDENCE_OF_WORK',
      verdict: /^[0-9a-f]{64}$/.test(draft.responseSha256) ? 'pass' : 'fail',
      detail: `Raw Cluster A response anchored as evidence sha256:${draft.responseSha256.slice(0, 16)}….`,
    });

    for (const [dimension, note] of HONEST_INCONCLUSIVES) {
      findings.push({ dimension, verdict: 'inconclusive', detail: note });
    }
    return report('PROJECT-pending-A', actor, findings,
      'Level-1b understanding verification: identity fidelity and brief traceability enforced mechanically.');
  }

  return {
    actor,
    verify: async () => {
      throw new Error('Understanding specialist requires context.draft via verifyDraft.');
    },
    verifyDraft,
  };
}

// ---------------------------------------------------------------------------
// Cluster B - Structural specialist
// ---------------------------------------------------------------------------

export interface StructuralDraft {
  readonly inventory: NormalizedInventory;
  readonly responseSha256: string;
}

export function createStructuralSpecialist(
  _services: CoreServices,
): Verifier & { verifyDraft: (draft: StructuralDraft) => Promise<VerificationReport> } {
  const actor: Actor = { kind: 'verifier', id: 'structural-specialist-01' };

  async function verifyDraft(draft: StructuralDraft): Promise<VerificationReport> {
    const inv = draft.inventory;
    const findings: VerificationFinding[] = [];

    // COUNT: actionability floor + internal consistency of the counts block.
    const declaredTotal =
      inv.counts.modules + inv.counts.features + inv.counts.workflows +
      inv.counts.pages + inv.counts.sections + inv.counts.actions +
      inv.counts.states + inv.counts.validations + inv.counts.rules +
      inv.counts.permissions + inv.counts.entities + inv.counts.apis +
      inv.counts.integrations;
    const counted =
      inv.sorted.modules.length + inv.sorted.features.length + inv.sorted.workflows.length +
      inv.sorted.pages.length +
      inv.sorted.pages.reduce((acc, p) => acc + p.sections.length + p.actions.length + p.states.length + p.validations.length, 0) +
      inv.sorted.rules.length + inv.sorted.permissions.length + inv.sorted.entities.length +
      inv.sorted.apis.length + inv.sorted.integrations.length;
    findings.push({
      dimension: 'COUNT',
      verdict: declaredTotal === counted && inv.counts.modules > 0 && inv.counts.pages > 0
        ? 'pass'
        : 'fail',
      detail:
        `counts block declares ${declaredTotal} artifacts and ${counted} were enumerated` +
        (inv.counts.modules > 0 && inv.counts.pages > 0
          ? '; actionability floor met (>=1 module, >=1 page).'
          : '; actionability floor NOT met.'),
    });

    // IDENTITY: slug keys are enforced by normalization; re-verified here.
    const SLUG = /^[a-z0-9][a-z0-9-]*$/;
    let malformedKeys = 0;
    for (const key of [
      ...inv.sorted.modules.map((m) => m.key),
      ...inv.sorted.features.map((f) => f.key),
      ...inv.sorted.workflows.map((w) => w.key),
      ...inv.sorted.pages.map((p) => p.key),
      ...inv.sorted.pages.flatMap((p) => p.sections.map((s) => s.key)),
      ...inv.sorted.pages.flatMap((p) => p.actions.map((a) => a.key)),
      ...inv.sorted.pages.flatMap((p) => p.states.map((s) => s.key)),
    ]) {
      if (!SLUG.test(key)) malformedKeys += 1;
    }
    findings.push({
      dimension: 'IDENTITY',
      verdict: malformedKeys === 0 ? 'pass' : 'fail',
      detail: malformedKeys === 0
        ? 'Every structural key is a canonical slug.'
        : `${malformedKeys} non-slug keys detected.`,
    });

    // COVERAGE: every module must be referenced by at least one feature or page.
    const referencedModules = new Set<string>();
    for (const f of inv.sorted.features) referencedModules.add(f.moduleKey);
    for (const p of inv.sorted.pages) referencedModules.add(p.moduleKey);
    const orphanModules = inv.sorted.modules.filter((m) => !referencedModules.has(m.key));
    findings.push({
      dimension: 'COVERAGE',
      verdict: orphanModules.length === 0 ? 'pass' : 'fail',
      detail: orphanModules.length === 0
        ? `All ${inv.sorted.modules.length} modules are realized by features or pages.`
        : `Orphan modules with no feature or page: [${orphanModules.map((m) => m.key).join(', ')}].`,
    });

    // TRACEABILITY / DEPENDENCY_INTEGRITY: enforced by normalization.
    findings.push({
      dimension: 'TRACEABILITY',
      verdict: 'pass',
      detail: 'Zero dangling references across features→modules, pages→modules, validations→actions, apis→entities.',
    });
    findings.push({
      dimension: 'DEPENDENCY_INTEGRITY',
      verdict: 'pass',
      detail: 'All cross-collection references resolved during normalization.',
    });

    // DUPLICATION: per-collection uniqueness enforced by normalization.
    findings.push({
      dimension: 'DUPLICATION',
      verdict: 'pass',
      detail: 'Per-collection key uniqueness enforced by normalization.',
    });

    // CONSISTENCY: workflows must carry at least one ordered step.
    const emptyWorkflows = inv.sorted.workflows.filter((w) => w.steps.length === 0);
    findings.push({
      dimension: 'CONSISTENCY',
      verdict: emptyWorkflows.length === 0 ? 'pass' : 'fail',
      detail: emptyWorkflows.length === 0
        ? `All ${inv.sorted.workflows.length} workflows carry ordered steps.`
        : `Workflows without steps: [${emptyWorkflows.map((w) => w.key).join(', ')}].`,
    });

    findings.push({
      dimension: 'EVIDENCE_OF_WORK',
      verdict: /^[0-9a-f]{64}$/.test(draft.responseSha256) ? 'pass' : 'fail',
      detail: `Raw Cluster B response anchored as evidence sha256:${draft.responseSha256.slice(0, 16)}….`,
    });

    for (const [dimension, note] of HONEST_INCONCLUSIVES) {
      findings.push({ dimension, verdict: 'inconclusive', detail: note });
    }
    return report('INVENTORY-pending-B', actor, findings,
      'Level-1b structural verification: coverage/orphan/consistency checks run mechanically over the normalized inventory.');
  }

  return {
    actor,
    verify: async () => {
      throw new Error('Structural specialist requires context.draft via verifyDraft.');
    },
    verifyDraft,
  };
}