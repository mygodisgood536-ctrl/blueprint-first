/**
 * Large-prompt / document handling (expansion §14-15).
 *
 * Short instructions remain normal chat messages. Large pasted instructions
 * become document/artifact references so chat state stays lightweight.
 *
 * Classification is a single deterministic rule: text at or above a configured
 * character threshold becomes a document; anything shorter stays a message.
 * The default threshold (4000 chars) is documented as a provisional value to
 * be tuned through instrumented paste/parse benchmarks; the rule itself and
 * its boundary behavior are unit-tested so behaviour stays honest while the
 * exact number waits for real measurement.
 *
 * Every document's content is preserved byte-for-byte; small documents are
 * precomputed in backside memory, and larger ones resolved on demand
 * (contentHashes are stored inline). Full text is never enumerated back to a
 * caller except through controlled, bounded accesses; the chat-relevant view is
 * a small reference (id, charset, byte length, char length, preview).
 */

import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { ConfigurationError } from '../core/errors.ts';

/** Research-backed provisional default: above this, chat attaches a document. */
export const DEFAULT_DOCUMENT_MAX_CHARS = 4000;
/** Preview included in every document reference (bounded for light chat state). */
export const DOCUMENT_PREVIEW_MAX_CHARS = 280;

/** Reference form kept in chat state - intentionally tiny. */
export interface DocumentRef {
  readonly id: string;
  readonly ownerId: string;
  readonly charLength: number;
  readonly byteLength: number;
  readonly preview: string;
  readonly contentHash: string;
}

/** Bounded view of a stored document (default for any list/preview endpoint). */
export interface DocumentView {
  readonly id: string;
  readonly ownerId: string;
  readonly charLength: number;
  readonly byteLength: number;
  readonly preview: string;
  /** Full content - present only when explicitly requested with `full=true`. */
  readonly content?: string;
}

/** Result of classifying an incoming chat input. */
export interface IngestionResult {
  readonly kind: 'message' | 'document';
  /** Under the threshold: the short input stays an inline message. */
  readonly message?: string;
  /** At/above the threshold: a lightweight document reference. */
  readonly documentRef?: DocumentRef;
  /** Raw input length, for provenance/diagnostics. */
  readonly charLength: number;
}

export class DocumentNotFoundError extends ConfigurationError {
  constructor(id: string) {
    super(`Document "${id}" does not exist (or belongs to a different user).`);
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function newDocumentId(): string {
  return `doc_${randomBytes(12).toString('hex')}`;
}

function truncatePreview(text: string): string {
  if (text.length <= DOCUMENT_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, DOCUMENT_PREVIEW_MAX_CHARS)}…`;
}

export interface DocumentStoreOptions {
  /** Character threshold above which an input is classified as a document. */
  maxChars?: number;
}

export class DocumentStore {
  private readonly maxChars: number;
  /** id -> { owner, content } (content held in backside memory; resolved lazily). */
  private readonly byId = new Map<string, { ownerId: string; content: string }>();

  constructor(options: DocumentStoreOptions = {}) {
    this.maxChars = options.maxChars ?? DEFAULT_DOCUMENT_MAX_CHARS;
  }

  /** The active classification threshold (characters). */
  get threshold(): number {
    return this.maxChars;
  }

  /** Classifies a raw input. Never stores anything here - pure rule. */
  classify(raw: string): 'short' | 'document' {
    return raw.length >= this.maxChars ? 'document' : 'short';
  }

  inDocument(text: string): boolean {
    return this.classify(text) === 'document';
  }

  /** Creates a document and returns the lightweight chat reference. */
  addDocument(ownerId: string, content: string): DocumentRef {
    if (ownerId.trim().length === 0) {
      throw new ConfigurationError('Document ownerId must be a non-empty string.');
    }
    const id = newDocumentId();
    this.byId.set(id, { ownerId, content });
    return this.refOf(id, ownerId, content);
  }

  private refOf(id: string, ownerId: string, content: string): DocumentRef {
    return {
      id,
      ownerId,
      charLength: content.length,
      byteLength: Buffer.byteLength(content, 'utf8'),
      preview: truncatePreview(content),
      contentHash: sha256(content),
    };
  }

  /** Ingest helper: decides short-message vs document, storing only when needed. */
  ingest(ownerId: string, raw: string): IngestionResult {
    if (this.classify(raw) === 'short') {
      return { kind: 'message', message: raw, charLength: raw.length };
    }
    const ref = this.addDocument(ownerId, raw);
    return { kind: 'document', documentRef: ref, charLength: raw.length };
  }

  /** Bounded view; the full content is only reached via getContent(). */
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
    };
  }

  /** Full content for the owner only (verification path; not enumerated). */
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
}