import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalProvider,
  localProviderStatus,
  normalizeLocalModel,
} from '../src/ai/local-provider.ts';
import {
  CredentialStore,
  sha256,
  safeEqual,
} from '../src/ai/credential-store.ts';
import {
  ProviderManager,
  providerStatusFromFailure,
} from '../src/ai/provider-manager.ts';
import { AiRouter } from '../src/ai/router.ts';
import type { ConnectionTestResult } from '../src/ai/provider-metadata.ts';

/** Minimal fetch mock returning canned responses per URL/method. */
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

function localModelsPayload(): unknown {
  return {
    object: 'list',
    data: [
      { id: 'llama3.2', object: 'model', details: { family: 'llama' } },
      { id: 'qwen2.5-coder', object: 'model', context_length: 32768 },
    ],
  };
}

describe('local provider (real no-key access path)', () => {
  it('completes against request.model with no auth header and echoes identity', () => {
    const { calls, fetch } = mockFetch((url) =>
      url.endsWith('/chat/completions')
        ? {
            status: 200,
            body: {
              choices: [{ message: { content: 'local says hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 7, completion_tokens: 3 },
            },
          }
        : { status: 404, body: {} },
    );
    const provider = new LocalProvider({ baseUrl: 'http://127.0.0.1:11434/v1/', fetchImpl: fetch as never });
    return provider
      .complete({
        taskType: 'DISCOVERY',
        messages: [{ role: 'user', content: 'hello' }],
        model: 'llama3.2',
      })
      .then((response) => {
        assert.equal(response.content, 'local says hi');
        assert.equal(response.providerId, 'local');
        assert.equal(response.modelId, 'llama3.2');
        assert.equal(response.usage?.inputTokens, 7);
        assert.equal(response.usage?.outputTokens, 3);
        assert.equal(calls[0]!.headers['authorization'], undefined); // no key involved
      });
  });

  it('refuses to guess a model when none is requested or configured', () => {
    const provider = new LocalProvider({
      baseUrl: 'http://127.0.0.1:11434/v1',
      fetchImpl: mockFetch(() => ({ status: 200, body: {} })).fetch as never,
    });
    return provider
      .complete({ taskType: 'BUILD', messages: [{ role: 'user', content: 'x' }] })
      .then(
        () => assert.fail('expected rejection'),
        (err: unknown) => assert.match((err as Error).message, /must specify a model/),
      );
  });

  it('discovers models live and verifies key-free; records failure honestly when down', () => {
    const up = new LocalProvider({
      baseUrl: 'http://127.0.0.1:11434/v1',
      fetchImpl: mockFetch(() => ({ status: 200, body: localModelsPayload() })).fetch as never,
    });
    const down = new LocalProvider({
      baseUrl: 'http://127.0.0.1:9999/v1',
      fetchImpl: mockFetch(() => ({ status: 503, body: 'down' })).fetch as never,
    });
    return up.listModels().then((models) => {
      assert.equal(models.length, 2);
      const llama = models.find((m) => m.modelId === 'llama3.2');
      assert.ok(llama);
      assert.equal(llama.accessCategory, 'local');
      assert.equal(llama.providerName, 'Ollama (local)');
      assert.equal(llama.metadata['source'], 'local-runtime');
      return up.verifyConnection().then((ok) => {
        assert.equal(ok.success, true);
        assert.equal(ok.modelsAvailable, 2);
        assert.equal(up.connectionVerified, true);
        return down.verifyConnection().then((failed) => {
          assert.equal(failed.success, false);
          assert.ok(failed.errorMessage);
          assert.equal(down.connectionVerified, false);
        });
      });
    });
  });

  it('maps failures to the honest status taxonomy', () => {
    const missing = mockFetch(() => ({ status: 200, body: localModelsPayload() }));
    return localProviderStatus('http://127.0.0.1:11434/v1', missing.fetch as never, {
      modelId: 'not-installed',
    }).then((s1) => {
      assert.equal(s1.status, 'model_unavailable');
      assert.match(s1.detail ?? '', /not-installed/);
      return localProviderStatus('http://x/v1', mockFetch(() => ({ status: 401, body: {} })).fetch as never).then((s2) => {
        assert.equal(s2.status, 'auth_required');
        return localProviderStatus('http://x/v1', mockFetch(() => ({ status: 429, body: {} })).fetch as never).then((s3) => {
          assert.equal(s3.status, 'rate_limited');
          return localProviderStatus('http://x/v1', () => Promise.reject(new Error('ECONNREFUSED')) as never).then((s4) => {
            assert.equal(s4.status, 'provider_unavailable');
          });
        });
      });
    });
  });

  it('normalizeLocalModel tolerates partial entries', () => {
    const m = normalizeLocalModel({ id: 'x' }, 'lmstudio');
    assert.equal(m.providerName, 'LM Studio (local)');
    assert.equal(m.contextLength, 0);
    assert.equal(m.capabilities.vision, false);
  });
});

describe('credential store (per-user isolation, secrets never exposed)', () => {
  it('adds, lists, and never returns the secret from any reference', () => {
    const store = new CredentialStore();
    const ref = store.addCredential('alice', 'openrouter', 'sk-or-alice-secret');
    assert.equal(ref.providerId, 'openrouter');
    assert.equal(ref.verified, false);
    const serialized = JSON.stringify(ref);
    assert.equal(serialized.includes('sk-or-alice-secret'), false);
    assert.equal(store.listCredentials('alice').length, 1);
    assert.equal(store.countForUser('alice'), 1);
  });

  it('isolates users: another user cannot see, resolve, or remove a credential', () => {
    const store = new CredentialStore();
    const ref = store.addCredential('alice', 'openrouter', 'sk-or-alice-secret');
    assert.equal(store.listCredentials('bob').length, 0);
    assert.equal(store.countForUser('bob'), 0);
    assert.throws(() => store.getReference('bob', ref.id), /does not exist/);
    assert.throws(() => store.resolveSecret('bob', ref.id), /does not exist/);
    assert.throws(() => store.removeCredential('bob', ref.id), /does not exist/);
    assert.throws(() => store.markVerified('bob', ref.id, true), /does not exist/);
    assert.equal(store.resolveUserId(ref.id), 'alice'); // ownership stays intact
    assert.equal(store.resolveSecret('alice', ref.id), 'sk-or-alice-secret');
  });

  it('rejects duplicates per user+provider and enforces non-empty inputs', () => {
    const store = new CredentialStore();
    store.addCredential('alice', 'openrouter', 'key-1');
    assert.throws(() => store.addCredential('alice', 'openrouter', 'key-2'), /already has a credential/);
    // Same provider for a different user is fine (isolation, not global uniqueness).
    const bobRef = store.addCredential('bob', 'openrouter', 'key-3');
    assert.equal(bobRef.providerId, 'openrouter');
    assert.throws(() => store.addCredential('carol', 'openrouter', '   '), /non-empty/);
    assert.throws(() => store.addCredential('', 'openrouter', 'k'), /non-empty/);
  });

  it('supports replace, remove, and hash-based verification without exposure', () => {
    const store = new CredentialStore();
    const ref = store.addCredential('alice', 'openrouter', 'old-key');
    const replaced = store.replaceCredential('alice', ref.id, 'new-key');
    assert.equal(replaced.verified, false); // rotation resets verification honestly
    assert.equal(store.resolveSecret('alice', ref.id), 'new-key');
    assert.equal(store.verifyHash('alice', ref.id, 'new-key'), true);
    assert.equal(store.verifyHash('alice', ref.id, 'old-key'), false);
    assert.equal(store.verifyHash('bob', ref.id, 'new-key'), false);
    store.removeCredential('alice', ref.id);
    assert.equal(store.countForUser('alice'), 0);
    assert.throws(() => store.resolveSecret('alice', ref.id), /does not exist/);
  });

  it('markVerified records the honest outcome on the reference only', () => {
    const store = new CredentialStore();
    const ref = store.addCredential('alice', 'openrouter', 'k');
    const failed = store.markVerified('alice', ref.id, false, 'HTTP 401');
    assert.equal(failed.verified, false);
    assert.equal(failed.lastError, 'HTTP 401');
    const ok = store.markVerified('alice', ref.id, true);
    assert.equal(ok.verified, true);
    assert.equal(ok.lastError, null);
  });

  it('sha256/safeEqual behave as cryptographic helpers', () => {
    assert.equal(sha256('abc'), sha256('abc'));
    assert.notEqual(sha256('abc'), sha256('abd'));
    assert.equal(safeEqual('x', 'x'), true);
    assert.equal(safeEqual('x', 'y'), false);
    assert.equal(safeEqual('x', 'xy'), false);
  });
});

describe('provider manager (honest selection lifecycle)', () => {
  function keyCheckBody(): unknown {
    return { data: { label: 'k', limit: null, usage: 0 } };
  }

  it('configures a local runtime; verification requires a REAL request', () => {
    const manager = new ProviderManager();
    manager.setLocalRuntime(
      { baseUrl: 'http://127.0.0.1:11434/v1' },
      mockFetch(() => ({ status: 200, body: localModelsPayload() })).fetch,
    );
    assert.equal(manager.getLocalRuntime()!.info.connectionVerified, false);
    return manager.selectLocalModel('alice', 'llama3.2').then((state) => {
      assert.equal(state.status, 'connected');
      assert.equal(state.connectionVerified, true);
      assert.equal(state.userId, 'alice');
      assert.equal(manager.getCurrentSelection('alice')?.modelId, 'llama3.2');
    });
  });

  it('never marks a local model available when the runtime is unreachable', () => {
    const manager = new ProviderManager();
    manager.setLocalRuntime(
      { baseUrl: 'http://127.0.0.1:9999/v1' },
      mockFetch(() => ({ status: 503, body: 'down' })).fetch,
    );
    return manager.selectLocalModel('alice', 'llama3.2').then(
      () => assert.fail('expected rejection'),
      (err: unknown) => {
        assert.match((err as Error).message, /NOT made available/);
        const failed = manager.getSelectionHistory('alice')[0]!;
        assert.equal(failed.status, 'provider_unavailable');
        assert.equal(failed.connectionVerified, false);
        assert.equal(manager.getCurrentSelection('alice'), null);
      },
    );
  });

  it('reports model_unavailable when the runtime does not have the model', () => {
    const manager = new ProviderManager();
    manager.setLocalRuntime(
      { baseUrl: 'http://127.0.0.1:11434/v1' },
      mockFetch(() => ({ status: 200, body: localModelsPayload() })).fetch,
    );
    return manager.selectLocalModel('alice', 'not-installed').then(
      () => assert.fail('expected rejection'),
      (err: unknown) => {
        assert.match((err as Error).message, /not usable/);
        assert.equal(manager.getSelectionHistory('alice')[0]!.status, 'model_unavailable');
      },
    );
  });

  it('routes a verified local model through the EXISTING AiRouter', () => {
    const { calls, fetch } = mockFetch((url) =>
      url.endsWith('/chat/completions')
        ? { status: 200, body: { choices: [{ message: { content: 'routed' } }] } }
        : { status: 200, body: localModelsPayload() },
    );
    const manager = new ProviderManager();
    manager.setLocalRuntime({ baseUrl: 'http://127.0.0.1:11434/v1' }, fetch);
    const router = new AiRouter();
    router.register(manager.getLocalRuntime()!);
    router.setDefaultProvider('local');
    return manager.selectLocalModel('alice', 'llama3.2').then(() =>
      router
        .complete({ taskType: 'DISCOVERY', messages: [{ role: 'user', content: 'q' }], model: 'llama3.2' })
        .then((response) => {
          assert.equal(response.content, 'routed');
          assert.equal(response.providerId, 'local');
          assert.equal(response.modelId, 'llama3.2');
          assert.equal(calls.some((c) => c.url.endsWith('/chat/completions')), true);
        }),
    );
  });

  it('connectOpenRouter requires a credential; verify marks it honestly', () => {
    const manager = new ProviderManager();
    assert.throws(() => manager.connectOpenRouter('alice', 'nope'), /does not exist/);
    return assert
      .rejects(() => manager.verifyOpenRouter('alice', 'nope'), /No OpenRouter connection/)
      .then(() => {
        const ref = manager.credentials.addCredential('alice', 'openrouter', 'sk-or-real');
        manager.connectOpenRouter('alice', ref.id, mockFetch(() => ({ status: 200, body: keyCheckBody() })).fetch);
        return manager.verifyOpenRouter('alice', ref.id).then((result) => {
          assert.equal(result.success, true);
          assert.equal(manager.credentials.getReference('alice', ref.id).verified, true);
        });
      });
  });

  it('selectOpenRouterModel refuses without verification (CONFIGURED ≠ AVAILABLE)', () => {
    const manager = new ProviderManager();
    const ref = manager.credentials.addCredential('bob', 'openrouter', 'sk-or-b');
    manager.connectOpenRouter('bob', ref.id, mockFetch(() => ({ status: 200, body: keyCheckBody() })).fetch);
    return manager.selectOpenRouterModel('bob', ref.id, 'openai/gpt-4o').then(
      () => assert.fail('expected rejection'),
      (err: unknown) => {
        assert.match((err as Error).message, /CONFIGURED does not mean AVAILABLE/);
        assert.equal(manager.getCurrentSelection('bob'), null);
      },
    );
  });

  it('selectOpenRouterModel succeeds only after real verification', () => {
    const manager = new ProviderManager();
    const ref = manager.credentials.addCredential('carol', 'openrouter', 'sk-or-c');
    manager.connectOpenRouter('carol', ref.id, mockFetch(() => ({ status: 200, body: keyCheckBody() })).fetch);
    return manager.verifyOpenRouter('carol', ref.id).then(() =>
      manager.selectOpenRouterModel('carol', ref.id, 'openai/gpt-4o').then((state) => {
        assert.equal(state.status, 'connected');
        assert.equal(state.modelId, 'openai/gpt-4o');
        assert.equal(manager.getCurrentSelection('carol')?.modelId, 'openai/gpt-4o');
      }),
    );
  });

  it('maps a 401 key check to auth_required and keeps the model unavailable', () => {
    const manager = new ProviderManager();
    const ref = manager.credentials.addCredential('dave', 'openrouter', 'sk-or-d');
    manager.connectOpenRouter('dave', ref.id, mockFetch(() => ({ status: 401, body: { message: 'No auth' } })).fetch);
    return manager.verifyOpenRouter('dave', ref.id).then((result) => {
      assert.equal(result.success, false);
      assert.equal(manager.credentials.getReference('dave', ref.id).verified, false);
      assert.equal(providerStatusFromFailure(result), 'auth_required');
      return manager.selectOpenRouterModel('dave', ref.id, 'openai/gpt-4o').then(
        () => assert.fail('expected rejection'),
        (err: unknown) => assert.match((err as Error).message, /no verified connection/),
      );
    });
  });

  it('providerStatusFromFailure classifies without over-claiming', () => {
    const mk = (errorMessage?: string): ConnectionTestResult => ({
      success: false,
      timestamp: 't',
      errorMessage,
    });
    assert.equal(providerStatusFromFailure(mk('HTTP 429. Body preview: rate limit')), 'rate_limited');
    assert.equal(providerStatusFromFailure(mk('quota exceeded')), 'rate_limited');
    assert.equal(providerStatusFromFailure(mk('HTTP 503')), 'provider_unavailable');
    assert.equal(providerStatusFromFailure(mk(undefined)), 'provider_unavailable');
  });
});




