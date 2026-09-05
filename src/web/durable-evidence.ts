/**
 * Durable EvidenceLog adapter (Nexona product layer).
 *
 * The verification engine's EvidenceLog port (verification/evidence.ts) is
 * append-only and small; this adapter keeps the exact MemoryEvidenceLog
 * semantics (monotonic EV-NNNNNN ids, artifact-id validation) while
 * snapshotting every record to disk after each append, so the project's
 * evidence trail survives restarts. Same port, same callers, durable state.
 */

import { join } from 'node:path';
import {
  MemoryEvidenceLog,
  type AppendEvidenceInput,
  type EvidenceLog,
  type EvidenceRecord,
} from '../verification/evidence.ts';
import { JsonFileStore } from './durable.ts';

const SCHEMA_VERSION = 1;

interface EvidenceSnapshot {
  counter: number;
  records: EvidenceRecord[];
}

export class DurableEvidenceLog implements EvidenceLog {
  private readonly inner = new MemoryEvidenceLog();
  private readonly file: JsonFileStore<EvidenceSnapshot>;
  private counter = 0;
  private loaded = false;

  constructor(filePath: string) {
    this.file = new JsonFileStore<EvidenceSnapshot>({ filePath, schemaVersion: SCHEMA_VERSION });
  }

  /** Loads any persisted evidence. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      // Re-hydrate the inner log by replaying the stored records verbatim
      // (append validates ids; stored records are already canonical).
      for (const record of snapshot.records) {
        await this.inner.append({
          kind: record.kind,
          summary: record.summary,
          artifactIds: record.artifactIds,
          ...(record.payloadRef !== undefined ? { payloadRef: record.payloadRef } : {}),
          producer: record.producer,
          at: record.createdAt,
        });
      }
      this.counter = snapshot.counter;
    }
    this.loaded = true;
  }

  async append(input: AppendEvidenceInput): Promise<EvidenceRecord> {
    await this.init();
    this.counter += 1;
    // MemoryEvidenceLog assigns ids sequentially from 1; it has no seed hook,
    // so on a rehydrated log the ids already line up because we replayed every
    // prior record in order (its internal counter matches ours exactly).
    const record = await this.inner.append(input);
    await this.persist();
    return record;
  }

  async forArtifact(artifactId: string): Promise<EvidenceRecord[]> {
    await this.init();
    return this.inner.forArtifact(artifactId);
  }

  async all(): Promise<readonly EvidenceRecord[]> {
    await this.init();
    return this.inner.all();
  }

  private async persist(): Promise<void> {
    const records = [...(await this.inner.all())];
    await this.file.save({ counter: this.counter, records });
  }
}

/** Default evidence snapshot path for a given data directory. */
export function evidenceFilePath(dataDir: string): string {
  return join(dataDir, 'evidence.json');
}
