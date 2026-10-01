import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDataDir } from './helpers.ts';
import { DurableEventBus, eventsFilePath } from '../src/events/bus.ts';
import type { SystemEvent } from '../src/events/types.ts';

describe('DurableEventBus', () => {
  it('assigns monotonic, reusable seq numbers and persists history', async () => {
    const dir = await tempDataDir();
    const file = join(dir, 'events.json');
    const bus = new DurableEventBus(file);
    await bus.init();
    const a = await bus.publish({ type: 'test.one', tenantId: 'alice', projectId: 'P-1', payload: { n: 1 } });
    const b = await bus.publish({ type: 'test.two', projectId: 'P-1', jobId: 'JOB-000001' });
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(a.id, 'EVT-000001');
    assert.equal(b.id, 'EVT-000002');
    const history = await bus.history();
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((e) => e.seq), [1, 2]);

    const reloaded = new DurableEventBus(file);
    const replay = await reloaded.history();
    assert.equal(replay.length, 2);
    assert.equal(replay[1]?.jobId, 'JOB-000001');
    assert.equal(replay[0]?.payload?.n, 1);
  });

  it('after() returns only events strictly past a sequence', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    await bus.publish({ type: 't.1' });
    await bus.publish({ type: 't.2' });
    await bus.publish({ type: 't.3' });
    const tail = await bus.after(1);
    assert.deepEqual(tail.map((e) => e.seq), [2, 3]);
  });

  it('notifies subscribers in publish order and unsubscribe works', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    const seen: SystemEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    await bus.publish({ type: 't.1' });
    await bus.publish({ type: 't.2' });
    assert.equal(seen.length, 2);
    off();
    await bus.publish({ type: 't.3' });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.type, 't.1');
    assert.equal(seen[1]?.type, 't.2');
  });

  it('a throwing subscriber never breaks the bus', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(join(dir, 'events.json'));
    await bus.init();
    bus.subscribe(() => {
      throw new Error('listener boom');
    });
    const event = await bus.publish({ type: 't.1', tenantId: 'bob' });
    assert.equal(event.seq, 1);
  });
});