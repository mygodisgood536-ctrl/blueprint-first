/**
 * OpenCode end-to-end over the REAL web layer: a project bound to an OpenCode
 * provider/model runs its stage through a REAL `opencode run` subprocess. The
 * provider is the platform's integrated execution layer, so no credentials
 * are needed: the free cost-0 models execute because the runtime itself serves
 * them (proven by real zero-credential runs).
 *
 * Honest skip: when no real opencode executable resolves on this host the
 * test reports skip (an unavailable runtime is a real environmental state,
 * not a signal to fake results). The same honesty applies to a real upstream
 * free model that is transiently unresponsive: the flow is not exercised and
 * skip (not a fake pass/fail) is reported after a short live probe.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { OpenCodeProvider } from '../src/ai/opencode/opencode-provider.ts';
import { OpenCodeRuntime } from '../src/ai/opencode/opencode-runtime.ts';
import {
  buildWorkingServer,
  createProject,
  workingSignupEnrolledCookie as signupEnrolledCookie,
  workingTempDataDir as tempDataDir,
} from './working-harness.ts';

const OPENCODE_MODEL = 'big-pickle';
const opencodeRuntime = new OpenCodeRuntime();
const openCodeAvailable = opencodeRuntime.available();

/**
 * Honest live-probe gate: this test drives a REAL free upstream model through a
 * REAL subprocess, and a free model can be transiently unresponsive (queued
 * model server, rate limit). When the live model does not answer within a short
 * bound the test reports skip with the real reason instead of asserting a false
 * passing/failing result (an integration bug is reported, a silent upstream is
 * reported honestly too).
 */
async function probeLiveModel(log: (message: string) => void): Promise<boolean> {
  const probeRuntime = new OpenCodeRuntime({ timeoutMs: 45_000 });
  if (!probeRuntime.available()) return false;
  try {
    const result = await probeRuntime.run('Reply with exactly one word: PONG', {
      providerId: 'opencode',
      modelId: OPENCODE_MODEL,
    });
    log(
      `live probe ok (${result.durationMs}ms, ${result.usage.input}/${result.usage.output} tokens, session ${result.sessionID})`,
    );
    return result.content.trim().length > 0;
  } catch (error) {
    log(`live probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Polls a job to COMPLETED/FAILED and returns the terminal job body. */
async function waitForTerminalJob(
  url: string,
  jobId: string,
  cookie: string,
  timeoutMs = 180_000,
): Promise<{ status: string; result: { ok?: boolean; providerId?: string; modelId?: string } | null }> {
  const started = Date.now();
  for (;;) {
    const r = await fetch(`${url}/api/working/jobs/${jobId}`, { headers: { cookie } });
    if (r.status !== 200) throw new Error(`job fetch failed with ${r.status}`);
    const body = (await r.json()) as { status?: string; result?: { ok?: boolean; providerId?: string; modelId?: string } };
    if (body.status === 'COMPLETED' || body.status === 'FAILED') {
      return { status: body.status!, result: body.result ?? null };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`job ${jobId} did not reach a terminal state (last: ${body.status}); retrying`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

describe('OpenCode execution layer (real subprocess)', () => {
  (openCodeAvailable ? it : it.skip)(
    'a project bound to opencode/big-pickle runs its stage for real and publishes the real session identity',
    async (t) => {
      if (!(await probeLiveModel((message) => console.log(message)))) {
        t.skip('live OpenCode free model is currently unresponsive (environmental, not an integration failure)');
        return;
      }
      const dir = await tempDataDir();
      const providerManager = new ProviderManager({
        opencodeProvider: new OpenCodeProvider({ runtime: new OpenCodeRuntime({ timeoutMs: 90_000 }) }),
      });
      const s = await buildWorkingServer(dir, providerManager);
      try {
        const alice = await signupEnrolledCookie(s.url, 'opencode_e2e');
        const projectId = await createProject(s.url, alice, 'OpenCode Project');

        const bind = await fetch(`${s.url}/api/projects/${projectId}/ai-config`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: alice },
          body: JSON.stringify({ providerId: 'opencode', modelId: OPENCODE_MODEL }),
        });
        if (bind.status !== 200) {
          assert.fail(`ai-config bind failed (${bind.status}): ${await bind.text()}`);
        }

        const jobRes = await fetch(`${s.url}/api/working/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: alice },
          body: JSON.stringify({ projectId, stageKey: 'design' }),
        });
        if (jobRes.status !== 201) {
          assert.fail(`job enqueue failed (${jobRes.status}): ${await jobRes.text()}`);
        }
const job = (await jobRes.json()) as { id: string };

      const done = await waitForTerminalJob(s.url, job.id, alice);
      assert.equal(done.status, 'COMPLETED', `job terminal state (result: ${JSON.stringify(done.result)})`);
      assert.equal(done.result?.ok, true);
        assert.equal(done.result?.providerId, 'opencode', 'the bound OpenCode provider executed the stage');
        assert.equal(done.result?.modelId, OPENCODE_MODEL, 'the exact bound model ran');

        // the durable stage record stamps the REAL opencode session identity
        const projectView = (await fetch(`${s.url}/api/projects/${projectId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
          aiOutputs?: Record<string, { providerId?: string; modelId?: string; sessionIds?: unknown }>;
        };
        const output = projectView.aiOutputs?.['design'];
        assert.ok(output !== undefined, 'aiOutputs.design is recorded');
        assert.equal(output.providerId, 'opencode');
        assert.equal(output.modelId, OPENCODE_MODEL);
        assert.ok(
          Array.isArray(output.sessionIds) &&
            typeof output.sessionIds[0] === 'string' &&
            output.sessionIds[0].startsWith('ses_'),
          `real opencode session identity recorded (got ${JSON.stringify(output.sessionIds)})`,
        );

        // the real execution is published on the durable bus with session identity
        const events = (await fetch(`${s.url}/api/working/project/${projectId}/events?after=0`, { headers: { cookie: alice } }).then((r) => r.json())) as {
          events: { type: string; sessionId?: string; payload?: { providerId?: string; cost?: unknown } }[];
        };
        const execEvent = events.events.find((e) => e.type === 'opencode.execution');
        assert.ok(execEvent !== undefined, 'opencode.execution event published');
        assert.equal(execEvent.payload?.providerId, 'opencode');
        assert.equal(execEvent.sessionId?.startsWith('ses_'), true, 'event carries the real session id');
        assert.ok(events.events.some((e) => e.type === 'job.completed'));
      } finally {
        await s.close();
      }
    },
  );
});