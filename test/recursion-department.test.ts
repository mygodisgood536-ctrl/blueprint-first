/**
 * Unit tests for the Continuous Discovery Recursion (Level 4, spec §5.2).
 *
 * The recursion engine closes the feedback loop between successive
 * continuous-engineering reports. Every drift item in the new report is
 * classified into one of seven verdicts: expected, known, duplicate,
 * transient, contradiction, actionable, regression. Only actionable and
 * regression items are routed through the Safe Change Department.
 *
 * Tests here cover:
 *   - the seven-way classification,
 *   - deterministic re-classification (same inputs -> same verdict),
 *   - sha256-anchored classificationHash,
 *   - integration with the Recursion Department end-to-end.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDeltas,
  oneStepMemory,
  type RecursionResult,
} from '../src/recursion/recursion.ts';
import {
  runRecursionDepartment,
} from '../src/recursion/department.ts';
import {
  runTestDepartment,
} from '../src/testing/department.ts';
import {
  runOperationsDepartment,
} from '../src/operations/department.ts';
import {
  runContinuousWorker,
} from '../src/continuous/worker.ts';
import { certifiedLevel2Fixture } from './helpers/level2-fixture.ts';
import type { DriftItem } from '../src/verification/live-engine.ts';

function makeDrift(over: Partial<DriftItem> = {}): DriftItem {
  return {
    artifactId: 'PAGE-0001',
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'verification',
    ...over,
  };
}


describe('Recursion — classification verdicts', () => {
  it('a fresh REGRESSED item with no prior is classified as `regression`', () => {
    const cur = [makeDrift()];
    const r = classifyDeltas({ prior: [], current: cur });
    assert.equal(r.deltas.length, 1);
    assert.equal(r.deltas[0]?.verdict, 'regression');
    assert.deepEqual(r.regressions.map((d) => d.artifactId), ['PAGE-0001']);
    assert.equal(r.actionable.length, 1);
  });

  it('a fresh non-REGRESSED item with no prior is classified as `actionable`', () => {
    const cur = [makeDrift({ kind: 'DEGRADED' })];
    const r = classifyDeltas({ prior: [], current: cur });
    assert.equal(r.deltas[0]?.verdict, 'actionable');
    assert.equal(r.regressions.length, 0);
    assert.equal(r.actionable.length, 1);
  });

  it('a duplicate of the prior report is `duplicate`', () => {
    const item = makeDrift();
    const r = classifyDeltas({ prior: [item], current: [item] });
    assert.equal(r.deltas[0]?.verdict, 'duplicate');
    assert.equal(r.actionable.length, 0);
  });

  it('a contradiction (same base+dimension, different kind) is `contradiction`', () => {
    const prior = [makeDrift({ kind: 'REGRESSED' })];
    const cur = [makeDrift({ kind: 'DEGRADED' })];
    const r = classifyDeltas({ prior, current: cur });
    assert.equal(r.deltas[0]?.verdict, 'contradiction');
  });

  it('a baseId in `expectedBaseIds` is `expected` even if it is fresh', () => {
    const cur = [makeDrift({ artifactId: 'PAGE-EXPECTED' })];
    const r = classifyDeltas({
      prior: [],
      current: cur,
      expectedBaseIds: new Set(['PAGE-EXPECTED']),
    });
    assert.equal(r.deltas[0]?.verdict, 'expected');
    assert.equal(r.actionable.length, 0);
  });

  it('a baseId seen in deeper memory is `known`', () => {
    const cur = [makeDrift({ artifactId: 'PAGE-KNOWN' })];
    // 1-step memory of a single prior report containing the same item.
    const memory = oneStepMemory([makeDrift({ artifactId: 'PAGE-KNOWN', kind: 'REGRESSED' })]);
    // The current item must be a different source so it's not a `duplicate`
    // by the key(artifactId, dimension, kind, source) match. The current is
    // verification-sourced; the prior is also verification-sourced -> still
    // a duplicate. Use telemetry source to make it a different key.
    const curItem = makeDrift({ artifactId: 'PAGE-KNOWN', source: 'telemetry' });
    const r = classifyDeltas({
      prior: [makeDrift({ artifactId: 'PAGE-KNOWN', kind: 'REGRESSED' })],
      current: [curItem],
      memory,
    });
    assert.equal(r.deltas[0]?.verdict, 'known');
  });

  it('classification is deterministic: same input -> same classificationHash', () => {
    const prior = [makeDrift({ kind: 'REGRESSED' })];
    const cur = [makeDrift({ kind: 'REGRESSED' })];
    const a = classifyDeltas({ prior, current: cur });
    const b = classifyDeltas({ prior, current: cur });
    assert.equal(a.classificationHash, b.classificationHash);
    assert.match(a.classificationHash, /^[0-9a-f]{64}$/);
  });
});


describe('Recursion Department — end-to-end on a deployed project', () => {
  async function deployedReady() {
    const ctx = await certifiedLevel2Fixture();
    const t = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    if (t.status !== 'passed') throw new Error('Stage 3 precondition failed: ' + t.boss.rationale);
    const o = await runOperationsDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    if (o.status !== 'passed') throw new Error('Stage 4 precondition failed: ' + o.boss.rationale);
    return ctx;
  }

  it('when prior == current (no drift), allRemediated is true with no changes', async () => {
    const ctx = await deployedReady();
    const r1 = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const r2 = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const rec = await runRecursionDepartment(ctx.services, {
      prior: r1.driftFindings,
      current: r2.driftFindings,
      projectId: ctx.discovery.projectId,
      env: { units: new Map() },
      apply: false,
    });
    assert.equal(rec.classification.deltas.length, r2.driftFindings.length);
    // All current items are duplicates of the prior -> nothing actionable.
    assert.equal(rec.classification.actionable.length, 0);
    assert.equal(rec.classification.regressions.length, 0);
    assert.equal(rec.changes.length, 0);
    assert.equal(rec.allRemediated, true);
  });

  it('when a new REGRESSED drift appears, the recursion routes it to Safe Change', async () => {
    const ctx = await deployedReady();
    const r1 = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    // Simulate a regression on a single base.
    const target = r1.observations[0]!.baseId;
    const r2 = await runContinuousWorker(ctx.services, ctx.discovery.projectId, {
      simulateRegressed: [target],
    });
    const rec = await runRecursionDepartment(ctx.services, {
      prior: r1.driftFindings,
      current: r2.driftFindings,
      projectId: ctx.discovery.projectId,
      env: { units: new Map() },
      apply: false,
    });
    const regressions = rec.classification.regressions;
    assert.ok(regressions.length >= 1, 'expected at least one regression');
    assert.ok(regressions.some((d) => d.artifactId === target));
    // One change-department result per (actionable | regression). Items that
    // appear in both lists (same base+dimension) are deduped in the
    // department, so the changes.length is bounded by the unique items.
    const unique = new Set(
      [...regressions, ...rec.classification.actionable].map(
        (d) => d.artifactId + '::' + d.dimension,
      ),
    );
    assert.equal(rec.changes.length, unique.size);
    for (const c of rec.changes) {
      assert.ok(['AUTHORIZED_BUT_NOT_APPLIED', 'AUTHORIZED_AND_APPLIED', 'REJECTED'].includes(c.result.status));
    }
    assert.equal(rec.allRemediated, rec.changes.every((c) => c.result.status === 'AUTHORIZED_AND_APPLIED'));
  });
});
