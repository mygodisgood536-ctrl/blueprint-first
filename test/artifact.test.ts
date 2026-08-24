import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createArtifact, withProvenance, describeActor } from '../src/core/artifact.ts';
import type { Actor } from '../src/core/artifact.ts';
import { InvalidArtifactIdError } from '../src/core/errors.ts';

const actor: Actor = { kind: 'system', id: 'test-harness' };
const aiActor: Actor = { kind: 'ai', id: 'design-worker', modelId: 'model-x' };

function baseInput() {
  return {
    id: 'PAGE-0001',
    type: 'PAGE' as const,
    title: 'Test page',
    description: 'A test artifact.',
    projectId: 'PROJECT-0001',
    actor,
  };
}

describe('artifact creation', () => {
  it('creates with version 1, DRAFT status, and a provenance trail', () => {
    const artifact = createArtifact(baseInput());
    assert.equal(artifact.version, 1);
    assert.equal(artifact.status, 'DRAFT');
    assert.equal(artifact.createdBy.id, 'test-harness');
    assert.equal(artifact.provenance.length, 1);
    assert.equal(artifact.provenance[0]?.action, 'created');
    assert.deepEqual(artifact.dependencies, []);
  });

  it('enforces identity: id type must match declared type', () => {
    assert.throws(
      () => createArtifact({ ...baseInput(), type: 'FEATURE' }),
      InvalidArtifactIdError,
    );
  });

  it('rejects empty titles and self-dependency', () => {
    assert.throws(() => createArtifact({ ...baseInput(), title: '   ' }), InvalidArtifactIdError);
    assert.throws(
      () => createArtifact({ ...baseInput(), dependencies: ['PAGE-0001'] }),
      InvalidArtifactIdError,
    );
  });

  it('normalizes the id to canonical form', () => {
    // PAGE-0001 is already canonical; a non-canonical id is rejected outright.
    assert.throws(() => createArtifact({ ...baseInput(), id: 'PAGE-1' }), InvalidArtifactIdError);
  });

  it('withProvenance bumps version and appends entries immutably', () => {
    const original = createArtifact(baseInput());
    const next = withProvenance(original, {
      at: new Date().toISOString(),
      action: 'status-changed',
      actor: aiActor,
      note: 'moved to review',
    });
    assert.equal(next.version, 2);
    assert.equal(next.provenance.length, 2);
    assert.equal(original.version, 1);
    assert.equal(original.provenance.length, 1);
  });

  it('describes actors including model provenance', () => {
    assert.equal(describeActor(aiActor), 'ai:design-worker@model-x');
    assert.equal(describeActor(actor), 'system:test-harness');
  });
});
