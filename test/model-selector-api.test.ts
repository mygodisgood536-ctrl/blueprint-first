import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import { buildServer } from '../src/web/server.ts';
import { ModelCatalogue } from '../src/ai/model-catalogue.ts';
import { ModelsDevSource } from '../src/ai/models-dev-source.ts';
import { OpenRouterProvider } from '../src/ai/openrouter-provider.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupCookie, tempDataDir } from './helpers.ts';

/** Minimal fetch mock returning canned responses per URL. */
function mockFetch(
  responder: (url: string, init: { method: string; headers: Record<string, string> }) => {
    status: number;
    body: unknown;
  },
): { calls: { url: string; method: string; headers: Record<string, string> }[]; fetch: unknown } {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetch = (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method, headers: init.headers });
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
        'claude-sonnet-4-5': {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 200000, output: 64000 },
          cost: { input: 3, output: 15 },
        },
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

describe('model selector API (honest surface, per-user isolation)', () => {
  it('serves the catalogue over GET /api/models with filters', async () => {
    const { url, close } = await buildTestServer();
    try {
      const all = (await (await fetch(`${url}/api/models`)).json()) as { total: number };
      assert.equal(all.total, 3);
      const filtered = (await (
        await fetch(`${url}/api/models?q=claude&accessCategory=paid`)
      ).json()) as { total: number };
      assert.equal(filtered.total, 1);
      const local = (await (
        await fetch(`${url}/api/models?accessCategory=local`)
      ).json()) as { total: number };
      assert.equal(local.total, 0); // local models come from the runtime, not these sources
      const stats = (await (await fetch(`${url}/api/models/stats`)).json()) as { totalModels: number };
      assert.equal(stats.totalModels, 3);
    } finally {
      await close();
    }
  });

  it('reports 502 when every catalogue source fails (no silent empty catalogue)', async () => {
    const failingMd = mockFetch(() => ({ status: 503, body: 'down' }));
    const failingOr = mockFetch(() => ({ status: 500, body: {} }));
    const catalogue = new ModelCatalogue({
      modelsDevSource: new ModelsDevSource({ fetchImpl: failingMd.fetch as never }),
      openRouterProvider: new OpenRouterProvider({ apiKey: 'k', fetchImpl: failingOr.fetch as never }),
    });
    const { app } = await buildServer({
      result: { baseline: { projectId: 'p' } } as unknown as DemoResult,
      modelCatalogue: catalogue,
      providerManager: new ProviderManager(),
      dataDir: await tempDataDir(),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/models`);
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: string };
      assert.ok(body.error.length > 0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns 404 for an unknown model and 401 without a session cookie on selection', async () => {
    const { url, close } = await buildTestServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const missing = await fetch(`${url}/api/models/anthropic/nope`);
      assert.equal(missing.status, 404);
      const noUser = await fetch(`${url}/api/models/selection`);
      assert.equal(noUser.status, 401);
      const withUser = await fetch(`${url}/api/models/selection`, {
        headers: { cookie: alice },
      });
      assert.equal(withUser.status, 200);
      assert.equal(((await withUser.json()) as { selection: unknown }).selection, null);
    } finally {
      await close();
    }
  });

  it('adds a credential without ever echoing the secret; isolates users', async () => {
    const { url, close } = await buildTestServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const bob = await signupCookie(url, 'bob');
      const created = await fetch(`${url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'openrouter', secret: 'sk-or-alice-secret-123' }),
      });
      assert.equal(created.status, 201);
      const ref = (await created.json()) as { id: string; verified: boolean };
      assert.equal(JSON.stringify(ref).includes('sk-or-alice-secret-123'), false);
      assert.equal(ref.verified, false);
      const bobList = await fetch(`${url}/api/credentials`, { headers: { cookie: bob } });
      assert.equal(((await bobList.json()) as { credentials: unknown[] }).credentials.length, 0);
      const bobDelete = await fetch(`${url}/api/credentials/${ref.id}`, {
        method: 'DELETE',
        headers: { cookie: bob },
      });
      assert.equal(bobDelete.status, 404); // bob cannot touch alice's credential
      const aliceDelete = await fetch(`${url}/api/credentials/${ref.id}`, {
        method: 'DELETE',
        headers: { cookie: alice },
      });
      assert.equal(aliceDelete.status, 204);
    } finally {
      await close();
    }
  });

  it('verifies a credential via a REAL key check and records the outcome', async () => {
    const { url, close } = await buildTestServer({ status: 200, body: { data: { label: 'k' } } });
    try {
      const alice = await signupCookie(url, 'alice');
      const created = await fetch(`${url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'openrouter', secret: 'sk-or-real' }),
      });
      const ref = (await created.json()) as { id: string };
      const verify = await fetch(`${url}/api/credentials/${ref.id}/verify`, {
        method: 'POST',
        headers: { cookie: alice },
      });
      assert.equal(verify.status, 200);
      assert.equal(((await verify.json()) as { success: boolean }).success, true);
      const list = await fetch(`${url}/api/credentials`, { headers: { cookie: alice } });
      const creds = ((await list.json()) as { credentials: { verified: boolean }[] }).credentials;
      assert.equal(creds[0]!.verified, true);
    } finally {
      await close();
    }
  });

  it('verify reports failure honestly on 401 (verified stays false)', async () => {
    const { url, close } = await buildTestServer({ status: 401, body: { message: 'No auth' } });
    try {
      const dave = await signupCookie(url, 'dave');
      const created = await fetch(`${url}/api/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: dave },
        body: JSON.stringify({ providerId: 'openrouter', secret: 'sk-or-bad' }),
      });
      const ref = (await created.json()) as { id: string };
      const verify = await fetch(`${url}/api/credentials/${ref.id}/verify`, {
        method: 'POST',
        headers: { cookie: dave },
      });
      assert.equal(verify.status, 200);
      const outcome = (await verify.json()) as { success: boolean; errorMessage?: string };
      assert.equal(outcome.success, false);
      assert.ok(outcome.errorMessage);
      const list = await fetch(`${url}/api/credentials`, { headers: { cookie: dave } });
      const creds = ((await list.json()) as { credentials: { verified: boolean; lastError: string | null }[] }).credentials;
      assert.equal(creds[0]!.verified, false);
      assert.ok(creds[0]!.lastError);
    } finally {
      await close();
    }
  });

  it('selects a local model only via the real verification path', async () => {
    const { url, close } = await buildTestServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const bob = await signupCookie(url, 'bob');
      const missing = await fetch(`${url}/api/models/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'not-installed' }),
      });
      assert.equal(missing.status, 409);
      assert.match(((await missing.json()) as { error: string }).error, /not usable/);
      const ok = await fetch(`${url}/api/models/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'llama3.2' }),
      });
      assert.equal(ok.status, 200);
      const state = (await ok.json()) as { status: string; modelId: string };
      assert.equal(state.status, 'connected');
      assert.equal(state.modelId, 'llama3.2');
      const selection = await fetch(`${url}/api/models/selection`, {
        headers: { cookie: alice },
      });
      assert.equal(
        ((await selection.json()) as { selection: { modelId: string } | null }).selection?.modelId,
        'llama3.2',
      );
      const bobSel = await fetch(`${url}/api/models/selection`, { headers: { cookie: bob } });
      assert.equal(((await bobSel.json()) as { selection: unknown }).selection, null); // per-user
    } finally {
      await close();
    }
  });

  it('select with openrouter without a credential returns 409 (CONFIGURED != AVAILABLE)', async () => {
    const { url, close } = await buildTestServer();
    try {
      const erin = await signupCookie(url, 'erin');
      const response = await fetch(`${url}/api/models/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: erin },
        body: JSON.stringify({ providerId: 'openrouter', modelId: 'openai/gpt-4o' }),
      });
      assert.equal(response.status, 409);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /CONFIGURED does not mean AVAILABLE/,
      );
    } finally {
      await close();
    }
  });

  it('select for an unimplemented provider reports 501 honestly (no fake success)', async () => {
    const { url, close } = await buildTestServer();
    try {
      const frank = await signupCookie(url, 'frank');
      const response = await fetch(`${url}/api/models/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: frank },
        body: JSON.stringify({ providerId: 'anthropic-direct', modelId: 'claude-3' }),
      });
      assert.equal(response.status, 501);
      assert.match(((await response.json()) as { error: string }).error, /not implemented yet/);
    } finally {
      await close();
    }
  });
});
/** Builds the server with injected doubles (no live pipeline, no network). */
async function buildTestServer(openRouterKeyFetch?: { status: number; body: unknown }): Promise<{
  app: Express;
  close: () => Promise<void>;
  url: string;
  providerManager: ProviderManager;
}> {
  const md = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
  const or = mockFetch(() => ({ status: 200, body: openRouterPayload() }));
  const catalogue = new ModelCatalogue({
    modelsDevSource: new ModelsDevSource({ fetchImpl: md.fetch as never }),
    openRouterProvider: new OpenRouterProvider({ apiKey: 'sk-or-test-key-xyz', fetchImpl: or.fetch as never }),
  });
  const manager = new ProviderManager();
  const localUp = mockFetch((url) =>
    url.endsWith('/models')
      ? { status: 200, body: localModelsPayload() }
      : { status: 200, body: { choices: [{ message: { content: 'ok' } }] } },
  );
  manager.setLocalRuntime({ baseUrl: 'http://127.0.0.1:11434/v1' }, localUp.fetch);
  const { app } = await buildServer({
    result: { baseline: { projectId: 'demo-project' } } as unknown as DemoResult,
    modelCatalogue: catalogue,
    providerManager: manager,
    openRouterFetchImpl: mockFetch(() =>
      openRouterKeyFetch ?? { status: 200, body: { data: { label: 'k' } } },
    ).fetch,
    dataDir: await tempDataDir(),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    app,
    providerManager: manager,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}