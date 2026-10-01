/**
 * OpenCode provider tests: real routing/verification behavior against a
 * stubbed runtime (injected runner + catalogue fixture). Classification stays
 * honest - free_no_api_key only after the runtime + catalogue resolve.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeProvider } from '../src/ai/opencode/opencode-provider.ts';
import { OpenCodeError, OpenCodeRuntime } from '../src/ai/opencode/opencode-runtime.ts';
import { OpencodeCatalogueSource } from '../src/ai/opencode/opencode-catalogue-source.ts';

const SESSION_ID = 'ses_9f3aPROVIDErTx';
const CACHE = JSON.stringify({
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    env: ['OPENCODE_API_KEY'],
    models: {
      'big-pickle': {
        id: 'big-pickle',
        name: 'big-pickle',
        tool_call: true,
        attachment: true,
        reasoning: false,
        limit: { context: 200000 },
        cost: { input: 0, output: 0 },
        status: 'active',
      },
      'paid-model': {
        id: 'paid-model',
        name: 'paid-model',
        limit: { context: 100000 },
        cost: { input: 1.2, output: 4.5 },
      },
    },
  },
});

const RUN_FIXTURE = [
  `{"type":"step_start","timestamp":1790238183940,"sessionID":"${SESSION_ID}","part":{"id":"prt_1","messageID":"msg_1","sessionID":"${SESSION_ID}","type":"step-start"}}`,
  `{"type":"text","timestamp":1790238184100,"sessionID":"${SESSION_ID}","part":{"id":"prt_2","messageID":"msg_2","sessionID":"${SESSION_ID}","type":"text","text":"REAL_OUTPUT"}}`,
  `{"type":"step_finish","timestamp":1790238184300,"sessionID":"${SESSION_ID}","part":{"id":"prt_3","messageID":"msg_3","sessionID":"${SESSION_ID}","type":"step-finish","reason":"stop","tokens":{"total":100,"input":60,"output":5,"cache":{"read":35,"write":0}},"cost":0}}`,
].join('\n');

function fixtureRuntime(runner: (args: readonly string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>): OpenCodeRuntime {
  const dir = mkdtempSync(join(tmpdir(), 'nexona-opencode-provider-'));
  const cachePath = join(dir, 'models.json');
  writeFileSync(cachePath, CACHE, 'utf8');
  return new OpenCodeRuntime({ cachePath, runner });
}

describe('OpenCodeProvider', () => {
  it('verifyConnection succeeds only when the real runtime catalogue resolves', async () => {
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async (args) => ({ stdout: RUN_FIXTURE, stderr: '', exitCode: 0 })),
    });
    const result = await provider.verifyConnection();
    assert.equal(result.success, true);
    assert.ok((result.modelsAvailable ?? 0) >= 2);
    assert.equal(provider.info.connectionVerified, true);
  });

  it('verifyConnection honestly fails when no executable resolves', async () => {
    const provider = new OpenCodeProvider({
      runtime: new OpenCodeRuntime({ executablePath: 'opencode-bogus-does-not-exist-9f3a', disableFallback: true }),
    });
    const result = await provider.verifyConnection();
    assert.equal(result.success, false);
    assert.match(result.errorMessage ?? '', /unavailable/);
    assert.equal(provider.info.connectionVerified, false);
  });

  it('listModels classifies cost-0 runtime models as free_no_api_key (proven access)', async () => {
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    const models = await provider.listModels();
    const free = models.find((m) => m.modelId === 'big-pickle');
    assert.ok(free !== undefined);
    assert.equal(free.accessCategory, 'free_no_api_key');
    assert.equal(free.inputCostPer1M, 0);
    assert.equal(free.outputCostPer1M, 0);
    assert.equal(free.capabilities.toolCalling, true);
    assert.equal(free.contextLength, 200000);
    assert.equal(free.available, true);
    const paid = models.find((m) => m.modelId === 'paid-model');
    assert.equal(paid?.accessCategory, 'free_api_key_required', 'non-free models are never marked free');
    assert.equal(paid?.inputCostPer1M, 1.2);
  });

  it('complete passes the exact provider/model and returns the real session identity', async () => {
    let invokedModel = '';
    let invokedPrompt = '';
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async (args) => {
        const mIdx = args.indexOf('-m');
        invokedModel = mIdx >= 0 ? (args[mIdx + 1] ?? '') : '';
        invokedPrompt = args[args.length - 1] ?? '';
        return { stdout: RUN_FIXTURE, stderr: '', exitCode: 0 };
      }),
    });
    const response = await provider.complete({
      taskType: 'BUILD',
      messages: [{ role: 'user', content: 'build it' }],
      model: 'big-pickle',
      requestId: 'req-1',
    });
    assert.equal(response.content, 'REAL_OUTPUT');
    assert.equal(response.providerId, 'opencode');
    assert.equal(response.modelId, 'big-pickle');
    assert.equal(response.sessionId, SESSION_ID);
    assert.equal(response.requestId, 'req-1');
    assert.equal(response.usage?.inputTokens, 60);
    assert.equal(invokedModel, 'opencode/big-pickle', 'the exact provider/model pair (-m) is passed through');
    assert.equal(invokedPrompt, '[USER]\nbuild it');
  });

  it('refuses a model that is not in the real catalogue (no silent substitution)', async () => {
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    await assert.rejects(
      provider.complete({ taskType: 'BUILD', messages: [{ role: 'user', content: 'x' }], model: 'ghost-model' }),
      (error: unknown) => {
        assert.ok(error instanceof OpenCodeError);
        assert.match(error.message, /not present in the real OpenCode catalogue/);
        return true;
      },
    );
  });

  it('throws when the runtime is unavailable instead of fabricating', async () => {
    const provider = new OpenCodeProvider({
      runtime: new OpenCodeRuntime({ executablePath: 'opencode-bogus-does-not-exist-9f3a', disableFallback: true }),
    });
    await assert.rejects(
      provider.complete({ taskType: 'BUILD', messages: [{ role: 'user', content: 'x' }], model: 'big-pickle' }),
      /unavailable/,
    );
  });

  it('requires an explicit model (no silent fallback)', async () => {
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    await assert.rejects(
      provider.complete({ taskType: 'BUILD', messages: [{ role: 'user', content: 'x' }] }),
      /explicit model/,
    );
  });
});

describe('OpencodeCatalogueSource', () => {
  it('feeds the ModelCatalogue with live runtime models; verified follows a real test', async () => {
    const provider = new OpenCodeProvider({
      runtime: fixtureRuntime(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    const source = new OpencodeCatalogueSource({ provider });
    assert.equal(source.providerId, 'opencode');
    assert.equal(source.verified, false, 'catalogue presence alone never marks verified');
    const models = await source.fetchCatalog();
    assert.ok(models.some((m) => m.modelId === 'big-pickle' && m.accessCategory === 'free_no_api_key'));
    await provider.verifyConnection();
    assert.equal(source.verified, true, 'verified starts only after a real connection test');
  });

  it('throws honestly when the runtime catalogue is unavailable (degrades per-source)', async () => {
    const provider = new OpenCodeProvider({
      runtime: new OpenCodeRuntime({
        cachePath: join(mkdtempSync(join(tmpdir(), 'nexona-opencode-provider-')), 'missing.json'),
        disableFallback: true,
      }),
    });
    const source = new OpencodeCatalogueSource({ provider });
    await assert.rejects(() => source.fetchCatalog(), /does not expose|unavailable/);
  });
});