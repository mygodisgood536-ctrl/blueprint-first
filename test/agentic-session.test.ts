import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalWorkspaceEnvAdapter } from '../src/env/local-workspace.ts';
import type { AiProvider } from '../src/ai/provider.ts';
import type { AiCompletionRequest, AiCompletionResponse, AiTaskType } from '../src/ai/types.ts';
import type { AgentToolName } from '../src/agentic/session.ts';
import { AgenticSession, parseToolCalls } from '../src/agentic/session.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';

async function tempWorkspace(): Promise<LocalWorkspaceEnvAdapter> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'nexona-agent-' + randomBytes(4).toString('hex')));
  const adapter = new LocalWorkspaceEnvAdapter(dir);
  const health = await adapter.provision({ label: 'agentic workspace', gitEnabled: true });
  assert.equal(health.ok, true);
  return adapter;
}

function toolReply(name: AgentToolName, input: Record<string, unknown>): string {
  return `TOOL_CALL ${JSON.stringify({ tool: name, input })}`;
}

async function runSession(env: LocalWorkspaceEnvAdapter, queue: unknown[], maxToolCalls?: number) {
  const router = new AiRouter();
  router
    .register(new ScriptedProvider({ id: 'scripted', queue: queue as string[] }))
    .setDefaultProvider('scripted');
  const session = new AgenticSession({
    router,
    taskType: 'BUILD' as AiTaskType,
    goals: 'Produce the stage deliverable in the workspace; never invent results.',
    env,
    ...(maxToolCalls !== undefined ? { maxToolCalls } : {}),
  });
  return session.run();
}

test('parseToolCalls extracts strict TOOL_CALL JSON lines and ignores junk', () => {
  const calls = parseToolCalls(
    [
      'thinking aloud...',
      `TOOL_CALL ${JSON.stringify({ tool: 'file.write', input: { path: 'a.txt', content: 'x' } })}`,
      `  TOOL_CALL ${JSON.stringify({ tool: 'terminal.run', input: { command: 'pwd' } })}  `,
      'TOOL_CALL not-json',
      'plain final text',
    ].join('\n'),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.name, 'file.write');
  assert.equal(calls[1]?.name, 'terminal.run');
  assert.deepEqual(parseToolCalls('no tools here'), []);
});

test('an immediate plain-text answer completes the session without any tool call', async () => {
  const env = await tempWorkspace();
  const result = await runSession(env, ['I have nothing to execute; here is my honest summary.']);
  assert.equal(result.ok, true);
  assert.equal(result.steps, 1);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.toolLog.length, 0);
  assert.ok(result.finalText.includes('honest summary'));
  assert.equal(await fs.readdir(env.workspaceRoot).then((l) => l.includes('deliverable.txt')), false);
});

