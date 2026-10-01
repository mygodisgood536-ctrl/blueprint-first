/**
 * The 3.3 hardening laws closed by this pass:
 *   §134 PLATFORM STARTUP GATE - the control-plane foundations (durable storage,
 *        event delivery, job state, scheduler, secret boundary, observability)
 *        are verified with REAL operations, and a degraded foundation closes
 *        the gate instead of being represented as ready.
 *   §86  CONCURRENT WORK IS ISOLATED - one workspace backs at most one running
 *        job, so concurrent Workers can never overwrite each other.
 *   §88  STALE JOB INVALIDATION - a certified upstream change stops the
 *        dependent queued work for real instead of letting it run on stale
 *        assumptions.
 *   §135 PROJECT START GATE - every start requirement is reported from real
 *        state, and an unmet one keeps the gate closed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessFoundation } from '../src/env/foundation.ts';
import type { CapabilityDecision } from '../src/env/capabilities.ts';
import { probeControlPlane, probeDurableStorage, probeEventDelivery, probeSecretBoundary } from '../src/env/control-plane-probes.ts';
import { DurableEventBus } from '../src/events/bus.ts';
import { CredentialStore } from '../src/ai/credential-store.ts';
import { JobEngine } from '../src/jobs/engine.ts';
import type { JobEnvPort } from '../src/env/types.ts';
import {
  buildWorkingServer,
  createProject,
  workingSignupEnrolledCookie as signupEnrolledCookie,
  workingTempDataDir as tempDataDir,
} from './working-harness.ts';

const AT = '2026-01-01T00:00:00.000Z';

/**
 * Temp dirs are intentionally left in place (the same convention the rest of the
 * suite uses). The durable stores and the scheduler keep writing after a test
 * returns, so deleting the directory underneath them races the atomic-write
 * path and produces spurious ENOENT failures that have nothing to do with the
 * behaviour under test. The OS temp sweeper reclaims them.
 */
async function discard(_dir: string): Promise<void> {
  // intentionally empty - see the note above
}

function cap(name: 'opencode' | 'cline' | 'daytona' | 'local-workspace', status: 'READY' | 'NOT_INSTALLED'): CapabilityDecision {
  return {
    capability: name,
    status,
    mechanism: status === 'READY' ? `${name}-mechanism` : null,
    version: null,
    rationale: `test decision for ${name}`,
    discoveredAt: AT,
  };
}

test('§134 the startup gate stays closed while a mandatory component is absent', () => {
  const report = assessFoundation({
    capabilities: [cap('opencode', 'READY'), cap('cline', 'NOT_INSTALLED'), cap('daytona', 'NOT_INSTALLED'), cap('local-workspace', 'READY')],
    environmentBackend: 'local-workspace',
  });
  assert.equal(report.productionReady, false);
  assert.equal(report.startupGateOpen, false);
  assert.equal(report.policy, 'development-local');
  assert.match(report.summary, /cline, daytona/);
});

test('§134 a failed control-plane probe closes the gate even with every CLI present', () => {
  const base = {
    capabilities: [cap('opencode', 'READY'), cap('cline', 'READY'), cap('daytona', 'READY'), cap('local-workspace', 'READY')],
    environmentBackend: 'daytona' as const,
  };
  const allGreen = assessFoundation({
    ...base,
    controlPlane: [
      { capability: 'durable-storage', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'event-delivery', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'job-state', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'scheduler', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'secret-boundary', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'observability', ready: true, detail: 'ok', checkedAt: AT },
    ],
  });
  assert.equal(allGreen.startupGateOpen, true);
  assert.equal(allGreen.policy, 'production');

  // One degraded foundation is enough: the gate must not report ready.
  const degraded = assessFoundation({
    ...base,
    controlPlane: [
      { capability: 'durable-storage', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'event-delivery', ready: false, detail: 'Probe failed: bus not answering', checkedAt: AT },
      { capability: 'job-state', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'scheduler', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'secret-boundary', ready: true, detail: 'ok', checkedAt: AT },
      { capability: 'observability', ready: true, detail: 'ok', checkedAt: AT },
    ],
  });
  assert.equal(degraded.startupGateOpen, false);
  assert.equal(degraded.productionReady, true, 'the components themselves are fine; the control plane is not');
  assert.match(degraded.summary, /event-delivery/);
});

