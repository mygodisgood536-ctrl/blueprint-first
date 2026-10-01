/**
 * Platform Startup Gate / capability-first discovery / real Cline & Daytona
 * execution boundaries (LAW - CAPABILITY-FIRST, LAW - CLINE MUST BE INSTALLED,
 * LAW - DAYTONA MUST BE INSTALLED, LAW - EXECUTION REALITY).
 *
 * The tests exercise REAL mechanisms where possible:
 *  - CapabilityDiscovery performs real `cline --version` / `daytona --version`
 *    probes on this host. On the current build host both CLIs are absent, so
 *    the durable decisions must honestly report NOT_INSTALLED.
 *  - The Daytona adapter is driven through a REAL spawned child process: a
 *    self-contained stub `daytona` CLI (written to a temp dir by this file) is
 *    invoked through the same cmd shell primitive the production adapter uses.
 *    Nothing is mocked in-process; the boundary (argv construction, cmd /s
 *    quoting, output parsing, honest failure) is what is under test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { CapabilityDiscovery, probeBinary, type CapabilityDecision, type ExecutionCapability } from '../src/env/capabilities.ts';
import { assessFoundation, type FoundationReport, type FoundationPolicy } from '../src/env/foundation.ts';
import { RealClineBoundary } from '../src/env/cline-adapter.ts';
import { DaytonaWorkspaceAdapter } from '../src/env/daytona-adapter.ts';
import { writeDaytonaStub } from './env-stub.ts';
import { reconcileHostPath } from '../src/runtime/host-path.ts';
import { tempDataDir, signupEnrolledCookie } from './helpers.ts';
import { buildWorkingServer } from './working-harness.ts';

function decisionFor(capability: ExecutionCapability, status: CapabilityDecision['status']): CapabilityDecision {
  return {
    capability,
    status,
    mechanism: status === 'NOT_INSTALLED' ? null : 'test-mechanism',
    version: null,
    rationale: `test decision for ${capability}: ${status}`,
    discoveredAt: new Date().toISOString(),
  };
}

function readyDecisions(): CapabilityDecision[] {
  return [
    decisionFor('opencode', 'READY'),
    decisionFor('cline', 'READY'),
    decisionFor('daytona', 'READY'),
    decisionFor('local-workspace', 'READY'),
  ];
}

describe('capability-first discovery (LAW - CAPABILITY-FIRST)', () => {
  it('records a decision for every capability that matches the LIVE probe of this host', async () => {
    const dir = await tempDataDir();
    const filePath = join(dir, 'capabilities.json');
    const discovery = new CapabilityDiscovery({ filePath, probeOpenCode: async () => true });
    const decisions = await discovery.discover();
    const daytona = decisions.find((d) => d.capability === 'daytona');
    const cline = decisions.find((d) => d.capability === 'cline');
    const opencode = decisions.find((d) => d.capability === 'opencode');
    const local = decisions.find((d) => d.capability === 'local-workspace');
    assert.ok(daytona, 'daytona decision must exist');
    assert.ok(cline, 'cline decision must exist');
    assert.ok(opencode, 'opencode decision must exist');
    assert.ok(local, 'local-workspace decision must exist');
    assert.equal(opencode.status, 'READY');
    assert.equal(local.status, 'READY', 'the local adapter is always a real mechanism');

    // The decision must track the REAL probe, never a hard-coded assumption.
    const installed = async (bin: string): Promise<boolean> => {
      const r = await probeBinary(bin, ['--version'], { timeoutMs: 60_000 });
      return r !== null && r.exitCode === 0;
    };
    const usable = async (bin: string, args: readonly string[]): Promise<boolean> => {
      const r = await probeBinary(bin, args, { timeoutMs: 30_000 });
      return r !== null && r.exitCode === 0;
    };
    const clineInstalled = await installed('cline');
    const daytonaInstalled = await installed('daytona');
    const daytonaUsable = daytonaInstalled ? await usable('daytona', ['list', '--format', 'json']) : false;

    // cline: READY when the real binary answers, otherwise honestly absent.
    assert.equal(cline.status, clineInstalled ? 'READY' : 'NOT_INSTALLED');
    if (cline.status === 'READY') {
      assert.equal(cline.mechanism, 'cline-cli');
      assert.ok((cline.version ?? '').length > 0, 'a READY cline decision records the real reported version');
    } else {
      assert.equal(cline.mechanism, null);
      assert.match(cline.rationale, /not present|not recognized/i);
    }

    // daytona (§75): a CLI that is installed but has no usable account is
    // DEGRADED, never READY. All three honest states are allowed, and each one
    // is tied to what Daytona itself answers.
    const expectedDaytona: 'READY' | 'DEGRADED' | 'NOT_INSTALLED' = !daytonaInstalled
      ? 'NOT_INSTALLED'
      : daytonaUsable
        ? 'READY'
        : 'DEGRADED';
    assert.equal(daytona.status, expectedDaytona);
    if (daytona.status === 'NOT_INSTALLED') {
      assert.equal(daytona.mechanism, null);
      assert.match(daytona.rationale, /not present|not recognized/i);
    } else {
      assert.equal(daytona.mechanism, 'daytona-cli');
      assert.ok((daytona.version ?? '').length > 0);
      if (daytona.status === 'DEGRADED') {
        assert.match(daytona.rationale, /degraded|account|not usable|no usable/i);
      }
    }

    // Durable across instances: a brand-new discovery over the same file
    // restores the recorded decisions instead of re-deriving silently.
    const reloaded = new CapabilityDiscovery({ filePath, probeOpenCode: async () => false });
    const latest = await reloaded.latest();
    assert.ok(latest.some((d) => d.capability === 'daytona' && d.status === daytona.status));
    assert.ok(latest.some((d) => d.capability === 'cline' && d.status === cline.status));
    // The recorded opencode decision (READY from the first live probe) is what
    // durable state preserves; the false probe only matters on re-discovery.
    assert.equal(latest.find((d) => d.capability === 'opencode')?.status, 'READY');
    await reloaded.discover();
    assert.equal((await reloaded.decisionOf('opencode'))?.status, 'DEGRADED');
  });

  it('detects the REAL cline and daytona CLIs installed on this host', async (t) => {
    // These are the genuine binaries, not doubles. The platform's own host-PATH
    // reconciliation runs first, exactly as the server does at boot, so a CLI
    // installed after this process started is still discovered.
    const added = reconcileHostPath();
    const cline = await probeBinary('cline', ['--version']);
    const daytona = await probeBinary('daytona', ['--version'], { timeoutMs: 60_000 });
    if (cline === null || cline.exitCode !== 0) {
      t.skip('cline CLI is not installed on this host');
      return;
    }
    assert.match(cline.stdout.trim(), /\d+\.\d+\.\d+/, 'the real cline reports a real version');
    if (daytona === null || daytona.exitCode !== 0) {
      // Only acceptable when the CLI genuinely is not resolvable; if the
      // reconciliation just added it, the probe must now find it.
      assert.equal(added.some((e) => /daytona/i.test(e)), false, 'reconciled a daytona PATH entry but the CLI is still not resolvable');
      t.skip('daytona CLI is not installed on this host');
      return;
    }
    assert.match(daytona.stdout.trim(), /v?\d+\.\d+\.\d+/, 'the real daytona reports a real version');
  });

  it('treats the OpenCode adapter as DEGRADED until a live provider is reachable', async () => {
    const dir = await tempDataDir();
    const unreachable = new CapabilityDiscovery({ filePath: join(dir, 'cap-unreachable.json') });
    const decisions = await unreachable.discover();
    assert.equal(decisions.find((d) => d.capability === 'opencode')?.status, 'DEGRADED');

    const dir2 = await tempDataDir();
    const reachable = new CapabilityDiscovery({ filePath: join(dir2, 'cap-reachable.json'), probeOpenCode: async () => true });
    assert.equal((await reachable.discover()).find((d) => d.capability === 'opencode')?.status, 'READY');
  });

  it('assesses the foundation honestly: production only when every mandatory component is READY', async () => {
    const ready: FoundationReport = assessFoundation({ capabilities: readyDecisions(), environmentBackend: 'daytona' });
    assert.equal(ready.productionReady, true);
    assert.equal(ready.policy, 'production');
    assert.equal(ready.opencodeReady, true);
    assert.equal(ready.clineReady, true);
    assert.equal(ready.daytonaReady, true);

    const missing = readyDecisions().map((d) => (d.capability === 'daytona' ? decisionFor('daytona', 'NOT_INSTALLED') : d));
    const degraded: FoundationReport = assessFoundation({ capabilities: missing, environmentBackend: 'local-workspace' });
    assert.equal(degraded.productionReady, false);
    assert.equal(degraded.policy, 'development-local');
    assert.equal(degraded.daytonaReady, false);
    assert.equal(degraded.environmentBackend, 'local-workspace');
    assert.match(degraded.summary, /daytona/);
  });

  it('never claims Cline execution unless the real CLI answers a live probe', async () => {
    const present = new RealClineBoundary({ probe: async () => ({ exitCode: 0, stdout: 'cline test 1.5\\n', stderr: '' }) });
    assert.equal(present.capability(), 'cline');
    assert.equal((await present.detect()).status, 'READY');
    assert.equal((await present.health()).ready, true);
    assert.equal(await present.canExecute(), true);

    const absent = new RealClineBoundary({ probe: async () => null });
    assert.equal((await absent.detect()).status, 'NOT_INSTALLED');
    assert.equal((await absent.health()).ready, false);
    assert.equal(await absent.canExecute(), false);
    assert.match((await absent.detect()).rationale, /not present/);
  });
});

describe('Daytona workspace adapter (LAW - DAYTONA MUST BE INSTALLED AND INTEGRATED)', () => {
  it('provisions, execs, transfers files and destroys a workspace through a REAL spawned CLI', async () => {
    const dir = await tempDataDir();
    const cli = await writeDaytonaStub(join(dir, 'stub'));
    const name = `env-dt-${Math.random().toString(36).slice(2, 8)}`;
    const adapter = new DaytonaWorkspaceAdapter(join(dir, name), { cli });

    const provisioned = await adapter.provision({ label: 'stub-bound test workspace', gitEnabled: false });
    assert.equal(provisioned.ok, true, provisioned.detail);
    assert.match(provisioned.detail, /responded to a real execution probe/);

    const health = await adapter.health();
    assert.equal(health.ok, true, health.detail);
    assert.equal(health.gitAvailable, true);
    assert.equal(health.gitBranch, 'main');

    const ran = await adapter.runCommand('echo hello-from-daytona');
    assert.equal(ran.exitCode, 0);
    assert.match(ran.stdout, /\[stub\] ok/);

    await adapter.writeFile('a.txt', 'alpha content');
    assert.equal((await adapter.readFile('a.txt')).content, 'alpha content');

    await adapter.writeFile('src/inner.txt', 'inner content');
    const listing = await adapter.listFiles('src');
    assert.ok(listing.map((e) => e.name).includes('inner.txt'));

    await adapter.renameFile('a.txt', 'b.txt');
    assert.equal((await adapter.readFile('b.txt')).content, 'alpha content');
    assert.equal((await adapter.readFile('a.txt')).content, '');

    await adapter.deleteFile('b.txt');
    assert.equal((await adapter.readFile('b.txt')).content, '');

    const git = await adapter.gitStatus();
    assert.equal(git.branch, 'main');
    assert.deepEqual(git.entries, []);

    await adapter.destroy();
  });

  it('reports the CLI honestly when daytona is not available (never fabricates a workspace)', async () => {
    const dir = await tempDataDir();
    const adapter = new DaytonaWorkspaceAdapter(join(dir, 'env-gone'), { cli: 'definitely-not-daytona-xyz' });
    const health = await adapter.health();
    assert.equal(health.ok, false);
    assert.match(health.detail, /not answering/);
    const provision = await adapter.provision({ label: 'x', gitEnabled: false });
    assert.equal(provision.ok, false);
  });
});

describe('GET /api/system/foundation (platform startup gate)', () => {
  it('requires authentication and then reports the real, discovered foundation state', async () => {
    const dataDir = await tempDataDir();
    const server = await buildWorkingServer(dataDir);
    try {
      const anonymous = await fetch(`${server.url}/api/system/foundation`);
      assert.equal(anonymous.status, 401);

      const cookie = await signupEnrolledCookie(server.url, 'foundation-user');
      const res = await fetch(`${server.url}/api/system/foundation`, { headers: { cookie } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        policy: FoundationPolicy;
        productionReady: boolean;
        opencodeReady: boolean;
        clineReady: boolean;
        daytonaReady: boolean;
        environmentBackend: 'local-workspace' | 'daytona';
        summary: string;
        controlPlane: Array<{ capability: string; ready: boolean; detail: string }>;
        startupGateOpen: boolean;
        capabilities: CapabilityDecision[];
      };
      // The report must be exactly in sync with the LIVE host probe, and a
      // degraded foundation must never be represented as ready.
      const clineProbe = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
      const daytonaProbe = await probeBinary('daytona', ['--version'], { timeoutMs: 30_000 });
      const clineReallyReady = clineProbe !== null && clineProbe.exitCode === 0;
      const daytonaInstalled = daytonaProbe !== null && daytonaProbe.exitCode === 0;
      const daytonaUsable = daytonaInstalled
        ? await probeBinary('daytona', ['list', '--format', 'json'], { timeoutMs: 30_000 }).then((r) => r !== null && r.exitCode === 0)
        : false;
      // `daytonaReady` is true only when the capability is genuinely READY
      // (§75): an installed-but-unusable CLI is DEGRADED, not ready.
      assert.equal(body.clineReady, clineReallyReady);
      assert.equal(body.daytonaReady, daytonaUsable);
      // OpenCode is never claimable here: this build host has no reachable
      // OpenCode provider, so the gate must stay shut and say why.
      assert.equal(body.opencodeReady, false);
      assert.equal(body.productionReady, false);
      assert.equal(body.policy, 'development-local');
      assert.equal(body.startupGateOpen, false);
      assert.match(body.summary, /Not production-ready/);
      // Every control-plane foundation was probed for real at boot.
      assert.equal(body.controlPlane.length, 6);
      assert.ok(body.capabilities.some((c) => c.capability === 'local-workspace' && c.status === 'READY'));
      const expectedDaytonaStatus = !daytonaInstalled ? 'NOT_INSTALLED' : daytonaUsable ? 'READY' : 'DEGRADED';
      assert.ok(body.capabilities.some((c) => c.capability === 'daytona' && c.status === expectedDaytonaStatus));
      // The reported environment backend follows genuine daytona readiness.
      assert.equal(body.environmentBackend, daytonaUsable ? 'daytona' : 'local-workspace');
    } finally {
      await server.close();
    }
  });
});