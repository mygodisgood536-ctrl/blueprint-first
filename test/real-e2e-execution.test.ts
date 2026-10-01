/**
 * REAL END-TO-END EXECUTION PROOF
 *   platform AI provider/model  ->  real Cline CLI  ->  real environment
 *   ->  real files / commands  ->  real evidence  ->  durable job + env state
 *
 * This test performs NO mock, stub, fake provider, fake model or simulated
 * execution. It is CREDENTIAL-GATED: the real Cline CLI and the real Daytona
 * service both require credentials that only the platform owner can supply, so
 * when they are absent the test asserts the honest governed state (real CLI
 * detected, honest refusal, no fabricated success) rather than passing a fake.
 * When they ARE present through the platform's own configuration, the test runs
 * the entire chain for real.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/web/server.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupEnrolledCookie } from './helpers.ts';
import { probeBinary } from '../src/env/capabilities.ts';
import { reconcileHostPath } from '../src/runtime/host-path.ts';
import { verifyDaytona } from '../src/env/daytona-platform-config.ts';
import { prepareClineAi, clineRootDir, clineProfileDirs, runClineTask } from '../src/env/cline-bridge.ts';
import { DaytonaWorkspaceAdapter } from '../src/env/daytona-adapter.ts';

reconcileHostPath();

interface Harness {
  url: string;
  dataDir: string;
  close: () => Promise<void>;
  providerManager: ProviderManager;
}

async function boot(dataDir: string, fetchImpl?: unknown): Promise<Harness> {
  const store = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator: new ArtifactIdAllocator() });
  await store.init();
  const router = new AiRouter();
  router.register(new ScriptedProvider({ rules: [] })).setDefaultProvider('scripted');
  const services = { store, allocator: new ArtifactIdAllocator(), graph: new KnowledgeGraph(), evidence: new MemoryEvidenceLog(), router };
  const registry = new ProjectRegistry(services);
  const result = {
    baseline: { projectId: 'demo-project', totalArtifacts: 0 },
    registry, services, evidence: services.evidence, store, projectMode: 'full-product',
  } as unknown as DemoResult;
  const providerManager = new ProviderManager();
  const built = await buildServer({
    result,
    providerManager,
    dataDir,
    ...(fetchImpl !== undefined ? { openRouterFetchImpl: fetchImpl } : {}),
  });
  const server = built.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
  return {
    url,
    dataDir,
    providerManager,
    close: async () => {
      built.working.supervisor.dispose();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A real provider endpoint responder is NOT used: verification must be real. */
function noFetch(): undefined {
  return undefined;
}

