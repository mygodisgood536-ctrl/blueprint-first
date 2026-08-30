import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelCatalogue } from '../src/ai/model-catalogue.ts';
import { ModelsDevSource, ProviderHttpError } from '../src/ai/models-dev-source.ts';
import { OpenRouterProvider, normalizeOpenRouterModel, parsePrice } from '../src/ai/openrouter-provider.ts';

/** Minimal fetch mock returning canned JSON responses per URL. */
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
    'anthropic': {
      id: 'anthropic',
      name: 'Anthropic',
      models: {
        'claude-sonnet-4-5': {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          reasoning: true,
          tool_call: true,
          structured_output: true,
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
        'mystery-model': {
          id: 'mystery-model',
          name: 'Mystery Model (no cost listed)',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 8192, output: 4096 },
        },
      },
    },
    'ollama': {
      id: 'ollama',
      name: 'Ollama',
      models: {
        'llama3.2': {
          id: 'llama3.2',
          name: 'Llama 3.2 (local)',
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 131072, output: 8192 },
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
        supported_parameters: ['tools', 'structured_outputs'],
      },
      {
        id: 'meta-llama/llama-3.2-3b-instruct:free',
        name: 'Meta: Llama 3.2 3B (free)',
        context_length: 131072,
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: ['tools'],
      },
    ],
  };
}

describe('models.dev source normalization', () => {
  it('normalizes providers and models with verified wire shape', () => {
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
      cacheTtlMs: 60_000,
    });
    return src.fetchCatalog().then((models) => {
      assert.equal(models.length, 4);
      const sonnet = models.find((m) => m.modelId === 'claude-sonnet-4-5');
      assert.ok(sonnet);
      assert.equal(sonnet.providerId, 'anthropic');
      assert.equal(sonnet.providerName, 'Anthropic');
      assert.equal(sonnet.accessCategory, 'paid');
      assert.equal(sonnet.inputCostPer1M, 3);
      assert.equal(sonnet.outputCostPer1M, 15);
      assert.equal(sonnet.contextLength, 200000);
      assert.equal(sonnet.capabilities.vision, true);
      assert.equal(sonnet.capabilities.reasoning, true);
      assert.equal(sonnet.capabilities.toolCalling, true);
      assert.equal(sonnet.metadata['source'], 'models.dev');
    });
  });

  it('classifies zero-cost as free_api_key_required (never free_no_api_key)', () => {
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
    });
    return src.fetchCatalog().then((models) => {
      const free = models.find((m) => m.modelId === 'claude-haiku-free');
      assert.ok(free);
      assert.equal(free.accessCategory, 'free_api_key_required');
      assert.equal(free.inputCostPer1M, 0);
      const local = models.find((m) => m.providerId === 'ollama');
      assert.ok(local);
      assert.equal(local.accessCategory, 'free_api_key_required');
    });
  });

  it('classifies missing cost as paid (pricing unknown is never free)', () => {
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
    });
    return src.fetchCatalog().then((models) => {
      const mystery = models.find((m) => m.modelId === 'mystery-model');
      assert.ok(mystery);
      assert.equal(mystery.accessCategory, 'paid');
      assert.equal(mystery.inputCostPer1M, null);
      assert.equal(mystery.outputCostPer1M, null);
    });
  });

  it('caches a successful fetch and reports cache freshness', () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
    const src = new ModelsDevSource({ fetchImpl: fetch as never, cacheTtlMs: 60_000 });
    assert.equal(src.cacheFresh, false);
    return src
      .fetchCatalog()
      .then(() => {
        assert.equal(src.cacheFresh, true);
        return src.fetchCatalog();
      })
      .then(() => {
        assert.equal(calls.length, 1, 'second fetch must be served from cache');
      });
  });

  it('clearCache forces a refetch', () => {
    const { calls, fetch } = mockFetch(() => ({ status: 200, body: modelsDevPayload() }));
    const src = new ModelsDevSource({ fetchImpl: fetch as never, cacheTtlMs: 60_000 });
    return src
      .fetchCatalog()
      .then(() => src.fetchCatalog())
      .then(() => {
        assert.equal(calls.length, 1);
        src.clearCache();
        assert.equal(src.cacheFresh, false);
        return src.fetchCatalog();
      })
      .then(() => {
        assert.equal(calls.length, 2);
      });
  });

  it('throws ProviderHttpError on HTTP failure', () => {
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 503, body: 'unavailable' })).fetch as never,
    });
    return src.fetchCatalog().then(
      () => assert.fail('expected rejection'),
      (err: unknown) => {
        assert.ok(err instanceof ProviderHttpError);
        assert.match((err as Error).message, /HTTP 503/);
      },
    );
  });

  it('throws ProviderHttpError on non-object payload', () => {
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: [1, 2, 3] })).fetch as never,
    });
    return src.fetchCatalog().then(
      () => assert.fail('expected rejection'),
      (err: unknown) => assert.ok(err instanceof ProviderHttpError),
    );
  });

  it('skips malformed provider and model entries instead of throwing', () => {
    const payload = {
      broken: null,
      alsonot: 'string',
      good: {
        id: 'good',
        name: 'Good',
        models: {
          m1: { id: 'm1', name: 'M1', cost: { input: 1, output: 2 } },
          bad: null,
          worse: 42,
        },
      },
    };
    const src = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: payload })).fetch as never,
    });
    return src.fetchCatalog().then((models) => {
      assert.equal(models.length, 1);
      assert.equal(models[0]?.modelId, 'm1');
    });
  });
});

