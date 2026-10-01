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

type Responder = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  { status: number; body: unknown };

function mockFetch(responder: Responder): {
  calls: { url: string; method: string; headers: Record<string, string>; body?: string }[];
  fetch: unknown;
} {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
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
    openai: {
      id: 'openai',
      name: 'OpenAI',
      models: {
        'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 128000, output: 8192 }, cost: { input: 5, output: 15 } },
      },
    },
    mistral: {
      id: 'mistral',
      name: 'Mistral',
      models: {
        'mistral-large-latest': { id: 'mistral-large-latest', name: 'Mistral Large', modalities: { input: ['text'], output: ['text'] }, limit: { context: 128000, output: 8192 }, cost: { input: 2, output: 6 } },
      },
    },
  };
}

const OPENAI_LIVE = { data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'gpt-4o-mini' }] };
const MISTRAL_LIVE = { object: 'list', data: [{ id: 'mistral-large-latest' }] };
const GOOGLE_LIVE = { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }] };
const OPENAI_COMPLETION = { choices: [{ message: { content: 'openai-wired-deliverable' }, finish_reason: 'stop' }] };
const MISTRAL_COMPLETION = { choices: [{ message: { content: 'mistral-wired-deliverable' }, finish_reason: 'stop' }] };

interface AiServer {
  app: Express;
  url: string;
  manager: ProviderManager;
  vendorCalls: () => { url: string; method: string }[];
  close: () => Promise<void>;
}

async function buildAiServer(): Promise<AiServer> {
  const md = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
  const catalogue = new ModelCatalogue({
    modelsDevSource: new ModelsDevSource({ fetchImpl: md.fetch as never }),
    openRouterProvider: new OpenRouterProvider({ apiKey: 'k', fetchImpl: mockFetch(() => ({ status: 200, body: { data: [] } })).fetch as never }),
  });
  const manager = new ProviderManager();
  const vendor = mockFetch((url) =>
    url.includes('api.openai.com/v1/models')
      ? { status: 200, body: OPENAI_LIVE }
      : url.includes('api.openai.com/v1/chat/completions')
        ? { status: 200, body: OPENAI_COMPLETION }
        : url.includes('api.mistral.ai/v1/models')
          ? { status: 200, body: MISTRAL_LIVE }
          : url.includes('api.mistral.ai/v1/chat/completions')
            ? { status: 200, body: MISTRAL_COMPLETION }
            : url.includes('generativelanguage.googleapis.com/v1beta/models')
              ? { status: 200, body: GOOGLE_LIVE }
              : { status: 404, body: { error: 'unexpected url' } },
  );
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
    baseline: { projectId: 'test-ai-config' },
    projectMode: 'full-product',
    config: { envName: 'test', dataDir: dir, logLevel: 'warn' },
    project: { id: 'PROJ-000000', title: '', description: '' },
    stats: {},
    providerCalls: 0,
  } as unknown as DemoResult;
  const { app } = await buildServer({
    result,
    modelCatalogue: catalogue,
    providerManager: manager,
    openRouterFetchImpl: vendor.fetch,
    dataDir: dir,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    app,
    manager,
    url: `http://127.0.0.1:${port}`,
    vendorCalls: () => vendor.calls,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((r) => setTimeout(r, 30));
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup: Windows may still hold handles briefly
      }
    },
  };
}

