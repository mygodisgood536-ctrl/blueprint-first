import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tempDataDir } from './helpers.ts';
import { DurableEventBus, eventsFilePath } from '../src/events/bus.ts';
import {
  EnvironmentManager,
  environmentsFilePath,
  workspacesRootPath,
} from '../src/env/manager.ts';
import type { EnvironmentRecord } from '../src/env/types.ts';
import { redactTerminal } from '../src/env/local-workspace.ts';

async function until(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function untilStatus(
  manager: EnvironmentManager,
  id: string,
  status: string,
): Promise<EnvironmentRecord> {
  await until(async () => (await manager.get(id))?.status === status);
  return (await manager.get(id))!;
}

/** Reads the environment transition/readiness events currently on the bus. */
async function collectTransitions(bus: DurableEventBus) {
  const history = await bus.history();
  return history.filter((e) => e.type === 'env.transition' || e.type === 'env.readiness_verified');
}

describe('EnvironmentManager (real local workspace)', () => {
  it('provisions a real workspace and drives REQUESTED -> READY with evidence events', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const manager = new EnvironmentManager({
      filePath: environmentsFilePath(dir),
      workspacesRoot: workspacesRootPath(dir),
      bus,
    });
    await manager.init();
    const record = await manager.request({
      ownerId: 'alice',
      projectId: 'PROJ-ALPHA',
      spec: { label: 'default', gitEnabled: false },
      by: 'test',
    });
    assert.equal(record.status, 'REQUESTED');
    const ready = await untilStatus(manager, record.id, 'READY');
    assert.equal(ready.status, 'READY');
    assert.equal(ready.workspaceRoot, join(workspacesRootPath(dir), record.id));
    // The real directory and manifest exist on disk.
    const stat = await fs.stat(ready.workspaceRoot!);
    assert.ok(stat.isDirectory());
    const manifest = await fs.readFile(join(ready.workspaceRoot!, '.nexona-manifest.json'), 'utf8');
    assert.ok(manifest.includes('nexona-project-environment'));
    assert.ok(ready.lastHealth?.ok === true);
    // Events were recorded with full attribution. The readiness event is
    // published asynchronously after the status flips, so poll for it rather
    // than asserting on a snapshot that may predate it.
    const deadline = Date.now() + 10_000;
    let transitions = await collectTransitions(bus);
    while (transitions.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      transitions = await collectTransitions(bus);
    }
    assert.ok(transitions.length >= 2, `expected transition events, saw ${transitions.length}`);
    assert.ok(transitions.every((e) => e.projectId === 'PROJ-ALPHA' && e.envId === record.id && e.tenantId === 'alice'));
  });

  it('exposes real files, terminal output and git when enabled', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const manager = new EnvironmentManager({
      filePath: environmentsFilePath(dir),
      workspacesRoot: workspacesRootPath(dir),
      bus,
    });
    await manager.init();
    const record = await manager.request({
      ownerId: 'alice',
      projectId: 'PROJ-BRAVO',
      spec: { label: 'git', gitEnabled: true },
      by: 'test',
    });
    const ready = await untilStatus(manager, record.id, 'READY');

    // adapter-level file CRUD through the manager's real workspace accessor
    const adapter = await manager.workspace(record.id);
    assert.ok(adapter !== null);
    assert.equal(ready.status, 'READY');
    await adapter.writeFile('src/hello.txt', 'hello world');
    const read = await adapter.readFile('src/hello.txt');
    assert.equal(read.content, 'hello world');
    const files = await adapter.listFiles('');
    assert.ok(files.some((f) => f.name === 'src' && f.kind === 'dir'));

    // real command with real exit codes and stdout
    const ok = await adapter.runCommand('node -e "process.stdout.write(\'node-hi\')"');
    assert.equal(ok.exitCode, 0);
    assert.ok(ok.stdout.includes('node-hi'));
    const failing = await adapter.runCommand('node -e "process.exit(7)"');
    assert.equal(failing.exitCode, 7);

    // git is real when enabled
    const status = await adapter.gitStatus();
    assert.equal(status.branch, 'main');
    assert.ok(status.entries.length >= 0);

    // secret-shaped output is redacted in captured terminal
    const secret = await adapter.runCommand('node -e "console.log(\'api_key=super-secret-1234\')"');
    assert.ok(!secret.stdout.includes('super-secret-1234'));
    assert.ok(secret.stdout.includes('[REDACTED]'));

    // path traversal is rejected
    await assert.rejects(() => adapter.readFile('../outside.txt'));
    await assert.rejects(() => adapter.writeFile('../../escape.txt', 'no'));
  });

  it('redactTerminal masks credential patterns', () => {
    const out = redactTerminal('token=abc123 and Authorization: Bearer xyz and sk-abcdefghijklmnop');
    assert.ok(!out.includes('abc123'));
    assert.ok(!out.includes('xyz'));
    assert.ok(!out.includes('sk-abcdefghijklmnop'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('enforces isolation and per-project quota, and validates transitions', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const manager = new EnvironmentManager({
      filePath: environmentsFilePath(dir),
      workspacesRoot: workspacesRootPath(dir),
      bus,
    });
    await manager.init();
    const record = await manager.request({
      ownerId: 'alice',
      projectId: 'PROJ-QUOTA',
      spec: { label: 'one', gitEnabled: false },
      by: 'test',
    });
    // another owner cannot see it
    assert.equal(await manager.get(record.id, 'mallory'), null);
    // second env on the same project is refused
    await assert.rejects(
      () =>
        manager.request({
          ownerId: 'alice',
          projectId: 'PROJ-QUOTA',
          spec: { label: 'two', gitEnabled: false },
          by: 'test',
        }),
      (e: unknown) => (e as { code?: string }).code === 'ENV_QUOTA_PROJECT',
    );
    const ready = await untilStatus(manager, record.id, 'READY');
    // invalid transitions throw
    await assert.rejects(() => {
      const again = (manager as unknown as { updateStatus: (r: EnvironmentRecord, to: string, by: string) => Promise<EnvironmentRecord> });
      return again.updateStatus(ready, 'FAILED', 'test');
    });
    // pause -> resume round trip
    const paused = await manager.pause(record.id, 'test');
    assert.equal(paused?.status, 'PAUSED');
    const resumed = await manager.resume(record.id, 'test');
    assert.equal(resumed?.status, 'READY');
  });

  it('destroy removes the real workspace but keeps the durable record and events', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const manager = new EnvironmentManager({
      filePath: environmentsFilePath(dir),
      workspacesRoot: workspacesRootPath(dir),
      bus,
    });
    await manager.init();
    const record = await manager.request({
      ownerId: 'alice',
      projectId: 'PROJ-GONE',
      spec: { label: 'default', gitEnabled: false },
      by: 'test',
    });
    const ready = await untilStatus(manager, record.id, 'READY');
    const destroyed = await manager.destroy(record.id, 'test');
    assert.equal(destroyed?.status, 'DESTROYED');
    await assert.rejects(() => fs.stat(ready.workspaceRoot!));
    assert.equal((await bus.history()).some((e) => e.type === 'env.transition'), true);
  });

  it('crash recovery: READY collapses to RECOVERING on boot and re-verifies to READY', async () => {
    const dir = await tempDataDir();
    const bus = new DurableEventBus(eventsFilePath(dir));
    const file = environmentsFilePath(dir);
    const root = workspacesRootPath(dir);
    const manager = new EnvironmentManager({ filePath: file, workspacesRoot: root, bus });
    await manager.init();
    const record = await manager.request({
      ownerId: 'alice',
      projectId: 'PROJ-CRASH',
      spec: { label: 'default', gitEnabled: false },
      by: 'test',
    });
    await untilStatus(manager, record.id, 'READY');

    // simulate a restart: a fresh manager over the same durable files
    const bus2 = new DurableEventBus(eventsFilePath(dir));
    const after = new EnvironmentManager({ filePath: file, workspacesRoot: root, bus: bus2 });
    await after.init();
    const reloaded = await untilStatus(after, record.id, 'RECOVERING');
    assert.equal(reloaded.status, 'RECOVERING');
    // readiness is re-verified by a real health check
    const ready = await after.verifyHealth(record.id, 'system:health-check');
    assert.equal(ready?.status, 'READY');
    assert.ok(ready?.lastHealth?.ok === true);
  });
});