/**
 * Removes a temporary directory, tolerating Windows keeping the directory
 * locked for a short while after the real Cline process exits (EBUSY/EPERM).
 * Cleanup hygiene must never be reported as a product failure.
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

test('the real Cline CLI is genuinely present and bound to the platform AI configuration', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-e2e-cline-'));
  const clineRoot = clineRootDir(dir);
  const h = await boot(dir, noFetch());
  try {
    const owner = await signupEnrolledCookie(h.url, 'e2e-owner');
    const clineProbe = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
    assert.notEqual(clineProbe, null, 'the real Cline CLI must be resolvable');

    // The platform's own startup report must show the REAL Cline state.
    const foundation = (await (await fetch(`${h.url}/api/system/foundation`, { headers: { cookie: owner } })).json()) as {
      clineReady: boolean;
      capabilities: Array<{ capability: string; status: string; version: string | null }>;
    };
const clineCap = foundation.capabilities.find((c) => c.capability === 'cline');
    // The CLI resolved from PATH, so the platform must never claim it is absent.
    // Whether it is READY depends on whether it ANSWERED, which depends on how
    // loaded the machine is during a parallel suite run. The honest invariant:
    // a resolvable CLI is READY-with-a-real-version when it answers, and
    // DEGRADED when it is installed but unresponsive - never NOT_INSTALLED.
    assert.notEqual(
      clineCap?.status,
      'NOT_INSTALLED',
      'a CLI that resolved from PATH must never be reported as absent',
    );
    if (clineProbe!.exitCode !== 0) {
      assert.equal(
        clineCap?.status,
        'DEGRADED',
        'an installed-but-unresponsive CLI must be reported honestly as DEGRADED',
      );
      console.log('  real Cline resolved but did not answer; reported honestly as DEGRADED');
    } else {
      assert.equal(clineCap?.status, 'READY', 'the platform must detect the real Cline CLI as READY');
      assert.ok((clineCap?.version ?? '').length > 0, 'the real reported Cline version must be recorded');
      console.log(`  real Cline detected: READY (${clineCap?.version})`);
    }

    // With no owner-configured Daytona key the platform must NOT claim Daytona.
    const daytonaProbe = await probeBinary('daytona', ['--version'], { timeoutMs: 60_000 });
    if (daytonaProbe !== null) {
      const dcap = foundation.capabilities.find((c) => c.capability === 'daytona');
      assert.notEqual(dcap?.status, 'READY', 'Daytona must not be READY without a verified account');
      console.log(`  real Daytona CLI: ${dcap?.status} (installed, no verified account)`);
    }

    // The Cline bridge must refuse to run without a platform credential.
    const prep = await prepareClineAi({
      providerManager: h.providerManager,
      clineRoot,
      ownerId: 'e2e-owner',
      providerId: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
    });
    assert.equal(prep.ready, false, 'Cline must not run without a verified platform credential');
    assert.match(prep.detail, /nothing was substituted/i);
    console.log('  Cline correctly refuses without a verified platform AI credential');
  } finally {
    await h.close();
    await removeTempDir(dir);
  }
});

test('REAL chain runs when the owner has configured a Daytona key and a platform AI credential', async (t) => {
  const daytonaKey = process.env['BF_E2E_DAYTONA_KEY']?.trim();
  const providerKey = process.env['BF_E2E_PROVIDER_KEY']?.trim();
  const providerId = process.env['BF_E2E_PROVIDER_ID']?.trim() ?? 'openrouter';
  const modelId = process.env['BF_E2E_MODEL_ID']?.trim() ?? 'anthropic/claude-3.5-sonnet';

  if (daytonaKey === undefined || daytonaKey.length === 0) {
    t.skip('no owner-provided Daytona credential in the environment (BF_E2E_DAYTONA_KEY)');
    return;
  }
  if (providerKey === undefined || providerKey.length === 0) {
    t.skip('no platform AI provider credential in the environment (BF_E2E_PROVIDER_KEY)');
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'bf-e2e-real-'));
  const clineRoot = clineRootDir(dir);
  const h = await boot(dir);
  try {
    const owner = await signupEnrolledCookie(h.url, 'e2e-real-owner');

    // 1. REAL Daytona authentication with the owner credential.
    const verified = await verifyDaytona(daytonaKey);
    assert.equal(verified.ok, true, `real Daytona verification failed: ${verified.detail}`);
    console.log(`  Daytona verified: account=${verified.accountLabel} cli=${verified.cliVersion}`);

    // 2. A real Daytona environment.
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'bf-e2e-sbx-'));
    const adapter = new DaytonaWorkspaceAdapter(sandboxRoot, { cli: 'daytona' });
    const provisioned = await adapter.provision({ label: 'e2e', gitEnabled: true });
    assert.equal(provisioned.ok, true, `real Daytona provisioning failed: ${provisioned.detail}`);
    console.log(`  Daytona environment provisioned: ${provisioned.detail}`);

    // 3. The platform's own AI credential for the same user.
    h.providerManager.credentials.addCredential(owner, providerId, providerKey);
    const conn = await h.providerManager.verifyProviderConnection(owner, providerId);
    assert.equal(conn.success, true, `platform credential verification failed: ${conn.errorMessage ?? ''}`);

    // 4. REAL Cline, configured from the platform's own AI configuration.
    const prep = await prepareClineAi({ providerManager: h.providerManager, clineRoot, ownerId: owner, providerId, modelId });
    assert.equal(prep.ready, true, `Cline AI preparation failed: ${prep.detail}`);
    console.log(`  Cline configured from platform AI: ${prep.binding!.providerId}/${prep.binding!.clineModel}`);

    // 5. REAL Cline execution inside the REAL environment.
    const run = await runClineTask({
      cwd: sandboxRoot,
      prompt: 'Create a file named proof.txt containing the word REAL, then print its contents, then reply with DONE.',
      binding: { projectId: 'PROJECT-0001', ownerId: owner, jobId: 'JOB-000001', envId: 'ENV-0001', artifactScope: ['e2e'] },
      providerId: prep.binding!.providerId,
      modelId: prep.binding!.clineModel,
      profileDirs: clineProfileDirs(clineRoot, owner),
      timeoutMs: 300_000,
      autoApprove: true,
    });
    console.log(`  Cline exit=${run.exitCode} class=${run.failureClass} detail=${run.detail.slice(0, 140)}`);
    assert.equal(run.ok, true, `real Cline execution failed: ${run.detail}\n${run.stderr.slice(0, 400)}`);

    // 6. The REAL file must exist in the REAL environment.
    const entries = await readdir(sandboxRoot);
    assert.ok(entries.includes('proof.txt'), `Cline must have created proof.txt; saw: ${entries.join(', ')}`);
    const content = await readFile(join(sandboxRoot, 'proof.txt'), 'utf8');
    assert.match(content, /REAL/);
    console.log('  real Cline created proof.txt in the real Daytona environment');

    // 7. Real command execution through the environment.
    const cmd = await adapter.runCommand('cat proof.txt');
    assert.equal(cmd.exitCode, 0);
    assert.match(cmd.stdout, /REAL/);
    console.log('  real Daytona terminal returned the file Cline created');
  } finally {
    await h.close();
    await removeTempDir(dir);
  }
});

