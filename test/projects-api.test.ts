/**
 * Stage 6 — Projects: list API, create, workspace detail, settings (PUT),
 * stage run, isolation, delete, and iteration persistence.
 *
 * Exercises the REAL web layer over a durable artifact store + a real
 * ProjectRegistry: signup -> create -> list -> detail -> update -> run stage ->
 * (restart on same data dir) -> isolation (second user) -> delete.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import { join } from 'node:path';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { buildServer } from '../src/web/server.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import type { CoreServices } from '../src/core/services.ts';
import { tempDataDir, signupCookie, loginCookie } from './helpers.ts';

interface ServerHandle {
  app: Express;
  close: () => Promise<void>;
  url: string;
}
/** Builds the web server with real services and a durable artifact store. */
async function buildProjectServer(dataDir: string): Promise<ServerHandle> {
  const allocator = new ArtifactIdAllocator();
  const store = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator });
  await store.init();
  const graph = new KnowledgeGraph();
  const evidence = new MemoryEvidenceLog();
  const router = new AiRouter();
  const scripted = new ScriptedProvider({ rules: [] });
  router.register(scripted).setDefaultProvider('scripted');
  const services: CoreServices = { store, allocator, graph, evidence, router };
  const registry = new ProjectRegistry(services);
  const result = {
    baseline: { projectId: 'demo-project', totalArtifacts: 0 },
    registry,
    services,
    evidence,
    store,
    projectMode: 'full-product',
  } as unknown as DemoResult;

  const { app } = await buildServer({
    result,
    providerManager: new ProviderManager(),
    dataDir,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function j(url: string, method: string, path: string, cookie?: string | null, body?: unknown) {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json as Record<string, unknown> };
}

async function newUser(url: string, username: string): Promise<string> {
  return await signupCookie(url, username);
}
describe('Stage 6 — Projects API (real registry + durable store)', () => {
  it('full lifecycle: create, list, detail, update, run stage, delete', async () => {
    const dataDir = await tempDataDir();
    const s = await buildProjectServer(dataDir);
    try {
      const cookie = await newUser(s.url, 'alice_s6');

      // Create
      const created = await j(s.url, 'POST', '/api/projects', cookie, {
        name: 'Alpha Project',
        vision: 'A vision for alpha that is long enough to pass validation.',
        mode: 'full-product',
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const proj = (created.body.project ?? {}) as { id: string; title: string };
      assert.ok(typeof proj.id === 'string' && proj.id.length > 0);
      const id = proj.id;

      // List
      const list = await j(s.url, 'GET', '/api/projects', cookie);
      assert.equal(list.status, 200);
      const projects = (list.body.projects ?? []) as { id: string; mode: string }[];
      assert.ok(projects.some((p) => p.id === id));
      assert.equal(projects.find((p) => p.id === id)?.mode, 'full-product');

      // Detail with stages
      const detail = await j(s.url, 'GET', `/api/projects/${id}`, cookie);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      const stages = (detail.body.stages ?? []) as { stageId: string; inScope: boolean }[];
      assert.ok(Array.isArray(stages) && stages.length > 0);
      assert.ok(stages.some((st) => st.stageId === 'discovery' && st.inScope === true));

      // Update title + mode (PUT — the 6.4 backend gap fix)
      const upd = await j(s.url, 'PUT', `/api/projects/${id}`, cookie, {
        title: 'Alpha Renamed',
        mode: 'design-plus-code',
      });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      const afterUpd = await j(s.url, 'GET', `/api/projects/${id}`, cookie);
      const body = afterUpd.body as unknown as { title: string; mode: string };
      assert.equal(body.title, 'Alpha Renamed');
      assert.equal(body.mode, 'design-plus-code');

      // PUT validation
      const badMode = await j(s.url, 'PUT', `/api/projects/${id}`, cookie, { mode: 'bogus' });
      assert.equal(badMode.status, 400, JSON.stringify(badMode.body));
      const emptyUpd = await j(s.url, 'PUT', `/api/projects/${id}`, cookie, {});
      assert.equal(emptyUpd.status, 400, JSON.stringify(emptyUpd.body));

      // Run in-scope stage (design-plus-code: discovery in scope)
      const run = await j(s.url, 'POST', `/api/projects/${id}/run/discovery`, cookie);
      assert.equal(run.status, 200, JSON.stringify(run.body));
      const afterRun = await j(s.url, 'GET', `/api/projects/${id}`, cookie);
      const discovery = (afterRun.body.stages as unknown as { stageId: string; status: string }[]).find(
        (st) => st.stageId === 'discovery',
      );
      assert.equal(discovery?.status, 'RECORDED');

      // Out-of-scope stage rejected (design-plus-code: deployment not in scope)
      const outScope = await j(s.url, 'POST', `/api/projects/${id}/run/deployment`, cookie);
      assert.equal(outScope.status, 409, JSON.stringify(outScope.body));

      // Delete
      const del = await j(s.url, 'DELETE', `/api/projects/${id}`, cookie);
      assert.equal(del.status, 204, `status=${del.status}`);
      const afterDel = await j(s.url, 'GET', `/api/projects/${id}`, cookie);
      assert.equal(afterDel.status, 404, `status=${afterDel.status}`);
      const listAfter = await j(s.url, 'GET', '/api/projects', cookie);
      const remaining = (listAfter.body.projects ?? []) as { id: string }[];
      assert.ok(!remaining.some((p) => p.id === id));
    } finally {
      await s.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('empty state: fresh user has count 0', async () => {
    const dataDir = await tempDataDir();
    const s = await buildProjectServer(dataDir);
    try {
      const cookie = await newUser(s.url, 'empty_s6');
      const list = await j(s.url, 'GET', '/api/projects', cookie);
      assert.equal(list.status, 200);
      assert.equal(list.body.count, 0);
      assert.deepEqual(list.body.projects, []);
    } finally {
      await s.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('isolation: a second account cannot read/update/run/delete the first account project', async () => {
    const dataDir = await tempDataDir();
    const s = await buildProjectServer(dataDir);
    try {
      const alice = await newUser(s.url, 'alice_iso');
      const created = await j(s.url, 'POST', '/api/projects', alice, {
        name: 'Alice Secret',
        vision: 'A vision for alice that is long enough to pass validation.',
        mode: 'full-product',
      });
      assert.equal(created.status, 201);
      const id = (created.body.project as unknown as { id: string }).id;

      const bob = await newUser(s.url, 'bob_iso');
      const bList = await j(s.url, 'GET', '/api/projects', bob);
      assert.equal((bList.body.projects as unknown[]).length, 0);

      const bGet = await j(s.url, 'GET', `/api/projects/${id}`, bob);
      assert.equal(bGet.status, 404);

      const bPut = await j(s.url, 'PUT', `/api/projects/${id}`, bob, { title: 'Hijack' });
      assert.equal(bPut.status, 404);

      const bRun = await j(s.url, 'POST', `/api/projects/${id}/run/discovery`, bob);
      assert.equal(bRun.status, 404);

      const bDel = await j(s.url, 'DELETE', `/api/projects/${id}`, bob);
      assert.equal(bDel.status, 404);

      // Alice's project is untouched
      const stillThere = await j(s.url, 'GET', `/api/projects/${id}`, alice);
      assert.equal(stillThere.status, 200);
      assert.equal((stillThere.body as unknown as { title: string }).title, 'Alice Secret');
    } finally {
      await s.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('unauthenticated access to project endpoints returns 401', async () => {
    const dataDir = await tempDataDir();
    const s = await buildProjectServer(dataDir);
    try {
      const list = await j(s.url, 'GET', '/api/projects', null);
      assert.equal(list.status, 401);
      const create = await j(s.url, 'POST', '/api/projects', null, {
        name: 'No Auth',
        vision: 'A vision that is long enough to pass validation.',
        mode: 'full-product',
      });
      assert.equal(create.status, 401);
      const upd = await j(s.url, 'PUT', '/api/projects/PROJECT-0001', null, { title: 'x' });
      assert.equal(upd.status, 401);
    } finally {
      await s.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('iteration persistence: project survives a server restart on the same data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nexona-s6-persist-'));
    try {
      const s1 = await buildProjectServer(dataDir);
      const alice = await newUser(s1.url, 'alice_persist');
      const created = await j(s1.url, 'POST', '/api/projects', alice, {
        name: 'Persistent Project',
        vision: 'A vision that will survive a restart for validation purposes.',
        mode: 'design-plus-code',
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = (created.body.project as unknown as { id: string }).id;
      await s1.close();

      // Fresh server instance on the SAME data dir.
      const s2 = await buildProjectServer(dataDir);
      try {
        const amBack = await loginCookie(s2.url, 'alice_persist');
        const list = await j(s2.url, 'GET', '/api/projects', amBack);
        const projects = (list.body.projects ?? []) as { id: string; title: string }[];
        assert.ok(projects.some((p) => p.id === id), JSON.stringify(list.body));
        const detail = await j(s2.url, 'GET', `/api/projects/${id}`, amBack);
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal((detail.body as unknown as { title: string }).title, 'Persistent Project');
      } finally {
        await s2.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
