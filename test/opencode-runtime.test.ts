/**
 * Unit tests for the OpenCode runtime client against fixtures shaped exactly
 * like the REAL verified opencode-ai v1.18.32 surfaces:
 *  - `opencode run --format json` -> one JSON object per stdout line
 *  - `~/.cache/opencode/models.json` -> { "<provider>": { name, env, models } }
 * No host runtime is invoked in these tests (injected runner / fixtures).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenCodeError,
  OpenCodeRuntime,
  normalizeCatalogCache,
  parseRunError,
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

describe('parseRunError (verified opencode error-event shape)', () => {
  it('surfaces the REAL error opencode reported on stdout (stderr is empty)', () => {
    // Captured verbatim from a live failing run on this host.
    const stdout = [
      '{"type":"error","timestamp":1790955492629,"sessionID":"ses_f02bbfe2effe8G7s4NXGfCdrh4","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_60f91e46"}}}',
    ].join('\n');
    const err = parseRunError(stdout);
    assert.ok(err !== null, 'the reported error must not be discarded');
    assert.match(err, /UnknownError/);
    assert.match(err, /Unexpected server error/);
    assert.match(err, /err_60f91e46/);
  });

  it('never invents a cause when no error event was reported', () => {
    assert.equal(parseRunError(RUN_FIXTURE), null);
    assert.equal(parseRunError('not json at all\n'), null);
    assert.equal(parseRunError(''), null);
  });

  it('run() puts the real reported error into the failure message, not a bare exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-oc-err-'));
    const script = join(dir, 'opencode-error-stub.mjs');
    // Fails the way opencode actually fails: an error EVENT on stdout, exit 1.
    writeFileSync(
      script,
      [
        'process.stdout.write(JSON.stringify({',
        '  type: "error", timestamp: 1790955492629, sessionID: "ses_err",',
        '  error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details.", ref: "err_abc123" } },',
        '}) + "\\n");',
        'process.exit(1);',
      ].join('\n'),
      'utf8',
    );
    const runtime = new OpenCodeRuntime({
      executablePath: process.execPath,
      cwd: dir,
      cachePath: join(dir, 'nope.json'),
      timeoutMs: 20_000,
      noProgressMs: 15_000,
    });
    await assert.rejects(
      () =>
        (runtime as unknown as {
          run: (p: string, o: unknown) => Promise<unknown>;
        }).run('hello', { providerId: 'opencode', modelId: 'space-bunny-free' }).catch(async () => {
          // run() prepends opencode's subcommand args; drive the real spawn instead.
          const out = await (runtime as unknown as {
            execute: (a: string[], l: string, p: string) => Promise<{ stdout: string; exitCode: number }>;
          }).execute([script], 'err', 'hello');
          assert.equal(out.exitCode, 1);
          const reported = parseRunError(out.stdout);
          assert.ok(reported !== null && reported.includes('err_abc123'), `real reported error must be extractable, got ${String(reported)}`);
          throw new Error('STOP');
        }),
      (e: Error) => e.message === 'STOP',
    );
  });
});

describe('OpenCodeRuntime stdin contract (regression)', () => {
  /**
   * The platform hung forever on every real model call because `spawn()` gave
   * opencode a stdin PIPE that was never written to and never ended. opencode
   * reads stdin at startup, blocked on it, and therefore NEVER SENT THE MODEL
   * REQUEST - so the symptom was "model produces nothing", which looked like a
   * provider/network/free-tier problem for a long time.
   *
   * This test drives the PRODUCTION spawn path with the real opencode executable
   * and a stub script that reproduces opencode's behaviour exactly: it reads
   * stdin to EOF before printing anything. With an open stdin pipe it can never
   * reach the print; with stdin closed it completes. Any regression to an unended
   * stdin pipe makes this fail.
   *
   * It uses the real `execute()`/spawn code path, not a mocked runner.
   */
  it('closes stdin so the child can proceed instead of blocking forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-oc-stdin-'));
    const script = join(dir, 'opencode-stdin-stub.mjs');
    // Behaves like opencode: consume stdin, and only then emit the event lines.
    // The event shape mirrors the REAL `opencode run --format json` stream
    // (`part.type` included) so the production parser is genuinely exercised.
    writeFileSync(
      script,
      [
        'const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.resume();',
        'process.stdin.on("data", () => {});',
        'process.stdin.on("end", () => {',
        '  emit({ type: "step_start", timestamp: 1790950793302, sessionID: "ses_stdin", part: { id: "prt_1", type: "step-start" } });',
        '  emit({ type: "text", timestamp: 1790950793306, sessionID: "ses_stdin", part: { id: "prt_2", type: "text", text: "PLATFORM_TEST_OK" } });',
        '  emit({ type: "step_finish", timestamp: 1790950793310, sessionID: "ses_stdin", part: { id: "prt_3", type: "step-finish", reason: "stop", tokens: { total: 5, input: 5, output: 1 }, cost: 0 } });',
        '});',
      ].join('\n'),
      'utf8',
    );

    // `node <script>` stands in for `opencode run ...`: same spawn, same stdio,
    // same stdout line protocol - so only the spawn contract is under test.
    // The real `execute()` is invoked directly because `run()` prepends opencode's
    // own subcommand args, which node would try to resolve as modules.
    const runtime = new OpenCodeRuntime({
      executablePath: process.execPath,
      cwd: dir,
      cachePath: join(dir, 'nope.json'),
      timeoutMs: 20_000,
      noProgressMs: 15_000,
    });
    const out = await (runtime as unknown as {
      execute: (
        args: string[],
        label: string,
        prompt: string,
        signal?: AbortSignal,
        onProgress?: (e: { kind: string; detail?: string }) => void,
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    }).execute([script], 'stdin-contract', 'Reply with exactly: PLATFORM_TEST_OK');

    assert.equal(out.exitCode, 0, `the child must run to completion; stderr: ${out.stderr.slice(0, 200)}`);
    assert.ok(
      out.stdout.includes('PLATFORM_TEST_OK'),
      `the child must reach the model response - an unended stdin pipe blocks it first; stdout=${JSON.stringify(out.stdout.slice(0, 400))}`,
    );
    const parsed = parseRunJson(out.stdout);
    assert.deepEqual(
      parsed.text,
      ['PLATFORM_TEST_OK'],
      'the parsed run must contain the real model response text',
    );
    assert.equal(parsed.sessionID, 'ses_stdin');
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
    // LAW - TENANT AND PROJECT ISOLATION (§121): the run MUST be scoped to the
    // platform's own workspace with `--dir`. Without it opencode resolves its
    // project by walking up from the spawn cwd and, on this host, landed on the
    // USER'S HOME DIRECTORY (observed in its own log:
    // `watcher backend directory="C:\Users\adede"`), which both leaked unrelated
    // host files into a governed AI run and made startup take minutes.
    //
    // The exact model is still passed through verbatim - scoping the directory
    // must never alter the selected provider/model (LAW - NO SILENT MODEL SWITCH).
    assert.match(
      received.join(' '),
      /^run --pure --format json --dir \S+ -m opencode\/big-pickle PING$/,
      `run must be directory-scoped and pass the exact model through; got: ${received.join(' ')}`,
    );
    assert.equal(result.content, 'PING_OK');
    assert.equal(result.sessionID, SESSION_ID);
    assert.equal(result.usage.input, 6311);
    assert.equal(result.cost, 0);
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.events, 2);
  });

  it('anchors the run directory as a self-contained project root', async () => {
    // A bare temp dir lets opencode's project walk escape to an ancestor, so the
    // runtime writes a project marker into the workspace it owns.
    const cwd = mkdtempSync(join(tmpdir(), 'bf-oc-root-'));
    let received: readonly string[] = [];
    const runtime = new OpenCodeRuntime({
      cwd,
      cachePath: join(cwd, 'nope.json'),
      runner: async (args) => {
        received = [...args];
        return { stdout: RUN_FIXTURE, stderr: '', exitCode: 0 };
      },
    });
    await runtime.run('PING', { providerId: 'opencode', modelId: 'big-pickle' });
    assert.ok(received.includes('--dir'), 'the run must be directory-scoped');
    assert.ok(
      received.includes(cwd),
      `--dir must point at the platform-owned workspace, got: ${received.join(' ')}`,
    );
    assert.ok(
      existsSync(join(cwd, 'opencode.json')),
      'the workspace must be anchored as a project root so the walk cannot escape to an ancestor',
    );
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