test('§134 the control-plane probes perform real operations and report real outcomes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-probe-'));
  try {
    const storage = await probeDurableStorage(dir);
    assert.equal(storage.ready, true, storage.detail);
    assert.match(storage.detail, /round trip/);

    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const delivery = await probeEventDelivery(bus);
    assert.equal(delivery.ready, true, delivery.detail);

    // A secret boundary that leaks is reported NOT ready, not silently passed.
    const goodStore = new CredentialStore();
    const secretBoundary = await probeSecretBoundary(async () => {
      const ref = goodStore.addCredential('owner', 'openrouter', 'super-secret-value');
      if (JSON.stringify(ref).includes('super-secret-value')) throw new Error('leak');
      if (goodStore.resolveSecret('owner', ref.id) !== 'super-secret-value') throw new Error('unrecoverable');
      let denied = false;
      try {
        goodStore.resolveSecret('other', ref.id);
      } catch {
        denied = true;
      }
      if (!denied) throw new Error('cross-owner read allowed');
    });
    assert.equal(secretBoundary.ready, true, secretBoundary.detail);

    const leaking = await probeSecretBoundary(async () => {
      throw new Error('credential reference leaked the secret value');
    });
    assert.equal(leaking.ready, false);
    assert.match(leaking.detail, /leaked the secret/);
  } finally {
    await discard(dir);
  }
});

test('§134 probeControlPlane reports every named foundation, passing or failing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-probe-all-'));
  try {
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const results = await probeControlPlane({
      dataDir: dir,
      bus,
      jobStateCount: async () => 0,
      schedulerPass: async () => undefined,
      secretBoundary: async () => undefined,
      observability: async () => undefined,
    });
    assert.deepEqual(
      results.map((r) => r.capability).sort(),
      ['durable-storage', 'event-delivery', 'job-state', 'observability', 'scheduler', 'secret-boundary'],
    );
    assert.ok(results.every((r) => r.ready && r.detail.length > 0));
  } finally {
    await discard(dir);
  }
});

test('§86 two jobs may not run against the same workspace at once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-iso-'));
  const gate = { open: false };
  // If an assertion below throws while a run is parked in the executor loop, a
  // pending timer would keep the test process alive and stall the suite. This
  // releases the loop no matter how the test ends.
  const release = setInterval(() => { gate.open = true; }, 180_000);
  try {
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const env: JobEnvPort = { envOf: async () => ({ status: 'READY' as const, workspaceRoot: join(dir, 'ws') }) };
    const engine = new JobEngine({
      filePath: join(dir, 'jobs.json'),
      bus,
      env,
      maxConcurrent: 4,
      executor: async (job) => {
        // Hold the first run open so the second genuinely overlaps it.
        if (job.stageKey === 'design') {
          while (!gate.open) await new Promise((r) => setTimeout(r, 20));
        }
        return { ok: true, summary: 'done' };
      },
    });
    await engine.init();
    const first = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'design', label: 'Design', mode: 'full-product', instruction: 'x', envId: 'ENV-1' });
    await new Promise((r) => setTimeout(r, 60));
    const second = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'build', label: 'Build', mode: 'full-product', instruction: 'x', envId: 'ENV-1' });
    await new Promise((r) => setTimeout(r, 60));

    const runningFirst = await engine.get(first.id);
    assert.equal(runningFirst?.status, 'RUNNING');
    // Poll rather than assert instantly: the scheduler recomputes the blocked set
    // asynchronously, so under load the second job may still read PENDING for a
    // moment after the first one starts.
    for (let i = 0; i < 1200 && (await engine.get(second.id))?.status !== 'BLOCKED'; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const heldSecond = await engine.get(second.id);
    // The second job is BLOCKED on the workspace, never running beside it.
    assert.equal(heldSecond?.status, 'BLOCKED');
    assert.match(heldSecond?.blockReason ?? '', /in use by running job/);

    // Once the first run releases the workspace the second starts automatically.
    gate.open = true;
    for (let i = 0; i < 1200 && (await engine.get(second.id))?.status !== 'COMPLETED'; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal((await engine.get(second.id))?.status, 'COMPLETED');
  } finally {
    gate.open = true;
    clearInterval(release);
    await discard(dir);
  }
});

