import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import { OpenAiCompatibleProvider } from '../src/ai/openai-compatible-provider.ts';
import type { FetchFn } from '../src/ai/openai-compatible-provider.ts';
import { ProviderExhaustedError, ProviderHttpError } from '../src/core/errors.ts';

describe('scripted provider', () => {
  it('serves rule-matched responses deterministically', async () => {
    const provider = new ScriptedProvider({
      rules: [
        {
          match: (req) =>
            req.taskType === 'DESIGN' && (req.messages[0]?.content ?? '').includes('blue'),
          respond: () => 'design-for-blue',
        },
      ],
    });
    const response = await provider.complete({
      taskType: 'DESIGN',
      messages: [{ role: 'user', content: 'make it blue' }],
    });
    assert.equal(response.content, 'design-for-blue');
    assert.equal(response.providerId, 'scripted');
    assert.deepEqual(provider.calls, [{ taskType: 'DESIGN', messageCount: 1 }]);
  });

  it('falls back to the FIFO queue and then refuses to invent answers', async () => {
    const provider = new ScriptedProvider({ queue: ['first', 'second'] });
    const first = await provider.complete({ taskType: 'BUILD', messages: [] });
    const second = await provider.complete({ taskType: 'BUILD', messages: [] });
    assert.equal(first.content, 'first');
    assert.equal(second.content, 'second');
    await assert.rejects(
      () => provider.complete({ taskType: 'BUILD', messages: [] }),
      ProviderExhaustedError,
    );
  });
});

describe('openai-compatible provider (offline, injected fetch)', () => {
  const settings = {
    baseUrlEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
    modelEnvVar: 'OPENAI_COMPATIBLE_MODEL',
    apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
    timeoutMs: 5000,
  };

  function fakeFetch(responseBody: unknown, ok = true, status = 200): {
    fetchImpl: FetchFn;
    captured: Array<{ url: string; init: { headers: Record<string, string>; body: string } }>;
  } {
    const captured: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    const fetchImpl: FetchFn = async (url, init) => ({
      ok,
      status,
      text: async () => JSON.stringify(responseBody),
      json: async () => responseBody,
    });
    return {
      fetchImpl: (url, init) => {
        captured.push({ url, init });
        return fetchImpl(url, init);
      },
      captured,
    };
  }

  const env = {
    OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1',
    OPENAI_COMPATIBLE_MODEL: 'gpt-test-9',
    OPENAI_COMPATIBLE_API_KEY: 'test-key-do-not-log',
  };

  it('shapes requests correctly and parses responses', async () => {
    const { fetchImpl, captured } = fakeFetch({
      choices: [
        { message: { content: 'the answer' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
    const provider = new OpenAiCompatibleProvider({ settings, fetchImpl, env });
    const response = await provider.complete({
      taskType: 'VERIFICATION',
      messages: [{ role: 'system', content: 'verify' }],
      temperature: 0.2,
      maxTokens: 128,
    });

    assert.equal(captured.length, 1);
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.url, 'https://api.example.com/v1/chat/completions');
    const authHeader = request.init.headers['authorization'] ?? '';
    assert.match(authHeader, /^Bearer test-key-/);
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    assert.equal(body['model'], 'gpt-test-9');
    assert.equal(body['max_tokens'], 128);

    assert.equal(response.content, 'the answer');
    assert.equal(response.modelId, 'gpt-test-9');
    assert.equal(response.usage?.inputTokens, 12);
    assert.equal(response.usage?.outputTokens, 34);
    assert.equal(response.finishReason, 'stop');
  });

  it('maps http failures to typed errors without leaking the key', async () => {
    const { fetchImpl } = fakeFetch({ error: { message: 'quota exceeded' } }, false, 429);
    const provider = new OpenAiCompatibleProvider({ settings, fetchImpl, env });
    try {
      await provider.complete({ taskType: 'REVIEW', messages: [] });
      assert.fail('expected throw');
    } catch (error) {
      assert.ok(error instanceof ProviderHttpError);
      assert.match(error.message, /429/);
      assert.doesNotMatch(error.message, /test-key-do-not-log/);
    }
  });

  it('fails fast with named env vars when credentials are missing', async () => {
    const { fetchImpl, captured } = fakeFetch({});
    const provider = new OpenAiCompatibleProvider({
      settings,
      fetchImpl,
      env: { OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1' },
    });
    await assert.rejects(
      () => provider.complete({ taskType: 'DESIGN', messages: [] }),
      /OPENAI_COMPATIBLE_API_KEY/,
    );
    assert.equal(captured.length, 0); // no request attempted
  });

  it('rejects empty assistant payloads', async () => {
    const { fetchImpl } = fakeFetch({ choices: [{ message: { content: '' } }] });
    const provider = new OpenAiCompatibleProvider({ settings, fetchImpl, env });
    await assert.rejects(
      () => provider.complete({ taskType: 'DISCOVERY', messages: [] }),
      ProviderHttpError,
    );
  });
});
