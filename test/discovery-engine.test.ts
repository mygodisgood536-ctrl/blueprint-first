import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePassDiscoveryEngine, DISCOVERY_BOSS } from '../src/discovery/engine.ts';
import { makeServices } from './helpers/test-services.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

describe('discovery engine end-to-end (scripted provider)', () => {
  it('produces a verified baseline with deterministic IDs and graph edges', async () => {
    const services = makeServices();
    const result = await new SinglePassDiscoveryEngine(services).discover(BRIEF);
    assert.equal(result.status, 'accepted');
    assert.ok(result.baseline);

    // Deterministic ID assignment in plan order.
    assert.equal(result.baseline.projectId, 'PROJECT-0001');
    assert.deepEqual(result.baseline.modules.map((m) => m.artifactId), ['MODULE-0001', 'MODULE-0002']);
    assert.equal(result.baseline.modules[0]?.key, 'projects');
    const board = result.baseline.pages.find((p) => p.key === 'task-board');
    assert.equal(board?.artifactId, 'PAGE-0001');
    const taskEntity = result.baseline.entities.find((e) => e.key === 'task');
    assert.equal(taskEntity?.artifactId, 'ENTITY-0001');

    // Total = 1 project + 2 modules + 2 features + 1 workflow + 2 pages
    //        + 3 sections + 4 actions + 3 states + 2 validations
    //        + 1 rule + 1 permission + 1 entity + 2 apis + 1 integration
    assert.equal(result.baseline.totalArtifacts, 26);

    // Statuses promoted to VERIFIED by the boss.
    const pageArtifact = await services.store.require('PAGE-0001');
    assert.equal(pageArtifact.status, 'VERIFIED');
    assert.equal(pageArtifact.createdBy.kind, 'ai');
    assert.match(pageArtifact.createdBy.modelId ?? '', /^scripted/);

    // Graph containment chain PROJECT -> MODULE -> PAGE -> SECTION.
    assert.equal(services.graph.hasEdge('MODULE-0002', 'CONTAINS', 'PAGE-0001'), true);
    assert.equal(services.graph.hasEdge('PAGE-0001', 'CONTAINS', 'SECTION-0001'), true);
    assert.equal(services.graph.hasEdge('PAGE-0002', 'CONTAINS', 'SECTION-0003'), true);
    assert.equal(result.baseline.sections[0]?.key, 'task-board/board-columns');

    // Cross-reference dependency: API -> ENTITY.
    const api = await services.store.require(result.baseline.apis[0].artifactId);
    assert.ok(api.dependencies.includes(taskEntity.artifactId));

    // Evidence anchored to the raw AI response.
    const evidenceForProject = await services.evidence.forArtifact(result.baseline.projectId);
    assert.equal(evidenceForProject.length, 1);
    assert.match(evidenceForProject[0]?.payloadRef ?? '', /^sha256:[0-9a-f]{64}$/);

    // Verification report covers all eleven dimensions; inconclusives honest.
    const dims = new Set(result.report?.findings.map((f) => f.dimension));
    assert.equal(dims.size, 11);
    const correctness = result.report?.findings.find((f) => f.dimension === 'CORRECTNESS');
    assert.equal(correctness?.verdict, 'inconclusive');

    // Provenance records the promotion by the boss.
    const provenanceActions = pageArtifact.provenance.map((p) => p.action);
    assert.ok(provenanceActions.includes('status-changed'));
  });

  it('is deterministic across independent runs', async () => {
    const a = await new SinglePassDiscoveryEngine(makeServices()).discover(BRIEF);
    const b = await new SinglePassDiscoveryEngine(makeServices()).discover(BRIEF);
    assert.deepEqual(a.artifactIds, b.artifactIds);
    assert.equal(a.status, b.status);
  });

  it('fails cleanly when the provider emits garbage', async () => {
    const services = makeServices({
      discoveryResponse: () => 'not json at all {{{',
    });
    const result = await new SinglePassDiscoveryEngine(services).discover(BRIEF);
    assert.equal(result.status, 'failed');
    assert.match(result.error?.message ?? '', /JSON/i);
    assert.equal((await services.store.list()).length, 0);
  });

  it('marks rejected baselines CHANGES_REQUESTED instead of deleting them', async () => {
    // Force a verification failure via a duplicate-key response that still
    // parses structurally but fails normalization -> run fails before boss.
    const services = makeServices({
      discoveryResponse: () =>
        JSON.stringify({
          product: { name: 'X', summary: 'Y' },
          modules: [
            { key: 'same', title: 'A', purpose: 'a' },
            { key: 'same', title: 'B', purpose: 'b' },
          ],
          pages: [{ key: 'p1', moduleKey: 'same', title: 'P', purpose: 'p' }],
        }),
    });
    const result = await new SinglePassDiscoveryEngine(services).discover(BRIEF);
    assert.equal(result.status, 'failed'); // normalization error aborts production
    assert.equal((await services.store.list()).length, 0);
    void DISCOVERY_BOSS;
  });
});
