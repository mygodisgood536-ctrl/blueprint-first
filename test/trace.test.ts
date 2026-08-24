import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryArtifactStore } from '../src/core/memory-store.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { createArtifact } from '../src/core/artifact.ts';
import type { Actor } from '../src/core/artifact.ts';
import {
  lineageStatus,
  computeLineageGaps,
  downstreamTrace,
  upstreamTrace,
  coverageSummary,
} from '../src/traceability/trace.ts';

const ACTOR: Actor = { kind: 'system', id: 'trace-tests' };

async function seededStore(): Promise<MemoryArtifactStore> {
  const store = new MemoryArtifactStore();
  await store.append(
    createArtifact({ id: 'PAGE-0001', type: 'PAGE', title: 'Base page', actor: ACTOR }),
  );
  await store.append(
    createArtifact({
      id: 'PAGE-0001-DESIGN',
      type: 'PAGE',
      title: 'Design',
      actor: ACTOR,
      dependencies: ['PAGE-0001'],
    }),
  );
  // IMPL exists but DESIGN is present too; TEST/DEPLOY/OPS intentionally missing.
  await store.append(
    createArtifact({
      id: 'PAGE-0001-IMPL',
      type: 'PAGE',
      title: 'Impl',
      actor: ACTOR,
      dependencies: ['PAGE-0001-DESIGN'],
    }),
  );
  return store;
}

describe('lineage status', () => {
  it('reports which links exist and where the chain stops', async () => {
    const status = await lineageStatus(await seededStore(), 'PAGE-0001');
    assert.deepEqual(
      status.links.map((l) => `${l.id}:${l.exists ? 'y' : 'n'}`),
      [
        'PAGE-0001:y',
        'PAGE-0001-DESIGN:y',
        'PAGE-0001-IMPL:y',
        'PAGE-0001-TEST:n',
        'PAGE-0001-DEPLOY:n',
        'PAGE-0001-OPS:n',
      ],
    );
    assert.equal(status.completeThrough, 'PAGE-0001-IMPL');
  });

  it('flags missing lineage links as gaps (honest incompleteness)', async () => {
    const status = await lineageStatus(await seededStore(), 'PAGE-0001');
    assert.ok(status.gaps.some((g) => g.id === 'PAGE-0001-TEST'));
  });

  it('detects non-contiguous lineages (impl without design)', () => {
    const gaps = computeLineageGaps([
      { id: 'PAGE-0002', exists: true },
      { id: 'PAGE-0002-DESIGN', exists: false },
      { id: 'PAGE-0002-IMPL', exists: true },
      { id: 'PAGE-0002-TEST', exists: false },
      { id: 'PAGE-0002-DEPLOY', exists: false },
      { id: 'PAGE-0002-OPS', exists: false },
    ]);
    assert.ok(gaps.some((g) => g.id === 'PAGE-0002-IMPL' && /predecessor/.test(g.reason)));
  });
});

describe('graph trace queries', () => {
  function graph() {
    const g = new KnowledgeGraph();
    for (const id of ['PROJECT-0001', 'FEATURE-0001', 'PAGE-0001']) g.addNode(id);
    g.link('FEATURE-0001', 'CONTAINS', 'PROJECT-0001');
    g.link('PAGE-0001', 'TRACES_TO', 'PROJECT-0001');
    g.link('PAGE-0001', 'DEPENDS_ON', 'FEATURE-0001');
    return g;
  }

  it('traces downstream impact and upstream causes', () => {
    const g = graph();
    assert.deepEqual(downstreamTrace(g, 'PAGE-0001'), ['FEATURE-0001', 'PROJECT-0001']);
    assert.deepEqual(upstreamTrace(g, 'PROJECT-0001'), ['FEATURE-0001', 'PAGE-0001']);
    assert.deepEqual(downstreamTrace(g, 'PROJECT-0001'), []);
  });

  it('summarizes requirement coverage with untraced lists', () => {
    const g = graph();
    for (const req of ['REQ-A', 'REQ-B']) g.addNode(req);
    g.link('PAGE-0001', 'TRACES_TO', 'REQ-A'); // REQ-A traced, REQ-B not
    const summary = coverageSummary(g, ['REQ-A', 'REQ-B'], ['TRACES_TO']);
    assert.equal(summary.totalRequirements, 2);
    assert.equal(summary.traced, 1);
    assert.deepEqual(summary.untraced, ['REQ-B']);
    assert.equal(summary.ratio, 0.5);
  });

  it('treats an empty requirement set as fully covered', () => {
    const summary = coverageSummary(new KnowledgeGraph(), []);
    assert.equal(summary.ratio, 1);
  });
});
