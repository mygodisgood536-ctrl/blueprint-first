/**
 * Evidence records: the raw "proof of work" behind verification claims.
 *
 * Evidence is append-only. Every record states who produced it, when, what
 * kind of observation it captures, and which artifact IDs it concerns.
 * Verification findings may reference an evidence ID; certification logic
 * later checks that claimed work is backed by evidence (EVIDENCE_OF_WORK).
 */

import { parseArtifactId } from '../core/ids.ts';
import type { Actor } from '../core/artifact.ts';

export const EVIDENCE_KINDS = [
  'command-output',
  'test-run',
  'review',
  'inspection',
  'metric',
  'external-response',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  summary: string;
  /** Artifact IDs this evidence concerns (canonical artifact IDs). */
  artifactIds: readonly string[];
  /** Optional pointer to where the full payload lives (file/ref/hash). */
  payloadRef?: string;
  createdAt: string;
  producer: Actor;
}

export interface EvidenceLog {
  append(input: AppendEvidenceInput): Promise<EvidenceRecord>;
  forArtifact(artifactId: string): Promise<EvidenceRecord[]>;
  all(): Promise<readonly EvidenceRecord[]>;
}

export interface AppendEvidenceInput {
  kind: EvidenceKind;
  summary: string;
  artifactIds?: readonly string[];
  payloadRef?: string;
  producer: Actor;
  at?: string;
}

/**
 * In-memory append-only implementation with monotonic EV-NNNNNN ids.
 * A durable adapter can be added behind the same port without touching
 * callers (same pattern as the artifact store ports).
 */
export class MemoryEvidenceLog implements EvidenceLog {
  private records: EvidenceRecord[] = [];
  private counter = 0;

  async append(input: AppendEvidenceInput): Promise<EvidenceRecord> {
    for (const id of input.artifactIds ?? []) {
      parseArtifactId(id); // validates canonical form; throws on garbage
    }
    this.counter += 1;
    const record: EvidenceRecord = {
      id: `EV-${String(this.counter).padStart(6, '0')}`,
      kind: input.kind,
      summary: input.summary,
      artifactIds: Object.freeze([...(input.artifactIds ?? [])]),
      ...(input.payloadRef !== undefined ? { payloadRef: input.payloadRef } : {}),
      createdAt: input.at ?? new Date().toISOString(),
      producer: input.producer,
    };
    this.records.push(record);
    return record;
  }

  async forArtifact(artifactId: string): Promise<EvidenceRecord[]> {
    return this.records.filter((r) => r.artifactIds.includes(artifactId));
  }

  async all(): Promise<readonly EvidenceRecord[]> {
    return [...this.records];
  }
}
