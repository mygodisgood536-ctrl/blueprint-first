import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiDesignStudio } from '../src/design/studio.ts';
import {
  approveBlueprint,
  DEFAULT_APPROVER,
  DESIGN_WORKER_ID,
  evaluateApproval,
  rejectBlueprint,
} from '../src/design/approval.ts';
import type { DesignMaterializationResult } from '../src/design/materialize.ts';
import {
  checkDesignCount,
  checkDesignCoverage,
  checkDesignIdentity,
} from '../src/design/check-dimensions.ts';
import type { DesignDraft } from '../src/design/check-dimensions.ts';
import { createDesignSpecialist } from '../src/design/verify.ts';
import { putNewArtifact, recordStatusChange } from '../src/core/store.ts';
import type { Actor } from '../src/core/artifact.ts';
import type { VerificationFinding } from '../src/verification/verifier.ts';
import { discoverSample } from './helpers/test-services.ts';

const SYSTEM: Actor = { kind: 'system', id: 'test-fixture' };

interface StoredPageDesignDoc {
  readonly pageKey: string;
  readonly navigation: { readonly route: string };
  readonly layout: readonly {
    readonly sectionKey: string;
    readonly contentType: string;
    readonly layoutHint: string;
  }[];
  readonly interactions: readonly {
    readonly actionKey: string;
    readonly validationMessages: readonly string[];
  }[];
  readonly stateHandling: readonly unknown[];
  readonly functionalRequirements: readonly string[];
  readonly securityNotes: readonly { readonly permissionKey: string; readonly appliesHere: boolean }[];
}

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

