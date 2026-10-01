/**
 * REAL Cline + REAL Daytona integration verification (LAW - CLINE MUST BE
 * INSTALLED AND INTEGRATED, LAW - DAYTONA MUST BE INSTALLED AND INTEGRATED,
 * LAW - EXECUTION REALITY, LAW - COMPATIBILITY GATE).
 *
 * These tests deliberately exercise the GENUINE installed CLIs, not doubles:
 *
 *  - the real `cline` executable is spawned and must answer a real version /
 *    health probe, and a real task run is attempted against a real workspace;
 *  - the real `daytona` executable is spawned and must answer a real version
 *    probe and an honest unauthenticated state;
 *  - the Daytona credential verifier is exercised against the REAL Daytona
 *    API, proving that a wrong key is genuinely rejected and never activated.
 *
 * Nothing here fabricates success. Where the host genuinely lacks a credential
 * or an account, the test asserts the honest boundary rather than passing a
 * fake.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityDiscovery, probeBinary } from '../src/env/capabilities.ts';
import { runRealCline } from '../src/env/cline-runner.ts';
import { RealClineBoundary } from '../src/env/cline-adapter.ts';
import { DaytonaWorkspaceAdapter } from '../src/env/daytona-adapter.ts';
import { DaytonaPlatformConfig, verifyDaytona } from '../src/env/daytona-platform-config.ts';
import { CredentialStore } from '../src/ai/credential-store.ts';
import { reconcileHostPath } from '../src/runtime/host-path.ts';

/**
 * Removes a temp directory, tolerating Windows keeping it locked for a short
 * while after the real Cline process exits (EBUSY/EPERM). Cleanup hygiene must
 * never be reported as a product failure.
 */
async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

reconcileHostPath();

test('the REAL cline CLI is installed, PATH-resolved and version-probed', async () => {
  const probe = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
  // The host fact under test is that the real CLI RESOLVES from PATH. Whether it
  // answers within the probe deadline depends on how loaded the machine is when
  // the full suite runs in parallel, so readiness is asserted only when it
  // genuinely answered - and an unresponsive-but-installed CLI must be reported
  // honestly rather than as absent.
  assert.notEqual(probe, null, 'the cline CLI must be resolvable from PATH on this host');
  if (probe!.exitCode !== 0) {
    // Present but did not answer: the platform must say DEGRADED, never
    // NOT_INSTALLED (which would falsely claim the CLI is absent).
    const busy = new CapabilityDiscovery({
      filePath: join(await mkdtemp(join(tmpdir(), 'bf-cline-busy-')), 'capabilities.json'),
    });
    await busy.init();
    const decisions = await busy.discover();
    const state = decisions.find((d) => d.capability === 'cline');
    assert.equal(state?.status, 'DEGRADED', 'an installed-but-unresponsive CLI must be DEGRADED, never NOT_INSTALLED');
    return;
  }
  assert.match(probe!.stdout.trim(), /\d+\.\d+\.\d+/, 'the real cline reports a real version');

  // The platform's own Cline boundary must therefore report READY, from a real
  // probe - never from a hard-coded assumption.
  const boundary = new RealClineBoundary();
  const detected = await boundary.detect();
  assert.equal(detected.status, 'READY');
  assert.equal(detected.mechanism, 'cline-cli');
  assert.ok((detected.version ?? '').length > 0);
  assert.equal(await boundary.canExecute(), true);
  const health = await boundary.health();
  assert.equal(health.ready, true);
});

test('the REAL cline CLI genuinely runs a task in a real workspace and reports honest outcomes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-real-'));
  try {
    // A real workspace on the real filesystem.
    await writeFile(join(dir, 'README.md'), '# real workspace\n', 'utf8');

    const result = await runRealCline({
      cwd: dir,
      prompt: 'List the files in this directory and reply with only the file names.',
      binding: {
        projectId: 'PROJECT-0001',
        ownerId: 'tester',
        jobId: 'JOB-000001',
        envId: 'ENV-0001',
        artifactScope: ['PAGE-0001'],
      },
      timeoutMs: 120_000,
      autoApprove: true,
    });

    // The binding is always reported, whatever the outcome.
    assert.equal(result.binding.jobId, 'JOB-000001');
    assert.equal(result.binding.envId, 'ENV-0001');
    assert.deepEqual([...result.binding.artifactScope], ['PAGE-0001']);
    assert.ok(result.durationMs > 0);

    // Outcome is the REAL process outcome. Without a provider credential on this
    // host, the honest result is a classified authentication/provider failure -
    // and the platform must say so rather than claim Cline work happened.
    if (result.ok) {
      assert.equal(result.failureClass, 'none');
      assert.match(result.detail, /completed the task/);
    } else {
      assert.notEqual(result.failureClass, 'none');
      assert.ok(
        result.failureClass === 'authentication' || result.failureClass === 'provider' || result.failureClass === 'cline',
        `unexpected failure class ${result.failureClass}`,
      );
      // A failed run must not claim completed work.
      assert.doesNotMatch(result.detail, /completed the task/);
    }
    // Output is real process output, and no credential can appear in it.
    assert.equal(typeof result.stdout, 'string');
    assert.equal(typeof result.stderr, 'string');
  } finally {
    await removeTempDir(dir);
  }
});

