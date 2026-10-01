import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HostedProvider,
  HOSTED_PROVIDER_META,
  hostedMetaFor,
  WIRED_HOSTED_PROVIDER_IDS,
} from '../src/ai/hosted-providers.ts';
import type { FetchFn } from '../src/ai/openrouter-provider.ts';
import type { AiCompletionRequest } from '../src/ai/types.ts';

/** Canned-fetch helper (same structural contract the web layer injects). */
function mockFetch(
  responder: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    status: number;
    body: unknown;
  },
): { calls: { url: string; method: string; headers: Record<string, string>; body?: string }[]; fetch: FetchFn } {
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

const OPENAI_MODELS = { data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'gpt-4o-mini', owned_by: 'openai' }] };
const ANTHROPIC_MODELS = { data: [{ type: 'model', id: 'claude-3-5-sonnet-latest', display_name: 'Claude 3.5 Sonnet' }] };
const GOOGLE_MODELS = { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1000000, outputTokenLimit: 8192 }] };
const MISTRAL_MODELS = { object: 'list', data: [{ id: 'mistral-large-latest', description: 'Large' }] };

const baseRequest: AiCompletionRequest = {
  taskType: 'DISCOVERY',
  messages: [
    { role: 'system', content: 'You are the project engine.' },
    { role: 'user', content: 'Produce the discovery deliverable.' },
  ],
  model: 'gpt-4o',
};

