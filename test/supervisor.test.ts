import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tempDataDir } from './helpers.ts';
import { DurableEventBus, eventsFilePath } from '../src/events/bus.ts';
import { JobEngine, jobsFilePath } from '../src/jobs/engine.ts';
import { ExecutionSupervisor, supervisionTraceFilePath } from '../src/supervisor/supervisor.ts';
import type { EnvStatus, JobEnvPort } from '../src/env/types.ts';
import type { SupervisorTarget } from '../src/supervisor/types.ts';
import type { JobExecutor, JobRecord, JobResult, JobRunContext } from '../src/jobs/types.ts';

async function until(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function untilEvent(
  bus: DurableEventBus,
  match: (e: { type: string; jobId?: string }) => boolean,
): Promise<void> {
  await until(async () => (await bus.history()).some(match));
}

async function waitForStatus(engine: JobEngine, id: string, status: string): Promise<JobRecord> {
  await until(async () => (await engine.get(id))?.status === status);
  return (await engine.get(id))!;
}

function makeEnv(initialStatus: string): { probe: JobEnvPort; setStatus: (s: EnvStatus) => void } {
  const state: { status: EnvStatus } = { status: initialStatus as EnvStatus };
  return {
    probe: {
      envOf: async () => ({
        status: state.status,
        workspaceRoot: state.status === 'READY' ? '/workspaces/x' : null,
      }),
    },
    setStatus: (s: EnvStatus) => {
      state.status = s;
    },
  };
}

/** Resolves when the run is signalled; used to model a real, interruptible executor. */
function waitAbort(context: JobRunContext): Promise<void> {
  return new Promise((resolve) => {
    if (context.signal.aborted) {
      resolve();
    } else {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    }
  });
}

describe('ExecutionSupervisor', () => {
  it('hard timeout: a RUNNING job with no meaningful progress is really terminated and classified timeout', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    let fakeNow = 0;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: supervisionTraceFilePath(dir),
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => fakeNow,
      progressWindowMs: 180_000,
      hangSuspectAtMs: 90_000,
      watchdogToleranceMs: 60_000,
    });
    await supervisor.init();
    const discarded: JobExecutor = async (_job, context) => {
      await waitAbort(context);
      return { ok: true, summary: 'should-be-discarded' };
    };
    engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, supervisor, executor: discarded });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T1',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    fakeNow += 190_000;
    await supervisor.tick();
    const failed = await waitForStatus(engine, job.id, 'FAILED');
    assert.equal(failed.result?.failureClass, 'timeout');
    // the late 'success' of the aborted executor was never recorded
    assert.notEqual(failed.result?.summary, 'should-be-discarded');
    await untilEvent(bus, (e) => e.type === 'supervisor.timeout' && e.jobId === job.id);
    await untilEvent(bus, (e) => e.type === 'job.supervised_failure' && e.jobId === job.id);
  });

  it('meaningful progress resets the hard-timeout window; a fresh stuck window still times out', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    let fakeNow = 0;
    let armed = false;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: supervisionTraceFilePath(dir),
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => fakeNow,
      progressWindowMs: 180_000,
      watchdogToleranceMs: 60_000,
    });
    await supervisor.init();
    const executor: JobExecutor = async (_job, context) => {
      const timer = setInterval(() => {
        if (armed) {
          context.reportProgress?.({ kind: 'tool', tool: 'make', ok: true });
        }
      }, 20);
      await waitAbort(context);
      clearInterval(timer);
      return { ok: true, summary: 'should-be-discarded' };
    };
    engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, supervisor, executor });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T2',
      ownerId: 'alice',
      stageKey: 'build',
      label: 'Build',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    fakeNow += 60_000; // 60s pass, no progress yet
    armed = true;
    await new Promise((r) => setTimeout(r, 60)); // at least one real report at now=60s
    armed = false;
    fakeNow += 60_000; // now 120s since the LAST meaningful progress (60s) = 60s idle
    await supervisor.tick();
    assert.equal((await engine.get(job.id))?.status, 'RUNNING'); // window respected
    fakeNow += 120_001; // now 180001ms idle since that progress -> hard timeout
    await supervisor.tick();
    const failed = await waitForStatus(engine, job.id, 'FAILED');
    assert.equal(failed.result?.failureClass, 'timeout');
  });

  it('network loss parks network-dependent work (not FAILED) and auto-resumes on restoration', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    let networkUp = true;
    let runs = 0;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: supervisionTraceFilePath(dir),
      target,
      networkProbe: async () => ({ up: networkUp, detail: networkUp ? 'ok' : 'down', at: new Date().toISOString() }),
      now: () => Date.now(),
      progressWindowMs: 180_000,
      watchdogToleranceMs: 60_000,
    });
    await supervisor.init();
    const executor: JobExecutor = async (_job, context) => {
      runs += 1;
      if (runs === 1) {
        await waitAbort(context);
        return { ok: false, summary: 'interrupted', retryable: false, error: 'ABORTED' };
      }
      return { ok: true, summary: 'ran after restore' };
    };
    engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, supervisor, executor });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T3',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    // A CONFIRMED outage is required before governed work is parked. One failed
    // probe is not evidence of an outage - a single slow sample on a busy
    // machine must not interrupt healthy work - so the boundary is polled twice
    // and only the second consecutive failure parks the run.
    networkUp = false;
    await supervisor.tick();
    const stillRunning = await engine.supervisorJobOf(job.id);
    assert.equal(
      stillRunning?.status,
      'RUNNING',
      'a single failed probe must not park governed work',
    );
    await supervisor.tick();
    const parked = await waitForStatus(engine, job.id, 'NETWORK_UNAVAILABLE');
    assert.equal(parked.waitKind, 'network');
    await untilEvent(bus, (e) => e.type === 'job.waiting' && e.jobId === job.id);
    networkUp = true;
    await supervisor.tick();
    await untilEvent(bus, (e) => e.type === 'supervisor.network_restored');
    await untilEvent(bus, (e) => e.type === 'job.auto_resumed' && e.jobId === job.id);
    const done = await waitForStatus(engine, job.id, 'COMPLETED');
    assert.equal(done.result?.ok, true);
  });

  it('a run loses its READY environment -> WAITING; restored readiness auto-resumes it', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const env = makeEnv('READY');
    let runs = 0;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: supervisionTraceFilePath(dir),
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => Date.now(),
      progressWindowMs: 180_000,
      watchdogToleranceMs: 60_000,
    });
    await supervisor.init();
    const executor: JobExecutor = async (_job, context) => {
      runs += 1;
      if (runs === 1) {
        await waitAbort(context);
        return { ok: false, summary: 'interrupted', retryable: false, error: 'ABORTED' };
      }
      return { ok: true, summary: 'ran after env restore' };
    };
    engine = new JobEngine({
      filePath: jobsFilePath(dir),
      bus,
      env: env.probe,
      supervisor,
      executor,
    });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T4',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
      envId: 'ENV-000001',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    env.setStatus('FAILED');
    await supervisor.tick();
    const waiting = await waitForStatus(engine, job.id, 'WAITING');
    assert.equal(waiting.waitKind, 'environment');
    await untilEvent(bus, (e) => e.type === 'supervisor.env_wait' && e.jobId === job.id);
    env.setStatus('READY');
    await supervisor.tick();
    await untilEvent(bus, (e) => e.type === 'job.auto_resumed' && e.jobId === job.id);
    const done = await waitForStatus(engine, job.id, 'COMPLETED');
    assert.equal(done.result?.ok, true);
  });

  it('watchdog: a stalled supervision loop never leaves a job falsely RUNNING', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    let fakeNow = 0;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: supervisionTraceFilePath(dir),
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => fakeNow,
      progressWindowMs: 180_000,
      watchdogToleranceMs: 5_000,
    });
    await supervisor.init();
    const executor: JobExecutor = async (_job, context) => {
      await waitAbort(context);
      return { ok: true, summary: 'should-be-discarded' };
    };
    engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, supervisor, executor });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T5',
      ownerId: 'alice',
      stageKey: 'discovery',
      label: 'Discovery',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    // the loop never beat (no tick); the watchdog (independent control) intervenes
    fakeNow += 6_000;
    const stale = await supervisor.watchdogCheck();
    assert.equal(stale, true);
    await untilEvent(bus, (e) => e.type === 'supervisor.watchdog_alarm');
    const failed = await waitForStatus(engine, job.id, 'FAILED');
    assert.equal(failed.result?.failureClass, 'process');
  });

  it('takes a durable per-run checkpoint trail and, on restart, knows a prior supervisor owned active runs', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    let fakeNow = 0;
    let engine: JobEngine | undefined;
    const target: SupervisorTarget = {
      jobOf: (id) => engine!.supervisorJobOf(id),
      activeJobs: () => engine!.supervisorActiveJobs(),
      forceFail: (id, classification, summary) => engine!.forceFailFromSupervisor(id, classification, summary),
      enterWait: (id, waitKind, reason) => engine!.enterWaitFromSupervisor(id, waitKind, reason),
      leaveWait: (id, detail) => engine!.leaveWaitFromSupervisor(id, detail),
    };
    const traceFilePath = supervisionTraceFilePath(dir);
    const supervisorA = new ExecutionSupervisor({
      bus,
      traceFilePath,
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => fakeNow,
      progressWindowMs: 3_600_000,
      watchdogToleranceMs: 3_600_000,
      checkpointStride: 5,
    });
    await supervisorA.init();
    const bootIdA = supervisorA.snapshot().bootId;
    const executor: JobExecutor = async (_job, context) => {
      await waitAbort(context);
      return { ok: true, summary: 'should-be-discarded' };
    };
    engine = new JobEngine({ filePath: jobsFilePath(dir), bus, env: makeEnv('READY').probe, supervisor: supervisorA, executor });
    await engine.init();
    const job = await engine.enqueue({
      projectId: 'PROJ-T6',
      ownerId: 'alice',
      stageKey: 'design',
      label: 'Design',
      mode: 'full-product',
      instruction: '',
    });
    await waitForStatus(engine, job.id, 'RUNNING');
    for (let i = 0; i < 6; i += 1) {
      fakeNow += 10_000;
      await supervisorA.tick();
    }
    // checkpoint trail became durable (stride 5 reached)
    const parsed = JSON.parse(await readFile(traceFilePath, 'utf8')) as {
      value: { bootId: string; nextCheckpointSeq: number; checkpoints: { jobId: string; status: string }[] };
    };
    const raw = parsed.value;
    assert.equal(raw.bootId, bootIdA);
    assert.ok(raw.nextCheckpointSeq >= 1, 'a stride checkpoint advanced the sequence');
    assert.ok(raw.checkpoints.length === 1, 'one durable per-run checkpoint set');
    assert.ok(raw.checkpoints.some((c) => c.jobId === job.id));
    assert.ok(raw.checkpoints.every((c) => c.status === 'RUNNING'));

    // a second supervisor over the SAME trace records that a prior control
    // plane owned active runs (recovery is explicit, nothing stays latent)
    supervisorA.dispose();
    const supervisorB = new ExecutionSupervisor({
      bus,
      traceFilePath,
      target,
      networkProbe: async () => ({ up: true, detail: 'ok', at: new Date().toISOString() }),
      now: () => fakeNow,
      progressWindowMs: 3_600_000,
      watchdogToleranceMs: 3_600_000,
    });
    await supervisorB.init();
    assert.notEqual(supervisorB.snapshot().bootId, bootIdA);
    await until(async () =>
      (await bus.history()).some(
        (e) => e.type === 'supervisor.reloaded' && (e as { payload?: { priorActiveRuns?: number } }).payload?.priorActiveRuns === 1,
      ),
    );
    supervisorB.dispose();
  });
});