import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { Express } from 'express';
import { buildServer } from '../src/web/server.ts';
import { ModelCatalogue } from '../src/ai/model-catalogue.ts';
import { ModelsDevSource } from '../src/ai/models-dev-source.ts';
import { OpenRouterProvider } from '../src/ai/openrouter-provider.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import type { CoreServices } from '../src/core/services.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupEnrolledCookie, tempDataDir } from './helpers.ts';

/** Minimal fetch mock returning canned responses per URL (same shape as tests). */
function mockFetch(
  responder: (url: string, init: { method: string; headers: Record<string, string> }) => {
    status: number;
    body: unknown;
  },
): { calls: { url: string; method: string }[]; fetch: unknown } {
  const calls: { url: string; method: string }[] = [];
  const fetch = (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method });
    const r = responder(url, init);
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: () => Promise.resolve(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: () => Promise.resolve(r.body),
    });
  };
  return { calls, fetch };
}

function modelsDevPayload(): unknown {
  return {
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      models: {
        'claude-haiku-free': {
          id: 'claude-haiku-free',
          name: 'Claude Haiku (zero-cost listing)',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
        },
      },
    },
  };
}

function openRouterPayload(): unknown {
  return {
    data: [
      {
        id: 'openai/gpt-4o',
        name: 'OpenAI: GPT-4o',
        context_length: 128000,
        pricing: { prompt: '0.0000025', completion: '0.00001' },
        architecture: { input_modalities: ['text', 'image'] },
        top_provider: { max_completion_tokens: 16384 },
        supported_parameters: ['tools'],
      },
    ],
  };
}

function localModelsPayload(): unknown {
  return {
    object: 'list',
    data: [{ id: 'llama3.2', object: 'model' }, { id: 'qwen2.5-coder', object: 'model' }],
  };
}

interface RunServer {
  app: Express;
  url: string;
  manager: ProviderManager;
  localCalls: () => { url: string; method: string }[];
  openRouterCalls: () => { url: string; method: string }[];
  close: () => Promise<void>;
}

/** Real in-memory engine bundle (registry + store + evidence), no pipeline run. */
async function buildEngineFixture(): Promise<{ result: DemoResult; close: () => Promise<void> }> {
  const dir = await tempDataDir();
  const storePath = join(dir, 'blueprint-store.json');
  const allocator = new ArtifactIdAllocator();
  const store = new JsonFileArtifactStore({ filePath: storePath, allocator });
  const graph = new KnowledgeGraph();
  const evidence = new MemoryEvidenceLog();
  const scripted = new ScriptedProvider();
  const router = new AiRouter();
  router.register(scripted).setDefaultProvider('scripted');
  const registry = new ProjectRegistry({ store, allocator, graph, evidence, router });
  const services: CoreServices = { store, allocator, graph, evidence, router, projects: registry };
  const result = {
    services,
    registry,
    evidence,
    store,
    allocator,
    graph,
    baseline: { projectId: 'test-engines' },
    projectMode: 'full-product',
    config: { envName: 'test', dataDir: dir, logLevel: 'warn' },
    project: { id: 'PROJ-000000', title: '', description: '' },
    stats: {},
    providerCalls: 0,
  } as unknown as DemoResult;
  return { result, close: () => fs.rm(dir, { recursive: true, force: true }) };
}