test('the loop turns scripted tool calls into REAL file/terminal effects and finishes honestly', async () => {
  const env = await tempWorkspace();
  const result = await runSession(env, [
    toolReply('file.write', { path: 'src/deliverable.txt', content: 'built by the agentic session' }),
    toolReply('file.list', { path: 'src' }),
    toolReply('terminal.run', {
      command: `node -e "require('fs').appendFileSync('src/ran.txt','ok')"`,
    }),
    toolReply('git.commit', { message: 'agentic deliverable' }),
    'STAGE COMPLETE. Wrote src/deliverable.txt, listed src, confirmed a real terminal command ran, committed the work.',
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.steps, 5);
  assert.equal(result.toolCalls, 4);
  assert.equal(result.toolLog.length, 4);
  assert.ok(result.toolLog.every((t) => t.ok));
  assert.equal(result.providerId, 'scripted');

  // REAL effects observable on disk, not fabricated by the session
  const deliverable = await fs.readFile(join(env.workspaceRoot, 'src', 'deliverable.txt'), 'utf8');
  assert.equal(deliverable, 'built by the agentic session');
  assert.equal(await fs.readFile(join(env.workspaceRoot, 'src', 'ran.txt'), 'utf8'), 'ok');

  // mutation tools leave evidence; read-only tools do not
  assert.ok(result.evidence.some((e) => e.includes('tool.file.write.ok')));
  const terminalLine = result.evidence.find((e) => e.includes('tool.terminal.run.ok'));
  assert.ok(terminalLine?.includes('exit=0'));
  assert.ok(result.evidence.some((e) => e.includes('tool.git.commit.ok')));
  assert.ok(!result.evidence.some((e) => e.includes('tool.file.list')));

  // the git commit is real
  const status = await env.gitStatus();
  assert.equal(status.entries.length, 0, 'working tree is clean after the real commit');
});

test('failing tools are reported honestly and the loop continues', async () => {
  const env = await tempWorkspace();
  const result = await runSession(env, [
    toolReply('file.read', { path: 'does-not-exist.txt' }),
    toolReply('terminal.run', { command: 'exit 7' }),
    'Finished after probing failures.',
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.toolCalls, 2);
  assert.equal(result.toolLog[0]?.tool, 'file.read');
  assert.equal(result.toolLog[0]?.ok, false);
  assert.equal(result.toolLog[1]?.tool, 'terminal.run');
  assert.equal(result.toolLog[1]?.ok, false);
  assert.ok(result.finalText.length > 0);
});

test('the tool budget is enforced and the session reports non-ok instead of hanging', async () => {
  const env = await tempWorkspace();
  const spam: string[] = [];
  for (let i = 0; i < 20; i++) {
    spam.push(toolReply('file.write', { path: `spam-${i}.txt`, content: 'x' }));
  }
  const result = await runSession(env, spam, 5);

  assert.equal(result.ok, false);
  assert.equal(result.toolCalls, 5);
  assert.equal(result.toolLog.length, 5);
  const files = await fs.readdir(env.workspaceRoot);
  const spamCount = files.filter((f) => f.startsWith('spam-')).length;
  assert.equal(spamCount, 5, 'only the budgeted tools executed for real');
});

test('malformed tool lines never loop forever; the session ends non-ok at the cap', async () => {
  const env = await tempWorkspace();
  const gibberish = Array.from({ length: 10 }, () => 'TOOL_CALL {corrupted json]');
  const result = await runSession(env, gibberish, 3);
  assert.equal(result.ok, false);
  assert.equal(result.toolCalls, 3, 'each malformed attempt burns one budget slot, so it cannot spin forever');
  assert.ok(result.steps <= 4, `loop terminated (steps=${result.steps})`);
});

test('REAL TERMINATION: a pre-aborted signal stops the session before any model call', async () => {
  const env = await tempWorkspace();
  const provider = new ScriptedProvider({ id: 'scripted', queue: ['this must never be consumed'] });
  const router = new AiRouter();
  router.register(provider).setDefaultProvider('scripted');
  const controller = new AbortController();
  controller.abort();
  const session = new AgenticSession({
    router,
    taskType: 'BUILD' as AiTaskType,
    goals: 'never reached',
    env,
    signal: controller.signal,
  });
  await assert.rejects(session.run(), /aborted by caller/);
  assert.equal(provider.calls.length, 0, 'a cancelled session consumes no model steps');
});

test('REAL TERMINATION: abort during a model step cancels the request and stops the loop', async () => {
  const env = await tempWorkspace();
  const hanging: AiProvider = {
    id: 'hanging',
    complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
      return new Promise((resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')), { once: true });
        void resolve;
      });
    },
  };
  const router = new AiRouter();
  router.register(hanging).setDefaultProvider('hanging');
  const controller = new AbortController();
  const session = new AgenticSession({
    router,
    taskType: 'BUILD' as AiTaskType,
    goals: 'must not fabricate',
    env,
    signal: controller.signal,
  });
  const running = session.run();
  controller.abort();
  await assert.rejects(running, /aborted by caller/);
});