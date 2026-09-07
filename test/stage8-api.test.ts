/**
 * Stage 8 — Blueprint-First Workspace: per-stage endpoint surface.
 *
 * Exercises the real Blueprint-First engine-backed endpoints that back
 * the per-stage views in `views/project-stage.js`:
 *   - GET /api/discovery
 *   - GET /api/design
 *   - GET /api/council
 *   - GET /api/certification (used by the Blueprint stage view)
 *   - GET /api/verification
 *   - GET /api/testing
 *   - GET /api/deployment (Operations view)
 *   - GET /api/telemetry
 *   - GET /api/continuous
 *   - GET /api/recursion
 *   - GET /api/safe-change
 *   - GET /api/peo
 *
 * Plus the real action endpoints used by the project-stage view:
 *   - POST /api/projects/:id/approve  (Approval view)
 *   - POST /api/projects/:id/run/:stageId  (Build view)
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

async function buildStage8Server(): Promise<ServerHandle> {
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
  }
  return { status: res.status, body: parsed };
}

const STAGE_ENDPOINTS = [
  '/api/discovery',
  '/api/design',
  '/api/council',
  '/api/certification',
  '/api/verification',
  '/api/testing',
  '/api/deployment',
  '/api/telemetry',
  '/api/continuous',
  '/api/recursion',
  '/api/safe-change',
  '/api/peo',
];

describe('Stage 8 — Blueprint-First Workspace endpoints', () => {
  it('every per-stage GET endpoint returns 200 for an authenticated user', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_all');
      for (const path of STAGE_ENDPOINTS) {
        const r = await j(url, 'GET', path, cookie);
        assert.equal(r.status, 200, `${path} should return 200, got ${r.status}`);
        assert.ok(r.body && typeof r.body === 'object', `${path} should return a JSON object`);
      }
    } finally {
      await close();
    }
  });

  it('every per-stage GET endpoint returns 401 without a session cookie', async () => {
    const { url, close } = await buildStage8Server();
    try {
      for (const path of STAGE_ENDPOINTS) {
        const r = await j(url, 'GET', path, undefined);
        assert.equal(r.status, 401, `${path} should return 401 without a cookie, got ${r.status}`);
      }
    } finally {
      await close();
    }
  });

  it('Discovery returns the expected shape (status, artifactIds, findingIds, baseline)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_discovery');
      const r = await j(url, 'GET', '/api/discovery', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'discovery body should have status');
      assert.ok('artifactIds' in body, 'discovery body should have artifactIds');
      assert.ok(Array.isArray(body.artifactIds), 'artifactIds should be an array');
      assert.ok('findingIds' in body, 'discovery body should have findingIds');
      assert.ok('baseline' in body, 'discovery body should have baseline');
    } finally {
      await close();
    }
  });

  it('Design returns the expected shape (status, blueprintId, artifactIds, approval)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_design');
      const r = await j(url, 'GET', '/api/design', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'design body should have status');
      assert.ok('blueprintId' in body, 'design body should have blueprintId');
      assert.ok('artifactIds' in body, 'design body should have artifactIds');
      assert.ok('approval' in body, 'design body should have approval');
    } finally {
      await close();
    }
  });

  it('Verification returns the expected shape (masterPassed, subjectsAudited, blockingFails)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_verification');
      const r = await j(url, 'GET', '/api/verification', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('masterPassed' in body, 'verification body should have masterPassed');
      assert.ok('subjectsAudited' in body, 'verification body should have subjectsAudited');
      assert.ok('blockingFails' in body, 'verification body should have blockingFails');
      assert.ok('unresolvedInconclusive' in body, 'verification body should have unresolvedInconclusive');
      assert.ok('closureArtifactCount' in body, 'verification body should have closureArtifactCount');
      assert.ok('reports' in body, 'verification body should have reports');
    } finally {
      await close();
    }
  });

  it('Testing returns the expected shape (status, executed, testIds, advancedToTestVerified)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_testing');
      const r = await j(url, 'GET', '/api/testing', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'testing body should have status');
      assert.ok('executed' in body, 'testing body should have executed');
      assert.ok('testIds' in body, 'testing body should have testIds');
      assert.ok('advancedToTestVerified' in body, 'testing body should have advancedToTestVerified');
    } finally {
      await close();
    }
  });

  it('Operations/Deployment returns the expected shape', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_ops');
      const r = await j(url, 'GET', '/api/deployment', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'deployment body should have status');
      assert.ok('executed' in body, 'deployment body should have executed');
      assert.ok('deployIds' in body, 'deployment body should have deployIds');
      assert.ok('advancedToDeployedVerified' in body, 'deployment body should have advancedToDeployedVerified');
    } finally {
      await close();
    }
  });

  it('Telemetry returns the expected shape (observation, sourceKind)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_telemetry');
      const r = await j(url, 'GET', '/api/telemetry', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('sourceKind' in body, 'telemetry body should have sourceKind');
      assert.ok('observation' in body, 'telemetry body should have observation');
    } finally {
      await close();
    }
  });

  it('Continuous returns the expected shape (finalVerdict, rationale, materialization)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_continuous');
      const r = await j(url, 'GET', '/api/continuous', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('finalVerdict' in body, 'continuous body should have finalVerdict');
      assert.ok('rationale' in body, 'continuous body should have rationale');
      assert.ok('materialization' in body, 'continuous body should have materialization');
    } finally {
      await close();
    }
  });

  it('Certification (used by Blueprint view) returns status', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_cert');
      const r = await j(url, 'GET', '/api/certification', cookie);
      assert.equal(r.status, 200);
      const body = r.body as Record<string, unknown>;
      assert.ok('status' in body, 'certification body should have status');
    } finally {
      await close();
    }
  });

  it('POST /api/projects/:id/approve requires auth (401 without session)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const r = await j(url, 'POST', '/api/projects/some-id/approve');
      assert.equal(r.status, 401);
    } finally {
      await close();
    }
  });

  it('POST /api/projects/:id/approve returns 404 for an unknown project', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_approve_404');
      const r = await j(url, 'POST', '/api/projects/prj_does_not_exist/approve', cookie);
      assert.equal(r.status, 404);
    } finally {
      await close();
    }
  });

  it('POST /api/projects/:id/run/:stageId requires auth (401 without session)', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const r = await j(url, 'POST', '/api/projects/some-id/run/discovery');
      assert.equal(r.status, 401);
    } finally {
      await close();
    }
  });

  it('POST /api/projects/:id/run/:stageId returns 404 for an unknown project', async () => {
    const { url, close } = await buildStage8Server();
    try {
      const cookie = await signupCookie(url, 'stage8_run_404');
      const r = await j(url, 'POST', '/api/projects/prj_does_not_exist/run/discovery', cookie);
      assert.equal(r.status, 404);
    } finally {
      await close();
    }
  });
});


