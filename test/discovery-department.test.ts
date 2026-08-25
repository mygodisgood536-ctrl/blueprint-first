import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscoveryDepartment } from '../src/discovery/department/engine.ts';
import { departmentStructuralResponse, makeServices } from './helpers/test-services.ts';
import type { ServicesOptions } from './helpers/test-services.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

function departmentServices(
  overrides: NonNullable<ServicesOptions['departmentResponses']> = {},
): ReturnType<typeof makeServices> {
  return makeServices({ departmentResponses: overrides });
}

describe('discovery department end-to-end (Level 1b)', () => {
  it('runs Clusters A+B with self-verification, specialists, and an accepting boss', async () => {
    const services = departmentServices();
    const result = await new DiscoveryDepartment(services).discover(BRIEF);

    assert.equal(result.status, 'accepted');
    assert.equal(result.baseline?.projectId, 'PROJECT-0001');

    // Full inventory INCLUDING trivial leaves is promoted - 14 anchors + 12 leaves.
    assert.equal(result.artifactIds.length, 26);
    assert.equal(result.artifactIds[0], 'PROJECT-0001');
    for (const id of ['SECTION-0001', 'STATE-0001', 'VALIDATION-0001']) {
      const leaf = await services.store.require(id);
      assert.equal(leaf.status, 'VERIFIED', `${id} must be VERIFIED`);
      assert.ok(result.artifactIds.includes(id));
    }

    // §0.13 confidence stamped everywhere, leaves inherit their parent page.
    const feature = await services.store.require('FEATURE-0001');
    assert.ok(feature.confidence !== undefined && feature.confidence > 0.5);
    assert.ok(feature.confidence <= 0.99);
    const page = await services.store.require('PAGE-0001');
    const state = await services.store.require('STATE-0001');
    assert.equal(state.confidence, page.confidence);

    // §0.13 discovered_by labels identify which worker/pass found each item.
    assert.match(String((await services.store.require('PROJECT-0001')).attributes['discoveredBy']), /DW-A1/);
    assert.match(String(feature.attributes['discoveredBy']), /DW-B3/);
    assert.match(String((await services.store.require('SECTION-0001')).attributes['discoveredBy']), /consolidated/);

    // Boss gate: zero deltas, no findings, honest acceptance rationale.
    assert.equal(result.diff?.deltas.length, 0);
    assert.deepEqual(result.findingIds, []);
    assert.match(result.bossDecision?.rationale ?? '', /0 deltas/);

    // Specialist reports are complete eleven-dimension reports with no fails.
    for (const rep of [result.understandingReport, result.structuralReport]) {
      assert.equal(new Set(rep?.findings.map((f) => f.dimension)).size, 11);
      assert.equal(rep?.findings.some((f) => f.verdict === 'fail'), false);
    }

    // Router selections: two cluster calls + one boss reconstruction call.
    const selections = services.router.completedSelections;
    assert.equal(selections.filter((s) => s.taskType === 'DISCOVERY').length, 2);
    assert.equal(selections.filter((s) => s.taskType === 'REVIEW').length, 1);

    // Evidence: 3 response anchors + 2 self-checks + 1 diff record.
    const projectEvidence = await services.evidence.forArtifact('PROJECT-0001');
    assert.equal(projectEvidence.length, 6);
    assert.ok(projectEvidence.some((e) => /Cluster A surfaced 1 uncertainty/.test(e.summary)));
    assert.ok(projectEvidence.some((e) => /Reconstruction diff record: 0 delta/.test(e.summary)));

    // §0.14 uncertainties are surfaced, never silently dropped.
    assert.deepEqual(result.uncertainties?.understanding, ['Whether recurring tasks are in scope.']);

    // Provenance records the boss's promotion wave.
    const project = await services.store.require('PROJECT-0001');
    assert.ok(project.provenance.filter((p) => p.actor.id === 'discovery-boss-01').length >= 2);
  });

  it('is deterministic across independent runs (ids + confidence)', async () => {
    const servicesA = departmentServices();
    const servicesB = departmentServices();
    const a = await new DiscoveryDepartment(servicesA).discover(BRIEF);
    const b = await new DiscoveryDepartment(servicesB).discover(BRIEF);
    assert.equal(a.status, 'accepted');
    assert.equal(b.status, 'accepted');
    assert.deepEqual(a.artifactIds, b.artifactIds);
    for (const id of a.artifactIds) {
      const artifactA = await servicesA.store.require(id);
      const artifactB = await servicesB.store.require(id);
      assert.equal(artifactA.confidence, artifactB.confidence, `${id} confidence must match`);
      assert.deepEqual(artifactA.attributes['discoveredBy'], artifactB.attributes['discoveredBy']);
    }
  });
});

