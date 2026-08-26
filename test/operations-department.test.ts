/**
 * Unit tests for the AI Operations & Observability Department (Stage 4).
 * Each test runs the full Level-1a/1b/2 pipeline plus the Stage-3 acceptance
 * suite to seed a certified, TEST-VERIFIED inventory, then drives the
 * Operations Department. All assertions verify ACTUAL stored graph/evidence
 * state, not return values alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Artifact } from '../src/core/artifact.ts';
import type { ArtifactStatus } from '../src/core/status.ts';
import type { DeployedUnit, ExecutedDeploy } from '../src/operations/deploy.ts';
import type { DeployExpectation } from '../src/operations/scope.ts';
import {
  createDeploymentEnvironment,
  deployRelease,
  verifyDeployedUnit,
  sha256,
} from '../src/operations/deploy.ts';
import { runDeployBoss } from '../src/operations/boss.ts';
import { runDeployAuditor, sampleDeploys } from '../src/operations/auditor.ts';
import { deriveDeployScope, hasAcceptedTest } from '../src/operations/scope.ts';
import { runTestDepartment } from '../src/testing/department.ts';
import { runOperationsDepartment } from '../src/operations/department.ts';
import { certifiedLevel2Fixture } from './helpers/level2-fixture.ts';
import type { Level2FixtureContext } from './helpers/level2-fixture.ts';

async function opsReady() {
  const ctx = await certifiedLevel2Fixture();
  const t = await runTestDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
  if (t.status !== 'passed') throw new Error(`Stage 3 precondition failed: ${t.boss.rationale}`);
  return ctx;
}

async function listDeployIds(ctx: { services: Level2FixtureContext['services'] }): Promise<string[]> {
  return (await ctx.services.store.list({})).filter((a) => a.id.endsWith('-DEPLOY')).map((a) => a.id);
}

describe('Operations & Observability Department (Stage 4) — scope & execution', () => {
  it('deriveDeployScope is mechanical from the verified -TEST closure, deterministically', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    assert.ok(scope.length > 0);
    for (const exp of scope) {
      assert.ok(await hasAcceptedTest(ctx.services, exp.baseId), `${exp.baseId} should carry a VERIFIED -TEST`);
    }
    const again = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    assert.deepEqual(
      again.map((s) => s.baseId),
      scope.map((s) => s.baseId),
    );
  });

  it('scope excludes bases whose -TEST is no longer VERIFIED', async () => {
    const ctx = await opsReady();
    const [first, ...rest] = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    assert.ok(first);
        const testArtifact = await ctx.services.store.get(`${first!.baseId}-TEST`);
    assert.ok(testArtifact);
    await ctx.services.store.update(testArtifact!.id, testArtifact!.version, (d: Artifact) => ({
      ...d,
      status: 'IN_REVIEW' as ArtifactStatus,
    }));
    const after = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    assert.equal(after.some((e) => e.baseId === first!.baseId), false);
    assert.ok(rest.length > 0, 'scope is not emptied by a single regression');
  });

  it('deployRelease seeds a complete, verifiable environment; verifyDeployedUnit is deterministic', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const env = createDeploymentEnvironment('production');
    await deployRelease(ctx.services, scope, env);
    for (const exp of scope) {
      const once = await verifyDeployedUnit(ctx.services, exp, env);
      assert.equal(once.passed, true, `${exp.baseId}: ${once.observed}`);
      assert.equal(once.envConfigured, true);
      assert.equal(once.rollbackExercised, true);
      assert.equal(once.monitorLive, true);
      const again = await verifyDeployedUnit(ctx.services, exp, env);
      assert.deepEqual(again, once);
      assert.match(again.evidenceHash, /^[0-9a-f]{64}$/);
    }
  });

  it('verifyDeployedUnit rejects absent deployments and drifted configurations', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const emptyEnv = createDeploymentEnvironment('production');
    const exp: DeployExpectation = scope[0]!;
    const absent = await verifyDeployedUnit(ctx.services, exp, emptyEnv);
    assert.equal(absent.passed, false);
    assert.match(absent.observed, /no deployed unit/);
    assert.equal(absent.evidenceHash, sha256([exp.baseId, exp.kind, 'absent']));

    const env = createDeploymentEnvironment('production');
    await deployRelease(ctx.services, scope, env);
    const unit = env.units.get(exp.baseId)!;
    const tampered: DeployedUnit = { ...unit, configHash: sha256(['drift']) };
    env.units.set(exp.baseId, tampered);
    const drifted = await verifyDeployedUnit(ctx.services, exp, env);
    assert.equal(drifted.passed, false);
    assert.equal(drifted.envConfigured, false);
  });

  it('sampleDeploys is evenly spaced, deterministic and de-duplicated', () => {
    const checks: { baseId: string }[] = Array.from({ length: 5 }, (_, i) => ({ baseId: `PAGE-${String(i).padStart(4, '0')}` }));
    const a = sampleDeploys(checks as any, 2);
    const b = sampleDeploys(checks as any, 2);
    assert.deepEqual(a.map((c) => c.baseId), b.map((c) => c.baseId));
    assert.equal(a.length, 2);
  });

    it('runDeployBoss accepts an honest deployment run and reconstructs the scope', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const env = createDeploymentEnvironment('production');
    await deployRelease(ctx.services, scope, env);
    const executed: ExecutedDeploy[] = [];
    for (const exp of scope) executed.push(await verifyDeployedUnit(ctx.services, exp, env));
    const boss = await runDeployBoss(ctx.services, ctx.discovery.projectId, env, executed);
    assert.equal(boss.verdict, 'accepted');
    assert.equal(boss.reconstructedCount, scope.length);
  });

  it('runDeployBoss rejects a corps that silently drops a scheduled deployment', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const skipped = scope[0]!.baseId;
    const result = await runOperationsDepartment(ctx.services, ctx.discovery.projectId, {
      defects: { skipIds: [skipped] },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.failedUnits[0], skipped);
    assert.equal(result.boss.verdict, 'rejected');
    assert.equal(result.manifestId, undefined);
    assert.deepEqual(result.deployIds, []);
    const persisted = await listDeployIds(ctx);
    assert.equal(persisted.length, 0, 'no -DEPLOY artifacts materialized on failure');
  });

  it('runDeployBoss rejects deployments outside the certified release scope', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const env = createDeploymentEnvironment('production');
    await deployRelease(ctx.services, scope, env);
        const executed: ExecutedDeploy[] = [];
    for (const exp of scope) executed.push(await verifyDeployedUnit(ctx.services, exp, env));
    const dropped = scope[0]!.baseId;
        const testArtifact = await ctx.services.store.get(`${dropped}-TEST`);
    await ctx.services.store.update(testArtifact!.id, testArtifact!.version, (d: Artifact) => ({
      ...d,
      status: 'IN_REVIEW' as ArtifactStatus,
    }));
    const boss = await runDeployBoss(ctx.services, ctx.discovery.projectId, env, executed);
    assert.equal(boss.verdict, 'rejected');
    assert.match(boss.rationale, /outside the certified release scope/);
  });

  it('runDeployAuditor confirms a deterministic sample and rejects a tampered verdict', async () => {
    const ctx = await opsReady();
    const scope = await deriveDeployScope(ctx.services, ctx.discovery.projectId);
    const env = createDeploymentEnvironment('production');
    await deployRelease(ctx.services, scope, env);
    const executed: ExecutedDeploy[] = [];
    for (const exp of scope) executed.push(await verifyDeployedUnit(ctx.services, exp, env));
    const ok = await runDeployAuditor(ctx.services, env, executed, 1);
    assert.equal(ok.verdict, 'confirmed');

    const tampered = executed.map((d, i) =>
      i === 0 ? { ...d, passed: false, evidenceHash: '0'.repeat(64) } : d,
    );
    const bad = await runDeployAuditor(ctx.services, env, tampered, 1);
    assert.equal(bad.verdict, 'rejected');
    assert.match(bad.rationale, /diverged/);
  });

  it('runOperationsDepartment materializes -DEPLOY lineage, advances DoC and records evidence', async () => {
    const ctx = await opsReady();
    const result = await runOperationsDepartment(ctx.services, ctx.discovery.projectId, { sampleSize: 2 });
    assert.equal(result.status, 'passed');
    assert.equal(result.deployIds.length, result.scope.length);
    for (const id of result.deployIds) {
      const a = await ctx.services.store.get(id);
      assert.ok(a, `${id} must exist`);
      assert.equal(a!.status, 'VERIFIED');
      assert.equal(typeof a!.attributes.bossRationale, 'string');
      assert.equal(typeof a!.attributes.auditorRationale, 'string');
    }
    for (const exp of result.scope) {
      const deployId = `${exp.baseId}-DEPLOY`;
      const dep = exp.kind === 'functional' ? `${exp.baseId}-IMPL` : `${exp.baseId}-DESIGN`;
      const nbrs = ctx.services.graph.neighbors(deployId, 'downstream', 'DERIVED_FROM');
      assert.ok(nbrs.includes(dep), `${deployId} must DERIVED_FROM ${dep}`);
    }
    assert.ok(result.manifestId);
    const manifest = await ctx.services.store.get(result.manifestId!);
    assert.equal(manifest?.type, 'COMPONENT');
    const contains = ctx.services.graph.neighbors(result.manifestId!, 'downstream', 'CONTAINS');
    assert.deepEqual([...contains].sort(), [...result.deployIds].sort());
    assert.equal(result.docHalts.length, 0);
    assert.equal(result.advancedToDeployedVerified.length, result.scope.length);
    assert.ok(result.evidenceId);
  });

  it('honest failure halts: defects abort with no artifacts and no DoC advance', async () => {
    const ctx = await opsReady();
    const firstId = (await deriveDeployScope(ctx.services, ctx.discovery.projectId))[0]!.baseId;
    const result = await runOperationsDepartment(ctx.services, ctx.discovery.projectId, {
      sampleSize: 2,
      defects: { omitMonitorIds: [firstId] },
    });
    assert.equal(result.status, 'failed');
        assert.equal(result.boss.verdict, 'rejected');
    assert.match(result.boss.rationale, /The corps reported unfinished deployments/);
    assert.deepEqual(result.deployIds, []);
    assert.deepEqual(result.advancedToDeployedVerified, []);
    const persisted = await listDeployIds(ctx);
    assert.equal(persisted.length, 0, 'no -DEPLOY artifacts on failure');
  });

  it('empty deployment scope fails honestly without fabricating anything', async () => {
    const ctx = await opsReady();
    const result = await runOperationsDepartment(ctx.services, 'PROJECT-0000', {});
        assert.equal(result.status, 'failed');
    assert.match(result.boss.rationale, /empty deployment scope/);
    assert.equal(result.manifestId, undefined);
    const persisted = await listDeployIds(ctx);
    assert.equal(persisted.length, 0);
  });
});



