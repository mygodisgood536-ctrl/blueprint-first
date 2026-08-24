import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/orchestration/pipeline.ts';
import type { PipelineStage } from '../src/orchestration/pipeline.ts';
import { MemoryArtifactStore } from '../src/core/memory-store.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';

function services() {
  return {
    store: new MemoryArtifactStore(),
    graph: new KnowledgeGraph(),
    evidence: new MemoryEvidenceLog(),
  };
}

describe('pipeline runner', () => {
  it('executes stages in order with per-stage records and state hand-off', async () => {
    const stages: PipelineStage[] = [
      { name: 'stage-a', run: async (ctx) => void ctx.state.set('value', 42) },
      {
        name: 'stage-b',
        run: async (ctx) => ({ doubled: ((ctx.state.get('value') as number) ?? 0) * 2 }),
      },
    ];
    const summary = await runPipeline(stages, services());
    assert.equal(summary.success, true);
    assert.deepEqual(
      summary.stages.map((s) => s.status),
      ['ok', 'ok'],
    );
    assert.equal(summary.stages[1]?.outputs?.['doubled'], 84);
  });

  it('stops on failure by default, marks the rest skipped, and reports honestly', async () => {
    const stages: PipelineStage[] = [
      { name: 'boom', run: async () => { throw new Error('kaboom'); } },
      { name: 'never-runs', run: async () => undefined },
    ];
    const summary = await runPipeline(stages, services(), { runId: 'fixed-run' });
    assert.equal(summary.runId, 'fixed-run');
    assert.equal(summary.success, false);
    assert.equal(summary.stages[0]?.status, 'failed');
    assert.equal(summary.stages[0]?.error?.message, 'kaboom');
    assert.equal(summary.stages[1]?.status, 'skipped');
  });

  it('continueOnError runs every stage and still reports failure', async () => {
    const ran: string[] = [];
    const stages: PipelineStage[] = [
      { name: 'a', run: async () => { throw new Error('x'); } },
      { name: 'b', run: async () => { ran.push('b'); return undefined; } },
    ];
    const summary = await runPipeline(stages, services(), { continueOnError: true });
    assert.equal(summary.success, false);
    assert.deepEqual(ran, ['b']);
    assert.equal(summary.stages.filter((s) => s.status === 'failed').length, 1);
  });

  it('gives stages access to shared services', async () => {
    const svc = services();
    const stages: PipelineStage[] = [
      {
        name: 'use-services',
        run: async (ctx) => {
          await ctx.services.evidence.append({
            kind: 'inspection',
            summary: 'pipeline evidence',
            producer: { kind: 'system', id: 'pipeline' },
          });
          ctx.services.graph.addNode('PAGE-0001');
          return { nodes: ctx.services.graph.stats().nodeCount };
        },
      },
    ];
    const summary = await runPipeline(stages, svc);
    assert.equal(summary.stages[0]?.outputs?.['nodes'], 1);
    assert.equal((await svc.evidence.all()).length, 1);
  });
});
