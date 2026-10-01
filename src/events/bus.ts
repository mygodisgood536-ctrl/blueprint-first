/**
 * Durable append-only event bus.
 *
 * Same durability philosophy as the other Nexona stores: a schema-versioned
 * JSON snapshot written atomically on every publish, re-hydrated on boot.
 * Statement ordering is guaranteed by the monotonic `seq`, and the seq
 * counter is persisted together with the events so a crash cannot reuse or
 * skip sequence numbers.
 *
 * Subscribers are notified synchronously in publish order; a throwing
 * listener can never break the bus (its error is swallowed per listener).
 */

import { join } from 'node:path';
import { JsonFileStore } from '../web/durable.ts';
import type { EventBus, PublishEventInput, SystemEvent } from './types.ts';

const SCHEMA_VERSION = 1;

interface EventSnapshot {
  nextSeq: number;
  events: SystemEvent[];
}

/** Default event-log path for a given data directory. */
export function eventsFilePath(dataDir: string): string {
  return join(dataDir, 'events.json');
}

function padSeq(seq: number): string {
  return String(seq).padStart(6, '0');
}

export class DurableEventBus implements EventBus {
  private readonly file: JsonFileStore<EventSnapshot>;
  private readonly listeners = new Set<(event: SystemEvent) => void>();
  private events: SystemEvent[] = [];
  private nextSeq = 1;
  private loaded = false;

  constructor(filePath: string) {
    this.file = new JsonFileStore<EventSnapshot>({
      filePath,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  /** Loads any persisted events. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      this.events = snapshot.events;
      this.nextSeq = snapshot.nextSeq;
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.init();
  }

  private async persist(): Promise<void> {
    await this.file.save({ nextSeq: this.nextSeq, events: this.events });
  }

  async publish(input: PublishEventInput): Promise<SystemEvent> {
    await this.ensureLoaded();
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const event: SystemEvent = {
      seq,
      id: `EVT-${padSeq(seq)}`,
      ts: new Date().toISOString(),
      type: input.type,
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.envId !== undefined ? { envId: input.envId } : {}),
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    this.events.push(event);
    await this.persist();
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A faulty listener must never break event delivery.
      }
    }
    return event;
  }

  subscribe(listener: (event: SystemEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async history(): Promise<readonly SystemEvent[]> {
    await this.ensureLoaded();
    return [...this.events];
  }

  async after(seq: number): Promise<readonly SystemEvent[]> {
    await this.ensureLoaded();
    return this.events.filter((e) => e.seq > seq);
  }
}