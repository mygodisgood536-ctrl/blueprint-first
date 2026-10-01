/**
 * Cline/Daytona governed readiness (LAW - DAYTONA MUST BE INSTALLED AND
 * INTEGRATED / LAW - COMPONENT HEALTH / LAW - PLATFORM STARTUP GATE).
 *
 * 1. The env-READY job gate: a Worker job can never enter RUNNING while its
 *    assigned workspace is not READY - it is BLOCKED with the real reason.
 * 2. Governed AUTO-READY: /api/system/foundation re-probes the real host. When
 *    the daytona CLI becomes available WITHOUT a restart, the platform lifts
 *    itself to daytona (report AND new-environment binding both flip) with NO
 *    architectural rewrite; cline stays honestly absent and the platform never
 *    claims production-readiness it does not have.
 * 3. Symmetric honesty: when the CLI is removed again the report flips back to
 *    local-workspace on the next live probe.
 *
 * The daytona mechanism is a REAL stub CLI resolved through the host PATH by the
 * platform's own cmd-shell primitive - not an in-process mock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Express } from 'express';
import { buildServer } from '../src/web/server.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import type { CoreServices } from '../src/core/services.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupEnrolledCookie, tempDataDir } from './helpers.ts';
import { writeDaytonaStub, prependToPath, restorePath } from './env-stub.ts';
import { probeBinary } from '../src/env/capabilities.ts';

interface Booted {
  url: string;
  close: () => Promise<void>;
  working: Awaited<ReturnType<typeof buildServer>>['working'];
}

async function boot(dataDir: string, options: { foundationTtlMs?: number } = {}): Promise<Booted> {
  const store = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator: new ArtifactIdAllocator() });
  await store.init();
  const services: CoreServices = {
    store,
    allocator: new ArtifactIdAllocator(),
    graph: new KnowledgeGraph(),
    evidence: new MemoryEvidenceLog(),
    router: (() => {
      const router = new AiRouter();
      router.register(new ScriptedProvider({ rules: [] })).setDefaultProvider('scripted');
      return router;
    })(),
  };
  const registry = new ProjectRegistry(services);
  const result = {
    baseline: { projectId: 'demo-project', totalArtifacts: 0 },
    registry,
    services,
    evidence: services.evidence,
    store,
    projectMode: 'full-product',
  } as unknown as DemoResult;
  const built = await buildServer({
    result,
    providerManager: new ProviderManager(),
    dataDir,
    foundationTtlMs: options.foundationTtlMs,
  });
  const app: Express = built.app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    working: built.working,
  };
}

async function until(predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function createProject(url: string, cookie: string, name: string): Promise<string> {
  const res = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, vision: 'A real workspace proving governed readiness honestly.', mode: 'full-product' }),
  });
  const payload = (await res.json()) as { project?: { id?: string }; error?: string };
  assert.equal(res.status, 201, payload.error ?? 'project create failed');
  assert.equal(typeof payload.project?.id, 'string');
  return payload.project!.id!;
}

interface FoundationBody {
  policy: string;
  productionReady: boolean;
  opencodeReady: boolean;
  clineReady: boolean;
  clineDetail?: string;
  daytonaReady: boolean;
  daytonaDetail?: string;
  localReady: boolean;
  environmentBackend: 'local-workspace' | 'daytona';
  summary: string;
  capabilities: { capability: string; status: string; rationale?: string }[];
}

async function getFoundation(url: string, cookie: string): Promise<FoundationBody> {
  const res = await fetch(`${url}/api/system/foundation`, { headers: { cookie } });
  assert.equal(res.status, 200);
  return (await res.json()) as FoundationBody;
}

describe('governed readiness: the env-READY job gate (LAW - DAYTONA READINESS GATE)', () => {
  it('a Worker job is BLOCKED, never RUNNING, while its assigned workspace is not READY', async () => {
    const dataDir = await tempDataDir();
    const s = await boot(dataDir);
    try {
    const alice = await signupEnrolledCookie(s.url, 'gate_alice');
    const projectId = await createProject(s.url, alice, 'Gate Alpha');
    const head = { 'content-type': 'application/json', cookie: alice } as const;

    const created = await fetch(`${s.url}/api/working/environments`, {
      method: 'POST',
      headers: head,
      body: JSON.stringify({ projectId, label: 'gated workspace', gitEnabled: false }),
    });
    assert.equal(created.status, 201);
    const env = (await created.json()) as { id: string; status: string };
    // The workspace is retired BEFORE any work references it: it is a real,
    // durable record whose availability is provably false.
    const destroyed = await s.working.environments.destroy(env.id, 'test-gate');
    assert.equal(destroyed?.status, 'DESTROYED');

    const jobRes = await fetch(`${s.url}/api/working/jobs`, {
      method: 'POST',
      headers: head,
      body: JSON.stringify({ projectId, stageKey: 'discovery', envId: env.id }),
    });
    assert.equal(jobRes.status, 201);
    const job = (await jobRes.json()) as { id: string };

    await until(async () => {
      const r = await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } });
      if (r.status !== 200) return false;
      const b = (await r.json()) as { status: string; blockReason: string | null };
      return b.status === 'BLOCKED' && b.blockReason !== null;
    });

    const blocked = (await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
      status: string;
      blockReason: string | null;
      startedAt: string | null;
    };
    assert.equal(blocked.status, 'BLOCKED');
    assert.ok(
      (blocked.blockReason ?? '').includes(`${env.id} is DESTROYED`),
      `blockReason must name the environment state, got: ${blocked.blockReason ?? ''}`,
    );
    assert.ok((blocked.blockReason ?? '').includes('readiness must be verified'));
    // The gate removed any chance of execution: never started, never ran.
    assert.equal(blocked.startedAt, null);
    } finally {
      await s.close();
    }
  });
});

describe('governed AUTO-READY: the platform lifts itself when a dependency becomes available (no restart)', () => {
  it('re-probes live, flips the daytona backend without an architectural rewrite, and never over-claims', async () => {
    const dataDir = await tempDataDir();
    const stubDir = await tempDataDir();
    const s = await boot(dataDir, { foundationTtlMs: 0 });
    let originalPath = process.env['PATH'] ?? '';
    try {
      const alice = await signupEnrolledCookie(s.url, 'autoready_alice');
      const head = { 'content-type': 'application/json', cookie: alice } as const;

      // Whatever is genuinely on this host, the report must match it exactly.
      const daytonaLive = await probeBinary('daytona', ['--version'], { timeoutMs: 60_000 });
      const daytonaReallyPresent = daytonaLive !== null && daytonaLive.exitCode === 0;
      // A daytona CLI with no usable Daytona account is DEGRADED, not ready, so
      // the execution backend stays on the real local adapter until it is usable.
      const daytonaUsable = daytonaReallyPresent
        ? await probeBinary('daytona', ['list', '--format', 'json'], { timeoutMs: 30_000 }).then((r) => r !== null && r.exitCode === 0)
        : false;
      const clineLive = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
      const clineReallyPresent = clineLive !== null && clineLive.exitCode === 0;

      const before = await getFoundation(s.url, alice);
      assert.equal(before.daytonaReady, daytonaUsable);
      assert.equal(before.clineReady, clineReallyPresent);
      // Readiness is derived from the LIVE component state, never asserted as a
      // fixed value: the platform is production-ready exactly when every
      // mandatory execution component is READY, and not otherwise.
      const mandatoryBefore = ['opencode', 'cline', 'daytona', 'local-workspace'].every((cap) =>
        before.capabilities.some((c) => c.capability === cap && c.status === 'READY'),
      );
      assert.equal(before.productionReady, mandatoryBefore, `unexpected readiness derivation: ${JSON.stringify(before.capabilities)}`);
      assert.equal(before.policy, mandatoryBefore ? 'production' : 'development-local');
      assert.equal(before.environmentBackend, daytonaUsable ? 'daytona' : 'local-workspace');
      assert.ok(before.capabilities.some((c) => c.capability === 'cline' && c.status === (clineReallyPresent ? 'READY' : 'NOT_INSTALLED')));

      // An environment created now is bound to whatever the real backend is.
      const project1 = await createProject(s.url, alice, 'AutoReady One');
      const pre = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId: project1, label: 'local-bound', gitEnabled: false }),
      });
      assert.equal(pre.status, 201);
      const preEnv = (await pre.json()) as { id: string; adapterKind: string; status: string };
      assert.equal(preEnv.adapterKind, daytonaUsable ? 'daytona' : 'local-workspace');

      // A daytona CLI on PATH. No restart, no rewrite: the next live probe
      // discovers it and the platform lifts itself. When the host already has
      // the real CLI this simply confirms the discovered state; when it does
      // not, the stub supplies a genuinely spawnable CLI on PATH.
      await writeDaytonaStub(stubDir);
      originalPath = prependToPath(stubDir);

      await until(async () => (await getFoundation(s.url, alice)).daytonaReady === true);

      const lifted = await getFoundation(s.url, alice);
      assert.equal(lifted.daytonaReady, true);
      assert.equal(lifted.environmentBackend, 'daytona');
      assert.ok(lifted.capabilities.some((c) => c.capability === 'daytona' && c.status === 'READY'));
      assert.match(lifted.daytonaDetail ?? '', /CLI is installed/);
      assert.match(lifted.daytonaDetail ?? '', /sandbox listing/);
      // PRODUCTION READINESS IS AN HONEST DERIVATION, NEVER A FIXED VALUE.
      //
      // This assertion used to pin `productionReady === false` on the belief that
      // "OpenCode has no reachable provider on this host". That premise is
      // observed, not assumed: the platform must be READY exactly when every
      // mandatory execution component is READY, and must NOT be ready when any
      // one of them is not. Asserting the invariant keeps the test meaningful on
      // a host that is missing OpenCode, on one where it is installed and
      // reachable, and after the OpenCode wiring was corrected.
      const mandatoryReady = ['opencode', 'cline', 'daytona', 'local-workspace'].every((cap) =>
        lifted.capabilities.some((c) => c.capability === cap && c.status === 'READY'),
      );
      assert.equal(
        lifted.productionReady,
        mandatoryReady,
        `production readiness must equal "every mandatory component is READY"; got ${JSON.stringify(lifted.capabilities)}`,
      );
      assert.equal(lifted.policy, mandatoryReady ? 'production' : 'development-local');

      // NEW environments now bind the REAL daytona backend end-to-end: created
      // through the stub CLI and READY as a genuine Daytona workspace.
      const project2 = await createProject(s.url, alice, 'AutoReady Two');
      const post = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId: project2, label: 'daytona-bound', gitEnabled: true }),
      });
      assert.equal(post.status, 201);
      const postEnv = (await post.json()) as { id: string; adapterKind: string; status: string };
      assert.equal(postEnv.adapterKind, 'daytona');
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/environments/${postEnv.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'READY';
      });
      const ready = (await fetch(`${s.url}/api/working/environments/${postEnv.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        status: string;
        adapterKind: string;
        lastHealth: { detail: string } | null;
      };
      assert.equal(ready.status, 'READY');
      assert.equal(ready.adapterKind, 'daytona');
      assert.match(ready.lastHealth?.detail ?? '', /responded to a real execution probe/);

      // The per-environment CLINE-DAYTONA BINDING stays honest: each record
      // keeps its OWN backend, whatever the platform default is.
      const preMarkerPath = daytonaReallyPresent ? 'pre-bound-to-daytona.txt' : 'pre-bound-to-local.txt';
      const localMarker = await fetch(`${s.url}/api/working/file?envId=${preEnv.id}&path=${preMarkerPath}`, {
        method: 'PUT',
        headers: head,
        body: JSON.stringify({ content: 'bound through the backend this record really owns' }),
      });
      assert.equal(localMarker.status, 200);
      const localRead = (await fetch(`${s.url}/api/working/file?envId=${preEnv.id}&path=${preMarkerPath}`, { headers: { cookie: alice } }).then((r) => r.json())) as { content: string };
      assert.equal(localRead.content, 'bound through the backend this record really owns');

      const daytonaFile = await fetch(`${s.url}/api/working/file?envId=${postEnv.id}&path=src/from-daytona.txt`, {
        method: 'PUT',
        headers: head,
        body: JSON.stringify({ content: 'bound through the real daytona CLI' }),
      });
      assert.equal(daytonaFile.status, 200);
      const daytonaRead = (await fetch(`${s.url}/api/working/file?envId=${postEnv.id}&path=src/from-daytona.txt`, { headers: { cookie: alice } }).then((r) => r.json())) as { content: string };
      assert.equal(daytonaRead.content, 'bound through the real daytona CLI');

      // Symmetric honesty: once the stub is removed from PATH, the NEXT live
      // probe reflects whatever is really resolvable - and never leaves a stale
      // claim behind. On a host with the real CLI installed the honest outcome
      // is still READY, which is exactly the point: the report tracks reality.
      restorePath(originalPath);
      await until(async () => {
        const f = await getFoundation(s.url, alice);
        return f.daytonaReady === daytonaUsable;
      });
      const back = await getFoundation(s.url, alice);
      assert.equal(back.daytonaReady, daytonaUsable);
      assert.equal(back.environmentBackend, daytonaUsable ? 'daytona' : 'local-workspace');
    } finally {
      restorePath(originalPath);
      await s.close();
    }
  });
});