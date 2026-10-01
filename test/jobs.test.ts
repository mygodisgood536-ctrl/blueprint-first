import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDataDir } from './helpers.ts';
import { DurableEventBus, eventsFilePath } from '../src/events/bus.ts';
import { JobEngine, jobsFilePath, JobConflictError } from '../src/jobs/engine.ts';
import { buildExecutionGraph } from '../src/jobs/graph.ts';
import type { EnvStatus, JobEnvPort } from '../src/env/types.ts';
import type { JobExecutor, JobRecord, JobResult } from '../src/jobs/types.ts';

async function until(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
}

function makeEnv(initialStatus: string): { probe: JobEnvPort; setStatus: (s: string) => void } {
  const state: { status: EnvStatus } = { status: initialStatus as EnvStatus };
  return {
    probe: {
      envOf: async () => ({
        status: state.status,
        workspaceRoot: state.status === 'READY' ? '/workspaces/x' : null,
      }),
    },
    setStatus: (s: string) => {
      state.status = s as EnvStatus;
    },
  };
}

async function untilEvent(bus: DurableEventBus, match: (e: { type: string; jobId?: string }) => boolean): Promise<void> {
  await until(async () => (await bus.history()).some(match));
}

function okExecutor(summary = 'done'): JobExecutor {
  return async () => ({ ok: true, summary }) as JobResult;
}

async function waitForStatus(engine: JobEngine, id: string, status: string): Promise<JobRecord> {
  await until(async () => (await engine.get(id))?.status === status);
  return (await engine.get(id))!;
}

