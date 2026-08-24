import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';

describe('artifact id allocator', () => {
  it('allocates deterministic sequential ids per type', () => {
    const allocator = new ArtifactIdAllocator();
    assert.equal(allocator.nextId('PAGE'), 'PAGE-0001');
    assert.equal(allocator.nextId('PAGE'), 'PAGE-0002');
    assert.equal(allocator.nextId('FEATURE'), 'FEATURE-0001');
    assert.equal(allocator.nextId('PAGE'), 'PAGE-0003');
  });

  it('peek does not consume', () => {
    const allocator = new ArtifactIdAllocator();
    assert.equal(allocator.peekNext('API'), 'API-0001');
    assert.equal(allocator.peekNext('API'), 'API-0001');
    assert.equal(allocator.nextId('API'), 'API-0001');
  });

  it('seeds from existing ids and never reuses numbers', () => {
    const allocator = ArtifactIdAllocator.fromIds(['PAGE-0042', 'PAGE-0017', 'API-0003']);
    assert.equal(allocator.nextId('PAGE'), 'PAGE-0043');
    assert.equal(allocator.nextId('API'), 'API-0004');
    assert.equal(allocator.nextId('RULE'), 'RULE-0001');
  });

  it('survives snapshot round-trips (restart determinism)', () => {
    const first = new ArtifactIdAllocator();
    first.nextId('PAGE');
    first.nextId('PAGE');
    first.nextId('ENTITY');
    const second = new ArtifactIdAllocator(first.snapshot());
    assert.equal(second.nextId('PAGE'), 'PAGE-0003');
    assert.equal(second.nextId('ENTITY'), 'ENTITY-0002');
  });

  it('rejects corrupt snapshots', () => {
    assert.throws(() => new ArtifactIdAllocator({ counters: { PAGE: -5 } }));
    assert.throws(() => new ArtifactIdAllocator({ counters: { PAGE: 1.5 } }));
  });
});