describe('provider hub + real stage execution API (honest surface)', () => {
  /** Fresh server: local runtime is UP; OpenRouter key-check is injected. */
  async function buildHubServer(): Promise<RunServer> {
    const md = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
    const or = mockFetch((url) =>
      url.endsWith('/key')
        ? { status: 200, body: { data: { label: 'k' } } }
        : { status: 200, body: openRouterPayload() },
    );
    const catalogue = new ModelCatalogue({
      modelsDevSource: new ModelsDevSource({ fetchImpl: md.fetch as never }),
      openRouterProvider: new OpenRouterProvider({ apiKey: 'sk-or-test-key-xyz', fetchImpl: or.fetch as never }),
    });
    const manager = new ProviderManager();
    const keyFetch = mockFetch(() => ({ status: 200, body: { data: { label: 'k' } } }));
    const localUp = mockFetch((url) =>
      url.endsWith('/models')
        ? { status: 200, body: localModelsPayload() }
        : { status: 200, body: { choices: [{ message: { content: 'stage deliverable content' } }] } },
    );
    manager.setLocalRuntime({ baseUrl: 'http://127.0.0.1:11434/v1' }, localUp.fetch);
    const { result, close: closeEngine } = await buildEngineFixture();
    const { app } = await buildServer({
      result,
      modelCatalogue: catalogue,
      providerManager: manager,
      openRouterFetchImpl: keyFetch.fetch,
      dataDir: await tempDataDir(),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return {
      app,
      manager,
      url: `http://127.0.0.1:${port}`,
      localCalls: () => localUp.calls,
      openRouterCalls: () => or.calls,
      close: async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await closeEngine();
      },
    };
  }

  it('GET /api/providers requires auth and describes supported providers with honest state', async () => {
    const s = await buildHubServer();
    try {
      const noAuth = await fetch(`${s.url}/api/providers`);
      assert.equal(noAuth.status, 401);

      const alice = await signupEnrolledCookie(s.url, 'prov_alice');
      const res = await fetch(`${s.url}/api/providers`, { headers: { cookie: alice } });
      assert.equal(res.status, 200);
      const { providers } = (await res.json()) as {
        providers: {
          providerId: string;
          authMethod: string;
          credentialRequired: boolean;
          configured: boolean;
          connectionVerified: boolean;
        }[];
      };
      const openrouter = providers.find((p) => p.providerId === 'openrouter');
      assert.ok(openrouter);
      assert.equal(openrouter.authMethod, 'api_key');
      assert.equal(openrouter.credentialRequired, true);
      assert.equal(openrouter.configured, false); // no credential yet
      assert.equal(openrouter.connectionVerified, false);
      const local = providers.find((p) => p.providerId === 'local');
      assert.ok(local);
      assert.equal(local.authMethod, 'none');
      assert.equal(local.credentialRequired, false); // derived from authMethod, not a label
      assert.equal(local.connectionVerified, false); // runtime exists but unverified
    } finally {
      await s.close();
    }
  });

  it('POST /api/providers/local/verify runs a REAL runtime reachability check', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'prov_alice2');
      const res = await fetch(`${s.url}/api/providers/local/verify`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(res.status, 200);
      const outcome = (await res.json()) as { success: boolean; modelsAvailable?: number };
      assert.equal(outcome.success, true);
      assert.equal(outcome.modelsAvailable, 2);
      assert.ok(s.localCalls().some((c) => c.url.endsWith('/models')));

      const mark = (await fetch(`${s.url}/api/providers`, { headers: { cookie: alice } }).then((r) =>
        r.json(),
      )) as {
        providers: { providerId: string; connectionVerified: boolean }[];
      };
      assert.equal(
        mark.providers.find((p) => p.providerId === 'local')?.connectionVerified,
        true,
      );
    } finally {
      await s.close();
    }
  });

  it('POST /api/providers/openrouter/verify needs a credential (409) and verifies the real key', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'prov_alice3');
      const noCred = await fetch(`${s.url}/api/providers/openrouter/verify`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(noCred.status, 409);
      assert.match(((await noCred.json()) as { error: string }).error, /No OpenRouter credential/);

      await fetch(`${s.url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'openrouter', secret: 'sk-or-prov-hub' }),
      });
      const verify = await fetch(`${s.url}/api/providers/openrouter/verify`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(verify.status, 200);
      assert.equal(((await verify.json()) as { success: boolean }).success, true);
    } finally {
      await s.close();
    }
  });

  it('POST /api/providers/unknown/verify reports 501 honestly (no fabricated success)', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'prov_alice4');
      const res = await fetch(`${s.url}/api/providers/acme/verify`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(res.status, 501);
      assert.match(((await res.json()) as { error: string }).error, /not implemented yet/);
    } finally {
      await s.close();
    }
  });

  it('/api/models?providerId=local lists the runtime models (localHubUnavailable=false)', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'prov_alice5');
      const res = await fetch(`${s.url}/api/models?providerId=local`, {
        headers: { cookie: alice },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        total: number;
        localHubUnavailable: boolean;
        models: { providerId: string }[];
      };
      assert.equal(body.total, 2);
      assert.equal(body.localHubUnavailable, false);
      assert.ok(body.models.every((m) => m.providerId === 'local'));
    } finally {
      await s.close();
    }
  });

  it('run with NO verified selection stays an honest RECORDED checkpoint', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'run_checkpoint');
      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ name: 'Checkpoint project', vision: 'A concise product vision for the checkpoint test.' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const run = await fetch(`${s.url}/api/projects/${project.id}/run/discovery`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(run.status, 200);
      const body = (await run.json()) as { status: string };
      assert.equal(body.status, 'RECORDED');
      assert.ok(s.openRouterCalls().length === 0); // no provider request was made
      assert.ok(s.localCalls().filter((c) => c.url.endsWith('/chat/completions')).length === 0);
    } finally {
      await s.close();
    }
  });

  it('run with a verified local model REALLY executes the stage and records output', async () => {
    const s = await buildHubServer();
    try {
      const alice = await signupEnrolledCookie(s.url, 'run_exec');

      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ name: 'Executed project', vision: 'A real execution vision for the run test here.' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      // Bind the project's OWN authoritative AI configuration (local/llama3.2),
      // then run through it. Global-selection fallback is not a run surface.
      const bind = await fetch(`${s.url}/api/projects/${project.id}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'llama3.2' }),
      });
      assert.equal(bind.status, 200);
      const run = await fetch(`${s.url}/api/projects/${project.id}/run/discovery`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(run.status, 200);
      const body = (await run.json()) as {
        status: string;
        providerId: string;
        modelId: string;
        content: string;
        evidenceId: string;
        latencyMs: number;
      };
      assert.equal(body.status, 'EXECUTED');
      assert.equal(body.providerId, 'local');
      assert.equal(body.modelId, 'llama3.2');
      assert.equal(body.content, 'stage deliverable content');
      assert.match(body.evidenceId, /^EV-\d+$/);
      assert.ok(body.latencyMs >= 0);
      assert.ok(s.localCalls().some((c) => c.url.endsWith('/chat/completions')));

      const detail = (await fetch(`${s.url}/api/projects/${project.id}`, {
        headers: { cookie: alice },
      }).then((r) => r.json())) as {
        stages: { stageId: string; status: string; providerId: string | null; modelId: string | null }[];
        aiOutputs: Record<string, { content: string; evidenceId: string }>;
      };
      const discovery = detail.stages.find((st) => st.stageId === 'discovery');
      assert.equal(discovery?.status, 'EXECUTED');
      assert.equal(discovery?.providerId, 'local');
      assert.equal(discovery?.modelId, 'llama3.2');
      assert.equal(detail.aiOutputs['discovery']?.content, 'stage deliverable content');
      assert.ok(detail.aiOutputs['discovery']?.evidenceId);

      const repeated = await fetch(`${s.url}/api/projects/${project.id}/run/discovery`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(repeated.status, 409); // already executed - never re-run silently
    } finally {
      await s.close();
    }
  });

  it('run failure returns an honest 502 and does NOT mark the stage completed', async () => {
    const md = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
    const catalogue = new ModelCatalogue({
      modelsDevSource: new ModelsDevSource({ fetchImpl: md.fetch as never }),
      openRouterProvider: new OpenRouterProvider({ apiKey: 'k', fetchImpl: mockFetch(() => ({ status: 200, body: openRouterPayload() })).fetch as never }),
    });
    const manager = new ProviderManager();
    const failCompletions = mockFetch(
      (url) =>
        url.endsWith('/models')
          ? { status: 200, body: localModelsPayload() }
          : { status: 503, body: { error: 'runtime outage' } },
    );
    manager.setLocalRuntime({ baseUrl: 'http://127.0.0.1:11434/v1' }, failCompletions.fetch);
    const { result, close: closeEngine } = await buildEngineFixture();
    const { app } = await buildServer({
      result,
      modelCatalogue: catalogue,
      providerManager: manager,
      openRouterFetchImpl: mockFetch(() => ({ status: 200, body: {} })).fetch,
      dataDir: await tempDataDir(),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    try {
      const alice = await signupEnrolledCookie(url, 'run_fail');
      const created = await fetch(`${url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ name: 'Fail project', vision: 'A vision that exercises the honest failure path now.' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const bind = await fetch(`${url}/api/projects/${project.id}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'llama3.2' }),
      });
      assert.equal(bind.status, 200);
      const run = await fetch(`${url}/api/projects/${project.id}/run/discovery`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(run.status, 502);
      const detail = (await fetch(`${url}/api/projects/${project.id}`, {
        headers: { cookie: alice },
      }).then((r) => r.json())) as {
        stages: { stageId: string; status: string }[];
        aiOutputs: Record<string, unknown>;
      };
      assert.equal(detail.stages.find((st) => st.stageId === 'discovery')?.status, 'PENDING');
      assert.equal(Object.keys(detail.aiOutputs).length, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeEngine();
    }
  });
});