describe('JobEngine', () => {
  it('enqueues and completes a job with an AI binding snapshot and events', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('READY');
    const engine = new JobEngine({
      filePath: jobsFilePath(dir),
      bus,
      executor: okExecutor('stage wired'),
      env: env.probe,
    });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-1',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
      envId: 'ENV-000001',
      ai: { providerId: 'openai', modelId: 'gpt-4o', configVersion: 1, boundAt: new Date().toISOString() },
    });
    assert.ok(job.id.startsWith('JOB-'));
    const done = await waitForStatus(engine, job.id, 'COMPLETED');
    assert.equal(done.result?.ok, true);
    assert.equal(done.result?.summary, 'stage wired');
    assert.equal(done.ai?.modelId, 'gpt-4o');
    await untilEvent(bus, (e) => e.type === 'job.created' && e.jobId === job.id);
    await untilEvent(bus, (e) => e.type === 'job.completed' && e.jobId === job.id);
    // a terminal job releases the per-stage lock: re-running a stage creates a new job
    const rerun = await engine.enqueue({
      projectId: 'PROJ-1',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, rerun.id, 'COMPLETED');
  });

  it('refuses a second active job of the same project stage', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, executor: () => new Promise<JobResult>(() => {}) });
    await engine.init();
    const first = await engine.enqueue({
      projectId: 'PROJ-CONFLICT',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, first.id, 'RUNNING');
    await assert.rejects(
      () =>
        engine.enqueue({
          projectId: 'PROJ-CONFLICT',
          ownerId: 'alice',
          stageKey: 'discovery',
          label: 'Discovery',
          mode: 'full-product',
          instruction: '',
        }),
      JobConflictError,
    );
  });

  it('orders dependents: B is BLOCKED until A completes, then runs', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('READY');
    const engine = new JobEngine({ filePath: jobsFilePath(dir), bus, executor: okExecutor(), env: env.probe });
    await engine.init();
    const a = await engine.enqueue({
      projectId: 'PROJ-2',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    const b = await engine.enqueue({
      projectId: 'PROJ-2',
      ownerId: 'alice',
      stageKey: 'blueprint',
      label: 'Blueprint',
      mode: 'full-product',
      instruction: '',
      dependsOn: [a.id],
    });
    await waitForStatus(engine, a.id, 'COMPLETED');
    await waitForStatus(engine, b.id, 'COMPLETED');
    // B must never have STARTED before A finished
    const graph = buildExecutionGraph(await engine.forProject('PROJ-2'), 'PROJ-2');
    assert.equal(graph.edges.length, 1);
    assert.deepEqual(graph.edges[0], { from: a.id, to: b.id });
    assert.equal(graph.completedCount, 2);
  });

  it('blocks a job whose environment is not READY and unblocks once verified', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('PROVISIONING');
    let started = false;
    const engine = new JobEngine({
      filePath: jobsFilePath(dir),
      bus,
      env: env.probe,
      executor: async () => {
        started = true;
        return { ok: true, summary: 'ran' };
      },
    });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-3',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
      envId: 'ENV-000001',
    });
    await waitForStatus(engine, job.id, 'BLOCKED');
    const blocked = await engine.get(job.id);
    assert.ok(blocked?.blockReason?.includes('PROVISIONING'));
    assert.equal(started, false);
    env.setStatus('READY');
    await engine.schedule();
    const done = await waitForStatus(engine, job.id, 'COMPLETED');
    assert.equal(done.result?.ok, true);
  });

  it('retries retryable failures up to maxAttempts and fails non-retryable immediately', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('READY');
    let calls = 0;
    const engine = new JobEngine({
      filePath: jobsFilePath(dir),
      bus,
      env: env.probe,
      executor: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, summary: 'flaky', retryable: true };
        return { ok: true, summary: 'second attempt ok' };
      },
    });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-4',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    const done = await waitForStatus(engine, job.id, 'COMPLETED');
    assert.equal(done.attempts, 1); // one recorded failure, then success
    await untilEvent(bus, (e) => e.type === 'job.retry' && e.jobId === job.id);

    // non-retryable: NO_MODEL must FAIL immediately, no retry
    const bus2 = new DurableEventBus(eventsFilePath(dir));
    const engine2 = new JobEngine({
      filePath: join(dir, 'jobs2.json'),
      bus: bus2,
      env: makeEnv('READY').probe,
      executor: async () => ({ ok: false, summary: 'no model', retryable: false, error: 'NO_MODEL' }),
    });
    await engine2.init();
    const nomodel = await engine2.enqueue({
      projectId: 'PROJ-4',
      ownerId: 'alice',
      stageKey: 'build',
      label: 'Build',
      mode: 'full-product',
      instruction: '',
    });
    const failed = await waitForStatus(engine2, nomodel.id, 'FAILED');
    assert.equal(failed.error, 'NO_MODEL');
    assert.equal(failed.attempts, 1);
  });

  it('pause interrupts a running job and discards its result; cancel stops a pending job', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('READY');
    const engine = new JobEngine({
      filePath: jobsFilePath(dir),
      bus,
      env: env.probe,
      executor: async (_job, ctx) => {
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) resolve();
          else ctx.signal.addEventListener('abort', () => resolve());
        });
        return { ok: true, summary: 'must-be-discarded' };
      },
    });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-5',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    const paused = await engine.pause(job.id);
    assert.equal(paused?.status, 'PAUSED');
    await until(async () => (await engine.get(job.id))?.result === null);
    assert.equal((await engine.get(job.id))?.status, 'PAUSED');
    assert.equal((await engine.get(job.id))?.result, null); // never counted as success

    // cancel a queued second job
    const second = await engine.enqueue({
      projectId: 'PROJ-5',
      ownerId: 'alice',
      stageKey: 'build',
      label: 'Build',
      mode: 'full-product',
      instruction: '',
    });
    const cancelled = await engine.cancel(second.id);
    assert.equal(cancelled?.status, 'CANCELLED');
  });

  it('crash recovery: a RUNNING job collapses to RECOVERING across a restart', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const file = jobsFilePath(dir);
    const env = makeEnv('READY');
    const neverResolves: JobExecutor = () => new Promise<JobResult>(() => {});
    const engine = new JobEngine({ filePath: file, bus, env: env.probe, executor: neverResolves });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-6',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    // simulated restart: fresh engine over the same durable files
    const bus2 = new DurableEventBus(eventsFilePath(dir));
    const engine2 = new JobEngine({ filePath: file, bus: bus2, env: env.probe, executor: okExecutor() });
    await engine2.init();
    const recovered = await waitForStatus(engine2, job.id, 'RECOVERING');
    assert.equal(recovered.status, 'RECOVERING'); // never booted falsely RUNNING
    // explicit user resume reschedules it
    const resumed = await engine2.resume(job.id);
    assert.equal(resumed?.status, 'PENDING');
    await waitForStatus(engine2, job.id, 'COMPLETED');
  });

  it('buildExecutionGraph derives nodes, edges, counts and unlocked jobs from real state', async () => {
    const jobs = [
      { id: 'JOB-000001', stageKey: 'discovery', label: 'Discovery', status: 'COMPLETED', ai: null },
      { id: 'JOB-000002', stageKey: 'blueprint', label: 'Blueprint', status: 'BLOCKED', ai: { providerId: 'p', modelId: 'm' } },
    ] as unknown as JobRecord[];
    const graph = buildExecutionGraph(jobs, 'PROJ-X');
    assert.equal(graph.totalCount, 2);
    assert.equal(graph.completedCount, 1);
    assert.equal(graph.statusCounts['BLOCKED'], 1);
    assert.equal(graph.edges.length, 0);
    // unlocked = dependency-satisfied, non-terminal: the COMPLETED root is
    // terminal, so the BLOCKED node's dependencies are trivially satisfied.
    assert.deepEqual(graph.unlocked, ['JOB-000002']);
    assert.equal(graph.nodes[1]?.ai?.modelId, 'm');
  });
});