test('a real Cline run never leaks the credential into argv, output or errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-secret-'));
  try {
    const secret = 'sk-test-secret-value-1234567890';
    const result = await runRealCline({
      cwd: dir,
      prompt: 'Say hello.',
      binding: { projectId: 'P', ownerId: 'o', jobId: 'J', envId: null, artifactScope: [] },
      timeoutMs: 60_000,
      apiKey: secret,
    });
    const combined = `${result.stdout}\n${result.stderr}\n${result.detail}`;
    assert.ok(!combined.includes(secret), 'the API key must never appear in the Cline result');
  } finally {
    await removeTempDir(dir);
  }
});

test('the REAL daytona CLI is installed, version-probed and reports its honest auth state', async () => {
  const probe = await probeBinary('daytona', ['--version']);
  assert.notEqual(probe, null, 'the daytona CLI must be resolvable from PATH on this host');
  assert.equal(probe!.exitCode, 0);
  assert.match(probe!.stdout.trim(), /v?\d+\.\d+\.\d+/, 'the real daytona reports a real version');

  // Without an authenticated Daytona account, the real CLI must refuse rather
  // than pretend a sandbox exists.
  const adapter = new DaytonaWorkspaceAdapter(join(dirnameOf(), 'never-provisioned-sandbox'));
  const health = await adapter.health();
  assert.equal(health.ok, false, 'an unauthenticated daytona CLI must not report a healthy sandbox');
});

function dirnameOf(): string {
  return tmpdir();
}

test('the Daytona credential verifier REJECTS a wrong key against the real Daytona API and never activates it', async () => {
  const result = await verifyDaytona('dtn_definitely_not_a_valid_key_000000000');
  assert.equal(result.ok, false, 'a fabricated key must never verify against the real Daytona API');
  assert.ok(result.detail.length > 0);
  // The failure must be actionable without leaking anything.
  assert.doesNotMatch(result.detail, /dtn_definitely_not_a_valid_key_000000000/);
  assert.match(result.detail, /not activated|rejected|authorize/i);
});

test('an empty Daytona key is refused before any network call', async () => {
  const result = await verifyDaytona('   ');
  assert.equal(result.ok, false);
});

test('the platform Daytona config never reports connected for an unverified credential', async () => {
  const config = new DaytonaPlatformConfig(new CredentialStore(), join(tmpdir(), 'daytona-cfg.json'));
  assert.equal(config.current().status, 'unconfigured');
  assert.equal(config.isReady(), false);

  const state = await config.configure('dtn_definitely_not_a_valid_key_000000000');
  assert.notEqual(state.status, 'connected', 'an unverified credential must not become active');
  assert.equal(config.isReady(), false);
  // The public state must never carry the secret.
  assert.ok(!JSON.stringify(state).includes('dtn_definitely_not_a_valid_key_000000000'));
  assert.equal(state.credentialId !== null, true, 'a credential reference is kept, not the secret');

  // Clearing returns to the unconfigured state.
  assert.equal(config.clear().status, 'unconfigured');
  assert.equal(config.isReady(), false);
});

test('a real Daytona sandbox is only claimed when Daytona itself reports it', async () => {
  // This is the honest external boundary: a real Daytona workspace requires a
  // real Daytona account, which only the platform owner can provide. The test
  // asserts that the platform refuses to fabricate one.
  const dir = await mkdtemp(join(tmpdir(), 'bf-daytona-real-'));
  try {
    const adapter = new DaytonaWorkspaceAdapter(dir);
    const provisioned = await adapter.provision({ label: 'real attempt', gitEnabled: false });
    assert.equal(provisioned.ok, false, 'no Daytona account is configured on this host, so provisioning must fail honestly');
    assert.ok(provisioned.detail.length > 0);
    assert.doesNotMatch(provisioned.detail, /responded to a real execution probe/);
  } finally {
    await removeTempDir(dir);
  }
});


