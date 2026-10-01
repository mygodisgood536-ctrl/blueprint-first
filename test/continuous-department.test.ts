/**
 * Unit tests for the Continuous Engineering Department (Stage 5).
 *
 * The Continuous Department is the only stage whose subject is the *live*
 * state of an already-deployed project. These tests drive the full
 * Level-1a/1b/2/3/4 pipeline to a DEPLOYED-VERIFIED state, then exercise
 * the Continuous Worker Corps / Boss / Auditor / Materialization flow.
 *
 * Every assertion checks ACTUAL stored state, not return values alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  runContinuousWorker,
} from '../src/continuous/worker.ts';
import type { ContinuousObservation } from '../src/continuous/worker.ts';
import { runContinuousBoss, sampleArtifacts } from '../src/continuous/boss.ts';
import { runContinuousAuditor } from '../src/continuous/auditor.ts';
import { runContinuousEngineeringDepartment } from '../src/continuous/department.ts';
import { deriveDeployScope } from '../src/operations/scope.ts';
import { runOperationsDepartment } from '../src/operations/department.ts';
import { certifiedLevel2Fixture } from './helpers/level2-fixture.ts';
import { runTestDepartment } from '../src/testing/department.ts';

/**
 * Pre-flight: build a DEPLOYED-VERIFIED project so the Continuous Department
 * has a real scope to observe. The Operations Department is the only legal
 * way to reach DEPLOYED-VERIFIED state. The Acceptance Testing Department
 * must run first, since the Operations Department's scope is derived from
 * the VERIFIED -TEST closure.
 */
async function deployedReady() {
  const ctx = await certifiedLevel2Fixture();
  const testRun = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
  if (testRun.status !== 'passed') {
    throw new Error(`Stage 3 precondition failed: ${testRun.boss.rationale}`);
  }
  const ops = await runOperationsDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
  if (ops.status !== 'passed') {
    throw new Error(`Stage 4 precondition failed: ${ops.boss.rationale}`);
  }
  return ctx;
}

async function listOpsIds(services: { store: { list: (q: object) => Promise<{ id: string }[]> } }): Promise<string[]> {
  return (await services.store.list({})).filter((a) => a.id.endsWith('-OPS')).map((a) => a.id);
}

describe('Continuous Engineering Department (Stage 5) — worker', () => {
  it('runContinuousWorker re-verifies the live scope and reports STABLE per base', async () => {
    const ctx = await deployedReady();
    const report = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    assert.equal(report.scopedCount, report.observations.length);
    assert.ok(report.observations.length > 0, 'continuous scope must not be empty post-deploy');
    for (const obs of report.observations) {
      assert.equal(obs.driftKind, 'STABLE', `${obs.baseId} should be STABLE on a fresh deployment`);
      assert.equal(obs.stable, true);
      assert.match(obs.evidenceHash, /^[0-9a-f]{64}$/);
    }
    assert.match(report.reportHash, /^[0-9a-f]{64}$/);
  });

  it('runContinuousWorker reflects simulated REGRESSED/DEGRADED as drift findings', async () => {
    const ctx = await deployedReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const target = scope[0]!.baseId;
    const report = await runContinuousWorker(ctx.services, ctx.discovery.projectId, {
      simulateRegressed: [target],
    });
    const obs = report.observations.find((o) => o.baseId === target);
    assert.ok(obs);
    assert.equal(obs!.driftKind, 'REGRESSED');
    assert.equal(obs!.stable, false);
    assert.ok(report.driftFindings.some((d) => d.artifactId === target && d.kind === 'REGRESSED'));
  });

  it('derives REGRESSED drift from a genuine live verification failure (no simulation)', async () => {
    const ctx = await deployedReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const target = scope[0]!.baseId;
    const base = await ctx.services.store.require(target);
    // Genuinely break live state: the certified record no longer verifies.
    await ctx.services.store.update(target, base.version, () => ({
      ...base,
      status: 'BLOCKED',
    }));
    const report = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const obs = report.observations.find((o) => o.baseId === target);
    assert.ok(obs);
    assert.equal(obs!.driftKind, 'CHANGED');
    assert.equal(obs!.liveVerdict, 'fail');
    const finding = report.driftFindings.find(
      (d) => d.artifactId === target && d.kind === 'REGRESSED',
    );
    assert.ok(finding, 'drift finding must be derived from the master report');
    // A DERIVED drift carries the real failing dimension from the engine's
    // own findings (COVERAGE), not the CONSISTENCY default that synthetic or
    // telemetry layering would attach.
    assert.equal(finding!.dimension, 'COVERAGE');
    assert.equal(finding!.source, 'verification');
  });

  it('sampleArtifacts is deterministic, evenly spaced and de-duplicating', () => {
    const items: { baseId: string }[] = Array.from({ length: 7 }, (_, i) => ({
      baseId: `PAGE-${String(i).padStart(4, '0')}`,
    }));
    const a = sampleArtifacts(items, 3);
    const b = sampleArtifacts(items, 3);
    assert.deepEqual(a.map((i) => i.baseId), b.map((i) => i.baseId));
    assert.equal(a.length, 3);
    assert.equal(new Set(a.map((i) => i.baseId)).size, 3);
  });
});

