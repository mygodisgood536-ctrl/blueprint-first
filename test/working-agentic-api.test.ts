/**
 * Layer 4 end-to-end over the REAL web layer: a Worker job whose project has a
 * READY workspace and a bound AI model runs as a real Cline-style agentic
 * session. The model itself is a stub OpenAI-compatible LOCAL runtime over a
 * real HTTP port (the same code path the Ollama/LM Studio adapter uses) that
 * returns scripted TOOL_CALL replies. What the test asserts is REAL: the file
 * the session "wrote" exists on disk, the terminal command it "ran" executed,
 * and the durable stage/evidence trail records the session honestly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import {
  buildWorkingServer,
  until,
  createProject,
  workingSignupEnrolledCookie as signupEnrolledCookie,
  workingTempDataDir as tempDataDir,
} from './working-harness.ts';

interface StubRuntime {
  url: string;
  close: () => Promise<void>;
  /** Replies served per POST /chat/completions request, in order. */
  replies: string[];
}

async function startStubRuntime(replies: string[], models: string[] = ['agenttest-v1']): Promise<StubRuntime> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id })) }));
      return;
    }
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const next = replies.shift() ?? 'Session finished without a further scripted reply.';
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: next },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    replies,
  };
}

function toolReply(input: Record<string, unknown>): string {
  return `TOOL_CALL ${JSON.stringify({ tool: 'file.write', input })}`;
}

