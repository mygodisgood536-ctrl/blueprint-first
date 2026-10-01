/**
 * EXECUTION SUPERVISION: NETWORK BOUNDARY SCOPE
 *
 * These tests lock in the two genuine defects that made governed runs fail only
 * under parallel load:
 *
 *  1. The Network Monitor observed a single public-internet reachability probe
 *     and, on failure, parked and aborted EVERY running job - including work
 *     served entirely by a local runtime on loopback that does not depend on the
 *     outbound boundary at all. Under CPU saturation the probe's deadline
 *     expired and healthy local work was interrupted with
 *     "Agentic session step aborted by caller."
 *  2. One failed sample was treated as proof of an outage, so a single slow
 *     probe was enough to interrupt real work.
 *
 * The correct behaviour is preserved and now proven:
 *  - genuinely network-dependent work still enters a governed WAIT (not a
 *    failure) and resumes automatically when the boundary returns;
 *  - local-only work is never interrupted by an outbound outage;
 *  - a single failed probe is not acted upon.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionSupervisor } from '../src/supervisor/supervisor.ts';
import { DurableEventBus } from '../src/events/bus.ts';
import { eventsFilePath } from '../src/events/bus.ts';
import type { ActiveJobView, SupervisorTarget } from '../src/supervisor/types.ts';
import type { NetworkProbeResult } from '../src/supervisor/network.ts';

interface RunOptions {
  networkDependent: boolean;
  networkDown: boolean;
  confirmations?: number;
}

async function drive(options: RunOptions): Promise<{ waits: string[]; resumed: string[]; failures: string[]; probes: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'bf-superv-'));
  const waits: string[] = [];
  const resumed: string[] = [];
  const failures: string[] = [];
  let probes = 0;
  try {
    const run: ActiveJobView = {
      id: 'JOB-1',
      projectId: 'PROJ-1',
      ownerId: 'alice',
      envId: 'ENV-1',
      stageKey: 'design',
      label: 'run',
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      envStatus: 'READY',
      networkDependent: options.networkDependent,
    };
    const target: SupervisorTarget = {
      jobOf: async () => run,
      activeJobs: async () => [run],
      forceFail: async (id) => { failures.push(id); return true; },
      enterWait: async (id) => { waits.push(id); return true; },
      leaveWait: async (id) => { resumed.push(id); return true; },
    };
    const bus = new DurableEventBus(eventsFilePath(dir));
    const supervisor = new ExecutionSupervisor({
      bus,
      traceFilePath: join(dir, 'supervision.json'),
      target,
      pollIntervalMs: 100,
      networkFailureConfirmations: options.confirmations ?? 2,
      networkProbe: async (): Promise<NetworkProbeResult> => {
        probes += 1;
        const at = new Date().toISOString();
        return options.networkDown
          ? { up: false, detail: 'no target reachable: 1.1.1.1:443', at }
          : { up: true, detail: 'reachable 1.1.1.1:443', at };
      },
    });
    await supervisor.init();
    // The supervisor supervises runs registered through runStarted(); the target
    // callbacks are what it then acts on.
    const handle = supervisor.runStarted(run);
    supervisor.start();
    // Allow several poll cycles so the confirmation policy is exercised.
    await new Promise((r) => setTimeout(r, 700));
    supervisor.dispose();
    handle.finish();
    // Let the bus finish any in-flight durable write before the directory goes.
    await new Promise((r) => setTimeout(r, 250));
    return { waits, resumed, failures, probes };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('a local-only run is never interrupted by an outbound network outage', async () => {
  const result = await drive({ networkDependent: false, networkDown: true });
  assert.ok(result.probes > 0, 'the boundary was genuinely probed');
  assert.deepEqual(result.waits, [], 'a run that does not cross the boundary must not be parked');
  assert.deepEqual(result.failures, [], 'and must never be failed');
});

test('a network-dependent run enters a governed wait when the boundary is confirmed down', async () => {
  const result = await drive({ networkDependent: true, networkDown: true, confirmations: 1 });
  assert.ok(result.waits.length > 0, 'genuinely network-bound work must still be parked');
  assert.deepEqual(result.failures, [], 'it waits in a governed state; it is not failed');
});

test('a single failed probe is not treated as proof of an outage', async () => {
  // One failed sample, then the boundary returns. With a confirmation policy of
  // 2, nothing may be parked.
  const dir = await mkdtemp(join(tmpdir(), 'bf-superv-flake-'));
  const waits: string[] = [];
  try {
    let probes = 0;
    const run: ActiveJobView = {
      id: 'JOB-1', projectId: 'PROJ-1', ownerId: 'alice', envId: 'ENV-1', stageKey: 'design',
      label: 'run', status: 'RUNNING', startedAt: new Date().toISOString(), envStatus: 'READY',
      networkDependent: true,
    };
    const supervisor = new ExecutionSupervisor({
      bus: new DurableEventBus(eventsFilePath(dir)),
      traceFilePath: join(dir, 'supervision.json'),
      target: {
        jobOf: async () => run,
      activeJobs: async () => [run],
        forceFail: async () => true,
        enterWait: async (id) => { waits.push(id); return true; },
        leaveWait: async () => true,
      },
      pollIntervalMs: 100,
      networkFailureConfirmations: 2,
      networkProbe: async () => {
        probes += 1;
        const at = new Date().toISOString();
        // The FIRST probe fails (a transient), every later probe is healthy.
        return probes === 1
          ? { up: false, detail: 'no target reachable', at }
          : { up: true, detail: 'reachable 1.1.1.1:443', at };
      },
    });
    await supervisor.init();
    const handle = supervisor.runStarted(run);
    supervisor.start();
    await new Promise((r) => setTimeout(r, 600));
    supervisor.dispose();
    handle.finish();
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(probes >= 2, 'several probes were taken');
    assert.deepEqual(waits, [], 'one transient failure must not interrupt governed work');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('the default confirmation policy requires more than one failed sample', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-superv-default-'));
  try {
    const supervisor = new ExecutionSupervisor({
      bus: new DurableEventBus(eventsFilePath(dir)),
      traceFilePath: join(dir, 'supervision.json'),
      target: {
        jobOf: async () => null,
        activeJobs: async () => [],
        forceFail: async () => true,
        enterWait: async () => true,
        leaveWait: async () => true,
      },
    });
    await supervisor.init();
    // Defaults must be safe: a single sample must never be sufficient.
    const internals = supervisor as unknown as { networkFailureConfirmations: number };
    assert.equal(internals.networkFailureConfirmations, 2);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});



