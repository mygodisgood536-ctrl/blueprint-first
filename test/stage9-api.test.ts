/**
 * Stage 9 — Artifacts, Evidence & Traceability: endpoint surface.
 *
 * Exercises the real backend endpoints that back the Stage 9 views:
 *   - GET /api/artifacts
 *   - GET /api/artifacts/:id
 *   - GET /api/evidence
 *   - GET /api/traceability
 *   - GET /api/dependency-map
 *   - GET /api/lineage
 *   - GET /api/certification
 *
 * All assertions are made against a real HTTP server with a real
 * ProjectRegistry, JsonFileArtifactStore, and scripted AI router. No
 * mocking, no fabrication.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
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
import { tempDataDir, signupCookie } from './helpers.ts';

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

async function buildStage9Server(): Promise<ServerHandle> {
  const dataDir = await tempDataDir();
  const allocator = new ArtifactIdAllocator();
  const fileStore = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator });
  await fileStore.init();
  const graph = new KnowledgeGraph();
  const evidence = new MemoryEvidenceLog();
  const aiRouter = new AiRouter();
  const scripted = new ScriptedProvider({ rules: [] });
  aiRouter.register(scripted).setDefaultProvider('scripted');
  const services: CoreServices = { store: fileStore, allocator, graph, evidence, router: aiRouter };
  const registry = new ProjectRegistry(services);
  const result = {
    baseline: { projectId: 'demo-project', totalArtifacts: 0 },
    registry,
    services,
    evidence,
    store: fileStore,
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
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function j(url: string, method: string, path: string, cookie?: string | null, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }

describe('Stage 9 — Artifacts, Evidence & Traceability endpoints', () => {
  it('every Stage 9 GET endpoint returns 200 for an authenticated user', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_all');
      for (const path of STAGE9_ENDPOINTS) {
        const r = await j(url, 'GET', path, cookie);
        assert.equal(r.status, 200, `${path} should return 200, got ${r.status}`);
        assert.ok(r.body && typeof r.body === 'object', `${path} should return a JSON object`);
      }
    } finally {
      await close();
    }
  });

  it('every Stage 9 GET endpoint returns 401 without a session cookie', async () => {
    const { url, close } = await buildStage9Server();
    try {
      for (const path of STAGE9_ENDPOINTS) {
        const r = await j(url, 'GET', path, undefined);
        assert.equal(r.status, 401, `${path} should return 401 without a cookie, got ${r.status}`);
      }
    } finally {
      await close();
    }
  });

  it('GET /api/artifacts returns the expected shape (count, artifacts)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_artifacts');
      const r = await j(url, 'GET', '/api/artifacts', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('count' in body, 'artifacts body should have count');
      assert.ok('artifacts' in body, 'artifacts body should have artifacts');
      assert.ok(Array.isArray(body.artifacts), 'artifacts should be an array');
    } finally {
      await close();
    }
  });

  it('GET /api/artifacts/:id returns 404 for an unknown artifact', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_artifact_404');
      const r = await j(url, 'GET', '/api/artifacts/NONEXISTENT-0001', cookie);
      assert.equal(r.status, 404);
    } finally {
      await close();
    }
  });

  it('GET /api/evidence returns the expected shape (count, entries)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_evidence');
      const r = await j(url, 'GET', '/api/evidence', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('count' in body, 'evidence body should have count');
      assert.ok('entries' in body, 'evidence body should have entries');
      assert.ok(Array.isArray(body.entries), 'entries should be an array');
    } finally {
      await close();
    }
  });

  it('GET /api/traceability returns the expected shape (projectId, rows, complete)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_traceability');
      const r = await j(url, 'GET', '/api/traceability', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('projectId' in body, 'traceability body should have projectId');
      assert.ok('rows' in body, 'traceability body should have rows');
      assert.ok('complete' in body, 'traceability body should have complete');
    } finally {
      await close();
    }
  });

  it('GET /api/dependency-map returns the expected shape (nodeCount, edgeCount, edges)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_depmap');
      const r = await j(url, 'GET', '/api/dependency-map', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('nodeCount' in body, 'dependency-map body should have nodeCount');
      assert.ok('edgeCount' in body, 'dependency-map body should have edgeCount');
      assert.ok('edges' in body, 'dependency-map body should have edges');
      assert.ok(Array.isArray(body.edges), 'edges should be an array');
    } finally {
      await close();
    }
  });

  it('GET /api/lineage returns the expected shape (firstPageId, links, completeThrough, gaps)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_lineage');
      const r = await j(url, 'GET', '/api/lineage', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('firstPageId' in body, 'lineage body should have firstPageId');
      assert.ok('links' in body, 'lineage body should have links');
      assert.ok('completeThrough' in body, 'lineage body should have completeThrough');
      assert.ok('gaps' in body, 'lineage body should have gaps');
      assert.ok(Array.isArray(body.links), 'links should be an array');
      assert.ok(Array.isArray(body.gaps), 'gaps should be an array');
    } finally {
      await close();
    }
  });

  it('GET /api/certification returns the expected shape (status)', async () => {
    const { url, close } = await buildStage9Server();
    try {
      const cookie = await signupCookie(url, 'stage9_cert');
      const r = await j(url, 'GET', '/api/certification', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'certification body should have status');
    } finally {
      await close();
    }
  });
});

  }
  return { status: res.status, body: parsed };
}

const STAGE9_ENDPOINTS = [
  '/api/artifacts',
  '/api/evidence',
  '/api/traceability',
  '/api/dependency-map',
  '/api/lineage',
  '/api/certification',
];
