import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/web/server.ts';
import { DocumentStore, DEFAULT_DOCUMENT_MAX_CHARS } from '../src/chat/document.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { signupCookie, tempDataDir } from './helpers.ts';

/** Builds the server with a real DocumentStore and NO demo pipeline/network. */
async function buildDocServer(documentStore?: DocumentStore): Promise<{
  url: string;
  close: () => Promise<void>;
  store: DocumentStore;
}> {
  const store = documentStore ?? new DocumentStore();
  const { app } = await buildServer({
    result: { baseline: { projectId: 'p' } } as unknown as DemoResult,
    providerManager: new ProviderManager(),
    documentStore: store,
    dataDir: await tempDataDir(),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    store,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('chat-first document API (short stays message, large becomes reference)', () => {
  it('short input returns an inline message (kind=message, no stored document)', async () => {
    const { url, close, store } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const created = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: 'create a landing page' }),
      });
      assert.equal(created.status, 201);
      const body = (await created.json()) as { kind: string; message?: string };
      assert.equal(body.kind, 'message');
      assert.equal(body.message, 'create a landing page');
      assert.equal(store.countForOwner('alice'), 0); // chat stays lightweight
    } finally {
      await close();
    }
  });

  it('large input becomes a document reference, retrievable by its owner', async () => {
    const { url, close, store } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const markdown = `# Brief\n\n${'paragraph text. '.repeat(400)}`;
      assert.ok(markdown.length >= DEFAULT_DOCUMENT_MAX_CHARS);
      const created = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: markdown }),
      });
      assert.equal(created.status, 201);
      const body = (await created.json()) as {
        kind: string;
        documentRef: { id: string; preview: string; charLength: number };
      };
      assert.equal(body.kind, 'document');
      assert.ok(body.documentRef.id.startsWith('doc_'));
      assert.equal(body.documentRef.charLength, markdown.length);
      assert.equal(store.countForOwner('alice'), 1);
      const list = await fetch(`${url}/api/documents`, { headers: { cookie: alice } });
      assert.equal(((await list.json()) as { count: number }).count, 1);
      const fetched = await fetch(`${url}/api/documents/${body.documentRef.id}?full=true`, {
        headers: { cookie: alice },
      });
      assert.equal(((await fetched.json()) as { content: string }).content, markdown);
    } finally {
      await close();
    }
  });

  it('default doc view excludes full content; full is opt-in', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const markdown = 'a'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 50);
      const created = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: markdown }),
      });
      const body = (await created.json()) as { documentRef: { id: string } };
      const bounded = await fetch(`${url}/api/documents/${body.documentRef.id}`, {
        headers: { cookie: alice },
      });
      const boundedJson = (await bounded.json()) as { content?: string };
      assert.equal(boundedJson.content, undefined); // memory-conscious default view
    } finally {
      await close();
    }
  });

  it('enforces per-user isolation and 401 without a session cookie', async () => {
    const { url, close } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const bob = await signupCookie(url, 'bob');
      const markdown = 'b'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 10);
      const created = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: markdown }),
      });
      const body = (await created.json()) as { documentRef: { id: string } };
      const bobRead = await fetch(`${url}/api/documents/${body.documentRef.id}`, {
        headers: { cookie: bob },
      });
      assert.equal(bobRead.status, 404); // bob cannot read alice's document
      const bobDelete = await fetch(`${url}/api/documents/${body.documentRef.id}`, {
        method: 'DELETE',
        headers: { cookie: bob },
      });
      assert.equal(bobDelete.status, 404);
      const noCookie = await fetch(`${url}/api/documents`);
      assert.equal(noCookie.status, 401);
    } finally {
      await close();
    }
  });

  it('deletes a document for its owner and rejects empty input', async () => {
    const { url, close, store } = await buildDocServer();
    try {
      const alice = await signupCookie(url, 'alice');
      const created = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: 'x'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 10) }),
      });
      const body = (await created.json()) as { documentRef: { id: string } };
      const del = await fetch(`${url}/api/documents/${body.documentRef.id}`, {
        method: 'DELETE',
        headers: { cookie: alice },
      });
      assert.equal(del.status, 204);
      assert.equal(store.countForOwner('alice'), 0);
      const empty = await fetch(`${url}/api/chat/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ text: '' }),
      });
      assert.equal(empty.status, 400);
    } finally {
      await close();
    }
  });
});