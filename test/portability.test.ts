/** Project portability export/import (expansion §9). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { discoverSample, makeServices } from './helpers/test-services.ts';
import { exportProjectBundle, importProjectBundle, transferProject } from '../src/portability/bundle.ts';
import type { CoreServices } from '../src/core/services.ts';

async function buildFresh(): Promise<CoreServices> {
  return makeServices();
}

describe('Project portability bundle', () => {
  it('exports a project bundle with integrity hash and artifacts', async () => {
    const { services, baseline } = await discoverSample({ name: 'TeamTask', vision: 'A lightweight task tracker for small teams.', targetUsers: ['small teams'] });

    const bundle = await exportProjectBundle(services, baseline.projectId);
    assert.equal(bundle.projectId, baseline.projectId);
    assert.ok(bundle.artifactCount > 0);
    assert.ok(bundle.edgeCount >= 0);
    assert.match(bundle.integrityHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(bundle.artifacts.length, bundle.artifactCount);
  });

  it('round-trips export→import into fresh services', async () => {
    const { services, baseline } = await discoverSample({ name: 'TeamTask', vision: 'A lightweight task tracker for small teams.', targetUsers: ['small teams'] });

    const fresh = await buildFresh();
    const result = await transferProject(services, fresh, baseline.projectId);

    assert.equal(result.projectId, baseline.projectId);
    assert.equal(result.artifactCount, (await services.store.list({ projectId: baseline.projectId })).length);
    assert.equal(result.integrityVerified, true);

    const restored = await fresh.graph.stats();
    assert.ok(restored.nodeCount > 0);
  });

  it('verifies integrity of a hand-imported bundle', async () => {
    const { services, baseline } = await discoverSample({ name: 'TeamTask', vision: 'A lightweight task tracker for small teams.', targetUsers: ['small teams'] });
    const bundle = await exportProjectBundle(services, baseline.projectId);

    const fresh = await buildFresh();
    const result = await importProjectBundle(fresh, bundle);
    assert.equal(result.integrityVerified, true);
  });

  it('restores graph edges and nodes after import', async () => {
    const { services, baseline } = await discoverSample({ name: 'TeamTask', vision: 'A lightweight task tracker for small teams.', targetUsers: ['small teams'] });

    const fresh = await buildFresh();
    const imported = await transferProject(services, fresh, baseline.projectId);
    assert.equal(imported.integrityVerified, true);
    assert.ok(imported.artifactCount > 0);

    const stats = fresh.graph.stats();
    assert.ok(stats.nodeCount > 0);
    assert.ok(stats.edgeCount > 0);
  });
});