async function until(fn: () => Promise<boolean>, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

interface ProjectView {
  id: string;
  title: string;
  aiConfig: { providerId: string; modelId: string; credentialId?: string } | null;
  stages: { stageId: string; status: string; providerId: string | null; modelId: string | null }[];
  aiOutputs: Record<string, { providerId: string; modelId: string; content: string }>;
}

async function getProject(url: string, cookie: string, id: string): Promise<ProjectView> {
  const res = await fetch(`${url}/api/projects/${id}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  return (await res.json()) as ProjectView;
}

describe('per-project AI configuration API (honest surface)', () => {
  it('/api/providers lists OpenAI/Anthropic/Google/Mistral as wired (not browse-only)', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_wired');
      const res = await fetch(`${s.url}/api/providers`, { headers: { cookie } });
      const { providers } = (await res.json()) as {
        providers: { providerId: string; wired: boolean; connectionVerified: boolean; configured: boolean }[];
      };
      for (const want of ['openrouter', 'openai', 'anthropic', 'google', 'mistral']) {
        const p = providers.find((x) => x.providerId === want);
        assert.ok(p, `expected provider ${want} in the list`);
        assert.equal(p.wired, true, `${want} must have a real execution adapter`);
        assert.equal(p.connectionVerified, false, `${want} starts unverified`);
        assert.equal(p.configured, false, `${want} starts unconfigured`);
      }
      assert.ok(providers.every((p) => p.wired !== false || p.providerId === 'local'));
    } finally {
      await s.close();
    }
  });

  it('create with a project AI config persists provider/model/credential and is echoed', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_persist');
      await fetch(`${s.url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'openai', secret: 'sk-real-key' }),
      });
      const verify = await fetch(`${s.url}/api/providers/openai/verify`, { method: 'POST', headers: { cookie } });
      assert.equal(verify.status, 200);
      assert.equal(((await verify.json()) as { success: boolean }).success, true);
      const creds = (await fetch(`${s.url}/api/credentials`, { headers: { cookie } }).then((r) => r.json())) as {
        credentials: { id: string; providerId: string; verified: boolean }[];
      };
      const openaiCred = creds.credentials.find((c) => c.providerId === 'openai');
      assert.ok(openaiCred);
      assert.equal(openaiCred.verified, true);

      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Wired project',
          vision: 'A product vision that will exercise the wired per-project AI configuration.',
          providerId: 'openai',
          modelId: 'gpt-4o',
          credentialId: openaiCred.id,
        }),
      });
      assert.equal(created.status, 201);
      const body = (await created.json()) as { project: { id: string }; aiConfig: { providerId: string; modelId: string; credentialId: string } };
      assert.deepEqual(body.aiConfig, { providerId: 'openai', modelId: 'gpt-4o', credentialId: openaiCred.id });

      // Auto-init: discovery EXECUTES through the wired openai adapter.
      const executed = await until(async () => {
        const p = await getProject(s.url, cookie, body.project.id);
        return p.stages.find((st) => st.stageId === 'discovery')?.status === 'EXECUTED';
      });
      assert.equal(executed, true, 'auto-init should run discovery through the verified project config');
      const p = await getProject(s.url, cookie, body.project.id);
      assert.equal(p.aiConfig?.providerId, 'openai');
      assert.equal(p.aiConfig?.modelId, 'gpt-4o');
      const discovery = p.stages.find((st) => st.stageId === 'discovery');
      assert.equal(discovery?.providerId, 'openai');
      assert.equal(discovery?.modelId, 'gpt-4o');
      assert.equal(p.aiOutputs['discovery']?.content, 'openai-wired-deliverable');
      assert.ok(s.vendorCalls().some((c) => c.url.includes('api.openai.com/v1/chat/completions')));
    } finally {
      await s.close();
    }
  });

  it('create with an AI config but no verified credential never fabricates work', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_pending');
      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Pending project',
          vision: 'A project bound to openai with no credential stored yet.',
          providerId: 'openai',
          modelId: 'gpt-4o',
        }),
      });
      assert.equal(created.status, 201);
      const { project, aiConfig } = (await created.json()) as { project: { id: string }; aiConfig: { providerId: string; modelId: string } | null };
      assert.deepEqual(aiConfig, { providerId: 'openai', modelId: 'gpt-4o' });
      const callsBefore = s.vendorCalls().length;
      const stillPending = await until(async () => {
        const p = await getProject(s.url, cookie, project.id);
        return p.stages.find((st) => st.stageId === 'discovery')?.status === 'PENDING';
      });
      assert.equal(stillPending, true);
      assert.equal(s.vendorCalls().length, callsBefore, 'no provider request is fabricated without a credential');
    } finally {
      await s.close();
    }
  });

  it('the run endpoint resolves the project AI config (real execution via vendor adapter)', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_run');
      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Run resolved project',
          vision: 'A project whose run resolves through the project-level AI configuration.',
          providerId: 'mistral',
          modelId: 'mistral-large-latest',
        }),
      });
      const { project } = (await created.json()) as { project: { id: string } };

      await fetch(`${s.url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'mistral', secret: 'mk-real-key' }),
      });
      const verify = await fetch(`${s.url}/api/providers/mistral/verify`, { method: 'POST', headers: { cookie } });
      assert.equal(verify.status, 200);

      const run = await fetch(`${s.url}/api/projects/${project.id}/run/discovery`, {
        method: 'POST',
        headers: { cookie },
      });
      assert.equal(run.status, 200);
      const body = (await run.json()) as { status: string; providerId: string; modelId: string; content: string };
      assert.equal(body.status, 'EXECUTED');
      assert.equal(body.providerId, 'mistral');
      assert.equal(body.modelId, 'mistral-large-latest');
      assert.equal(body.content, 'mistral-wired-deliverable');
    } finally {
      await s.close();
    }
  });

  it('validation rejects unknown providers, model-less configs, and foreign credentials', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_validate');
      const unknown = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Bad provider', vision: 'A vision for the validator.', providerId: 'acme', modelId: 'x' }),
      });
      assert.equal(unknown.status, 400);
      assert.match(((await unknown.json()) as { error: string }).error, /wired provider/);

      const noModel = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'No model', vision: 'A vision for the validator.', providerId: 'openai' }),
      });
      assert.equal(noModel.status, 400);
      assert.match(((await noModel.json()) as { error: string }).error, /modelId is required/);

      await fetch(`${s.url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'openai', secret: 'sk-any' }),
      });
      const creds = (await fetch(`${s.url}/api/credentials`, { headers: { cookie } }).then((r) => r.json())) as {
        credentials: { id: string; providerId: string }[];
      };
      const foreignCred = creds.credentials.find((c) => c.providerId === 'openai')!;
      const mismatched = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Mismatch',
          vision: 'A vision binding a credential to the wrong provider.',
          providerId: 'mistral',
          modelId: 'mistral-large-latest',
          credentialId: foreignCred.id,
        }),
      });
      assert.equal(mismatched.status, 400);
      assert.match(((await mismatched.json()) as { error: string }).error, /belongs to provider/);
    } finally {
      await s.close();
    }
  });

  it('PUT /api/projects/:id/ai-config sets and clears the configuration', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_put');
      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Configurable', vision: 'A vision for the configurable project here.' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      assert.equal((await getProject(s.url, cookie, project.id)).aiConfig, null);

      const set = await fetch(`${s.url}/api/projects/${project.id}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'openai', modelId: 'gpt-4o' }),
      });
      assert.equal(set.status, 200);
      assert.deepEqual(((await set.json()) as { aiConfig: unknown }).aiConfig, { providerId: 'openai', modelId: 'gpt-4o' });
      assert.deepEqual((await getProject(s.url, cookie, project.id)).aiConfig, { providerId: 'openai', modelId: 'gpt-4o' });

      const clear = await fetch(`${s.url}/api/projects/${project.id}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({}),
      });
      assert.equal(clear.status, 200);
      assert.equal(((await clear.json()) as { aiConfig: unknown }).aiConfig, null);
      assert.equal((await getProject(s.url, cookie, project.id)).aiConfig, null);
    } finally {
      await s.close();
    }
  });

  it('binding a model that does not exist in the catalogue is rejected (never silently substituted)', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_nomodel');
      const created = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'No such model', vision: 'A vision for the missing-model binding.' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const missing = await fetch(`${s.url}/api/projects/${project.id}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'openai', modelId: 'gpt-4o-nonexistent' }),
      });
      assert.equal(missing.status, 400);
      assert.match(((await missing.json()) as { error: string }).error, /not present in the catalogue/);
      assert.equal((await getProject(s.url, cookie, project.id)).aiConfig, null);
    } finally {
      await s.close();
    }
  });

  it('POST /api/credentials/:id/verify handles hosted providers (not just openrouter)', async () => {
    const s = await buildAiServer();
    try {
      const cookie = await signupEnrolledCookie(s.url, 'aicfg_credverify');
      const added = await fetch(`${s.url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ providerId: 'google', secret: 'AIza-test' }),
      });
      const { id } = (await added.json()) as { id: string };
      const verify = await fetch(`${s.url}/api/credentials/${id}/verify`, { method: 'POST', headers: { cookie } });
      assert.equal(verify.status, 200);
      assert.equal(((await verify.json()) as { success: boolean }).success, true);
      assert.ok(s.vendorCalls().some((c) => c.url.includes('generativelanguage.googleapis.com/v1beta/models')));
    } finally {
      await s.close();
    }
  });
});