import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DocumentStore,
  DEFAULT_DOCUMENT_MAX_CHARS,
  DOCUMENT_PREVIEW_MAX_CHARS,
  DocumentNotFoundError,
} from '../src/chat/document.ts';

describe('document store (chat-first large-prompt handling)', () => {
  it('classifies short inputs as messages and large ones as documents (deterministic rule)', () => {
    const store = new DocumentStore();
    assert.equal(store.threshold, DEFAULT_DOCUMENT_MAX_CHARS);
    assert.equal(store.classify('short prompt'), 'short');
    assert.equal(store.inDocument('short prompt'), false);
    // Boundary: at/above the threshold is a document, below is a message.
    const exactly = 'x'.repeat(DEFAULT_DOCUMENT_MAX_CHARS);
    const under = 'x'.repeat(DEFAULT_DOCUMENT_MAX_CHARS - 1);
    assert.equal(store.classify(exactly), 'document');
    assert.equal(store.classify(under), 'short');
  });

  it('ingest keeps short inputs inline (no document stored)', () => {
    const store = new DocumentStore();
    const result = store.ingest('alice', 'create a landing page');
    assert.equal(result.kind, 'message');
    assert.equal(result.message, 'create a landing page');
    assert.equal(store.countForOwner('alice'), 0); // nothing persisted to storage
  });

  it('ingest converts large inputs to a lightweight document reference', () => {
    const store = new DocumentStore();
    const markdown = `# Brief\n\n${'paragraph text. '.repeat(400)}`;
    assert.ok(markdown.length >= DEFAULT_DOCUMENT_MAX_CHARS);
    const result = store.ingest('alice', markdown);
    assert.equal(result.kind, 'document');
    assert.ok(result.documentRef);
    const ref = result.documentRef!;
    assert.ok(ref.id.startsWith('doc_'));
    assert.equal(ref.charLength, markdown.length);
    assert.equal(ref.byteLength, Buffer.byteLength(markdown, 'utf8'));
    assert.equal(ref.preview.length <= DOCUMENT_PREVIEW_MAX_CHARS + 1, true); // +1 ellipsis
    assert.equal(ref.contentHash, createHash('sha256').update(markdown).digest('hex'));
    assert.equal(store.countForOwner('alice'), 1); // stored once, chat keeps only the ref
  });

  it('preserves full content byte-for-byte and bounds default views', () => {
    const store = new DocumentStore();
    const markdown = `# verbose\n\n${'lorem ipsum dolor '.repeat(300)}`;
    const ref = store.addDocument('alice', markdown);
    assert.equal(store.getContent('alice', ref.id), markdown); // exact preservation
    const bounded = store.getView('alice', ref.id);
    assert.equal(bounded.content, undefined); // default view has NO full content
    assert.equal(bounded.preview.length <= DOCUMENT_PREVIEW_MAX_CHARS + 1, true); // +1 ellipsis
    const full = store.getView('alice', ref.id, { full: true });
    assert.equal(full.content, markdown); // explicit full only when requested
  });

  it('enforces per-user isolation for reads and removal', () => {
    const store = new DocumentStore();
    const ref = store.addDocument('alice', 'a'.repeat(DEFAULT_DOCUMENT_MAX_CHARS + 100));
    assert.throws(() => store.getContent('bob', ref.id), DocumentNotFoundError);
    assert.throws(() => store.getView('bob', ref.id) ?? null, DocumentNotFoundError);
    assert.throws(() => store.removeForOwner('bob', ref.id), DocumentNotFoundError);
    assert.equal(store.countForOwner('bob'), 0);
    assert.equal(store.listForOwner('bob').length, 0);
    // Owner can still read and remove.
    assert.equal(store.getContent('alice', ref.id).length, DEFAULT_DOCUMENT_MAX_CHARS + 100);
    store.removeForOwner('alice', ref.id);
    assert.equal(store.countForOwner('alice'), 0);
  });

  it('tolerates a configured threshold override', () => {
    const store = new DocumentStore({ maxChars: 10 });
    assert.equal(store.threshold, 10);
    assert.equal(store.classify('12345'), 'short');
    assert.equal(store.classify('12345678910'), 'document');
  });
});