import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiDesignStudio } from '../src/design/studio.ts';
import { approveBlueprint } from '../src/design/approval.ts';
import { AiBuildStudio, assertBuildableBlueprint } from '../src/build/studio.ts';
import {
  checkBuildCount,
  checkBuildCoverage,
  checkBuildIdentity,
  createBuildSpecialist,
} from '../src/build/verify.ts';
import type { BuildDraft } from '../src/build/verify.ts';
import type { BuildMaterializationResult } from '../src/build/materialize.ts';
import { discoverSample } from './helpers/test-services.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

type Services = Awaited<ReturnType<typeof discoverSample>>['services'];

/** Full happy-path fixture: discovery -> design -> approval -> build. */
async function builtProject(): Promise<{
  services: Services;
  run: Awaited<ReturnType<AiBuildStudio['buildFromBlueprint']>>;
}> {
  const { services, baseline } = await discoverSample(BRIEF);
  const designRun = await new AiDesignStudio(services).designFromBaseline(baseline);
  if (designRun.status !== 'accepted' || designRun.blueprintId === undefined) {
    throw new Error(`fixture design run failed: ${designRun.status}`);
  }
  const approval = await approveBlueprint(services, designRun.blueprintId);
  if (!approval.approved) {
    throw new Error(`fixture approval failed: ${approval.reasons.join('; ')}`);
  }
  const run = await new AiBuildStudio(services).buildFromBlueprint(designRun.blueprintId);
  return { services, run };
}

describe('AI Build Studio end-to-end (scripted provider)', () => {
  it('implements an approved blueprint with -IMPL lineage and a manifest', async () => {
    const { services, run } = await builtProject();

    assert.equal(run.status, 'accepted');
    assert.equal(run.manifestId, 'COMPONENT-0001');
    assert.deepEqual(run.artifactIds, [
      'COMPONENT-0001',
      'PAGE-0001-IMPL',
      'PAGE-0002-IMPL',
      'FEATURE-0001-IMPL',
      'FEATURE-0002-IMPL',
    ]);

    // Everything promoted to VERIFIED by the build boss.
    for (const id of run.artifactIds) {
      const artifact = await services.store.require(id);
      assert.equal(artifact.status, 'VERIFIED', `${id} should be VERIFIED`);
    }

    // Graph lineage: impls DERIVED_FROM approved designs; manifest aggregates.
    assert.equal(services.graph.hasEdge('PAGE-0001-IMPL', 'DERIVED_FROM', 'PAGE-0001-DESIGN'), true);
    assert.equal(services.graph.hasEdge('FEATURE-0002-IMPL', 'DERIVED_FROM', 'FEATURE-0002-DESIGN'), true);
    assert.equal(services.graph.hasEdge('COMPONENT-0001', 'CONTAINS', 'PAGE-0001-IMPL'), true);
    assert.equal(services.graph.hasEdge('COMPONENT-0001', 'DEPENDS_ON', 'BLUEPRINT-0001'), true);

    // AI notes exist only on page implementations and are labeled commentary.
    const pageImpl = await services.store.require('PAGE-0001-IMPL');
    assert.match(
      String((pageImpl.attributes['aiNote'] as string | undefined) ?? ''),
      /Scripted implementation note \(deterministic\)/,
    );
    assert.equal('aiNote' in (await services.store.require('FEATURE-0002-IMPL')).attributes, false);

    // Evidence anchors every AI note by sha256 of the raw response.
    for (const implId of ['PAGE-0001-IMPL', 'PAGE-0002-IMPL']) {
      const evidence = await services.evidence.forArtifact(implId);
      assert.equal(evidence.length, 1, `${implId} should carry one implementation-note evidence`);
      assert.match(evidence[0]?.payloadRef ?? '', /^sha256:[0-9a-f]{64}$/);
      assert.match(
        evidence[0]?.summary ?? '',
        /BUILD implementation note \(scripted\/scripted-deterministic-v1\)/,
      );
    }

    // The router recorded BUILD selections; provenance records the boss.
    assert.equal(
      services.router.completedSelections.filter((s) => s.taskType === 'BUILD').length,
      2,
    );
    const manifest = await services.store.require('COMPONENT-0001');
    assert.ok(manifest.provenance.filter((p) => p.actor.id === 'build-boss-01').length >= 2);

    // Independent specialist report: all eleven dimensions, no fails.
    const dims = new Set(run.report?.findings.map((f) => f.dimension));
    assert.equal(dims.size, 11);
    assert.equal(run.report?.verifier.id, 'build-specialist-01');
    assert.equal(run.report?.artifactId, 'COMPONENT-0001');
    for (const dimension of ['CORRECTNESS', 'QUALITY', 'CONFLICTS'] as const) {
      const finding: { verdict: string } | undefined = run.report?.findings.find(
        (f) => f.dimension === dimension,
      );
      assert.equal(finding?.verdict, 'inconclusive', `${dimension} must stay honest`);
    }
    assert.equal(run.report?.findings.some((f) => f.verdict === 'fail'), false);

    // The deterministic implementation plan is persisted on the manifest:
    // page/feature components, then api/entity/integration units from the
    // certified inventory.
    const units = manifest.attributes['units'] as readonly {
      kind: string;
      title: string;
      baseArtifactId?: string;
      description?: string;
    }[];
    assert.equal(units.filter((u) => u.kind === 'component' && u.title.startsWith('Implement page')).length, 2);
    assert.equal(units.filter((u) => u.kind === 'component' && u.title.startsWith('Implement feature')).length, 2);
    const apiUnit = units.find((u) => u.baseArtifactId === 'API-0001');
    assert.equal(apiUnit?.title, 'Expose POST /api/tasks');
    assert.ok(units.some((u) => u.baseArtifactId === 'ENTITY-0001'));
    assert.ok(units.some((u) => u.baseArtifactId === 'INTEGRATION-0001'));
    const boardUnit = units.find((u) => (u.description ?? '').includes('/task-board'));
    assert.ok(boardUnit !== undefined);
  });

  it('is deterministic across independent chains', async () => {
    const a = await builtProject();
    const b = await builtProject();
    assert.deepEqual(a.run.artifactIds, b.run.artifactIds);
    assert.deepEqual(
      (await a.services.store.require('COMPONENT-0001')).attributes,
      (await b.services.store.require('COMPONENT-0001')).attributes,
    );
    assert.deepEqual(
      (await a.services.store.require('PAGE-0001-IMPL')).attributes['implementationDoc'],
      (await b.services.store.require('PAGE-0001-IMPL')).attributes['implementationDoc'],
    );
  });
});

