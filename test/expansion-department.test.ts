/**
 * Level-3 Recursive Page Expansion + promotion-gate tests.
 *
 * Covers: the §0.6 fourteen-layer determination (every page through all 14
 * layers, machine-checkable exit condition), §0.16 idempotence (running the
 * expansion twice produces no new artifacts), the level3 passes running over
 * an accepted baseline, and the negative path of the exported promotion gate
 * (an artifact without provenance/evidence stays DRAFT and is reported).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscoveryDepartment } from '../src/discovery/department/engine.ts';
import {
  runFullDepartmentPasses,
  submitProducedArtifactsToGate,
} from '../src/discovery/department/level3.ts';
import { runRecursivePageExpansion } from '../src/discovery/department/expansion.ts';
import { makeServices } from './helpers/test-services.ts';
import type { CoreServices } from '../src/core/services.ts';
import { createArtifact } from '../src/core/artifact.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

async function acceptedBaseline(services: CoreServices) {
  const result = await new DiscoveryDepartment(services).discover(BRIEF);
  assert.equal(result.status, 'accepted');
  assert.ok(result.baseline !== undefined);
  return result.baseline;
}

describe('Recursive Page Expansion (§0.6, Pass 10)', () => {
  it('determines every page through all fourteen layers with a machine-checkable exit condition', async () => {
    const services = makeServices();
    const baseline = await acceptedBaseline(services);
    const expansion = await runRecursivePageExpansion(services, baseline);

    assert.equal(expansion.pages.length, baseline.pages.length);
    for (const page of expansion.pages) {
      assert.equal(page.layers.length, 14, `${page.pageKey} must have 14 layer records`);
      assert.equal(page.allLayersDetermined, true, `${page.pageKey} exit condition`);
      const layers = page.layers.map((l) => l.layer);
      assert.deepEqual(layers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      for (const layer of page.layers) {
        assert.ok(
          ['covered', 'added', 'not-relevant', 'blocked'].includes(layer.status),
          `${page.pageKey} layer ${layer.layer} has a valid status`,
        );
      }
    }

    // The five mechanical requirement sets the sample inventory genuinely
    // lacks are materialized (A11Y / PERF / SEC_REQ classes).
    assert.ok(expansion.artifactIds.some((id) => id.startsWith('A11Y-')));
    assert.ok(expansion.artifactIds.some((id) => id.startsWith('PERF-')));
    assert.ok(expansion.artifactIds.some((id) => id.startsWith('SEC_REQ-')));
  });

  it('is idempotent: a second run produces no new artifacts (§0.16)', async () => {
    const services = makeServices();
    const baseline = await acceptedBaseline(services);
    const first = await runRecursivePageExpansion(services, baseline);
    assert.ok(first.artifactIds.length > 0);
    const second = await runRecursivePageExpansion(services, baseline);
    assert.equal(second.artifactIds.length, 0, 'no duplicates on the second run');
    // And the second run still determines all 14 layers per page.
    for (const page of second.pages) {
      assert.equal(page.allLayersDetermined, true);
    }
  });

  it('routes blocked layers as omissions instead of inventing product knowledge', async () => {
    const services = makeServices();
    const baseline = await acceptedBaseline(services);
    const expansion = await runRecursivePageExpansion(services, baseline);

    // The sample has a destructive Delete task action but no rule authorizing
    // confirmation gates beyond the deletion itself; layer 6 must refuse to
    // invent one and surface the omission.
    const details = expansion.pages.find((p) => p.pageKey === 'task-details');
    assert.ok(details !== undefined, 'fixture contains task-details');
    const businessRules = details.layers.find((l) => l.layer === 6);
    assert.equal(businessRules?.status, 'blocked');
    assert.ok(details.omissions.length >= 1);
    assert.match(details.omissions.join(''), /Business Rules/);
  });

  it('runs inside the full Level-3 department and promotes every expansion artifact through the gate', async () => {
    const services = makeServices();
    const baseline = await acceptedBaseline(services);
    const result = await runFullDepartmentPasses(services, baseline);

    assert.equal(result.expansion.pages.length, baseline.pages.length);
    const expansionCount = result.expansion.artifactIds.length;
    assert.ok(expansionCount > 0);
    // Every gate subject that was genuinely produced is now VERIFIED.
    for (const id of result.artifactIds) {
      const artifact = await services.store.require(id);
      assert.equal(artifact.status, 'VERIFIED', `${id} must pass the promotion gate`);
    }
    assert.equal(result.audited, true);
    assert.ok(result.auditEvidenceId !== undefined);
  });

  it('is idempotent at the full-department level too (§0.16)', async () => {
    const services = makeServices();
    const baseline = await acceptedBaseline(services);
    const first = await runFullDepartmentPasses(services, baseline);
    const second = await runFullDepartmentPasses(services, baseline);
    assert.equal(second.expansion.artifactIds.length, 0);
    assert.equal(second.contentAdded.length, 0);
    assert.equal(second.edgeStatesAdded.length, 0);
    assert.equal(second.risks.length, 0);
    assert.equal(second.comparisonFindings.length, 0);
    assert.ok(first.artifactIds.length >= second.artifactIds.length);
    // No duplicate CONTENT / RISK / FINDING / STATE artifacts were minted.
    const counts = await services.store.countByType();
    assert.ok((counts['CONTENT'] ?? 0) >= 9);
    assert.ok((counts['RISK'] ?? 0) <= 10);
  });
});

describe('Level-3 promotion gate (negative path)', () => {
  it('keeps an evidence-less artifact DRAFT and reports it as a gate failure', async () => {
    // Isolated store: NO discovery ran, so neither the artifact nor the
    // project carries any evidence. The gate must refuse promotion.
    const services = makeServices();
    const baseline = {
      projectId: 'PROJECT-0001',
      modules: [],
      features: [],
      workflows: [],
      pages: [],
      sections: [],
      actions: [],
      rules: [],
      permissions: [],
      entities: [],
      apis: [],
      integrations: [],
      totalArtifacts: 1,
    } as const;

    const badId = services.allocator.nextId('CONTENT');
    await services.store.append(
      createArtifact({
        id: badId,
        type: 'CONTENT',
        title: 'Unanchored content region',
        description: 'Crafted fixture with provenance but no evidence.',
        projectId: baseline.projectId,
        actor: { kind: 'ai', id: 'fixture-worker' },
        attributes: { discoveryPass: 'fixture' },
      }),
    );

    const gate = await submitProducedArtifactsToGate(services, baseline, [badId]);
    assert.equal(gate.promoted, 0);
    assert.equal(gate.failures.length, 1);
    assert.match(gate.failures[0] ?? '', /no producing evidence/);

    const artifact = await services.store.require(badId);
    assert.equal(artifact.status, 'DRAFT', 'must NOT be promoted without evidence');
  });

  it('promotes a genuinely produced artifact (evidence + provenance present)', async () => {
    const services = makeServices();
    const baseline = {
      projectId: 'PROJECT-0001',
      modules: [],
      features: [],
      workflows: [],
      pages: [],
      sections: [],
      actions: [],
      rules: [],
      permissions: [],
      entities: [],
      apis: [],
      integrations: [],
      totalArtifacts: 1,
    } as const;

    const goodId = services.allocator.nextId('CONTENT');
    await services.store.append(
      createArtifact({
        id: goodId,
        type: 'CONTENT',
        title: 'Anchored content region',
        description: 'Fixture anchored with a producing evidence record.',
        projectId: baseline.projectId,
        actor: { kind: 'ai', id: 'fixture-worker' },
      }),
    );
    await services.evidence.append({
      kind: 'inspection',
      summary: `Fixture produced ${goodId} with a real evidence anchor.`,
      artifactIds: [goodId],
      producer: { kind: 'ai', id: 'fixture-worker' },
    });

    const gate = await submitProducedArtifactsToGate(services, baseline, [goodId]);
    assert.equal(gate.promoted, 1);
    assert.equal(gate.failures.length, 0);
    assert.equal((await services.store.require(goodId)).status, 'VERIFIED');
  });
});