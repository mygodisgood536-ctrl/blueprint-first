/**
 * Level-3 / §1.4 endpoint surface for the Recursive Page Expansion and the
 * Interactive Digital Twin:
 *   - GET /api/expansion  (Pass 10 — 14-layer determination + gate promo)
 *   - GET /api/twin       (§1.4 — element -> DESIGN -> Discovery -> evidence)
 *
 * Uses a real HTTP server with a real registry/store/evidence and a
 * result memo that is either untouched (PENDING path) or extended with the
 * engine outputs the handlers read (READY path).
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
import { tempDataDir, signupEnrolledCookie } from './helpers.ts';
import type { RecursiveExpansionResult } from '../src/discovery/department/expansion.ts';
import type { DigitalTwin } from '../src/twin/types.ts';

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

async function buildExpansionServer(extend?: (result: Partial<DemoResult>) => void): Promise<ServerHandle> {
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
  if (extend) extend(result);
  const { app } = await buildServer({ result, providerManager: new ProviderManager(), dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function j(url: string, method: string, path: string, cookie?: string | null): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: res.status, body: parsed };
}

const EXPANSION_RESULT: RecursiveExpansionResult = {
  pages: [
    {
      pageId: 'PAGE-0002',
      pageKey: 'task-board',
      title: 'Task board',
      allLayersDetermined: true,
      omissions: [],
      layers: [
        { layer: 1, name: 'Purpose & Structure', status: 'covered', note: 'Existing page inventory.', artifactIds: [] },
        { layer: 2, name: 'Content / Components', status: 'added', note: 'Content regions materialized.', artifactIds: ['SECTION-0001-CONTENT-0001'] },
        { layer: 14, name: 'Recovery', status: 'not-relevant', note: 'No interrupted-flow substrate.', artifactIds: [] },
      ],
    },
    {
      pageId: 'PAGE-0003',
      pageKey: 'task-details',
      title: 'Task details',
      allLayersDetermined: true,
      omissions: ['Layer 6 Business Rules: Delete task lacks governing RULE — routed, not invented.'],
      layers: [
        { layer: 6, name: 'Business Rules', status: 'blocked', note: 'Requires product rule authority.', artifactIds: [] },
      ],
    },
  ],
  artifactIds: ['SECTION-0001-CONTENT-0001'],
  tally: { covered: 1, added: 1, 'not-relevant': 1, blocked: 1 },
};

const TWIN_RESULT: DigitalTwin = {
  projectId: 'demo-project',
  blueprintId: 'BP-0001',
  twinArtifactId: 'TWIN-0001',
  pages: [
    {
      pageId: 'PAGE-0002',
      pageKey: 'task-board',
      title: 'Task board',
      designId: 'PAGE-0002-DESIGN',
      designBound: true,
      elements: [
        {
          id: 'PAGE-0002#section:SECTION-0001',
          kind: 'section',
          label: 'Column headers',
          surface: 'Task board',
          discoveryArtifactId: 'SECTION-0001',
          designArtifactId: 'PAGE-0002-DESIGN',
          designBound: true,
          evidenceIds: ['EV-1'],
          trace: [
            { artifactId: 'SECTION-0001', kind: 'design', label: 'Design' },
            { artifactId: 'SECTION-0001', kind: 'discovery', label: 'Discovery' },
            { artifactId: 'EV-1', kind: 'evidence', label: 'Evidence' },
          ],
        },
      ],
      edges: [{ from: 'PAGE-0002', to: 'PAGE-0002-DESIGN', relation: 'DERIVED_FROM' }],
      gaps: [],
    },
  ],
  elementCount: 1,
  boundElementCount: 1,
  gapCount: 0,
  evidenceCount: 1,
  built: true,
  note: '§1.4 twin fixture',
};

describe('Level-3 / §1.4 expansion + twin web surface', () => {
  it('both endpoints require authentication (401 without a session)', async () => {
    const { url, close } = await buildExpansionServer();
    try {
      assert.equal((await j(url, 'GET', '/api/expansion')).status, 401);
      assert.equal((await j(url, 'GET', '/api/twin')).status, 401);
    } finally {
      await close();
    }
  });

  it('report PENDING honestly until the department has run', async () => {
    const { url, close } = await buildExpansionServer();
    try {
      const cookie = await signupEnrolledCookie(url, 'expansion_pending');
      const expansion = (await j(url, 'GET', '/api/expansion', cookie)) as { status: number; body: any };
      assert.equal(expansion.status, 200);
      assert.equal(expansion.body.status, 'PENDING');
      assert.equal(expansion.body.pages.length, 0);

      const twin = (await j(url, 'GET', '/api/twin', cookie)) as { status: number; body: any };
      assert.equal(twin.status, 200);
      assert.equal(twin.body.built, false);
    } finally {
      await close();
    }
  });

  it('serve the READY expansion with the fourteen-layer records intact and the gate tallies', async () => {
    const { url, close } = await buildExpansionServer((result) => {
      Object.assign(result, {
        fullDepartment: {
          expansion: EXPANSION_RESULT,
          contentAdded: [],
          edgeStatesAdded: [],
          risks: [],
          audited: true,
          artifactIds: [],
        },
      });
    });
    try {
      const cookie = await signupEnrolledCookie(url, 'expansion_ready');
      const r = (await j(url, 'GET', '/api/expansion', cookie)) as { status: number; body: any };
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'READY');
      assert.equal(r.body.pages.length, 2);
      assert.equal(r.body.pages[0].layers.length, 3);
      assert.equal(r.body.pages[0].layers[1].status, 'added');
      assert.deepEqual(r.body.tally, EXPANSION_RESULT.tally);
      assert.equal(r.body.pages[1].omissions.length, 1);
      assert.equal(r.body.fullDepartment.audited, true);
    } finally {
      await close();
    }
  });

  it('serve the READY twin with element -> DESIGN -> Discovery -> evidence lineage', async () => {
    const { url, close } = await buildExpansionServer((result) => {
      Object.assign(result, { twin: TWIN_RESULT });
    });
    try {
      const cookie = await signupEnrolledCookie(url, 'twin_ready');
      const r = (await j(url, 'GET', '/api/twin', cookie)) as { status: number; body: any };
      assert.equal(r.status, 200);
      assert.equal(r.body.built, true);
      assert.ok(r.body.twinArtifactId.startsWith('TWIN-'));
      assert.equal(r.body.pages[0].designBound, true);
      const element = r.body.pages[0].elements[0];
      assert.equal(element.designArtifactId, 'PAGE-0002-DESIGN');
      assert.equal(element.discoveryArtifactId, 'SECTION-0001');
      assert.ok(element.trace.some((t: any) => t.kind === 'discovery'));
      assert.ok(element.trace.some((t: any) => t.kind === 'design'));
      assert.ok(element.trace.some((t: any) => t.kind === 'evidence'));
    } finally {
      await close();
    }
  });
});