describe('build gate: only APPROVED blueprints with VERIFIED designs', () => {
  it('refuses a blueprint that is verified but not approved', async () => {
    const { services, baseline } = await discoverSample(BRIEF);
    const designRun = await new AiDesignStudio(services).designFromBaseline(baseline);
    assert.equal(designRun.status, 'accepted');
    const blueprintId = designRun.blueprintId as string;

    await assert.rejects(
      () => assertBuildableBlueprint(services, blueprintId),
      /only APPROVED blueprints may be built/,
    );
    const run = await new AiBuildStudio(services).buildFromBlueprint(blueprintId);
    assert.equal(run.status, 'failed');
    assert.match(run.error?.message ?? '', /only APPROVED blueprints may be built/);
    assert.equal(run.artifactIds.length, 0);
  });

  it('refuses an unknown blueprint id', async () => {
    const { services } = await discoverSample(BRIEF);
    await assert.rejects(
      () => assertBuildableBlueprint(services, 'BLUEPRINT-9999'),
      /does not exist/,
    );
  });

  it('refuses when a listed design has lost VERIFIED status', async () => {
    const fresh = await discoverSample(BRIEF);
    const designRun = await new AiDesignStudio(fresh.services).designFromBaseline(fresh.baseline);
    const id = designRun.blueprintId as string;
    await approveBlueprint(fresh.services, id);
    const current = await fresh.services.store.require('FEATURE-0002-DESIGN');
    await fresh.services.store.update(current.id, current.version, (draft) => ({
      ...draft,
      status: 'DRAFT',
    }));

    const run = await new AiBuildStudio(fresh.services).buildFromBlueprint(id);
    assert.equal(run.status, 'failed');
    assert.match(run.error?.message ?? '', /FEATURE-0002-DESIGN is DRAFT; build requires VERIFIED designs/);
    const manifests = await fresh.services.store.list({ types: ['COMPONENT'] });
    assert.equal(manifests.length, 0); // nothing was produced
  });
});