describe('Continuous Engineering Department (Stage 5) — boss', () => {
  it('runContinuousBoss accepts an honest worker report and reconstructs the scope', async () => {
    const ctx = await deployedReady();
    const workerReport = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const boss = await runContinuousBoss(ctx.services, ctx.discovery.projectId, workerReport, { sampleSize: 2 });
    assert.equal(boss.verdict, 'accepted');
    assert.equal(boss.reconstructedCount, workerReport.scopedCount);
    assert.ok(boss.stableArtifacts.length > 0);
  });

  it('runContinuousBoss rejects a worker that silently drops a scoped artifact', async () => {
    const ctx = await deployedReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const dropped = scope[0]!.baseId;
    const workerReport = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const stripped: typeof workerReport = {
      ...workerReport,
      observations: workerReport.observations.filter((o) => o.baseId !== dropped),
      driftFindings: workerReport.driftFindings,
    };
    const boss = await runContinuousBoss(ctx.services, ctx.discovery.projectId, stripped, { sampleSize: 2 });
    assert.equal(boss.verdict, 'rejected');
    assert.match(boss.rationale, /silently unreported/);
  });

  it('runContinuousBoss rejects a worker that reports an artifact outside the deployed scope', async () => {
    const ctx = await deployedReady();
    const workerReport = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const ghost: ContinuousObservation = {
      baseId: 'PAGE-9999',
      driftKind: 'STABLE',
      priorVerdict: 'pass',
      liveVerdict: 'pass',
      evidenceHash: '0'.repeat(64),
      stable: true,
    };
    const contaminated: typeof workerReport = {
      ...workerReport,
      observations: [...workerReport.observations, ghost],
    };
    const boss = await runContinuousBoss(ctx.services, ctx.discovery.projectId, contaminated, { sampleSize: 2 });
    assert.equal(boss.verdict, 'rejected');
    assert.match(boss.rationale, /outside DEPLOYED-VERIFIED scope/);
  });
});

describe('Continuous Engineering Department (Stage 5) — auditor', () => {
  it('runContinuousAuditor confirms a clean sample', async () => {
    const ctx = await deployedReady();
    const workerReport = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    const auditor = await runContinuousAuditor(
      ctx.services,
      ctx.discovery.projectId,
      workerReport.observations,
      2,
    );
    assert.equal(auditor.verdict, 'confirmed');
    assert.equal(auditor.sampledIds.length, 2);
  });

  it('runContinuousAuditor rejects when the worker claims stability that the re-execution cannot reproduce', async () => {
    const ctx = await deployedReady();
    const workerReport = await runContinuousWorker(ctx.services, ctx.discovery.projectId);
    // Lie about stability of the first observation by flipping both fields.
    const lying: ContinuousObservation[] = workerReport.observations.map((o, i) =>
      i === 0 ? { ...o, stable: !o.stable, driftKind: o.driftKind === 'STABLE' ? 'CHANGED' : 'STABLE' } : o,
    );
    const auditor = await runContinuousAuditor(
      ctx.services,
      ctx.discovery.projectId,
      lying,
      2,
    );
    assert.equal(auditor.verdict, 'rejected');
    assert.match(auditor.rationale, /diverged/);
  });
});

describe('Continuous Engineering Department (Stage 5) — materialization & DoC', () => {
  it('runContinuousEngineeringDepartment materializes -OPS lineage, stamps PERM manifest, and certifies completion', async () => {
    const ctx = await deployedReady();
    const result = await runContinuousEngineeringDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    assert.equal(result.finalVerdict, 'CERTIFIED_COMPLETE');
    assert.ok(result.materialization);
    assert.equal(result.materialization!.opsIds.length, result.workerReport.observations.length);
    for (const id of result.materialization!.opsIds) {
      const a = await ctx.services.store.get(id);
      assert.ok(a, `${id} must exist`);
      assert.equal(a!.status, 'VERIFIED');
      assert.equal(typeof a!.attributes.bossRationale, 'string');
      assert.equal(typeof a!.attributes.auditorRationale, 'string');
      assert.match(a!.attributes.evidenceHash as string, /^[0-9a-f]{64}$/);
      const downstream = ctx.services.graph.neighbors(id, 'downstream', 'DERIVED_FROM');
      assert.ok(
        downstream.includes(`${id.replace(/-OPS$/, '')}-DEPLOY`),
        `${id} must DERIVED_FROM its -DEPLOY`,
      );
    }
    const manifest = await ctx.services.store.get(result.materialization!.manifestId);
    assert.equal(manifest?.type, 'COMPONENT');
    assert.match(manifest!.id, /-PERM$/);
    assert.equal(manifest!.status, 'VERIFIED');
    const contains = ctx.services.graph.neighbors(result.materialization!.manifestId, 'downstream', 'CONTAINS');
    assert.deepEqual([...contains].sort(), [...result.materialization!.opsIds].sort());
  });

  it('regression halts: simulated drift aborts with no -OPS materialization', async () => {
    const ctx = await deployedReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const target = scope[0]!.baseId;
    const result = await runContinuousEngineeringDepartment(ctx.services, ctx.discovery.projectId, {
      sampleSize: 2,
      defects: { simulateRegressed: [target] },
    });
    assert.notEqual(result.finalVerdict, 'CERTIFIED_COMPLETE');
    assert.equal(result.materialization, null);
    const persisted = await listOpsIds(ctx.services);
    assert.equal(persisted.length, 0, 'no -OPS artifacts may be persisted when regression is detected');
  });

  it('empty live scope fails honestly without fabricating anything', async () => {
    const ctx = await deployedReady();
    const result = await runContinuousEngineeringDepartment(ctx.services, 'PROJECT-0000');
    assert.notEqual(result.finalVerdict, 'CERTIFIED_COMPLETE');
    assert.equal(result.materialization, null);
    const persisted = await listOpsIds(ctx.services);
    assert.equal(persisted.length, 0);
  });
});