describe('openrouter provider', () => {
  it('listModels normalizes verified wire shape (prices per token to per 1M)', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      fetchImpl: mockFetch(() => ({ status: 200, body: openRouterPayload() })).fetch as never,
    });
    return provider.listModels().then((models) => {
      assert.equal(models.length, 2);
      const gpt4o = models.find((m) => m.modelId === 'openai/gpt-4o');
      assert.ok(gpt4o);
      assert.equal(gpt4o.accessCategory, 'paid');
      assert.ok(Math.abs((gpt4o.inputCostPer1M ?? 0) - 2.5) < 1e-9);
      assert.ok(Math.abs((gpt4o.outputCostPer1M ?? 0) - 10) < 1e-9);
      assert.equal(gpt4o.contextLength, 128000);
      assert.equal(gpt4o.maxOutputTokens, 16384);
      assert.equal(gpt4o.capabilities.toolCalling, true);
      assert.equal(gpt4o.capabilities.structuredOutput, true);
      assert.equal(gpt4o.capabilities.vision, true);
      const free = models.find((m) => m.modelId === 'meta-llama/llama-3.2-3b-instruct:free');
      assert.ok(free);
      assert.equal(free.accessCategory, 'free_api_key_required');
    });
  });

  it('complete routes to the requested model with Bearer auth and no key leakage', () => {
    const { calls, fetch } = mockFetch(() => ({
      status: 200,
      body: {
        choices: [{ message: { content: 'hello from llama' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      },
    }));
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-secret-value',
      fetchImpl: fetch as never,
    });
    return provider
      .complete({
        taskType: 'DISCOVERY',
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        messages: [{ role: 'user', content: 'hi' }],
      })
      .then((res) => {
        assert.equal(res.content, 'hello from llama');
        assert.equal(res.providerId, 'openrouter');
        assert.equal(res.modelId, 'meta-llama/llama-3.2-3b-instruct:free');
        assert.equal(res.usage?.inputTokens, 11);
        assert.equal(res.usage?.outputTokens, 7);
        const call = calls[0];
        assert.ok(call);
        assert.match(call.url, /\/chat\/completions$/);
        assert.equal(call.headers['authorization'], 'Bearer sk-or-secret-value');
      });
  });

  it('complete rejects when no model is specified (honest routing)', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'k',
      fetchImpl: mockFetch(() => ({ status: 200, body: {} })).fetch as never,
    });
    return provider
      .complete({ taskType: 'DISCOVERY', messages: [{ role: 'user', content: 'hi' }] })
      .then(
        () => assert.fail('expected rejection'),
        (err: unknown) => assert.match((err as Error).message, /must specify a model/),
      );
  });

  it('verifyConnection succeeds via authenticated GET /key without spending tokens', () => {
    const { calls, fetch } = mockFetch(() => ({
      status: 200,
      body: { data: { label: 'my-key', usage: 0.42, limit: 20 } },
    }));
    const provider = new OpenRouterProvider({ apiKey: 'sk-or-live', fetchImpl: fetch as never });
    return provider.verifyConnection().then((result) => {
      assert.equal(result.success, true);
      assert.ok(result.latencyMs !== undefined);
      const call = calls[0];
      assert.ok(call);
      assert.match(call.url, /\/key$/);
      assert.equal(call.headers['authorization'], 'Bearer sk-or-live');
      assert.equal(provider.connectionVerified, true);
    });
  });

  it('verifyConnection records failure on 401 and never fakes success', () => {
    const { calls, fetch } = mockFetch(() => ({ status: 401, body: { error: 'bad key' } }));
    const provider = new OpenRouterProvider({ apiKey: 'sk-or-bad', fetchImpl: fetch as never });
    return provider.verifyConnection().then((result) => {
      assert.equal(result.success, false);
      assert.match(result.errorMessage ?? '', /HTTP 401/);
      assert.equal(provider.connectionVerified, false);
      assert.equal(calls.length, 1);
    });
  });

  it('info reports configured from key presence, never fabricates verification', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-x',
      fetchImpl: mockFetch(() => ({ status: 500, body: {} })).fetch as never,
    });
    assert.equal(provider.info.configured, true);
    assert.equal(provider.info.connectionVerified, false);
    assert.equal(provider.info.lastConnectionResult, null);
  });
});

