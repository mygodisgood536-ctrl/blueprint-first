/**
 * Durable system-event model for real-time work transparency.
 *
 * Events are the platform's observable history: every meaningful backend
 * state change (environment transitions, job lifecycles, file writes,
 * command runs, verification events) is published here with full
 * attribution (tenant -> project -> env -> job -> session). The bus is
 * append-only and persisted, so refresh or reconnect never erases history
 * and the frontend can replay from a known sequence number instead of
 * polling snapshots.
 */

/** A single observable event. The bus owns `seq` and `id`. */
export interface SystemEvent {
  /** Monotonic, durable sequence number (1-based); never reused. */
  readonly seq: number;
  /** Canonical id `EVT-<seq zero-padded to 6>`. */
  readonly id: string;
  /** ISO timestamp of publication. */
  readonly ts: string;
  /** Event type, e.g. 'env.transition', 'job.completed', 'file.written'. */
  readonly type: string;
  /** Account (tenant) this event belongs to. */
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly envId?: string;
  readonly jobId?: string;
  readonly sessionId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** An event being published; seq/id are assigned by the bus. */
export type PublishEventInput = Omit<SystemEvent, 'seq' | 'id' | 'ts'>;

export interface EventBus {
  /** Appends an event, assigns its sequence, persists it, notifies listeners. */
  publish(input: PublishEventInput): Promise<SystemEvent>;
  /** Registers a listener; returns an unsubscribe function. */
  subscribe(listener: (event: SystemEvent) => void): () => void;
  /** All persisted events in sequence order. */
  history(): Promise<readonly SystemEvent[]>;
  /** Persisted events strictly after the given sequence number. */
  after(seq: number): Promise<readonly SystemEvent[]>;
}