test('§88 a certified upstream change invalidates the dependent queued work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-stale-'));
  const hold = { open: false };
  // A held executor must never outlive the test: if an assertion below throws
  // while the run is parked in its loop, the still-pending timer would keep the
  // whole test process alive and stall the suite.
  const release = setInterval(() => { hold.open = true; }, 180_000);
  try {
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const engine = new JobEngine({
      filePath: join(dir, 'jobs.json'),
      bus,
      maxConcurrent: 4,
      // Discovery completes for real; Design then stays RUNNING so the
      // invalidation has to interrupt a live run, not just relabel a queued one.
      executor: async (job) => {
        if (job.stageKey !== 'discovery') {
          while (!hold.open) await new Promise((r) => setTimeout(r, 20));
        }
        return { ok: true, summary: 'done' };
      },
    });
    await engine.init();
    const parent = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'discovery', label: 'Discovery', mode: 'full-product', instruction: 'x' });
    const child = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'design', label: 'Design', mode: 'full-product', instruction: 'x', dependsOn: [parent.id] });
    const grandchild = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'build', label: 'Build', mode: 'full-product', instruction: 'x', dependsOn: [child.id] });
    for (let i = 0; i < 1200 && (await engine.get(child.id))?.status !== 'RUNNING'; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal((await engine.get(child.id))?.status, 'RUNNING', 'design is genuinely running');

    const invalidated = await engine.invalidateStaleJobs({
      projectId: 'P1',
      changedArtifactIds: [parent.id],
      reason: 'Discovery was re-certified under a new baseline.',
      by: 'test-boss',
    });
    const ids = invalidated.map((j) => j.id).sort();
    // The dependent chain is identified transitively, not just one level deep.
    assert.deepEqual(ids, [child.id, grandchild.id].sort());
    // The live run was really stopped: it is no longer RUNNING.
    assert.notEqual((await engine.get(child.id))?.status, 'RUNNING');
    assert.equal((await engine.get(child.id))?.blockReason, 'Discovery was re-certified under a new baseline.');
    // The changed job itself is not invalidated by its own change.
    assert.ok(!ids.includes(parent.id));

    // The invalidation is durable evidence on the bus, not a transient label.
    const events = await bus.history();
    const invalidations = events.filter((e) => e.type === 'job.invalidated');
    assert.equal(invalidations.length, 2);
    assert.deepEqual(invalidations[0]?.payload?.['changedArtifactIds'], [parent.id]);
  } finally {
    hold.open = true;
    clearInterval(release);
    await discard(dir);
  }
});

test('§88 a cross-project change never invalidates another project\'s work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-stale-iso-'));
  try {
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const engine = new JobEngine({
      filePath: join(dir, 'jobs.json'),
      bus,
      executor: async () => ({ ok: true, summary: 'done' }),
    });
    await engine.init();
    await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'design', label: 'D', mode: 'full-product', instruction: 'x' });
    const mine = await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'build', label: 'B', mode: 'full-product', instruction: 'x' });
    const invalidated = await engine.invalidateStaleJobs({
      projectId: 'OTHER',
      changedArtifactIds: ['JOB-000001'],
      reason: 'unrelated change',
      by: 'test',
    });
    assert.equal(invalidated.length, 0);
    assert.notEqual((await engine.get(mine.id))?.blockReason, 'unrelated change');
    // Let every queued run finish before the directory is removed, so no
    // background write outlives the test.
    await engine.retry((await engine.enqueue({ projectId: 'P1', ownerId: 'alice', stageKey: 'test', label: 'T', mode: 'full-product', instruction: 'x' })).id);
    for (let i = 0; i < 200; i += 1) {
      const active = (await engine.all()).filter((j) => j.status === 'RUNNING' || j.status === 'PENDING');
      if (active.length === 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    await discard(dir);
  }
});

