/**
 * Serverless supervision tick (Decision D4).
 *
 * The Execution Supervisor's three-minute hang timeout, crash recovery and
 * network-restore resume must keep working on a managed control plane, where
 * there is no long-lived daemon: a function is created for a request, does its
 * work, and is frozen or reclaimed.
 *
 * The same supervision logic therefore has two drivers:
 *   - a `setInterval` loop, used by the long-lived local process, and
 *   - this one-shot tick, invoked by the platform's scheduled watchdog so the
 *     durable supervision state advances even when nobody is browsing.
 *
 * It performs the identical scans (`tick()` then `watchdogCheck()`); it does not
 * implement a second, weaker version of the rules. A watchdog event only acts
 * when the durable supervision state shows a genuinely stuck job, and it records
 * the action as durable evidence so a recovery is never invisible.
 */

export interface WatchdogResult {
  readonly ok: boolean;
  readonly ranAt: string;
  readonly tick: {
    readonly progressed: number;
    readonly timedOut: string[];
    readonly hung: string[];
    readonly networkLost: string[];
    readonly networkRestored: string[];
    readonly environmentWaiting: string[];
    readonly resumed: string[];
    readonly quotaAlarms: number;
  };
  readonly watchdog: {
    readonly beat: boolean;
    readonly recovered: string[];
  };
  readonly detail: string;
}

export interface WatchdogTarget {
  tick(): Promise<void>;
  watchdogCheck(): Promise<boolean>;
  /** Durable supervision snapshot for an operator-facing report. */
  snapshot?(): Promise<unknown>;
}

function collect(events: readonly { type: string; payload?: Record<string, unknown> }[], type: string, key: string): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== type) continue;
    const value = event.payload?.[key];
    if (typeof value === 'string' && value.length > 0) ids.add(value);
  }
  return [...ids];
}

/**
 * Runs one complete supervision pass and reports what it actually did.
 * Safe to call concurrently with request traffic: the supervisor serializes its
 * own scans and the durable trace is the single source of truth.
 */
export async function runWatchdogTick(
  supervisor: WatchdogTarget,
  events: readonly { type: string; payload?: Record<string, unknown> }[],
): Promise<WatchdogResult> {
  const before = events.length;
  await supervisor.tick();
  const beat = await supervisor.watchdogCheck();
  const emitted = events.slice(before);
  return {
    ok: true,
    ranAt: new Date().toISOString(),
    tick: {
      progressed: emitted.filter((e) => e.type === 'supervisor.progress').length,
      timedOut: collect(emitted, 'supervisor.timeout', 'jobId'),
      hung: collect(emitted, 'supervisor.hang_suspect', 'jobId'),
      networkLost: collect(emitted, 'supervisor.network_lost', 'jobId'),
      networkRestored: collect(emitted, 'supervisor.network_restored', 'jobId'),
      environmentWaiting: collect(emitted, 'supervisor.environment_wait', 'jobId'),
      resumed: collect(emitted, 'supervisor.resumed', 'jobId'),
      quotaAlarms: emitted.filter((e) => e.type === 'supervisor.quota_alarm').length,
    },
    watchdog: {
      beat,
      recovered: collect(emitted, 'supervisor.watchdog_recovered', 'jobId'),
    },
    detail:
      emitted.length === 0
        ? 'Supervision pass completed; no job required intervention.'
        : `Supervision pass completed; ${emitted.length} event(s) recorded against the durable supervision trace.`,
  };
}