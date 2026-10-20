/**
 * Scheduled watchdog reporting.
 *
 * The supervision tick exists because a managed control plane has no daemon:
 * a platform scheduler calls `GET /api/internal/watchdog` and the durable
 * supervision trace has to advance with nobody browsing. Two properties matter,
 * and both were wrong at once:
 *
 *   - the pass must report the events *it* emitted, not the event log as it
 *     happened to look beforehand. Reading a snapshot taken before the scan
 *     makes every report say "no job required intervention" even when the
 *     watchdog had just recovered one, which is worse than reporting nothing.
 *   - the platform's cron issues GET, so a watchdog served only by POST is a
 *     watchdog that never runs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWatchdogTick, type WatchdogTarget } from '../src/web/watchdog.ts';

type TestEvent = { type: string; payload?: Record<string, unknown> };

function fakeLog(): { history: () => Promise<TestEvent[]>; publish: (e: TestEvent) => Promise<void>; all: () => TestEvent[] } {
  const events: TestEvent[] = [];
  return {
    history: async () => events.slice(),
    publish: async (e) => {
      events.push(e);
    },
    all: () => events,
  };
}

describe('runWatchdogTick', () => {
  it('reports the events the pass itself emitted, not the log as it was beforehand', async () => {
    const log = fakeLog();
    // A supervisor that hangs a job *while* the tick runs: this is exactly the
    // shape that a pre-tick snapshot used to hide from the report.
    const supervisor: WatchdogTarget = {
      tick: async () => {
        await log.publish({ type: 'supervisor.hang_suspect', payload: { jobId: 'JOB-1' } });
        await log.publish({ type: 'supervisor.timeout', payload: { jobId: 'JOB-2' } });
        await log.publish({ type: 'supervisor.progress', payload: { jobId: 'JOB-1' } });
      },
      watchdogCheck: async () => true,
    };

    const report = await runWatchdogTick(supervisor, log.history);

    assert.deepEqual(report.tick.hung, ['JOB-1']);
    assert.deepEqual(report.tick.timedOut, ['JOB-2']);
    assert.equal(report.tick.progressed, 1);
    assert.equal(report.watchdog.beat, true);
  });

  it('excludes events that predate the pass so an old log cannot inflate a fresh report', async () => {
    const log = fakeLog();
    await log.publish({ type: 'supervisor.hang_suspect', payload: { jobId: 'JOB-OLD' } });

    const supervisor: WatchdogTarget = {
      tick: async () => {
        await log.publish({ type: 'supervisor.hang_suspect', payload: { jobId: 'JOB-NEW' } });
      },
      watchdogCheck: async () => false,
    };

    const report = await runWatchdogTick(supervisor, log.history);

    assert.deepEqual(report.tick.hung, ['JOB-NEW']);
    assert.equal(report.watchdog.beat, false);
  });

  it('reports a quiet pass honestly instead of inventing one', async () => {
    const log = fakeLog();
    const supervisor: WatchdogTarget = {
      tick: async () => {},
      watchdogCheck: async () => false,
    };

    const report = await runWatchdogTick(supervisor, log.history);

    assert.equal(report.tick.progressed, 0);
    assert.deepEqual(report.tick.hung, []);
    assert.equal(report.detail, 'Supervision pass completed; no job required intervention.');
    assert.deepEqual(log.all(), [], 'a quiet pass must not manufacture durable events');
  });

  it('counts recovered runs from the watchdog step of the same pass', async () => {
    const log = fakeLog();
    const supervisor: WatchdogTarget = {
      tick: async () => {},
      watchdogCheck: async () => {
        await log.publish({ type: 'supervisor.watchdog_recovered', payload: { jobId: 'JOB-3' } });
        return true;
      },
    };

    const report = await runWatchdogTick(supervisor, log.history);

    assert.deepEqual(report.watchdog.recovered, ['JOB-3']);
    assert.equal(report.watchdog.beat, true);
    assert.match(report.detail, /1 event\(s\) recorded/);
  });
});