describe('Layer 4: agentic sessions run real stages for jobs with a READY workspace', () => {
  it('a bound model drives TOOL_CALL tool effects against the real environment and records them honestly', async () => {
    const dir = await tempDataDir();
    const runtime = await startStubRuntime([
      toolReply({ path: 'src/plan.md', content: '# executed by the agentic session' }),
      'TOOL_CALL {"tool":"terminal.run","input":{"command":"node -e \\"require(\'fs\').appendFileSync(\'src/ran.txt\',\'ok\')\\""}}',
      'TOOL_CALL {"tool":"file.list","input":{"path":"src"}}',
      'DESIGN COMPLETE. Wrote src/plan.md, ran a real terminal command, listed the workspace.',
    ]);
    const providerManager = new ProviderManager();
    providerManager.setLocalRuntime({ baseUrl: runtime.url, runtime: 'ollama', defaultModel: 'agenttest-v1' });
    const s = await buildWorkingServer(dir, providerManager);
    try {
      const alice = await signupEnrolledCookie(s.url, 'agentic_e2e');
      const projectId = await createProject(s.url, alice, 'Agentic Project');

      // bind provider/model to THIS project (no credential needed for local)
      const bind = await fetch(`${s.url}/api/projects/${projectId}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'agenttest-v1' }),
      });
      assert.equal(bind.status, 200, await bind.text());

      // a READY real workspace must exist before sessions can run
      const envRes = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, label: 'agentic workspace', gitEnabled: true }),
      });
      assert.equal(envRes.status, 201);
      const env = (await envRes.json()) as { id: string; status: string };
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/environments/${env.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'READY';
      });

      // run a DESIGN job: it must execute as an AGENTIC SESSION (multiple model
      // steps + real tool effects), not a single-shot completion
      const jobRes = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, stageKey: 'design' }),
      });
      assert.equal(jobRes.status, 201);
      const job = (await jobRes.json()) as { id: string };

      await until(async () => {
        const r = await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'COMPLETED';
      });
      const done = (await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        status: string;
        result: {
          ok: boolean;
          providerId?: string;
          steps?: number;
          toolCalls?: number;
        } | null;
      };
      assert.equal(done.status, 'COMPLETED');
      assert.equal(done.result?.ok, true);
      assert.equal(done.result?.providerId, 'local', 'the bound local runtime executed the job');
      assert.ok((done.result?.toolCalls ?? 0) >= 3, `session ran real tools (toolCalls=${done.result?.toolCalls})`);
      assert.ok((done.result?.steps ?? 0) >= 4, `session took multiple model steps (steps=${done.result?.steps})`);

      // REAL effects: the agent session wrote and ran commands on disk
      const files = (await fetch(`${s.url}/api/working/files?envId=${env.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        entries: { relPath: string }[];
      };
      assert.ok(files.entries.some((e) => e.relPath.includes('src')), 'session created the src tree in the workspace');
      const read = (await fetch(`${s.url}/api/working/file?envId=${env.id}&path=src%2Fplan.md`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        content?: string;
      };
      assert.equal(read.content, '# executed by the agentic session');
      const ran = (await fetch(`${s.url}/api/working/file?envId=${env.id}&path=src%2Fran.txt`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        content?: string;
      };
      assert.equal(ran.content, 'ok', 'the session terminal.run executed for real');

      // durable trail: the stage is recorded as EXECUTED with session metadata
      const projectView = (await fetch(`${s.url}/api/projects/${projectId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        stages?: { stageId: string; status: string }[];
        aiOutputs?: Record<string, { toolLog?: { tool: string; ok: boolean }[] }>;
      };
      const designRecord = projectView.stages?.find((stage) => stage.stageId === 'design');
      assert.equal(designRecord?.status, 'EXECUTED');
      const outputs = projectView.aiOutputs?.['design'];
      assert.ok(outputs !== undefined, 'aiOutputs record for design exists');
      assert.ok(outputs.toolLog !== undefined && outputs.toolLog.length >= 3, 'toolLog is recorded');

      // event log carries the job lifecycle
      const events = (await fetch(`${s.url}/api/working/project/${projectId}/events?after=0`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        events: { type: string }[];
      };
      assert.ok(events.events.some((e) => e.type === 'job.completed'));
    } finally {
      await s.close();
      await runtime.close();
    }
  });

  it('rejects a per-run model override; the project default governs the run and the evidence trail', async () => {
    const dir = await tempDataDir();
    const runtime = await startStubRuntime(
      ['STAGE DONE: ran with the project model binding.'],
      ['agenttest-v1', 'project-default-v1'],
    );
    const providerManager = new ProviderManager();
    providerManager.setLocalRuntime({ baseUrl: runtime.url, runtime: 'ollama', defaultModel: 'project-default-v1' });
    const s = await buildWorkingServer(dir, providerManager);
    try {
      const alice = await signupEnrolledCookie(s.url, 'agentic_bind');
      const projectId = await createProject(s.url, alice, 'Binding Project');

      // project default: the authoritative model
      const bind = await fetch(`${s.url}/api/projects/${projectId}/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ providerId: 'local', modelId: 'project-default-v1' }),
      });
      assert.equal(bind.status, 200, await bind.text());

      // ready workspace so the run exercises the agentic path
      const envRes = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, label: 'binding workspace', gitEnabled: false }),
      });
      const env = (await envRes.json()) as { id: string };
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/environments/${env.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'READY';
      });

      // per-run provider/model override is NOT a configuration surface
      // (§3.3 ONE authoritative configuration, no second model selector): it is
      // rejected outright instead of silently swapping the model.
      const overrideRes = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, stageKey: 'design', providerId: 'local', modelId: 'agenttest-v1' }),
      });
      assert.equal(overrideRes.status, 400);
      const rejected = (await overrideRes.json()) as { error: string };
      assert.match(rejected.error, /override/i);

      // the governed job inherits the project configuration
      const runRes = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, stageKey: 'design' }),
      });
      assert.equal(runRes.status, 201);
      const job = (await runRes.json()) as { id: string; ai: { providerId: string; modelId: string; configVersion: number } };
      assert.equal(job.ai.providerId, 'local');
      assert.equal(job.ai.modelId, 'project-default-v1', 'the job inherits the project authoritative model');
      assert.equal(job.ai.configVersion, 1, 'the job carries the project config version');

      await until(async () => {
        const r = await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'COMPLETED';
      });
      const done = (await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        result: { providerId?: string; modelId?: number | string } | null;
      };
      assert.equal(done.result?.providerId, 'local', 'the run executed through the bound provider');
      assert.equal(done.result?.modelId, 'project-default-v1', 'the project model is stamped in the result');

      // the durable stage record reflects the EXACT model that produced it
      const projectView = (await fetch(`${s.url}/api/projects/${projectId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        aiOutputs?: Record<string, { providerId?: string; modelId?: string }>;
      };
      assert.equal(projectView.aiOutputs?.['design']?.providerId, 'local');
      assert.equal(projectView.aiOutputs?.['design']?.modelId, 'project-default-v1');

      // the project configuration itself is unchanged
      const config = (await fetch(`${s.url}/api/projects/${projectId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        aiConfig?: { providerId?: string; modelId?: string };
      };
      assert.equal(config.aiConfig?.modelId, 'project-default-v1');
    } finally {
      await s.close();
      await runtime.close();
    }
  });
});