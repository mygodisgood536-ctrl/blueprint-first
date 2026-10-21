/**
 * ID ALLOCATION UNDER RESERVATION (production, many serverless instances).
 *
 * Each instance reserves an EXCLUSIVE block of canonical IDs from the database
 * so two instances can never mint the same ID. The reservation advances a global
 * counter BEFORE any ID from the block is minted, which is exactly what made
 * the production deployment fail: the allocator was seeded from that counter
 * and so sat at the end of the block it had just reserved, and the very first
 * ID it tried to hand out looked exhausted.
 *
 * These tests pin the corrected behaviour:
 *   - a fresh instance continues from the START of its reserved block;
 *   - an instance that observes IDs minted by another instance does NOT
 *     continue from them (those belong to the other instance's block);
 *   - an instance whose observed IDs already exceed its block takes another.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArtifactIdAllocator, ID_RESERVATION_BLOCK, type IdReservation } from '../src/core/id-allocator.ts';

/** A reservation that hands out non-overlapping blocks from a global counter. */
function globalReservation(): IdReservation & { nextValue: number } {
  const state = { nextValue: 0 };
  return {
    get nextValue() {
      return state.nextValue;
    },
    async reserve(type: string, size: number) {
      const from = state.nextValue + 1;
      const to = state.nextValue + size;
      state.nextValue = to;
      return { from, to };
    },
  };
}

describe('id allocation with reserved blocks', () => {
  it('continues from the start of its own reserved block', async () => {
    const reservation = globalReservation();
    const allocator = new ArtifactIdAllocator();
    await allocator.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);

    assert.equal(allocator.nextId('PROJECT'), 'PROJECT-0001');
    assert.equal(allocator.nextId('PROJECT'), 'PROJECT-0002');
  });

  it('does not re-mint an ID that another instance already owns', async () => {
    const reservation = globalReservation();
    // Instance A reserves the first block and mints from it.
    const instanceA = new ArtifactIdAllocator();
    await instanceA.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);
    assert.equal(instanceA.nextId('PROJECT'), 'PROJECT-0001');

    // Instance B boots. It observes the artifact instance A minted, and THEN
    // reserves its own block. It must not hand out PROJECT-0001 again.
    const instanceB = new ArtifactIdAllocator();
    instanceB.observe('PROJECT-0001');
    await instanceB.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);

    const minted = instanceB.nextId('PROJECT');
    assert.notEqual(minted, 'PROJECT-0001', 'a reserved block must never be re-minted');
    assert.equal(minted, `PROJECT-${String(ID_RESERVATION_BLOCK + 1).padStart(4, '0')}`);
  });

  it('starts above IDs that already exist when the reservation comes second', async () => {
    // The production order: the store is initialised (observing the IDs that
    // exist) and only then are the blocks reserved.
    const reservation = globalReservation();
    const allocator = new ArtifactIdAllocator();
    allocator.observe('PROJECT-0500');
    await allocator.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);

    const minted = allocator.nextId('PROJECT');
    const number = Number(minted.replace('PROJECT-', ''));
    assert.ok(number > 500, `the minted ID must be above the observed ID, got ${minted}`);
  });

  it('fails closed rather than minting a duplicate when a block is spent', async () => {
    const reservation = globalReservation();
    const allocator = new ArtifactIdAllocator();
    await allocator.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);
    // The whole block is consumed.
    for (let i = 0; i < ID_RESERVATION_BLOCK; i += 1) allocator.nextId('PROJECT');

    assert.throws(
      () => allocator.nextId('PROJECT'),
      /exhausted/i,
      'a spent block must fail closed rather than risk a duplicate ID',
    );
  });

  it('takes another block when the observed IDs already exceed it', async () => {
    const reservation = globalReservation();
    const allocator = new ArtifactIdAllocator();
    // An artifact exists far beyond the range this instance would be given.
    allocator.observe('PROJECT-9000');

    await allocator.reserve('PROJECT', ID_RESERVATION_BLOCK, reservation);

    const minted = allocator.nextId('PROJECT');
    const number = Number(minted.replace('PROJECT-', ''));
    assert.ok(number > 9000, `the minted ID must be above the observed high-water mark, got ${minted}`);
  });

  it('fails closed when a block is genuinely exhausted', async () => {
    const reservation = globalReservation();
    const allocator = new ArtifactIdAllocator();
    await allocator.reserve('PROJECT', 2, reservation);

    assert.equal(allocator.nextId('PROJECT'), 'PROJECT-0001');
    assert.equal(allocator.nextId('PROJECT'), 'PROJECT-0002');
    assert.throws(() => allocator.nextId('PROJECT'), /exhausted/i);
  });
});
