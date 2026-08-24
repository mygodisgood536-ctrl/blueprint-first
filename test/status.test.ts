import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  assertTransition,
  isTerminalStatus,
  STATUS_TRANSITIONS,
} from '../src/core/status.ts';
import type { ArtifactStatus } from '../src/core/status.ts';
import { InvalidTransitionError } from '../src/core/errors.ts';

describe('artifact lifecycle state machine', () => {
  it('allows the happy path draft -> review -> verified -> approved', () => {
    assertTransition('DRAFT', 'IN_REVIEW');
    assertTransition('IN_REVIEW', 'VERIFIED');
    assertTransition('VERIFIED', 'APPROVED');
  });

  it('blocks illegal jumps with actionable messages', () => {
    assert.throws(() => assertTransition('DRAFT', 'APPROVED'), InvalidTransitionError);
    try {
      assertTransition('DRAFT', 'ARCHIVED');
      assert.fail('expected throw');
    } catch (error) {
      assert.ok(error instanceof InvalidTransitionError);
      assert.match(error.message, /DRAFT -> ARCHIVED/);
      assert.match(error.message, /IN_REVIEW/); // lists legal alternatives
    }
  });

  it('forces rework cycles through changes-requested and rejection', () => {
    assertTransition('IN_REVIEW', 'CHANGES_REQUESTED');
    assertTransition('CHANGES_REQUESTED', 'IN_REVIEW');
    assertTransition('IN_REVIEW', 'REJECTED');
    assertTransition('REJECTED', 'DRAFT');
  });

  it('treats archived as terminal', () => {
    assert.equal(isTerminalStatus('ARCHIVED'), true);
    for (const target of ARTIFACT_STATUS_ALL) {
      assert.equal(canTransition('ARCHIVED', target), false);
    }
  });

  it('has no unreachable statuses (every status is transitionable into)', () => {
    const targets = new Set<string>();
    for (const legal of Object.values(STATUS_TRANSITIONS)) {
      for (const t of legal) targets.add(t);
    }
    for (const status of ARTIFACT_STATUS_ALL) {
      if (status === 'DRAFT') continue; // initial status
      assert.ok(targets.has(status), `status ${status} is unreachable`);
    }
  });
});

const ARTIFACT_STATUS_ALL: readonly ArtifactStatus[] = [
  'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'VERIFIED', 'APPROVED',
  'REJECTED', 'BLOCKED', 'SUPERSEDED', 'DEPRECATED', 'ARCHIVED',
];
