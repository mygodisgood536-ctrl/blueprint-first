/**
 * Shared harness for the working-execution layer tests: boots the real web
 * server with a real project engine over a temp data directory.
 */
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

export interface WorkingServer {
  url: string;
  close: () => Promise<void>;
}

export async function buildWorkingServer(
  dataDir: string,
  providerManager?: ProviderManager,
  routerRegistrar?: (router: AiRouter) => void,
): Promise<WorkingServer> {
  const store = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator: new ArtifactIdAllocator() });
  await store.init();
  const services: CoreServices = {
    store,
    allocator: new ArtifactIdAllocator(),
    graph: new KnowledgeGraph(),
    evidence: new MemoryEvidenceLog(),
    router: (() => {
      const router = new AiRouter();
      if (routerRegistrar !== undefined) {
        routerRegistrar(router);
      } else {
        router.register(new ScriptedProvider({ rules: [] })).setDefaultProvider('scripted');
      }
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
  // The full server result is kept so teardown can stop the Execution
  // Supervisor's own timers as well as the HTTP listener. A supervisor left
  // running keeps a 5s supervision loop and a 10s watchdog alive for the rest
  // of the process, which is both a real resource leak and a source of
  // run-to-run flakiness.
  const built = await buildServer({ result, providerManager: providerManager ?? new ProviderManager(), dataDir });
  const { app } = built;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        built.working.supervisor.dispose();
        // `server.close()` alone only stops accepting; it keeps waiting while any
        // client keep-alive socket is still open, which can stall a whole test
        // run under load. Destroying the live connections makes teardown
        // deterministic instead of timing-dependent.
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/**
 * Polls a real asynchronous condition until it holds.
 *
 * The default budget is generous because these predicates wait on REAL work:
 * provisioning a real environment, running a real stage, or a real CLI
 * answering. Under full-suite parallel load that legitimately takes far longer
 * than a unit-test timeout, and a tight budget turns a slow-but-correct run into
 * a misleading failure in whichever file happened to lose the race.
 */
export async function until(
  predicate: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function createProject(url: string, cookie: string, name: string): Promise<string> {
  const res = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, vision: 'A real working workspace that executes real stages honestly.', mode: 'full-product' }),
  });
  const payload = (await res.json()) as { project?: { id?: string }; error?: string };
  assert.equal(res.status, 201, payload.error ?? 'project create failed');
  assert.equal(typeof payload.project?.id, 'string');
  return payload.project!.id!;
}

export { signupEnrolledCookie as workingSignupEnrolledCookie };
export { tempDataDir as workingTempDataDir };