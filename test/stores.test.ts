import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryArtifactStore } from '../src/core/memory-store.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { createArtifact } from '../src/core/artifact.ts';
import type { Actor } from '../src/core/artifact.ts';
import {
  DuplicateArtifactError,
  ArtifactNotFoundError,
  VersionConflictError,
} from '../src/core/errors.ts';

const ACTOR: Actor = { kind: 'system', id: 'store-tests' };

function sample(id: string) {
  return createArtifact({
    id,
    type: id.split('-')[0] === 'FEATURE' ? 'FEATURE' : 'PAGE',
    title: `Artifact ${id}`,
    actor: ACTOR,
    dependencies: [],
    tags: ['test'],
  });
}

async function assertStoreContract(storeFactory: () => import('../src/core/store.ts').ArtifactStore) {
  const store = storeFactory();
  await store.append(sample('PAGE-0001'));
  await store.append(sample('PAGE-0002'));

  // duplicate rejection
  await assert.rejects(() => store.append(sample('PAGE-0001')), DuplicateArtifactError);

  // read-back equality
  const fetched = await store.require('PAGE-0001');
  assert.equal(fetched.title, 'Artifact PAGE-0001');

  // missing artifact
  await assert.rejects(() => store.require('PAGE-9999'), ArtifactNotFoundError);
  assert.equal(await store.get('PAGE-9999'), null);

  // optimistic concurrency
  const current = await store.get('PAGE-0001');
  assert.ok(current);
  const updated = await store.update(current.id, current.version, (draft) => ({
    ...draft,
    title: 'Renamed',
  }));
  assert.equal(updated.version, 2);
  assert.equal(updated.title, 'Renamed');
  await assert.rejects(
    () => store.update('PAGE-0001', current.version, (d) => ({ ...d, title: 'stale' })),
    VersionConflictError,
  );

  // filters and counts
  const onlyPage2 = await store.list({ ids: ['PAGE-0002'] });
  assert.equal(onlyPage2.length, 1);
  const counts = await store.countByType();
  assert.equal(counts['PAGE'], 2);

  // reads are clones: external mutation must not corrupt the store
  const before = await store.get('PAGE-0002');
  if (before) before.title = 'MUTATED';
  const after = await store.get('PAGE-0002');
  assert.equal(after?.title, 'Artifact PAGE-0002');
}

describe('MemoryArtifactStore', () => {
  it('satisfies the shared store contract', async () => {
    await assertStoreContract(() => new MemoryArtifactStore());
  });

  it('returns deterministic id-ordered lists', async () => {
    const store = new MemoryArtifactStore();
    await store.append(sample('PAGE-0003'));
    await store.append(sample('PAGE-0001'));
    const list = await store.list();
    assert.deepEqual(list.map((a) => a.id), ['PAGE-0001', 'PAGE-0003']);
  });
});

describe('JsonFileArtifactStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bf-store-test-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('satisfies the shared store contract', async () => {
    const filePath = join(dir, 'store.json');
    await assertStoreContract(() => new JsonFileArtifactStore({ filePath }));
  });

  it('persists artifacts and allocator state across instances', async () => {
    const filePath = join(dir, 'store.json');
    const allocatorA = new ArtifactIdAllocator();
    const storeA = new JsonFileArtifactStore({ filePath, allocator: allocatorA });
    const page = createArtifact({ id: allocatorA.nextId('PAGE'), type: 'PAGE', title: 'Persisted', actor: ACTOR });
    await storeA.append(page);
    const feature = createArtifact({
      id: allocatorA.nextId('FEATURE'),
      type: 'FEATURE',
      title: 'F',
      actor: ACTOR,
      dependencies: [page.id],
    });
    await storeA.append(feature);

    // New process simulation: fresh store + fresh allocator over same file.
    const allocatorB = new ArtifactIdAllocator();
    const storeB = new JsonFileArtifactStore({ filePath, allocator: allocatorB });
    await storeB.init();
    const loaded = await storeB.get(page.id);
    assert.equal(loaded?.title, 'Persisted');
    // Allocator observes loaded artifacts; next allocation continues sequence.
    assert.equal(allocatorB.nextId('PAGE'), 'PAGE-0002');
    const depsOfFeature = (await storeB.require(feature.id)).dependencies;
    assert.deepEqual(depsOfFeature, [page.id]);
  });

  it('rejects corrupt files with a clear error', async () => {
    const filePath = join(dir, 'corrupt.json');
    await fs.writeFile(filePath, '{not json', 'utf8');
    const store = new JsonFileArtifactStore({ filePath });
    await assert.rejects(() => store.init(), /not valid JSON/);
  });

  it('overwrites safely on repeated saves (atomic write path)', async () => {
    const filePath = join(dir, 'atomic.json');
    const allocator = new ArtifactIdAllocator();
    const store = new JsonFileArtifactStore({ filePath, allocator });
    for (let i = 0; i < 5; i++) {
      const artifact = createArtifact({
        id: allocator.nextId('CONTENT'),
        type: 'CONTENT',
        title: `Item ${i}`,
        actor: ACTOR,
      });
      await store.append(artifact);
    }
    const reloaded = new JsonFileArtifactStore({ filePath });
    await reloaded.init();
    assert.equal((await reloaded.list()).length, 5);
    const leftovers = (await fs.readdir(dir)).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  });
});