describe('AI Design Studio end-to-end (scripted provider)', () => {
  it('turns a verified baseline into an approvable blueprint with full lineage', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);

    assert.equal(run.status, 'accepted');
    assert.equal(run.blueprintId, 'BLUEPRINT-0001');

    // Exact lineage IDs, one design per discovered page/feature.
    assert.deepEqual(run.artifactIds, [
      'BLUEPRINT-0001',
      'PAGE-0001-DESIGN',
      'PAGE-0002-DESIGN',
      'FEATURE-0001-DESIGN',
      'FEATURE-0002-DESIGN',
    ]);

    // Everything promoted to VERIFIED by the design boss.
    for (const id of run.artifactIds) {
      const artifact = await services.store.require(id);
      assert.equal(artifact.status, 'VERIFIED', `${id} should be VERIFIED`);
    }

    // Graph lineage: designs DERIVED_FROM their bases, blueprint aggregates.
    assert.equal(services.graph.hasEdge('PAGE-0001-DESIGN', 'DERIVED_FROM', 'PAGE-0001'), true);
    assert.equal(services.graph.hasEdge('FEATURE-0002-DESIGN', 'DERIVED_FROM', 'FEATURE-0002'), true);
    assert.equal(services.graph.hasEdge('BLUEPRINT-0001', 'CONTAINS', 'PAGE-0001-DESIGN'), true);
    assert.equal(services.graph.hasEdge('BLUEPRINT-0001', 'CONTAINS', 'FEATURE-0002-DESIGN'), true);

    // Deterministic derivation from certified discovery attributes.
    const boardDoc = (await services.store.require('PAGE-0001-DESIGN')).attributes['designDoc'] as {
      pageKey: string;
      navigation: { route: string };
      layout: { sectionKey: string; contentType: string; layoutHint: string }[];
      interactions: { actionKey: string; validationMessages: string[] }[];
      stateHandling: unknown[];
      functionalRequirements: string[];
      securityNotes: { permissionKey: string; appliesHere: boolean }[];
    };
    assert.equal(boardDoc.navigation.route, '/task-board');
    assert.deepEqual(
      boardDoc.layout.map((s) => s.sectionKey),
      ['task-board/board-columns', 'task-board/board-toolbar'],
    );
    assert.equal(boardDoc.layout[0]?.layoutHint.includes('drag-and-drop'), true);
    const createInteraction = boardDoc.interactions.find((i) => i.actionKey === 'create-task');
    assert.deepEqual(createInteraction?.validationMessages, ['Title is required.']);
    assert.equal(boardDoc.stateHandling.length, 2);
    assert.equal(boardDoc.functionalRequirements.length, 2);
    // Permission notes carry the discovered permission plus applicability.
    assert.equal(boardDoc.securityNotes[0]?.permissionKey, 'manage-tasks');
    assert.equal(boardDoc.securityNotes[0]?.appliesHere, true);

    // Feature designs wire to the pages of their module.
    const crudDoc = (await services.store.require('FEATURE-0002-DESIGN')).attributes['designDoc'] as {
      pageKeys: string[];
    };
    assert.deepEqual(crudDoc.pageKeys, ['task-board', 'task-details']);
    const organizerDoc = (await services.store.require('FEATURE-0001-DESIGN')).attributes['designDoc'] as {
      pageKeys: string[];
    };
    assert.deepEqual(organizerDoc.pageKeys, []);

    // AI rationales exist only on page designs (feature designs are fully
    // code-derived), are labeled commentary, and never alter structure.
    const storedBoardDoc = (await services.store.require('PAGE-0001-DESIGN'))
      .attributes['designDoc'] as StoredPageDesignDoc & { readonly aiRationale?: string };
    assert.match(storedBoardDoc.aiRationale ?? '', /Scripted design rationale \(deterministic\)/);
    const featureAttrs = (await services.store.require('FEATURE-0002-DESIGN')).attributes;
    assert.equal(featureAttrs['designKind'], 'feature');
    assert.equal(
      (featureAttrs['designDoc'] as { readonly aiRationale?: string }).aiRationale,
      undefined,
    );

    // Evidence anchors every AI rationale by sha256 of the raw response.
    for (const designId of ['PAGE-0001-DESIGN', 'PAGE-0002-DESIGN']) {
      const evidence = await services.evidence.forArtifact(designId);
      assert.equal(evidence.length, 1, `${designId} should carry one rationale evidence`);
      assert.match(evidence[0]?.payloadRef ?? '', /^sha256:[0-9a-f]{64}$/);
      assert.match(
        evidence[0]?.summary ?? '',
        /DESIGN rationale \(scripted\/scripted-deterministic-v1\)/,
      );
    }

    // The router recorded the DESIGN selections; provenance records the boss.
    assert.equal(
      services.router.completedSelections.filter((s) => s.taskType === 'DESIGN').length,
      2,
    );
    const blueprint = await services.store.require('BLUEPRINT-0001');
    const bossEntries = blueprint.provenance.filter((p) => p.actor.id === 'design-boss-01');
    assert.ok(bossEntries.length >= 2); // IN_REVIEW + VERIFIED promotions

    // Independent specialist report: all eleven dimensions, no fails.
    const dims = new Set(run.report?.findings.map((f) => f.dimension));
    assert.equal(dims.size, 11);
    assert.equal(run.report?.verifier.id, 'design-specialist-01');
    assert.equal(run.report?.artifactId, 'BLUEPRINT-0001');
    for (const dimension of ['CORRECTNESS', 'QUALITY', 'CONFLICTS'] as const) {
      const finding: VerificationFinding | undefined = run.report?.findings.find(
        (f) => f.dimension === dimension,
      );
      assert.equal(finding?.verdict, 'inconclusive', `${dimension} must stay honest`);
    }
    assert.equal(run.report?.findings.some((f) => f.verdict === 'fail'), false);
    assert.equal(run.decision?.decision, 'accepted');
  });

  it('is deterministic across independent runs', async () => {
    const a = await discoverSample(BRIEF);
    const b = await discoverSample(BRIEF);
    const runA = await new AiDesignStudio(a.services).designFromBaseline(a.baseline);
    const runB = await new AiDesignStudio(b.services).designFromBaseline(b.baseline);
    assert.deepEqual(runA.artifactIds, runB.artifactIds);
    assert.deepEqual(
      (await a.services.store.require('BLUEPRINT-0001')).attributes,
      (await b.services.store.require('BLUEPRINT-0001')).attributes,
    );
    assert.deepEqual(
      (await a.services.store.require('PAGE-0001-DESIGN')).attributes['designDoc'],
      (await b.services.store.require('PAGE-0001-DESIGN')).attributes['designDoc'],
    );
  });

  it('refuses to design from a baseline that is not fully VERIFIED', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    // Legal reopen of one discovered page (state machine allows this).
    await recordStatusChange(services.store, 'PAGE-0001', 'IN_REVIEW', SYSTEM, {
      note: 'Reopened before design.',
    });
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    assert.equal(run.status, 'failed');
    assert.match(run.error?.message ?? '', /design requires a VERIFIED baseline/);
    assert.equal(run.artifactIds.length, 0);
    const blueprints = await services.store.list({ types: ['BLUEPRINT'] });
    assert.equal(blueprints.length, 0); // nothing was produced
  });
});

