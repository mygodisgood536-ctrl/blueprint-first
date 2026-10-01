/**
 * Unit tests for the OpenCode runtime client against fixtures shaped exactly
 * like the REAL verified opencode-ai v1.18.32 surfaces:
 *  - `opencode run --format json` -> one JSON object per stdout line
 *  - `~/.cache/opencode/models.json` -> { "<provider>": { name, env, models } }
 * No host runtime is invoked in these tests (injected runner / fixtures).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenCodeError,
  OpenCodeRuntime,
  normalizeCatalogCache,
  parseRunJson,
} from '../src/ai/opencode/opencode-runtime.ts';

const SESSION_ID = 'ses_f2d7d5e8affe5yTIkMt9Y3P2jG';

const RUN_FIXTURE = [
  `{"type":"step_start","timestamp":1790238183940,"sessionID":"${SESSION_ID}","part":{"id":"prt_1","messageID":"msg_1","sessionID":"${SESSION_ID}","snapshot":"9e5d","type":"step-start"}}`,
  `{"type":"text","timestamp":1790238184100,"sessionID":"${SESSION_ID}","part":{"id":"prt_2","messageID":"msg_2","sessionID":"${SESSION_ID}","type":"text","text":"PING_OK","time":{"start":1790238184000,"end":1790238184090}}}`,
  `{"type":"step_finish","timestamp":1790238184300,"sessionID":"${SESSION_ID}","part":{"id":"prt_3","messageID":"msg_3","sessionID":"${SESSION_ID}","type":"step-finish","reason":"stop","snapshot":"9e5d","tokens":{"total":8108,"input":6311,"output":5,"reasoning":0,"cache":{"write":0,"read":1792}},"cost":0}}`,
].join('\n');

const CACHE_FIXTURE = JSON.stringify({
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    env: ['OPENCODE_API_KEY'],
    api: 'https://opencode.ai',
    npm: '@opencode-ai/opencode',
    models: {
      'big-pickle': {
        id: 'big-pickle',
        name: 'big-pickle',
        family: 'openmodels',
        description: 'a verified free model',
        tool_call: true,
        attachment: true,
        reasoning: false,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200000, output: 4000 },
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        status: 'active',
        release_date: '2025-05-01',
        last_updated: '2026-01-01',
      },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
    models: {
      'gpt-4o': {
        id: 'gpt-4o',
        name: 'gpt-4o',
        cost: { input: 2.5, output: 10 },
        limit: { context: 128000 },
      },
    },
  },
});

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'nexona-opencode-test-'));
}

function runtimeWithFixture(): OpenCodeRuntime {
  const dir = fixtureDir();
  const cachePath = join(dir, 'models.json');
  writeFileSync(cachePath, CACHE_FIXTURE, 'utf8');
  return new OpenCodeRuntime({ cachePath });
}

describe('parseRunJson (verified `opencode run --format json` shape)', () => {
  it('extracts session identity, text, tokens, cost and finish reason', () => {
    const parsed = parseRunJson(RUN_FIXTURE);
    assert.equal(parsed.sessionID, SESSION_ID);
    assert.deepEqual(parsed.text, ['PING_OK']);
    assert.equal(parsed.usage.input, 6311);
    assert.equal(parsed.usage.output, 5);
    assert.equal(parsed.usage.cacheRead, 1792);
    assert.equal(parsed.cost, 0);
    assert.equal(parsed.finishReason, 'stop');
    assert.equal(parsed.events, 2);
  });

  it('tolerates non-JSON noise lines without fabricating data', () => {
    const parsed = parseRunJson(`some noise line\n${RUN_FIXTURE}\n`);
    assert.equal(parsed.sessionID, SESSION_ID);
    assert.equal(parsed.text.join(''), 'PING_OK');
  });

  it('returns empty text and blank session when nothing real appeared', () => {
    const parsed = parseRunJson('');
    assert.equal(parsed.sessionID, '');
    assert.equal(parsed.text.join(''), '');
    assert.equal(parsed.events, 0);
  });
});

describe('normalizeCatalogCache (verified models.json shape)', () => {
  it('normalizes provider entries with env vars and real model fields', () => {
    const entries = normalizeCatalogCache('models.json', CACHE_FIXTURE);
    const opencode = entries.find((e) => e.providerId === 'opencode');
    assert.ok(opencode !== undefined);
    assert.deepEqual(opencode.env, ['OPENCODE_API_KEY']);
    const model = opencode.models.find((m) => m.id === 'big-pickle');
    assert.ok(model !== undefined);
    assert.equal(model.costInputPer1M, 0);
    assert.equal(model.costOutputPer1M, 0);
    assert.equal(model.contextLength, 200000);
    assert.equal(model.maxOutputTokens, 4000);
    assert.equal(model.toolCalling, true);
    assert.equal(model.attachment, true);
    const paid = entries.find((e) => e.providerId === 'openai')?.models[0];
    assert.equal(paid?.costInputPer1M, 2.5);
    assert.equal(paid?.costOutputPer1M, 10);
  });

  it('throws on a non-JSON cache instead of guessing', () => {
    assert.throws(() => normalizeCatalogCache('models.json', '{not json'), OpenCodeError);
  });
});

describe('OpenCodeRuntime.run (injected runner)', () => {
  it('invokes the exact `-m provider/model` pass-through and returns the real session result', async () => {
    let received: readonly string[] = [];
    const runtime = new OpenCodeRuntime({
      cachePath: join(fixtureDir(), 'nope.json'),
      runner: async (args) => {
        received = [...args];
        return { stdout: RUN_FIXTURE, stderr: '', exitCode: 0 };
      },
    });
    const result = await runtime.run('PING', { providerId: 'opencode', modelId: 'big-pickle' });
    assert.equal(received.join(' '), 'run --pure --format json -m opencode/big-pickle PING');
    assert.equal(result.content, 'PING_OK');
    assert.equal(result.sessionID, SESSION_ID);
    assert.equal(result.usage.input, 6311);
    assert.equal(result.cost, 0);
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.events, 2);
  });

  it('reports a genuine non-zero exit as an honest OpenCodeError', async () => {
    const runtime = new OpenCodeRuntime({
      runner: async () => ({ stdout: RUN_FIXTURE, stderr: 'the model blew up\n', exitCode: 1 }),
    });
    await assert.rejects(
      runtime.run('PING', { providerId: 'opencode', modelId: 'big-pickle' }),
      (error: unknown) => {
        assert.ok(error instanceof OpenCodeError);
        assert.match(error.message, /exited 1/);
        assert.match(error.message, /the model blew up/);
        return true;
      },
    );
  });

  it('throws when the run produced no real assistant text', async () => {
    const runtime = new OpenCodeRuntime({
      runner: async () => ({ stdout: '', stderr: 'no output', exitCode: 0 }),
    });
    await assert.rejects(
      runtime.run('PING', { providerId: 'opencode', modelId: 'big-pickle' }),
      /no assistant text/,
    );
  });
});

describe('OpenCodeRuntime availability (real --version probe)', () => {
  it('reports unavailable for a bogus explicit executable path when fallback is disabled', () => {
    const runtime = new OpenCodeRuntime({
      executablePath: 'opencode-bogus-does-not-exist-9f3a',
      disableFallback: true,
    });
    assert.equal(runtime.available(), false);
  });

  it('refuses to run when the runtime is unavailable', async () => {
    const runtime = new OpenCodeRuntime({
      executablePath: 'opencode-bogus-does-not-exist-9f3a',
      disableFallback: true,
    });
    await assert.rejects(
      runtime.run('PING', { providerId: 'opencode', modelId: 'big-pickle' }),
      /unavailable/,
    );
  });
});

describe('OpenCodeRuntime catalogue', () => {
  it('hasModel only accepts models present in the real catalogue', () => {
    const runtime = runtimeWithFixture();
    assert.equal(runtime.hasModel('opencode', 'big-pickle'), true);
    assert.equal(runtime.hasModel('opencode', 'not-a-real-model'), false);
    assert.equal(runtime.hasModel('openai', 'gpt-4o'), true);
  });

  it('readCatalogCache returns null (never an empty guess) when no cache exists', () => {
    const runtime = new OpenCodeRuntime({ cachePath: join(fixtureDir(), 'missing.json') });
    assert.equal(runtime.readCatalogCache(), null);
  });
});