describe('discovery boss gate (independent reconstruction)', () => {
  it('rejects and records FINDING artifacts when a core feature is missing', async () => {
    const services = departmentServices({
      boss: () =>
        JSON.stringify({
          productName: 'TeamTask',
          features: [
            { key: 'task-crud', title: 'Task CRUD' },
            { key: 'reporting', title: 'Reporting' },
          ],
          workflows: [{ key: 'task-lifecycle', title: 'Task lifecycle' }],
          pages: [
            { key: 'task-board', title: 'Task Board' },
            { key: 'task-details', title: 'Task Details' },
          ],
        }),
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);

    assert.equal(result.status, 'rejected');
    // Symmetric diff: the boss's extra expectation is MISSING, and the worker
    // feature it never expected is EXTRA.
    assert.equal(result.diff?.deltas.length, 2);
    const missing = result.diff?.deltas.find((d) => d.kind === 'missing');
    assert.equal(missing?.coreType, 'FEATURE');
    assert.equal(missing?.bossKey, 'reporting');
    const extra = result.diff?.deltas.find((d) => d.kind === 'extra');
    assert.equal(extra?.coreType, 'FEATURE');
    assert.equal(extra?.workerKey, 'project-organizer');

    // Both deltas are addressable by artifact ID (ordering is deterministic
    // but the test locates them by content, not position).
    const findings = await services.store.list({ types: ['FINDING'] });
    assert.equal(findings.length, 2);
    const missingFinding = findings.find((f) => f.attributes['deltaKind'] === 'missing');
    const extraFinding = findings.find((f) => f.attributes['deltaKind'] === 'extra');
    assert.equal(missingFinding?.type, 'FINDING');
    assert.equal(missingFinding?.attributes['coreType'], 'FEATURE');
    assert.equal(missingFinding?.attributes['bossKey'], 'reporting');
    assert.equal(extraFinding?.attributes['workerKey'], 'project-organizer');

    // Rejected inventory is retained as CHANGES_REQUESTED, never deleted.
    const project = await services.store.require('PROJECT-0001');
    assert.equal(project.status, 'CHANGES_REQUESTED');
    assert.match(project.provenance.at(-1)?.note ?? '', /2 reconstruction delta/);
  });

  it('rejects worker-invented scope as an extra reconstruction delta', async () => {
    const services = departmentServices({
      structural: () => {
        const parsed = JSON.parse(departmentStructuralResponse()) as {
          features: { key: string; moduleKey: string; title: string; description: string }[];
        };
        parsed.features.push({
          key: 'ghost-feature',
          moduleKey: 'projects',
          title: 'Ghost feature',
          description: 'Invented scope.',
        });
        return JSON.stringify(parsed);
      },
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);

    assert.equal(result.status, 'rejected');
    const extra = result.diff?.deltas.find((d) => d.kind === 'extra');
    assert.equal(extra?.coreType, 'FEATURE');
    assert.equal(extra?.workerKey, 'ghost-feature');
    const finding = await services.store.require('FINDING-0001');
    assert.equal(finding.attributes['deltaKind'], 'extra');
    assert.equal(finding.attributes['workerKey'], 'ghost-feature');
  });

  it('accepts when titles correlate even though keys differ', async () => {
    const services = departmentServices({
      boss: () =>
        JSON.stringify({
          productName: 'TeamTask',
          features: [
            { key: 'organizer', title: 'Project organizer' },
            { key: 'crud-tasks', title: 'Task CRUD' },
          ],
          workflows: [{ key: 'lifecycle', title: 'Task lifecycle' }],
          pages: [
            { key: 'board', title: 'Task Board' },
            { key: 'details', title: 'Task Details' },
          ],
        }),
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(result.status, 'accepted');
    assert.ok(Object.values(result.diff?.matches ?? {}).includes('title'));
    assert.equal(result.findingIds?.length, 0);
  });

  it('fails closed when the boss expectation contradicts the brief name', async () => {
    const services = departmentServices({
      boss: () =>
        JSON.stringify({ productName: 'WrongName', features: [], workflows: [], pages: [] }),
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(result.status, 'rejected');
    assert.match(result.bossDecision?.rationale ?? '', /inconsistent with the brief product name/);
  });
});

describe('discovery department failure attribution', () => {
  it('attributes Cluster A identity drift to its specialist before anything is stored', async () => {
    const services = departmentServices({
      understanding: () =>
        JSON.stringify({
          product: { name: 'Renamed Product', summary: 'A task tracker.' },
        }),
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(result.status, 'failed');
    assert.match(result.error?.message ?? '', /renamed the product/i);
    assert.equal((await services.store.list()).length, 0);
  });

  it('attributes Cluster B garbage to the structural stage', async () => {
    const services = departmentServices({
      structural: () => 'not json at all {{{',
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(result.status, 'failed');
    assert.match(result.error?.message ?? '', /Cluster B inventory rejected/);
    assert.equal((await services.store.list()).length, 0);
  });

  it('surfaces duplicate structural keys as a Cluster B validation failure', async () => {
    const services = departmentServices({
      structural: () => {
        const parsed = JSON.parse(departmentStructuralResponse()) as {
          modules: { key: string; title: string; purpose: string }[];
        };
        parsed.modules.push({ key: 'tasks', title: 'Dup', purpose: 'dup' });
        return JSON.stringify(parsed);
      },
    });
    const result = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(result.status, 'failed');
    assert.match(result.error?.message ?? '', /duplicate key "tasks"/);
    assert.equal((await services.store.list()).length, 0);
  });
});

describe('discovery department contract', () => {
  it('reports implemented status with target level 1b', () => {
    const department = new DiscoveryDepartment(departmentServices());
    assert.equal(department.descriptor.name, 'DiscoveryDepartment');
    assert.equal(department.descriptor.targetLevel, '1b');
    assert.equal(department.descriptor.status, 'implemented');
  });
});