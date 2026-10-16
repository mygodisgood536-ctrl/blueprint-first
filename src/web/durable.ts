/**
 * Generic durable store for application-layer state.
 *
 * Accounts, sessions, projects, documents, evidence, jobs, events, environments,
 * capabilities, the judgment ledger, the supervision trace and per-project stage
 * state all occupy one slot of this store. The constructor signature is
 * unchanged — callers still pass a file path — but the bytes now land in the
 * backend selected for the process (Decision D2):
 *
 *   - `json-file`    local disk, development and the test suite
 *   - `postgresql`   Neon, production (a `DATABASE_URL` is present)
 *
 * The file path is therefore a *slot name*, not a write location, and the schema
 * version is still enforced on read so an incompatible store fails closed
 * instead of being silently misread.
 */

import { basename, dirname, extname, resolve } from 'node:path';
import { BlueprintError } from '../core/errors.ts';
import { jsonFileBackend } from '../storage/json-file-backend.ts';
import {
  resolveBackend,
  selectStorageKind,
  type DurableSnapshotBackend,
} from '../storage/index.ts';

interface Envelope<T> {
  schemaVersion: number;
  savedAt: string;
  value: T;
}

export class JsonFileStore<T> {
  private readonly slot: string;
  private readonly schemaVersion: number;
  private readonly rootDir: string;
  private backendOverride?: DurableSnapshotBackend;

  constructor(options: { filePath: string; schemaVersion: number; backend?: DurableSnapshotBackend }) {
    // The file path still decides *where* development state lives, so a test
    // (or a second local instance) rooted at its own directory stays fully
    // isolated. In production the path is ignored: PostgreSQL is the substrate.
    this.rootDir = dirname(resolve(options.filePath));
    this.slot = basename(options.filePath, extname(options.filePath));
    this.schemaVersion = options.schemaVersion;
    if (options.backend !== undefined) this.backendOverride = options.backend;
  }

  /** The live durable backend. Overridable for tests. */
  backend(): DurableSnapshotBackend {
    if (this.backendOverride !== undefined) return this.backendOverride;
    this.backendOverride = selectStorageKind() === 'postgresql' ? resolveBackend() : jsonFileBackend(this.rootDir);
    return this.backendOverride;
  }

  /** Pins this store to an explicit backend (tests, alternate hosts). */
  useBackend(value: DurableSnapshotBackend): void {
    this.backendOverride = value;
  }

  /**
   * Loads the persisted value, or null when the slot has never been written
   * (first run). Throws STORE_CORRUPT on a schema-version mismatch so an
   * incompatible store is never silently ignored.
   */
  async load(): Promise<T | null> {
    const raw = await this.backend().read(this.slot);
    if (raw === null) return null;
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('schemaVersion' in raw) ||
      (raw as Envelope<T>).schemaVersion !== this.schemaVersion
    ) {
      throw new BlueprintError(
        'STORE_CORRUPT',
        `Durable store slot ${this.slot} does not match schema version ${this.schemaVersion}.`,
      );
    }
    return (raw as Envelope<T>).value;
  }

  /** Persists the value atomically in the active backend. */
  async save(value: T): Promise<void> {
    await this.backend().write(this.slot, {
      schemaVersion: this.schemaVersion,
      savedAt: new Date().toISOString(),
      value,
    } satisfies Envelope<T>);
  }

  /**
   * Serialized read-modify-write for callers that must not lose an update under
   * concurrency (used by the per-project stage ledger and the identity registry).
   */
  async update<R>(mutate: (current: T | null) => Promise<{ value: T; result: R }> | { value: T; result: R }): Promise<R> {
    return this.backend().transact(this.slot, async (current) => {
      const typed = current as Envelope<T> | null;
      if (typed !== null && typed.schemaVersion !== this.schemaVersion) {
        throw new BlueprintError(
          'STORE_CORRUPT',
          `Durable store slot ${this.slot} does not match schema version ${this.schemaVersion}.`,
        );
      }
      const { value, result } = await mutate(typed === null ? null : typed.value);
      return {
        value: { schemaVersion: this.schemaVersion, savedAt: new Date().toISOString(), value },
        result,
      };
    });
  }
}

/**
 * Stable slot name derived from a durable file path. Slots are scoped by the
 * backend root (the directory), so only the base name is needed as the key.
 */
export function slotNameFrom(filePath: string): string {
  return basename(filePath, extname(filePath));
}