describe('hosted provider adapters (real HTTP adapters, mocked transport)', () => {
  it('HOSTED_PROVIDER_META lists exactly the four wired vendors with api_key auth', () => {
    assert.deepEqual([...WIRED_HOSTED_PROVIDER_IDS], ['openai', 'anthropic', 'google', 'mistral']);
    for (const meta of HOSTED_PROVIDER_META) {
      assert.equal(meta.authMethod, 'api_key');
      assert.ok(meta.baseUrl.startsWith('https://'));
    }
    assert.equal(hostedMetaFor('openai')?.name, 'OpenAI');
    assert.equal(hostedMetaFor('acme'), undefined);
  });

  it('openai verifyConnection succeeds via authenticated GET /models and reports the count', async () => {
    const m = mockFetch(() => ({ status: 200, body: OPENAI_MODELS }));
    const p = new HostedProvider(hostedMetaFor('openai')!, { apiKey: 'sk-test', fetchImpl: m.fetch });
    const result = await p.verifyConnection();
    assert.equal(result.success, true);
    assert.equal(result.modelsAvailable, 2);
    assert.ok(m.calls.length === 1);
    assert.equal(m.calls[0]!.url, 'https://api.openai.com/v1/models');
    assert.equal(m.calls[0]!.method, 'GET');
    assert.equal(m.calls[0]!.headers['authorization'], 'Bearer sk-test');
    assert.equal(p.connectionVerified, true);
  });

  it('anthropic verifyConnection sends x-api-key + anthropic-version', async () => {
    const m = mockFetch(() => ({ status: 200, body: ANTHROPIC_MODELS }));
    const p = new HostedProvider(hostedMetaFor('anthropic')!, { apiKey: 'sk-ant', fetchImpl: m.fetch });
    const result = await p.verifyConnection();
    assert.equal(result.success, true);
    assert.equal(m.calls[0]!.headers['x-api-key'], 'sk-ant');
    assert.equal(m.calls[0]!.headers['anthropic-version'], '2023-06-01');
    assert.equal(result.modelsAvailable, 1);
  });

  it('google verifyConnection sends x-goog-api-key', async () => {
    const m = mockFetch(() => ({ status: 200, body: GOOGLE_MODELS }));
    const p = new HostedProvider(hostedMetaFor('google')!, { apiKey: 'AIza-test', fetchImpl: m.fetch });
    assert.equal((await p.verifyConnection()).success, true);
    assert.equal(m.calls[0]!.headers['x-goog-api-key'], 'AIza-test');
  });

  it('verifyConnection failure is recorded honestly (real 401, no fabricated success)', async () => {
    const m = mockFetch(() => ({ status: 401, body: { error: { message: 'Incorrect API key provided' } } }));
    const p = new HostedProvider(hostedMetaFor('openai')!, { apiKey: 'sk-bad', fetchImpl: m.fetch });
    const result = await p.verifyConnection();
    assert.equal(result.success, false);
    assert.match(String(result.errorMessage), /401/);
    assert.equal(p.connectionVerified, false);
  });

  it('openai (OpenAI-compatible) complete() shapes the request and parses the response', async () => {
    const m = mockFetch(() => ({
      status: 200,
      body: {
        choices: [{ message: { content: 'discovery deliverable text' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      },
    }));
    const p = new HostedProvider(hostedMetaFor('openai')!, { apiKey: 'sk-test', fetchImpl: m.fetch });
    const res = await p.complete(baseRequest);
    assert.equal(res.content, 'discovery deliverable text');
    assert.equal(res.providerId, 'openai');
    assert.equal(res.modelId, 'gpt-4o');
    assert.equal(res.usage?.inputTokens, 12);
    const parsed = JSON.parse(m.calls[0]!.body!) as { model: string; messages: unknown[] };
    assert.equal(parsed.model, 'gpt-4o');
    assert.equal(parsed.messages.length, 2);
    assert.equal(m.calls[0]!.url, 'https://api.openai.com/v1/chat/completions');
  });

  it('mistral complete() reuses the OpenAI-compatible shape against its base URL', async () => {
    const m = mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } }));
    const p = new HostedProvider(hostedMetaFor('mistral')!, { apiKey: 'mk-test', fetchImpl: m.fetch });
    const res = await p.complete({ ...baseRequest, model: 'mistral-large-latest' });
    assert.equal(res.providerId, 'mistral');
    assert.ok(m.calls[0]!.url.startsWith('https://api.mistral.ai/v1/chat/completions'));
  });

  it('anthropic complete() splits the system prompt and requires max_tokens', async () => {
    const m = mockFetch(() => ({
      status: 200,
      body: {
        content: [{ type: 'text', text: 'claude deliverable' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 9 },
      },
    }));
    const p = new HostedProvider(hostedMetaFor('anthropic')!, { apiKey: 'sk-ant', fetchImpl: m.fetch });
    const res = await p.complete({ ...baseRequest, model: 'claude-3-5-sonnet-latest' });
    assert.equal(res.content, 'claude deliverable');
    const parsed = JSON.parse(m.calls[0]!.body!) as { system: string; messages: unknown[]; max_tokens: number };
    assert.equal(parsed.system, 'You are the project engine.');
    assert.deepEqual(parsed.messages, [{ role: 'user', content: 'Produce the discovery deliverable.' }]);
    assert.equal(parsed.max_tokens, 2048);
    assert.equal(m.calls[0]!.url, 'https://api.anthropic.com/v1/messages');
  });

  it('google complete() maps roles to user/model and sends systemInstruction', async () => {
    const m = mockFetch(() => ({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'gemini deliverable' }] }, finishReason: 'STOP' }] },
    }));
    const p = new HostedProvider(hostedMetaFor('google')!, { apiKey: 'AIza-test', fetchImpl: m.fetch });
    const res = await p.complete({ ...baseRequest, model: 'gemini-2.5-flash', maxTokens: 512 });
    assert.equal(res.content, 'gemini deliverable');
    const parsed = JSON.parse(m.calls[0]!.body!) as {
      contents: { role: string; parts: { text: string }[] }[];
      systemInstruction: { parts: { text: string }[] };
      generationConfig: { maxOutputTokens: number };
    };
    assert.equal(parsed.contents[0]!.role, 'user');
    assert.equal(parsed.systemInstruction.parts[0]!.text, 'You are the project engine.');
    assert.equal(parsed.generationConfig.maxOutputTokens, 512);
    assert.equal(
      m.calls[0]!.url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
  });

  it('complete() throws an honest ProviderHttpError when upstream rejects with a bad key', async () => {
    const m = mockFetch(() => ({ status: 401, body: { error: { message: 'invalid key' } } }));
    const p = new HostedProvider(hostedMetaFor('openai')!, { apiKey: 'sk-bad', fetchImpl: m.fetch });
    await assert.rejects(() => p.complete(baseRequest), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /401/);
      return true;
    });
  });

  it('complete() requires an explicit model', async () => {
    const m = mockFetch(() => ({ status: 200, body: { choices: [] } }));
    const p = new HostedProvider(hostedMetaFor('openai')!, { apiKey: 'sk-test', fetchImpl: m.fetch });
    await assert.rejects(() => p.complete({ ...baseRequest, model: undefined }), /must specify a model/);
  });

  it('listModels() normalizes each provider payload shape into ModelInfo rows', async () => {
    const mk = (body: unknown): HostedProvider => {
      const m = mockFetch(() => ({ status: 200, body }));
      const meta = hostedMetaFor(body === GOOGLE_MODELS ? 'google' : body === ANTHROPIC_MODELS ? 'anthropic' : body === MISTRAL_MODELS ? 'mistral' : 'openai')!;
      return new HostedProvider(meta, { apiKey: 'k', fetchImpl: m.fetch });
    };
    const openai = await mk(OPENAI_MODELS).listModels();
    assert.equal(openai[0]!.modelId, 'gpt-4o');
    const anthropic = await mk(ANTHROPIC_MODELS).listModels();
    assert.equal(anthropic[0]!.modelId, 'claude-3-5-sonnet-latest');
    assert.equal(anthropic[0]!.accessCategory, 'paid');
    const google = await mk(GOOGLE_MODELS).listModels();
    assert.equal(google[0]!.modelId, 'gemini-2.5-flash'); // 'models/' prefix stripped
    const mistral = await mk(MISTRAL_MODELS).listModels();
    assert.equal(mistral[0]!.modelId, 'mistral-large-latest');
    assert.ok(openai.every((m) => m.providerId === 'openai'));
  });
});