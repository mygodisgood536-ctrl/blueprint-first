/**
 * Generic durable JSON-file store for application-layer state.
 *
 * Nexona's product layer (accounts, sessions, documents, evidence) needs
 * small, structured snapshots that survive process restarts. This module
 * provides one tiny, typed primitive for that: a schema-versioned JSON file
 * written atomically on every save (temp file + rename, Windows-safe
 * fallback reused from the core artifact store).
 *
 * Deliberately storage-light by design — the same philosophy as the core's
 * JsonFileArtifactStore: single-node durable persistence behind a narrow
 * surface, swappable for a database adapter later without touching callers.
 */

import { promises as fs } from 'node:fs';
import { BlueprintError } from '../core/errors.ts';
import { atomicWriteText } from '../core/json-file-store.ts';

interface Envelope<T> {
  schemaVersion: number;
  savedAt: string;
  value: T;
}

export class JsonFileStore<T> {
  private readonly filePath: string;
  private readonly schemaVersion: number;

  constructor(options: { filePath: string; schemaVersion: number }) {
    this.filePath = options.filePath;
    this.schemaVersion = options.schemaVersion;
  }

  /**
   * Loads the persisted value, or null when no file exists yet (first run).
   * Throws STORE_CORRUPT on invalid JSON or a schema-version mismatch so a
   * bad file is never silently ignored.
   */
  async load(): Promise<T | null> {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch {
      return null; // first run - nothing persisted yet
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new BlueprintError(
        'STORE_CORRUPT',
        `Durable store file ${this.filePath} is not valid JSON: ${(error as Error).message}`,
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('schemaVersion' in parsed) ||
      (parsed as Envelope<T>).schemaVersion !== this.schemaVersion
    ) {
      throw new BlueprintError(
        'STORE_CORRUPT',
        `Durable store file ${this.filePath} does not match schema version ${this.schemaVersion}.`,
      );
    }
    return (parsed as Envelope<T>).value;
  }

  /** Persists the value atomically (temp file + rename with fallback). */
  async save(value: T): Promise<void> {
    const envelope: Envelope<T> = {
      schemaVersion: this.schemaVersion,
      savedAt: new Date().toISOString(),
      value,
    };
    await atomicWriteText(this.filePath, JSON.stringify(envelope, null, 2));
  }
}
