/**
 * Working execution foundation (Layers 1-3) over the REAL web layer:
 * durable environments (create -> ready -> real files/terminal/git), the
 * Worker Runtime job scheduler (honest failure when no credential is bound —
 * nothing is fabricated), execution graph, event log, and a live SSE stream.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkingServer,
  until,
  createProject,
  workingSignupEnrolledCookie as signupEnrolledCookie,
  workingTempDataDir as tempDataDir,
} from './working-harness.ts';

describe('working execution foundation over HTTP', () => {
  it('auth-gates every working endpoint', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const paths = [
        '/api/working/environments',
        '/api/working/jobs',
        '/api/working/jobs/x/pause',
        '/api/working/terminal',
      ];
      for (const p of paths) {
        const res = await fetch(`${s.url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(res.status, 401, `${p} should require auth`);
      }
      const git = await fetch(`${s.url}/api/working/git/status`);
      assert.equal(git.status, 401, '/api/working/git/status should require auth');
      const evts = await fetch(`${s.url}/api/working/jobs`);
      assert.equal(evts.status, 401);
      const files = await fetch(`${s.url}/api/working/files`);
      assert.equal(files.status, 401);
      const sup = await fetch(`${s.url}/api/working/supervisor`);
      assert.equal(sup.status, 401, '/api/working/supervisor should require auth');
    } finally {
      await s.close();
    }
  });

  it('provisions a real environment and serves real files, terminal output and git', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const alice = await signupEnrolledCookie(s.url, 'working_alice');
      const projectId = await createProject(s.url, alice, 'Workspace Alpha');

      const created = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, label: 'alpha workspace', gitEnabled: true }),
      });
      assert.equal(created.status, 201);
      const env = (await created.json()) as { id: string; status: string; workspaceRoot: string | null };
      const envId = env.id;
      assert.equal(env.status, 'REQUESTED');

      await until(async () => {
        const r = await fetch(`${s.url}/api/working/environments/${envId}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'READY';
      });
      const ready = (await fetch(`${s.url}/api/working/environments/${envId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        status: string;
        workspaceRoot: string | null;
      };
      assert.equal(ready.status, 'READY');
      assert.ok(ready.workspaceRoot !== null);

      // real files
      const put = await fetch(`${s.url}/api/working/file?envId=${envId}&path=src/notes.txt`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ content: 'hello working world' }),
      });
      assert.equal(put.status, 200);
      const read = (await fetch(`${s.url}/api/working/file?envId=${envId}&path=src/notes.txt`, { headers: { cookie: alice } }).then((r) => r.json())) as { content: string };
      assert.equal(read.content, 'hello working world');
      const listing = (await fetch(`${s.url}/api/working/files?envId=${envId}&path=`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        entries: { kind: string }[];
      };
      assert.ok(listing.entries.some((e) => e.kind === 'dir'));

      // real terminal with real exit codes and captured (credential-masked) output
      const okRun = (await fetch(`${s.url}/api/working/terminal?envId=${envId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ command: 'node -e "process.stdout.write(\'hi-from-real-shell\')"' }),
      }).then((r) => r.json())) as { exitCode: number; stdout: string };
      assert.equal(okRun.exitCode, 0);
      assert.ok(okRun.stdout.includes('hi-from-real-shell'));

      // real git tracking the real file we wrote
      const git = (await fetch(`${s.url}/api/working/git/status?envId=${envId}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        branch: string;
        entries: { path: string }[];
      };
      assert.equal(git.branch, 'main');
      assert.ok(git.entries.length > 0, 'git status has entries for the file(s) we wrote');
      assert.ok(git.entries.some((e) => e.path.includes('src')), 'src/ tree is tracked');
    } finally {
      await s.close();
    }
  });

  it('runs jobs honestly (no fabrication), exposes graph/events, isolates owners and enforces quota', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const alice = await signupEnrolledCookie(s.url, 'working_bob_owner');
      const projectId = await createProject(s.url, alice, 'Quota Gamma');
      const head = { 'content-type': 'application/json', cookie: alice } as const;

      // no verified credential/selection -> the job FAILS honestly (never faked)
      const jobRes = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId, stageKey: 'discovery' }),
      });
      assert.equal(jobRes.status, 201);
      const job = (await jobRes.json()) as { id: string; stageKey: string };
      assert.equal(job.stageKey, 'discovery');
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'FAILED';
      });
      const failed = (await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        status: string;
        error: string;
        result: { ok: boolean } | null;
      };
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.error, 'NO_VERIFIED_CREDENTIAL');
      assert.equal(failed.result?.ok, false);

      // out-of-scope stages never run (full-product scopes deployment, so use a design-only project)
      const designOnly = await fetch(`${s.url}/api/projects`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({
          name: 'Quota Gamma DnD',
          vision: 'A design-only variant used to prove out-of-scope enforcement.',
          mode: 'design-only',
        }),
      });
      const dobj = (await designOnly.json()) as { project: { id: string } };
      assert.equal(designOnly.status, 201);
      const out = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId: dobj.project.id, stageKey: 'deployment' }),
      });
      assert.equal(out.status, 409);

      // project graph reflects the real job state
      const graph = (await fetch(`${s.url}/api/working/project/${projectId}/graph`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        nodes: { id: string }[];
        statusCounts: Record<string, number>;
      };
      assert.ok(graph.nodes.length >= 1);
      assert.ok(graph.statusCounts['FAILED']! >= 1);

      // durable event log carries job/env lifecycle with project attribution
      const events = (await fetch(`${s.url}/api/working/project/${projectId}/events?after=0`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        events: { type: string; projectId: string }[];
      };
      const types = events.events.map((e) => e.type);
      assert.ok(types.includes('job.created'));
      assert.ok(types.includes('job.failed'));
      assert.ok(types.every((e) => e !== undefined));

      // isolation: a foreign user never sees this project's environments/jobs/graph
      const bob = await signupEnrolledCookie(s.url, 'working_bob_guest');
      const envList = (await fetch(`${s.url}/api/working/environments?projectId=${projectId}`, { headers: { cookie: bob } }).then((r) => r.json())) as {
        environments: unknown[];
      };
      assert.equal(envList.environments.length, 0);
      const foreignGraph = await fetch(`${s.url}/api/working/project/${projectId}/graph`, { headers: { cookie: bob } });
      assert.equal(foreignGraph.status, 404);

      // per-project quota: one environment per project, enforced server-side
      const firstEnv = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId, label: 'one', gitEnabled: false }),
      });
      assert.equal(firstEnv.status, 201);
      const secondEnv = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId, label: 'two', gitEnabled: false }),
      });
      assert.equal(secondEnv.status, 409);
      assert.equal(((await secondEnv.json()) as { code: string }).code, 'ENV_QUOTA_PROJECT');
    } finally {
      await s.close();
    }
  });

  it('streams project events over SSE (replay + live)', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const alice = await signupEnrolledCookie(s.url, 'working_sse');
      const projectId = await createProject(s.url, alice, 'Stream Delta');

      // seed the durable log with a project event before opening the stream
      const seed = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, stageKey: 'discovery' }),
      });
      assert.equal(seed.status, 201);

      const controller = new AbortController();
      const stream = fetch(`${s.url}/api/working/project/${projectId}/stream?after=0`, {
        headers: { cookie: alice },
        signal: controller.signal,
      });
      const resp = await stream;
      assert.equal(resp.status, 200);

      // replay the events already in the durable log
      const reader = resp.body!.getReader();
      const received: string[] = [];
      const replayTimer = setTimeout(() => controller.abort(), 5000);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received.push(new TextDecoder().decode(value));
          if (received.join('').includes('data:')) break;
        }
      } catch {
        // abort is expected if the flush boundary is not hit; we still assert below
      } finally {
        clearTimeout(replayTimer);
        controller.abort();
      }
      const body = received.join('');
      assert.ok(body.includes('data:'), 'SSE framing present');

      // live: a new event must be delivered as it happens
      const ctrl2 = new AbortController();
      const stream2 = fetch(`${s.url}/api/working/project/${projectId}/stream`, {
        headers: { cookie: alice },
        signal: ctrl2.signal,
      });
      const resp2 = await stream2;
      assert.equal(resp2.status, 200);
      const reader2 = resp2.body!.getReader();
      const chunks2: string[] = [];
      const liveJob = fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, stageKey: 'design' }), // stage distinct from the seed job (seed already ran discovery)
      });
      const liveTimer = setTimeout(() => ctrl2.abort(), 6000);
      let sawCreated = false;
      try {
        for (;;) {
          const { value, done } = await reader2.read();
          if (done) break;
          chunks2.push(new TextDecoder().decode(value));
          if (chunks2.join('').includes('job.created')) {
            sawCreated = true;
            break;
          }
        }
      } catch {
        // awaited below
      } finally {
        clearTimeout(liveTimer);
        ctrl2.abort();
      }
      const jobRes = await liveJob;
      assert.equal(jobRes.status, 201);
      assert.ok(sawCreated, 'live job.created event streamed');
    } finally {
      await s.close();
    }
  });

  it('the Execution Supervisor is wired into the web control plane (live loop, owner-scoped)', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const alice = await signupEnrolledCookie(s.url, 'supervisor_alice');
      const head = { 'content-type': 'application/json', cookie: alice } as const;

      // the supervisor loop is genuinely engaged after boot
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/supervisor`, { headers: { cookie: alice } });
        if (r.status !== 200) return false;
        const body = (await r.json()) as { tickSeq: number; bootId: string; lastProbe: { up: boolean } | null };
        return typeof body.bootId === 'string' && body.lastProbe !== null;
      });

      const snapshot = (await fetch(`${s.url}/api/working/supervisor`, { headers: { cookie: alice } }).then((r) => r.json())) as {
        bootId: string;
        tickSeq: number;
        networkUp: boolean | null;
        lastProbe: { up: boolean } | null;
        progressWindowMs: number;
        active: unknown[];
      };
      assert.equal(snapshot.networkUp, snapshot.lastProbe?.up);
      assert.equal(snapshot.progressWindowMs, 180_000);
      assert.ok(Array.isArray(snapshot.active));

      // a job that honestly fails (no credential) leaves nothing in the active set
      const projectId = await createProject(s.url, alice, 'Supervised Gamma');
      const jobRes = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: head,
        body: JSON.stringify({ projectId, stageKey: 'discovery' }),
      });
      assert.equal(jobRes.status, 201);
      const job = (await jobRes.json()) as { id: string };
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/jobs/${job.id}`, { headers: { cookie: alice } });
        return r.status === 200 && ((await r.json()) as { status: string }).status === 'FAILED';
      });
      await until(async () => {
        const r = await fetch(`${s.url}/api/working/supervisor`, { headers: { cookie: alice } });
        const b = (await r.json()) as { active: unknown[] };
        return !b.active.some((a) => (a as { stageKey: string }).stageKey === 'discovery');
      });
    } finally {
      await s.close();
    }
  });
});