describe('blueprint approval gate', () => {
  it('approves a verified blueprint and records evidence + provenance', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    assert.equal(run.status, 'accepted');
    const blueprintId = run.blueprintId as string;

    const evaluation = await evaluateApproval(services, blueprintId, DEFAULT_APPROVER);
    assert.equal(evaluation.approved, true);
    assert.deepEqual(evaluation.reasons, []);

    const approval = await approveBlueprint(services, blueprintId);
    assert.equal(approval.approved, true);
    assert.ok(approval.evidenceId !== undefined);

    const blueprint = await services.store.require(blueprintId);
    assert.equal(blueprint.status, 'APPROVED');
    const evidence = await services.evidence.forArtifact(blueprintId);
    assert.ok(evidence.some((e) => e.id === approval.evidenceId && e.kind === 'review'));
    assert.ok(
      blueprint.provenance.some(
        (p) => p.actor.id === 'product-owner-01' && p.evidenceId === approval.evidenceId,
      ),
    );
  });

  it('forbids self-approval regardless of the declared actor kind', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    const blueprintId = run.blueprintId as string;

    // Identity rule: same id = same origin, whatever kind it claims to be.
    for (const kind of ['human', 'ai', 'verifier', 'system'] as const) {
      const evaluation = await evaluateApproval(services, blueprintId, {
        kind,
        id: DESIGN_WORKER_ID,
      });
      assert.equal(evaluation.approved, false, `${kind}:${DESIGN_WORKER_ID} must not approve`);
      assert.ok(evaluation.reasons.some((r) => /self-approval forbidden/.test(r)));
    }
  });

  it('rejects when any listed design is not VERIFIED', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    const blueprintId = run.blueprintId as string;

    const current = await services.store.require('FEATURE-0002-DESIGN');
    await services.store.update(current.id, current.version, (draft) => ({
      ...draft,
      status: 'DRAFT',
    }));

    const evaluation = await evaluateApproval(services, blueprintId, DEFAULT_APPROVER);
    assert.equal(evaluation.approved, false);
    assert.ok(
      evaluation.reasons.some((r) => /FEATURE-0002-DESIGN is DRAFT, not VERIFIED/.test(r)),
    );
  });

  it('rejects when a verified discovery artifact has no design coverage', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    const blueprintId = run.blueprintId as string;

    // A new VERIFIED page appears in the project without a design.
    const rogueId = services.allocator.nextId('PAGE');
    await putNewArtifact(services.store, {
      id: rogueId,
      type: 'PAGE',
      title: 'Late page',
      projectId: baseline.projectId,
      actor: SYSTEM,
    });
    await recordStatusChange(services.store, rogueId, 'IN_REVIEW', SYSTEM, {});
    await recordStatusChange(services.store, rogueId, 'VERIFIED', SYSTEM, {});

    const evaluation = await evaluateApproval(services, blueprintId, DEFAULT_APPROVER);
    assert.equal(evaluation.approved, false);
    assert.ok(
      evaluation.reasons.some((r) => r.includes(`No design covers discovery artifact ${rogueId}.`)),
    );

    const rejection = await approveBlueprint(services, blueprintId);
    assert.equal(rejection.approved, false);
    const stillVerified = await services.store.require(blueprintId);
    assert.equal(stillVerified.status, 'VERIFIED'); // gate did NOT promote
  });

  it('records an explicit rejection as CHANGES_REQUESTED via the legal path', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    const blueprintId = run.blueprintId as string;

    await rejectBlueprint(services, blueprintId, 'Navigation model too rigid.', DEFAULT_APPROVER);
    const blueprint = await services.store.require(blueprintId);
    assert.equal(blueprint.status, 'CHANGES_REQUESTED');
    assert.ok(blueprint.provenance.some((p) => p.note === 'Navigation model too rigid.'));

    const evaluation = await evaluateApproval(services, blueprintId, DEFAULT_APPROVER);
    assert.equal(evaluation.approved, false);
    assert.ok(evaluation.reasons.some((r) => /CHANGES_REQUESTED/.test(r)));
  });
});

