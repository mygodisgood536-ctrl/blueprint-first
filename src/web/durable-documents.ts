/**
 * Durable document store for the Nexona product layer.
 *
 * The existing chat DocumentStore is in-memory by design ("content held in
 * backside memory"); uploaded project context must survive restarts, so this
 * adapter re-implements the same public surface with a JSON-file snapshot
 * (atomic writes). Documents are content-addressed (sha256), owner-scoped,
 * and only ever returned to their owner — the isolation rule of the original
 * store is preserved exactly.
 *
 * The threshold/classification rule stays identical to chat/document.ts so
 * short inputs remain inline messages everywhere in the product.
 */

import { join } from 'node:path';
import {
  DEFAULT_DOCUMENT_MAX_CHARS,
  DOCUMENT_PREVIEW_MAX_CHARS,
  DocumentNotFoundError,
  sha256,
} from '../chat/document.ts';
import type {
  DocumentRef,
  DocumentView,
  IngestionResult,
} from '../chat/document.ts';
import { randomBytes } from 'node:crypto';
import { ConfigurationError } from '../core/errors.ts';
import { JsonFileStore } from './durable.ts';

const SCHEMA_VERSION = 1;

interface DocumentSnapshot {
  documents: { id: string; ownerId: string; content: string; createdAt?: string }[];
}

export class DurableDocumentStore {
  private readonly maxChars: number;
  private readonly byId = new Map<string, { ownerId: string; content: string; createdAt: string }>();
  private readonly file: JsonFileStore<DocumentSnapshot>;
  private loaded = false;

  constructor(options: { filePath: string; maxChars?: number }) {
    this.maxChars = options.maxChars ?? DEFAULT_DOCUMENT_MAX_CHARS;
    this.file = new JsonFileStore<DocumentSnapshot>({ filePath: options.filePath, schemaVersion: SCHEMA_VERSION });
  }

  /** Loads persisted documents. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      for (const doc of snapshot.documents) {
        this.byId.set(doc.id, { ownerId: doc.ownerId, content: doc.content, createdAt: doc.createdAt ?? '' });
      }
    }
    this.loaded = true;
  }

  get threshold(): number {
    return this.maxChars;
  }

  classify(raw: string): 'short' | 'document' {
    return raw.length >= this.maxChars ? 'document' : 'short';
  }

  /** Classifies an upload; above threshold it is stored (durable) and referenced. */
  ingest(ownerId: string, raw: string): IngestionResult {
    if (this.classify(raw) === 'short') {
      return { kind: 'message', message: raw, charLength: raw.length };
    }
    const ref = this.addDocument(ownerId, raw);
    return { kind: 'document', documentRef: ref, charLength: raw.length };
  }

  /** Creates a durable document and returns the lightweight reference. */
  addDocument(ownerId: string, content: string): DocumentRef {
    if (ownerId.trim().length === 0) {
      throw new ConfigurationError('Document ownerId must be a non-empty string.');
    }
    const id = `doc_${randomBytes(12).toString('hex')}`;
    const createdAt = new Date().toISOString();
    this.byId.set(id, { ownerId, content, createdAt });
    // Fire-and-forget persistence would risk silent loss; but addDocument is
    // sync by contract. The server layer awaits persistDocuments() explicitly
    // after mutating calls.
    return this.refOf(id, ownerId, content, createdAt);
  }

  private refOf(id: string, ownerId: string, content: string, createdAt: string): DocumentRef {
    return {
      id,
      ownerId,
      charLength: content.length,
      byteLength: Buffer.byteLength(content, 'utf8'),
      preview: truncatePreview(content),
      contentHash: sha256(content),
      createdAt,
    };
  }

  getView(ownerId: string, id: string, options: { full?: boolean } = {}): DocumentView {
    const record = this.byId.get(id);
    if (record === undefined || record.ownerId !== ownerId) {
      throw new DocumentNotFoundError(id);
    }
    return {
      id,
      ownerId,
      charLength: record.content.length,
      byteLength: Buffer.byteLength(record.content, 'utf8'),
      preview: truncatePreview(record.content),
      ...(options.full === true ? { content: record.content } : {}),
      createdAt: record.createdAt ?? '',
    };
  }

  getContent(ownerId: string, id: string): string {
    const record = this.byId.get(id);
    if (record === undefined || record.ownerId !== ownerId) {
      throw new DocumentNotFoundError(id);
    }
    return record.content;
  }

  listForOwner(ownerId: string): readonly DocumentView[] {
    return [...this.byId.entries()]
      .filter(([, r]) => r.ownerId === ownerId)
      .map(([id, r]) => ({
        id,
        ownerId,
        charLength: r.content.length,
        byteLength: Buffer.byteLength(r.content, 'utf8'),
        preview: truncatePreview(r.content),
        createdAt: r.createdAt ?? '',
      }));
  }

  /** Documents bound to a specific project (project binding uses ownerId scope + id list). */
  getRecordsForOwner(ownerId: string): readonly { id: string; charLength: number; byteLength: number; preview: string }[] {
    return this.listForOwner(ownerId).map(({ id, charLength, byteLength, preview }) => ({
      id,
      charLength,
      byteLength,
      preview,
    }));
  }

  removeForOwner(ownerId: string, id: string): void {
    const record = this.byId.get(id);
    if (record === undefined || record.ownerId !== ownerId) {
      throw new DocumentNotFoundError(id);
    }
    this.byId.delete(id);
  }

  countForOwner(ownerId: string): number {
    return [...this.byId.values()].filter((r) => r.ownerId === ownerId).length;
  }

  /** Persists the full document map atomically. Called after every mutation. */
  async persist(): Promise<void> {
    const documents = [...this.byId.entries()].map(([id, r]) => ({
      id,
      ownerId: r.ownerId,
      content: r.content,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    }));
    await this.file.save({ documents });
  }
}

function truncatePreview(text: string): string {
  if (text.length <= DOCUMENT_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, DOCUMENT_PREVIEW_MAX_CHARS)}…`;
}

/** Default documents snapshot path for a given data directory. */
export function documentsFilePath(dataDir: string): string {
  return join(dataDir, 'documents.json');
}
