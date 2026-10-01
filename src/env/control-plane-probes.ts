/**
 * Real control-plane foundation probes (ARCHITECTURE 3.3 §134, PLATFORM
 * STARTUP GATE).
 *
 * The startup gate names the foundations that must be verified before the
 * platform accepts production engineering work: durable storage, event
 * delivery, job state, scheduler, secret boundary, and observability. A
 * configuration record existing is not verification, so every probe here
 * performs a REAL operation and reports what actually happened:
 *
 *   durable-storage  a real atomic write + read-back through the same store
 *                    primitive every durable record uses.
 *   event-delivery   a real publish + subscribe round trip on the durable bus.
 *   job-state        a real durable job-state read (the state machine's own
 *                    persisted snapshot, not an in-memory cache).
 *   scheduler        a real scheduler pass that must complete without error.
 *   secret-boundary  a real credential round trip proving the secret is
 *                    accepted, never returned, and scoped to one owner.
 *   observability    a real evidence append + read-back: the audit trail must
 *                    actually persist.
 *
 * A probe that throws is reported NOT ready with the actual error. Nothing here
 * is allowed to pass by declaring itself healthy.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDir } from '../runtime/paths.ts';
import { atomicWriteText } from '../core/json-file-store.ts';
import type { EventBus } from '../events/types.ts';
import type { ControlPlaneCapability, ControlPlaneDecision } from './foundation.ts';

export interface ControlPlaneProbePorts {
  /** Durable-state root the storage probe writes into. */
  readonly dataDir: string;
  readonly bus: EventBus;
  /** Real durable job-state read; resolves the persisted record count. */
  readonly jobStateCount: () => Promise<number>;
  /** Real scheduler pass; resolves when a scheduling sweep completed. */
  readonly schedulerPass: () => Promise<void>;
  /** Real credential boundary round trip (add + reference + secret recovery). */
  readonly secretBoundary: () => Promise<void>;
  /** Real evidence append + read-back through the durable evidence log. */
  readonly observability: () => Promise<void>;
}

function ok(capability: ControlPlaneCapability, detail: string): ControlPlaneDecision {
  return { capability, ready: true, detail, checkedAt: new Date().toISOString() };
}

function failed(capability: ControlPlaneCapability, error: unknown): ControlPlaneDecision {
  const message = error instanceof Error ? error.message : String(error);
  return {
    capability,
    ready: false,
    detail: `Probe failed: ${message}`,
    checkedAt: new Date().toISOString(),
  };
}

/** Probes durable storage with a real write/read/delete round trip. */
export async function probeDurableStorage(dataDir: string): Promise<ControlPlaneDecision> {
  const dir = join(dataDir, 'startup-probe');
  try {
    await ensureDir(dir);
    const file = join(dir, `probe-${randomUUID()}.json`);
    const payload = JSON.stringify({ probe: 'durable-storage', at: new Date().toISOString() });
    await atomicWriteText(file, payload);
    const readBack = await fs.readFile(file, 'utf8');
    await fs.unlink(file);
    if (readBack !== payload) {
      throw new Error('read-back did not match what was written');
    }
    return ok('durable-storage', `Atomic write/read/delete round trip succeeded under ${dir}.`);
  } catch (error) {
    return failed('durable-storage', error);
  }
}

/** Probes event delivery with a real publish -> receive round trip. */
export async function probeEventDelivery(bus: EventBus): Promise<ControlPlaneDecision> {
  try {
    const received = new Promise<{ type: string; payload: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('the published probe event was not delivered within 5s'));
      }, 5_000);
      const off = bus.subscribe((event) => {
        if (event.payload?.['probe'] !== 'event-delivery') return;
        clearTimeout(timer);
        off();
        resolve({ type: event.type, payload: event.payload });
      });
    });
    await bus.publish({
      type: 'supervisor.network_probe',
      payload: { probe: 'event-delivery', at: new Date().toISOString() },
    });
    const got = await received;
    if (got.type !== 'supervisor.network_probe') {
      throw new Error(`unexpected event type delivered: ${got.type}`);
    }
    return ok('event-delivery', 'A published probe event was delivered to a live subscriber through the durable bus.');
  } catch (error) {
    return failed('event-delivery', error);
  }
}

/** Probes job state by reading the real durable job snapshot. */
export async function probeJobState(
  jobStateCount: () => Promise<number>,
): Promise<ControlPlaneDecision> {
  try {
    const count = await jobStateCount();
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`durable job-state read returned a non-count: ${String(count)}`);
    }
    return ok('job-state', `The durable job-state snapshot was read successfully (${count} persisted job record(s)).`);
  } catch (error) {
    return failed('job-state', error);
  }
}

/** Probes the scheduler by running a real scheduling pass. */
export async function probeScheduler(schedulerPass: () => Promise<void>): Promise<ControlPlaneDecision> {
  try {
    await schedulerPass();
    return ok('scheduler', 'A real scheduling pass completed without error; dependency and environment gates were evaluated.');
  } catch (error) {
    return failed('scheduler', error);
  }
}

/**
 * Probes the secret boundary: a real credential is accepted, an opaque
 * reference is returned (never the secret), the secret is recoverable by its
 * owner for authorized use, and a different owner cannot read it.
 */
export async function probeSecretBoundary(
  secretBoundary: () => Promise<void>,
): Promise<ControlPlaneDecision> {
  try {
    await secretBoundary();
    return ok(
      'secret-boundary',
      'A credential round trip proved the secret is accepted, echoed only as an opaque reference, scoped to one owner, and never serialized back to a client.',
    );
  } catch (error) {
    return failed('secret-boundary', error);
  }
}

/** Probes observability with a real evidence append + read-back. */
export async function probeObservability(observability: () => Promise<void>): Promise<ControlPlaneDecision> {
  try {
    await observability();
    return ok('observability', 'The evidence trail accepted and returned a real record; the audit trail is writable and readable.');
  } catch (error) {
    return failed('observability', error);
  }
}

/** Runs every §134 control-plane probe and returns their real verdicts. */
export async function probeControlPlane(ports: ControlPlaneProbePorts): Promise<ControlPlaneDecision[]> {
  const results = await Promise.all([
    probeDurableStorage(ports.dataDir),
    probeEventDelivery(ports.bus),
    probeJobState(ports.jobStateCount),
    probeScheduler(ports.schedulerPass),
    probeSecretBoundary(ports.secretBoundary),
    probeObservability(ports.observability),
  ]);
  return results;
}
