import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/web/server.ts';
import { DocumentStore, DEFAULT_DOCUMENT_MAX_CHARS } from '../src/chat/document.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupCookie, tempDataDir } from './helpers.ts';
import { completeSetup } from './helpers.ts';
import { join } from 'node:path';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import type { CoreServices } from '../src/core/services.ts';

async function buildDocServer(): Promise<{ url: string; close: () => Promise<void> }> {
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
  const docStore = new DocumentStore();
  const result = { baseline: { projectId: 'demo-project' }, registry, services, evidence, store: fileStore, projectMode: 'full-product' } as unknown as DemoResult;
  const { app } = await buildServer({
    result,
    providerManager: new ProviderManager(),
    documentStore: docStore,
    dataDir,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function makeMultipart(fieldName: string, fileName: string, content: string): { body: Buffer; contentType: string } {
  const CRLF = String.fromCharCode(13, 10);
  const boundary = '----test' + Math.random().toString(36).slice(2);
  const head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"${CRLF}Content-Type: text/plain${CRLF}${CRLF}`;
  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.from(head + content + tail, 'utf8');
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('documents API (Stage 7 frontend surface)', () => {
  it('upload via multipart returns a DocumentRef, and list/detail/delete round-trip', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      await completeSetup(url, alice);
      const text = 'Hello, brief!'.repeat(50);
      const expected = text.length;
      const { body, contentType } = makeMultipart('file', 'brief.txt', text);
      const up = await fetch(`${url}/api/documents/upload`, { method: 'POST', headers: { cookie: alice, 'content-type': contentType, 'content-length': String(body.length) }, body });
      assert.equal(up.status, 201);
      const upBody = (await up.json()) as { document: { id: string; charLength: number }; fileName: string };
      assert.equal(upBody.fileName, 'brief.txt');
      assert.equal(upBody.document.charLength, expected);
      assert.ok(upBody.document.id.startsWith('doc_'));

      const list = await fetch(`${url}/api/documents`, { headers: { cookie: alice } });
      assert.equal(list.status, 200);
      const listBody = (await list.json()) as { documents: unknown[]; count: number };
      assert.equal(listBody.count, 1);
      assert.equal(listBody.documents.length, 1);

      const get = await fetch(`${url}/api/documents/${upBody.document.id}?full=true`, { headers: { cookie: alice } });
      assert.equal(get.status, 200);
      const getBody = (await get.json()) as { content: string; charLength: number };
      assert.equal(getBody.content, text.trim());
      assert.equal(getBody.charLength, expected);

      const del = await fetch(`${url}/api/documents/${upBody.document.id}`, { method: 'DELETE', headers: { cookie: alice } });
      assert.equal(del.status, 204);
      const get404 = await fetch(`${url}/api/documents/${upBody.document.id}`, { headers: { cookie: alice } });
      assert.equal(get404.status, 404);
    } finally {
      await close();
    }
  });

  it('rejects empty upload body with 400', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      await completeSetup(url, alice);
      const { body, contentType } = makeMultipart('file', 'empty.txt', '   \n  ');
      const up = await fetch(`${url}/api/documents/upload`, { method: 'POST', headers: { cookie: alice, 'content-type': contentType, 'content-length': String(body.length) }, body });
      assert.equal(up.status, 400);
    } finally {
      await close();
    }
  });

  it('enforces owner isolation on documents and 401 without a session', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const bob = await signupCookie(url, 'bob');
      await completeSetup(url, alice);
      await completeSetup(url, bob);
      const longText = 'x'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 10);
      const ingest = await fetch(`${url}/api/chat/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ text: longText }) });
      const { documentRef } = (await ingest.json()) as { documentRef: { id: string } };
      const bobRead = await fetch(`${url}/api/documents/${documentRef.id}`, { headers: { cookie: bob } });
      assert.equal(bobRead.status, 404);
      const bobDelete = await fetch(`${url}/api/documents/${documentRef.id}`, { method: 'DELETE', headers: { cookie: bob } });
      assert.equal(bobDelete.status, 404);
      const noCookie = await fetch(`${url}/api/documents`);
      assert.equal(noCookie.status, 401);
    } finally {
      await close();
    }
  });

  it('POST /api/projects accepts an optional visionDocumentId and persists it in the project config', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      await completeSetup(url, alice);
      const longVision = 'A long, deliberate vision describing the system. '.repeat(200);
      assert.ok(longVision.length >= DEFAULT_DOCUMENT_MAX_CHARS);
      const ingest = await fetch(`${url}/api/chat/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ text: longVision }) });
      const { documentRef } = (await ingest.json()) as { documentRef: { id: string } };
      const created = await fetch(`${url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ name: 'Linked Vision', vision: longVision, mode: 'design-only', visionDocumentId: documentRef.id }) });
      assert.equal(created.status, 201);
      const project = ((await created.json()) as { project: { id: string } }).project;
      const detail = await fetch(`${url}/api/projects/${project.id}`, { headers: { cookie: alice } });
      const detailBody = (await detail.json()) as { config: { visionDocument?: { id: string } } };
      assert.equal(detailBody.config.visionDocument?.id, documentRef.id);
    } finally {
      await close();
    }
  });

  it('rejects a visionDocumentId that does not belong to the caller with 400', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      await completeSetup(url, alice);
      const longVision = 'y'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 10);
      const ingest = await fetch(`${url}/api/chat/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ text: longVision }) });
      const { documentRef } = (await ingest.json()) as { documentRef: { id: string } };
      const bob = await signupCookie(url, 'bob');
      await completeSetup(url, bob);
      const created = await fetch(`${url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: bob }, body: JSON.stringify({ name: 'Borrowed', vision: longVision, mode: 'design-only', visionDocumentId: documentRef.id }) });
      assert.equal(created.status, 400);
    } finally {
      await close();
    }
  });
});