test('§135/§134/§88 the gates are visible over the real HTTP API', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const cookie = await signupEnrolledCookie(s.url, 'alice');
    const projectId = await createProject(s.url, cookie, 'Gate project');
    const head = { 'content-type': 'application/json', cookie };

    // §134: the startup gate reports its real control-plane verdicts.
    const foundation = (await (await fetch(`${s.url}/api/system/foundation`, { headers: { cookie } })).json()) as {
      startupGateOpen: boolean;
      controlPlane: Array<{ capability: string; ready: boolean; detail: string }>;
    };
    assert.equal(typeof foundation.startupGateOpen, 'boolean');
    assert.deepEqual(
      foundation.controlPlane.map((c) => c.capability).sort(),
      ['durable-storage', 'event-delivery', 'job-state', 'observability', 'scheduler', 'secret-boundary'],
    );
    // On a real boot every control-plane foundation probe genuinely passes.
    const failed = foundation.controlPlane.filter((c) => !c.ready);
    assert.deepEqual(failed.map((c) => `${c.capability}: ${c.detail}`), [], 'a real boot must pass its own control-plane probes');

    // §135: a brand-new project has unmet start requirements, honestly reported.
    const gate = (await (await fetch(`${s.url}/api/projects/${projectId}/start-gate`, { headers: { cookie } })).json()) as {
      gateOpen: boolean;
      items: Array<{ requirement: string; met: boolean; detail: string }>;
      summary: string;
    };
    assert.equal(gate.gateOpen, false);
    assert.ok(gate.items.length >= 6);
    assert.ok(gate.items.every((i) => i.detail.length > 0));
    assert.match(gate.summary, /Unmet:/);

    // §88: invalidation without a changed-artifact set is refused, not guessed.
    const bad = await fetch(`${s.url}/api/projects/${projectId}/invalidate-stale-jobs`, {
      method: 'POST', headers: head, body: JSON.stringify({ reason: 'something changed' }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${s.url}/api/projects/${projectId}/invalidate-stale-jobs`, {
      method: 'POST', headers: head, body: JSON.stringify({ changedArtifactIds: ['FEATURE-0001'], reason: 'Discovery re-certified.' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { count: number }).count, 0);

    // §105-§110: the judgment routes are authenticated and produce real reports.
    const judgment = (await (await fetch(`${s.url}/api/judgment/${projectId}`, { headers: { cookie } })).json()) as {
      intent: unknown;
      judgment: { verdict: string; findings: unknown[] };
      simulation: { userSimulation: unknown[]; adversarialSimulation: unknown[] };
    };
    assert.equal(judgment.intent, null, 'no intent baseline is invented when none was established');
    assert.equal(typeof judgment.judgment.verdict, 'string');
    assert.ok(judgment.simulation.userSimulation.length === 7);
    assert.equal(judgment.simulation.adversarialSimulation.length, 12);

    // A material decision is escalated, and authorizing it here is refused.
    const material = await fetch(`${s.url}/api/judgment/${projectId}/decisions`, {
      method: 'POST', headers: head,
      body: JSON.stringify({ decision: 'Only admins may delete an account', decisionClass: 'permissions', authorize: true }),
    });
    assert.equal(material.status, 409);
    const escalated = (await material.json()) as { resolution: { kind: string; reason: string } };
    assert.equal(escalated.resolution.kind, 'human-decision-required');

    // A safe inference with a rationale is recorded in the durable ledger.
    const safe = await fetch(`${s.url}/api/judgment/${projectId}/decisions`, {
      method: 'POST', headers: head,
      body: JSON.stringify({
        decision: 'Date formatting follows ISO-8601',
        decisionClass: 'naming-convention',
        rationale: 'matches the existing exported reports',
        alternativesConsidered: ['locale format'],
        downstreamImpact: 'report headers only',
      }),
    });
    assert.equal(safe.status, 201);
    const recorded = (await safe.json()) as { decision: { id: string; resolution: string } };
    assert.match(recorded.decision.id, /^DEC-\d{6}$/);
    assert.equal(recorded.decision.resolution, 'safe-inference');

    // The intent baseline is established once and never overwritten.
    const first = await fetch(`${s.url}/api/judgment/${projectId}/intent`, {
      method: 'PUT', headers: head,
      body: JSON.stringify({ goals: ['let users file tickets'], targetUsers: ['end users'], nonGoals: ['social feed'] }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${s.url}/api/judgment/${projectId}/intent`, {
      method: 'PUT', headers: head,
      body: JSON.stringify({ goals: ['something else entirely'], targetUsers: ['nobody'] }),
    });
    const after = (await second.json()) as { intent: { goals: string[]; anchor: string } };
    assert.deepEqual(after.intent.goals, ['let users file tickets'], 'the baseline is immutable');
  } finally {
    await s.close();
  }
});