describe('model catalogue', () => {
  it('merges two sources into a deduplicated catalogue with provenance', () => {
    const md = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
    });
    const or = new OpenRouterProvider({
      apiKey: 'k',
      fetchImpl: mockFetch(() => ({ status: 200, body: openRouterPayload() })).fetch as never,
    });
    const catalogue = new ModelCatalogue({ modelsDevSource: md, openRouterProvider: or });
    return catalogue.getAllModels().then((all) => {
      assert.equal(all.length, 6); // 4 from models.dev + 2 from openrouter
      const gpt4o = all.find((m) => m.providerId === 'openrouter' && m.modelId === 'openai/gpt-4o');
      assert.ok(gpt4o);
      assert.deepEqual(gpt4o.sources, ['openrouter']);
      const llama = all.find((m) => m.providerId === 'ollama' && m.modelId === 'llama3.2');
      assert.ok(llama);
      assert.deepEqual(llama.sources, ['models.dev']);
    });
  });

  it('marks models verified ONLY after a real connection test succeeds', () => {
    const or = new OpenRouterProvider({
      apiKey: 'k',
      fetchImpl: mockFetch((url) =>
        url.endsWith('/key')
          ? { status: 200, body: { data: { label: 'k' } } }
          : { status: 200, body: openRouterPayload() },
      ).fetch as never,
    });
    const catalogue = new ModelCatalogue({ openRouterProvider: or });
    return catalogue.getAllModels().then((before) => {
      for (const m of before) assert.equal(m.verified, false, 'unverified before connection test');
      return or
        .verifyConnection()
        .then(() => catalogue.getAllModels())
        .then((after) => {
          const gpt4o = after.find((m) => m.providerId === 'openrouter' && m.modelId === 'openai/gpt-4o');
          assert.ok(gpt4o);
          assert.equal(gpt4o.verified, true);
        });
    });
  });

  it('search filters by search term, category, and capability', () => {
    const md = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
    });
    const catalogue = new ModelCatalogue({ modelsDevSource: md });
    return catalogue.search({ searchTerm: 'claude' }).then((r1) => {
      assert.equal(r1.total, 2); // sonnet + haiku
      return catalogue.search({ accessCategories: ['free_api_key_required'] }).then((r2) => {
        assert.equal(r2.total, 2); // haiku-free + ollama llama
        return catalogue.search({ capabilities: { vision: true } }).then((r3) => {
          assert.equal(r3.total, 1); // only sonnet accepts images
          return catalogue.search({ maxInputCostPer1M: 3 }).then((r4) => {
            assert.equal(r4.total, 3); // sonnet (3) + two zero-cost models
          });
        });
      });
    });
  });

  it('applies Blueprint-First overrides last and only to explicit models', () => {
    const md = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 200, body: modelsDevPayload() })).fetch as never,
    });
    const catalogue = new ModelCatalogue({
      modelsDevSource: md,
      accessOverrides: [
        { providerId: 'anthropic', modelId: 'claude-haiku-free', accessCategory: 'free_no_api_key' },
      ],
    });
    return catalogue.getModelsByCategory('free_no_api_key').then((noKey) => {
      assert.equal(noKey.length, 1);
      assert.equal(noKey[0]?.modelId, 'claude-haiku-free');
      return catalogue.getModel('anthropic', 'claude-sonnet-4-5').then((sonnet) => {
        assert.equal(sonnet?.accessCategory, 'paid'); // untouched by the override
      });
    });
  });

  it('degrades gracefully when one source fails; throws only when all fail', () => {
    const md = new ModelsDevSource({
      fetchImpl: mockFetch(() => ({ status: 503, body: 'down' })).fetch as never,
    });
    const or = new OpenRouterProvider({
      apiKey: 'k',
      fetchImpl: mockFetch(() => ({ status: 200, body: openRouterPayload() })).fetch as never,
    });
    const catalogue = new ModelCatalogue({ modelsDevSource: md, openRouterProvider: or });
    return catalogue.getAllModels().then((all) => {
      assert.equal(all.length, 2); // openrouter still served despite md failure
      const allFail = new ModelCatalogue({
        modelsDevSource: md,
        openRouterProvider: new OpenRouterProvider({
          apiKey: 'k',
          fetchImpl: mockFetch(() => ({ status: 500, body: {} })).fetch as never,
        }),
      });
      return allFail.getAllModels().then(
        () => assert.fail('expected rejection'),
        (err: unknown) => assert.ok(err instanceof Error),
      );
    });
  });

  it('getStats aggregates category, provider, and verified counts', () => {
    const or = new OpenRouterProvider({
      apiKey: 'k',
      fetchImpl: mockFetch(() => ({ status: 200, body: openRouterPayload() })).fetch as never,
    });
    const catalogue = new ModelCatalogue({ openRouterProvider: or });
    return catalogue.getStats().then((stats) => {
      assert.equal(stats.totalModels, 2);
      assert.equal(stats.byCategory['free_api_key_required'], 1);
      assert.equal(stats.byCategory['paid'], 1);
      assert.equal(stats.verifiedCount, 0);
      assert.equal(stats.sourceCount, 1);
      assert.equal(stats.byProvider['openrouter'], 2);
    });
  });
});

describe('shared helpers', () => {
  it('parsePrice parses OpenRouter string prices and rejects junk', () => {
    assert.equal(parsePrice('0.0000025'), 0.0000025);
    assert.equal(parsePrice('0'), 0);
    assert.equal(parsePrice('0'), 0);
    assert.equal(parsePrice(undefined), null);
    assert.equal(parsePrice(42), null);
    assert.equal(parsePrice('not-a-number'), null);
  });

  it('normalizeOpenRouterModel defaults safely on partial entries', () => {
    const m = normalizeOpenRouterModel({ id: 'x/y' });
    assert.equal(m.modelId, 'x/y');
    assert.equal(m.name, 'x/y');
    assert.equal(m.contextLength, 0);
    assert.equal(m.inputCostPer1M, null);
    assert.equal(m.capabilities.vision, false);
  });
});
