/**
 * Level 3 — AI Acceptance Testing Department tests.
 *
 * Spec §3.3 in one sentence: production and judgment stay separate jobs.
 * The Test Worker corps executes a coverage matrix derived directly from the
 * certified Master Product Inventory; the Test Boss independently reconstructs
 * the required matrix and each expected outcome without trusting the worker;
 * the Test Auditor re-executes a deterministic sample and compares results
 * byte-for-byte. Only after both judgments confirm do -TEST artifacts get
 * persisted and the Definition-of-Complete machine advances -DESIGN and -IMPL
 * items.
 *
 * These tests exercise the real departments and machinery, not mocks. They
 * are the regression boundary for the Level-3 acceptance department.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runTestDepartment } from '../src/testing/department.ts';
import { deriveExpectedCoverage, isBaseArtifactId } from '../src/testing/coverage.ts';
import { executeCheck, executeCoverage } from '../src/testing/execute.ts';
import { runTestBoss } from '../src/testing/boss.ts';
import { runTestAuditor, sampleChecks } from '../src/testing/auditor.ts';
import type { ExecutedCheck } from '../src/testing/execute.ts';

import { buildLevel2Fixture, certifiedLevel2Fixture } from './helpers/level2-fixture.ts';

test('Level 3 - coverage derivation is mechanical and deterministic', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const a = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const b = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    assert.equal(a.length, b.length);
    assert.deepEqual(a, b);
    // 2 features + 2 pages in the fixture inventory.
    assert.equal(a.length, 4);
    const features = a.filter((e) => e.kind === 'functional');
    const pages = a.filter((e) => e.kind === 'render');
    assert.equal(features.length, 2);
    assert.equal(pages.length, 2);
    for (const exp of a) {
      assert.ok(isBaseArtifactId(exp.baseId), `${exp.baseId} must be a base (non-phase) id`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - executeCheck returns sha256-anchored pass on a complete pipeline', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const expected = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const sample = expected[0];
    assert.ok(sample !== undefined);
    const result = await executeCheck(ctx.services, sample);
    assert.equal(result.baseId, sample.baseId);
    assert.equal(result.kind, sample.kind);
    assert.equal(result.passed, true);
    assert.match(result.evidenceHash, /^[0-9a-f]{64}$/);
    // Recompute the same fact set: hash is deterministic.
    const reExecuted = await executeCheck(ctx.services, sample);
    assert.equal(result.evidenceHash, reExecuted.evidenceHash);
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - Test Boss reconstructs required coverage and rejects fabricated passes', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const expected = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const executed = await executeCoverage(ctx.services, expected);

    // Happy path: identical coverage, all real passes.
    const accepted = await runTestBoss(ctx.services, ctx.discovery.projectId, executed);
    assert.equal(accepted.verdict, 'accepted');
    assert.equal(accepted.reconstructedCount, expected.length);

    // Adversarial: invent a passing check the boss never derived.
    const fakeBaseId = 'FEATURE-9999';
    const fabricated: ExecutedCheck[] = [
      ...executed,
      {
        baseId: fakeBaseId,
        kind: 'functional',
        passed: true,
        requirement: 'invented',
        observed: 'fabricated pass',
        evidenceHash: '0'.repeat(64),
      },
    ];
    const rejected = await runTestBoss(ctx.services, ctx.discovery.projectId, fabricated);
    assert.equal(rejected.verdict, 'rejected');
    assert.match(rejected.rationale, /outside the certified scope/);
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - Test Boss rejects when worker omits a required check', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const expected = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const executed = await executeCoverage(ctx.services, expected);
    const truncated = executed.slice(1); // drop the first required check
    const boss = await runTestBoss(ctx.services, ctx.discovery.projectId, truncated);
    assert.equal(boss.verdict, 'rejected');
    assert.match(boss.rationale, /required tests not run/);
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - Test Auditor re-execution reproduces evidence hashes', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const expected = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const executed = await executeCoverage(ctx.services, expected);
    const auditor = await runTestAuditor(ctx.services, executed, 2);
    assert.equal(auditor.verdict, 'confirmed');
    assert.equal(auditor.sampledIds.length, 2);
    for (const id of auditor.sampledIds) {
      const original = executed.find((c) => c.baseId === id);
      assert.ok(original !== undefined);
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - Test Auditor rejects when worker mismatches a result', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const expected = await deriveExpectedCoverage(ctx.services, ctx.discovery.projectId);
    const executed = await executeCoverage(ctx.services, expected);
    // Forge a tampered check with a different evidence hash.
    const tampered: ExecutedCheck[] = executed.map((c, i) =>
      i === 0
        ? { ...c, evidenceHash: 'f'.repeat(64) }
        : c,
    );
    const auditor = await runTestAuditor(ctx.services, tampered, 2);
    assert.equal(auditor.verdict, 'rejected');
    assert.match(auditor.rationale, /diverged/);
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - sampleChecks picks a deterministic, de-duplicated subset', () => {
  const checks: ExecutedCheck[] = Array.from({ length: 10 }, (_, i) => ({
    baseId: `FEATURE-${String(i + 1).padStart(4, '0')}`,
    kind: 'functional' as const,
    passed: true,
    requirement: 'r',
    observed: 'o',
    evidenceHash: 'a'.repeat(64),
  }));
  const a = sampleChecks(checks, 3);
  const b = sampleChecks(checks, 3);
  assert.deepEqual([...a], [...b]);
  assert.ok(a.length <= 3);
  for (const picked of a) {
    const count = a.filter((p) => p.baseId === picked.baseId).length;
    assert.equal(count, 1);
  }
});

test('Level 3 - full department pass: -TEST artifacts persisted and DoC advances', async () => {
  const ctx = await certifiedLevel2Fixture();
  try {
    // The project is CERTIFIED first (as the demo does), so the DoC walker may
    // legitimately advance past CERTIFIED to DESIGN-VERIFIED / TEST-VERIFIED.
    assert.equal(ctx.certification.certified, true);

    const before = await ctx.services.store.list({ projectId: ctx.discovery.projectId });
    const beforeTest = before.filter((a) => a.id.endsWith('-TEST')).length;

    const result = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    assert.equal(result.status, 'passed');
    assert.equal(result.failedChecks.length, 0);
    assert.equal(result.boss.verdict, 'accepted');
    assert.equal(result.auditor.verdict, 'confirmed');
    assert.ok(result.reportId !== undefined);
    assert.ok(result.evidenceId !== undefined);

    const after = await ctx.services.store.list({ projectId: ctx.discovery.projectId });
    const afterTest = after.filter((a) => a.id.endsWith('-TEST')).length;
    assert.equal(afterTest, beforeTest + result.executed.length);

    // The TEST report itself is persisted.
    const report = await ctx.services.store.require(result.reportId ?? '');
    assert.equal(report.type, 'TEST');
    assert.equal(report.attributes['totalChecks'], result.executed.length);
    assert.equal(report.attributes['passedChecks'], result.executed.length);

    // Every accepted test artifact records its sha256 evidence hash and the
    // boss/auditor rationales (inspectable judgment chain).
    const firstTest = result.testIds[0];
    assert.ok(firstTest !== undefined);
    const persisted = await ctx.services.store.require(firstTest);
    assert.match(String(persisted.attributes['evidenceHash'] ?? ''), /^[0-9a-f]{64}$/);
    assert.equal(typeof persisted.attributes['bossRationale'], 'string');
    assert.equal(typeof persisted.attributes['auditorRationale'], 'string');

    // -IMPL artifacts advanced through the Definition-of-Complete machine.
    assert.ok(result.advancedToTestVerified.length > 0);
    for (const id of result.advancedToTestVerified) {
      const impl = await ctx.services.store.require(id);
      assert.equal(impl.attributes['docState'], 'TEST-VERIFIED');
    }
    // -DESIGN artifacts advanced to DESIGN-VERIFIED.
    for (const exp of result.expected) {
      const designId = `${exp.baseId}-DESIGN`;
      const design = await ctx.services.store.get(designId);
      if (design !== null) {
        assert.equal(design.attributes['docState'], 'DESIGN-VERIFIED');
      }
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - uncertified project: the department passes but DoC advances halt honestly at CERTIFIED', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    const result = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    // The acceptance suite still passes and materializes -TEST artifacts...
    assert.equal(result.status, 'passed');
    assert.equal(result.testIds.length, result.executed.length);
    assert.ok(result.testIds.length > 0);
    // ...but without a real Level-2 certification the walker must NOT fabricate
    // CERTIFIED, so it halts and reports the documented halt.
    assert.equal(result.advancedToTestVerified.length, 0);
    assert.ok(result.docHalts.length > 0);
    for (const halt of result.docHalts) {
      assert.equal(halt.haltedAt, 'CERTIFIED');
    }
    // No design may be stamped DESIGN-VERIFIED either (it too sits behind CERTIFIED).
    const firstDesign = `${result.expected[0]?.baseId}-DESIGN`;
    assert.ok(firstDesign !== undefined);
    const design = await ctx.services.store.get(firstDesign);
    if (design !== null) {
      assert.notEqual(design.attributes['docState'], 'DESIGN-VERIFIED');
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Level 3 - failure path: when the worker has a failing check, the boss is never reached', async () => {
  const ctx = await buildLevel2Fixture();
  try {
    // Force one README design to drop below VERIFIED so the page render check fails.
    const firstPage = ctx.discovery.pages[0];
    assert.ok(firstPage !== undefined);
    const designId = `${firstPage.artifactId}-DESIGN`;
    const design = await ctx.services.store.require(designId);
    await ctx.services.store.update(designId, design.version, (draft) => ({
      ...draft,
      status: 'IN_REVIEW',
    }));

    const result = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 1 });
    assert.equal(result.status, 'failed');
    assert.ok(result.failedChecks.length > 0);
    assert.equal(result.boss.verdict, 'rejected');
    assert.equal(result.auditor.verdict, 'rejected');
    // Nothing materialized on failure.
    assert.equal(result.testIds.length, 0);
    assert.equal(result.reportId, undefined);
  } finally {
    await ctx.cleanup();
  }
});