describe('build verification mechanics', () => {
  async function fixture(): Promise<{ services: Services; draft: BuildDraft }> {
    const { services } = await builtProject();
    const materialization: BuildMaterializationResult = {
      manifestId: 'COMPONENT-0001',
      pageImplIds: ['PAGE-0001-IMPL', 'PAGE-0002-IMPL'],
      featureImplIds: ['FEATURE-0001-IMPL', 'FEATURE-0002-IMPL'],
      allArtifactIds: [
        'COMPONENT-0001',
        'PAGE-0001-IMPL',
        'PAGE-0002-IMPL',
        'FEATURE-0001-IMPL',
        'FEATURE-0002-IMPL',
      ],
    };
    return {
      services,
      draft: {
        projectId: 'PROJECT-0001',
        approvedDesignIds: [
          'PAGE-0001-DESIGN',
          'PAGE-0002-DESIGN',
          'FEATURE-0001-DESIGN',
          'FEATURE-0002-DESIGN',
        ],
        materialization,
        noteHashes: {},
        expectedPageCount: 2,
        expectedFeatureCount: 2,
      },
    };
  }

  it('COUNT fails loudly when the created count deviates', async () => {
    const { draft } = await fixture();
    const truncated: BuildDraft = {
      ...draft,
      materialization: { ...draft.materialization, featureImplIds: [] },
    };
    const finding = checkBuildCount(truncated);
    assert.equal(finding.verdict, 'fail');
    assert.match(finding.detail, /Expected 4 .* created 2\./);
    assert.equal(checkBuildCount(draft).verdict, 'pass');
  });

  it('COVERAGE names exactly which designs lack implementations', async () => {
    const { draft } = await fixture();
    const missing: BuildDraft = {
      ...draft,
      materialization: { ...draft.materialization, featureImplIds: [] },
    };
    const finding = checkBuildCoverage(missing);
    assert.equal(finding.verdict, 'fail');
    assert.match(
      finding.detail,
      /Missing implementations for designs \[FEATURE-0001-DESIGN, FEATURE-0002-DESIGN\]/,
    );
    assert.equal(checkBuildCoverage(draft).verdict, 'pass');
  });

  it('IDENTITY fails on listed implementations that do not exist', async () => {
    const { services, draft } = await fixture();
    const ghost: BuildDraft = {
      ...draft,
      materialization: { ...draft.materialization, pageImplIds: ['PAGE-9999-IMPL'] },
    };
    const finding = await checkBuildIdentity(services, ghost);
    assert.equal(finding.verdict, 'fail');
    const ok = await checkBuildIdentity(services, draft);
    assert.equal(ok.verdict, 'pass');
  });

  it('EVIDENCE_OF_WORK is honestly inconclusive without AI notes', async () => {
    const { services, draft } = await fixture();
    const specialist = createBuildSpecialist(services);
    const report = await specialist.verifyDraft(draft);
    const finding = report.findings.find((f) => f.dimension === 'EVIDENCE_OF_WORK');
    assert.equal(finding?.verdict, 'inconclusive');
    assert.match(finding?.detail ?? '', /No AI implementation note for 2 page implementations/);

    const hashed: BuildDraft = {
      ...draft,
      noteHashes: Object.fromEntries(
        draft.materialization.pageImplIds.map((id) => [id, 'b'.repeat(64)]),
      ),
    };
    const passing = (await specialist.verifyDraft(hashed)).findings.find(
      (f) => f.dimension === 'EVIDENCE_OF_WORK',
    );
    assert.equal(passing?.verdict, 'pass');
  });
});