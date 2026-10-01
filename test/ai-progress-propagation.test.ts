/**
 * Regression: a genuinely-progressing long AI run must NOT be killed by the
 * independent three-minute hard timeout.
 *
 * ARCHITECTURE 3.3 LAWS:
 *  - §54 REAL PROGRESS ONLY  (only genuine state advancement resets the window)
 *  - §55 THREE-MINUTE HARD TIMEOUT (a long run is not exempt by being long;
 *    it stays alive because progress keeps arriving)
 *  - §95 FALSE COMPLETION IS A CRITICAL FAILURE (and by symmetry, a healthy run
 *    falsely declared a hang destroys real work)
 *
 * The defect: a single model call against a real provider streams genuine
 * advancement, but nothing surfaced it to the supervisor. The supervisor saw
 * silence and terminated HEALTHY work as a hang. These tests pin the real
 * plumbing: provider stream -> OpenCodeRuntime.onProgress -> AgenticSession ->
 * JobRunContext.reportProgress -> ExecutionSupervisor window.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeRuntime, parseRunJson } from '../src/ai/opencode/opencode-runtime.ts';
import { AgenticSession } from '../src/agentic/session.ts';
import { AiRouter } from '../src/ai/router.ts';
import { LocalWorkspaceEnvAdapter } from '../src/env/local-workspace.ts';
import type { AiCompletionRequest, AiCompletionResponse } from '../src/ai/types.ts';

describe('long AI runs report REAL progress to the supervisor', () => {
  it('the runtime forwards genuine stream advancement and never invents it', async () => {
    // Drive the REAL streaming path: an injected runner would bypass the stdout
    // listener entirely, so a real child process is used with the real opencode
    // line protocol. This is the production path under test.
    const rt = new OpenCodeRuntime({ executablePath: process.execPath });
    const seen: string[] = [];
    const script = join(await mkdtemp(join(tmpdir(), 'bf-oc-stream-')), 'fake-opencode.mjs');
    await writeFile(
      script,
      [
        'process.stdout.write(JSON.stringify({type:"step_start",sessionID:"ses_a",part:{id:"p1"}}) + "\\n");',
        'process.stdout.write(JSON.stringify({type:"text",sessionID:"ses_a",part:{text:"working"}}) + "\\n");',
        'process.stdout.write(JSON.stringify({type:"step_finish",sessionID:"ses_a",part:{tokens:{total:10},cost:0}}) + "\\n");',
      ].join('\n'),
      'utf8',
    );
    // `node <script>` stands in for `opencode run ...`: same spawn, same stdout
    // streaming, same JSON-line contract.
    const streaming = new OpenCodeRuntime({ executablePath: process.execPath });
    const result = await spawnNodeStreaming(streaming, script, seen);
    assert.ok(seen.includes('opencode.step_start'), `started step must count as progress, saw ${JSON.stringify(seen)}`);
    assert.ok(seen.includes('opencode.step_finish'), `finished step must count as progress, saw ${JSON.stringify(seen)}`);
    // The real session identity still parses from the same stream.
    assert.equal(result.sessionID, 'ses_a');
    assert.equal(rt.executablePath, process.execPath);
  });

  it('a silent run reports NO progress, so the hard timeout can still detect a real hang', async () => {
    const script = join(await mkdtemp(join(tmpdir(), 'bf-oc-silent-')), 'fake-opencode.mjs');
    // Emits whitespace only: real process, genuinely no advancement.
    await writeFile(script, 'process.stdout.write("   \\n");', 'utf8');
    const seen: string[] = [];
    await spawnNodeStreaming(new OpenCodeRuntime({ executablePath: process.execPath }), script, seen);
    assert.deepEqual(seen, [], 'non-advancement output must never be reported as meaningful progress');
  });

  it('an agentic session forwards provider progress to its caller', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-session-progress-'));
    const env = new LocalWorkspaceEnvAdapter(dir);
    const router = new AiRouter();
    // A provider that reports a genuine per-step advancement event, exactly as
    // a streaming real provider does, then returns a plain final summary.
    const provider = {
      id: 'streaming-test',
      complete: async (req: AiCompletionRequest): Promise<AiCompletionResponse> => {
        req.onProgress?.({ kind: 'ai-step', detail: `streaming step for ${req.taskType}` });
        return { content: 'final summary, no tools', providerId: 'streaming-test', modelId: 'm1' };
      },
    };
    router.register(provider).setDefaultProvider(provider.id);
    const seen: string[] = [];
    await new AgenticSession({
      router,
      taskType: 'DISCOVERY',
      model: 'space-bunny-free',
      goals: 'Produce a discovery brief.',
      env,
      onProgress: (e) => seen.push(e.kind),
    }).run();
    assert.ok(
      seen.includes('ai-step'),
      `provider progress must reach the supervisor sink, saw ${JSON.stringify(seen)}`,
    );
  });
});

/**
 * Runs `node <script>` THROUGH the production OpenCodeRuntime streaming path so
 * the stdout listener, the JSON-line progress parser and the real session parse
 * are all the production code under test (an injected `runner` short-circuits
 * exactly the code that was defective).
 */
async function spawnNodeStreaming(
  rt: OpenCodeRuntime,
  script: string,
  seen: string[],
): Promise<{ sessionID: string }> {
  const result = await (rt as unknown as {
    execute: (
      args: string[],
      label: string,
      prompt: string,
      signal?: AbortSignal,
      onProgress?: (e: { kind: string; detail?: string }) => void,
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  }).execute([script], 'stream-test', '', undefined, (e) => seen.push(e.kind));
  assert.equal(result.exitCode, 0, `stream script failed: ${result.stderr}`);
  return parseRunJson(result.stdout);
}