describe('design verification mechanics', () => {
  type Services = Awaited<ReturnType<typeof discoverSample>>['services'];

  async function acceptedFixture(): Promise<{
    services: Services;
    draft: DesignDraft;
  }> {
    const { services, baseline } = await discoverSample(BRIEF);
    const run = await new AiDesignStudio(services).designFromBaseline(baseline);
    if (run.status !== 'accepted' || run.blueprintId === undefined) {
      throw new Error(`fixture design run failed: ${run.status}`);
    }
    const materialization: DesignMaterializationResult = {
      blueprintId: run.blueprintId,
      pageDesignIds: ['PAGE-0001-DESIGN', 'PAGE-0002-DESIGN'],
      featureDesignIds: ['FEATURE-0001-DESIGN', 'FEATURE-0002-DESIGN'],
      allArtifactIds: [
        run.blueprintId,
        'PAGE-0001-DESIGN',
        'PAGE-0002-DESIGN',
        'FEATURE-0001-DESIGN',
        'FEATURE-0002-DESIGN',
      ],
    };
    return { services, draft: { baseline, materialization, rationaleHashes: {} } };
  }

  it('COUNT fails loudly when the created count deviates from the baseline', async () => {
    const { draft } = await acceptedFixture();
    const truncated: DesignDraft = {
      ...draft,
      materialization: { ...draft.materialization, featureDesignIds: [] },
    };
    const finding = await checkDesignCount(truncated);
    assert.equal(finding.dimension, 'COUNT');
    assert.equal(finding.verdict, 'fail');
    assert.match(finding.detail, /Expected 4 .* created 2\./);
    assert.equal((await checkDesignCount(draft)).verdict, 'pass');
  });

  it('COVERAGE names exactly which pages lack designs', async () => {
    const { draft } = await acceptedFixture();
    const missing: DesignDraft = {
      ...draft,
      materialization: { ...draft.materialization, pageDesignIds: ['PAGE-0001-DESIGN'] },
    };
    const finding = checkDesignCoverage(missing);
    assert.equal(finding.verdict, 'fail');
    assert.match(finding.detail, /Missing designs/);
    assert.match(finding.detail, /pages \[task-details\]/);
    assert.match(finding.detail, /features \[\]/);
    assert.equal(checkDesignCoverage(draft).verdict, 'pass');
  });

  it('IDENTITY fails on listed designs that do not exist in the store', async () => {
    const { services, draft } = await acceptedFixture();
    const ghost: DesignDraft = {
      ...draft,
      materialization: { ...draft.materialization, pageDesignIds: ['PAGE-9999-DESIGN'] },
    };
    const finding = await checkDesignIdentity(services, ghost);
    assert.equal(finding.verdict, 'fail');
    assert.match(finding.detail, /malformed or missing/);
    const ok = await checkDesignIdentity(services, draft);
    assert.equal(ok.verdict, 'pass');
  });

  it('EVIDENCE_OF_WORK is honestly inconclusive without rationale hashes', async () => {
    const { services, draft } = await acceptedFixture();
    const specialist = createDesignSpecialist(services);
    const report = await specialist.verifyDraft(draft);
    const finding = report.findings.find((f) => f.dimension === 'EVIDENCE_OF_WORK');
    assert.equal(finding?.verdict, 'inconclusive');
    assert.match(finding?.detail ?? '', /No AI rationale for 4 deterministic feature designs/);

    // With hashes present the same check passes outright.
    const hashed: DesignDraft = {
      ...draft,
      rationaleHashes: Object.fromEntries(
        [...draft.materialization.pageDesignIds, ...draft.materialization.featureDesignIds].map(
          (id) => [id, 'a'.repeat(64)],
        ),
      ),
    };
    const passing = (await specialist.verifyDraft(hashed)).findings.find(
      (f) => f.dimension === 'EVIDENCE_OF_WORK',
    );
    assert.equal(passing?.verdict, 'pass');
  });
});
