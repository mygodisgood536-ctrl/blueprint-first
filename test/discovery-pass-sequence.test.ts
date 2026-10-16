import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDiscoveryPassSequence,
  runDiscoverySequence,
} from '../src/discovery/pass-sequence.ts';
import { DiscoveryDepartment } from '../src/discovery/department/engine.ts';
import { makeServices } from './helpers/test-services.ts';
import {
  DISCOVERY_WORKER_ROLES,
  WORKER_ROLE_IDS,
  getDiscoveryWorkerRole,
  requireDiscoveryWorkerRole,
} from '../src/discovery/corpus/workers.ts';

const BRIEF = {
  name: 'TeamTask',
  vision: 'A lightweight task tracker that small teams can adopt in minutes.',
  targetUsers: ['small teams'],
};

const EXPECTED_ROLE_IDS = [
  'DW-A1', 'DW-A2', 'DW-A3', 'DW-A4', 'DW-A5',
  'DW-B1', 'DW-B2', 'DW-B3', 'DW-B4', 'DW-B5', 'DW-B6', 'DW-B7', 'DW-B8', 'DW-B9', 'DW-B10', 'DW-B11',
  'DW-C1', 'DW-C2', 'DW-C3', 'DW-C4', 'DW-C5', 'DW-C6', 'DW-C7', 'DW-C8',
  'DW-D1', 'DW-D2', 'DW-D3', 'DW-D4', 'DW-D5', 'DW-D6', 'DW-D7',
  'DW-E1', 'DW-E2', 'DW-E3', 'DW-E4', 'DW-E5',
];

describe('Discovery Worker Corps corpus (36 roles)', () => {
  it('defines every role across the twelve required axes', () => {
    assert.equal(DISCOVERY_WORKER_ROLES.length, 36);
    assert.deepEqual([...WORKER_ROLE_IDS].sort(), [...EXPECTED_ROLE_IDS].sort());
    const clusters = new Set(DISCOVERY_WORKER_ROLES.map((r) => r.cluster));
    assert.deepEqual([...clusters].sort(), ['A', 'B', 'C', 'D', 'E']);
    for (const role of DISCOVERY_WORKER_ROLES) {
      assert.notEqual(role.name.trim(), '', `${role.id} name`);
      assert.notEqual(role.responsibility.trim(), '', `${role.id} responsibility`);
      assert.ok(role.inputs.length > 0, `${role.id} inputs`);
      assert.ok(role.outputs.length > 0, `${role.id} outputs`);
      assert.notEqual(role.evidenceRequired.trim(), '', `${role.id} evidenceRequired`);
      assert.ok(role.dependencies.length > 0, `${role.id} dependencies`);
      assert.notEqual(role.verification.trim(), '', `${role.id} verification`);
      assert.ok(role.failureConditions.length > 0, `${role.id} failureConditions`);
      assert.notEqual(role.reworkBehavior.trim(), '', `${role.id} reworkBehavior`);
      assert.notEqual(role.bossInteraction.trim(), '', `${role.id} bossInteraction`);
      assert.notEqual(role.auditorInteraction.trim(), '', `${role.id} auditorInteraction`);
      assert.notEqual(role.recursiveContribution.trim(), '', `${role.id} recursiveContribution`);
      assert.notEqual(role.mpiContribution.trim(), '', `${role.id} mpiContribution`);
    }
  });

  it('lookup helpers resolve known roles and fail loudly on unknown ids', () => {
    for (const id of EXPECTED_ROLE_IDS) {
      assert.equal(getDiscoveryWorkerRole(id)?.id, id);
      assert.equal(requireDiscoveryWorkerRole(id).id, id);
    }
    assert.equal(getDiscoveryWorkerRole('DW-Z9'), undefined);
    assert.throws(() => requireDiscoveryWorkerRole('DW-Z9'), /Unknown Discovery Worker role/);
  });
});

describe('Discovery Pass Sequence (passes 0–24)', () => {
  it('runs the full sequence to a clean audit certificate', async () => {
    const services = makeServices();
    const result = await runDiscoverySequence(services, BRIEF);

    assert.equal(result.sequenceComplete, true);
    assert.equal(result.haltedAt, undefined);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.passes.length, 25);
    for (const pass of result.passes) {
      assert.equal(pass.status, 'passed', `Pass ${pass.pass} (${pass.name}): ${pass.exitReason}`);
    }
    assert.equal(result.summary.passesPassed, 25);

    // Pass table wiring: every pass names its Worker Corps owner where applicable.
    assert.match(result.passes[5]?.owner ?? '', /DW-B1/);
    assert.match(result.passes[12]?.owner ?? '', /DW-D1/);
    assert.match(result.passes[13]?.owner ?? '', /DW-C8/);
    assert.match(result.passes[19]?.owner ?? '', /DW-E2/);
    assert.match(result.passes[24]?.owner ?? '', /DW-E5/);

    // Pass 21 converges on the first sweep: every enrichment pass is
    // deterministic and idempotent (§0.16), so a second full sweep proves the
    // first produced everything there was to produce.
    assert.equal(result.summary.sweeps, 1);
    assert.match(
      result.passes[21]?.exitReason ?? '',
      /No new artifact generated in the most recent sweep \(sweep 1 of 3\)/,
    );

    // Honesty counters: contradictions resolved (none detected in the
    // fixture), Discovery Questions surfaced rather than guessed.
    assert.equal(result.summary.contradictionOpen, 0);
    assert.ok(result.summary.discoveryQuestionCount > 0);

    // Pass 24 issues a clean, addressable Audit Certificate.
    const certificate = result.auditCertificate;
    assert.ok(certificate !== undefined);
    assert.equal(certificate.projectId, 'PROJECT-0001');
    assert.equal(certificate.clean, true);
    assert.deepEqual(certificate.failures, []);
    assert.ok(certificate.sampled.length > 0);

    // Every enrichment pass left its expected artifact classes behind.
    const roles = await services.store.list({ types: ['ROLE'] });
    assert.equal(roles.length, 2);
    assert.deepEqual(roles.map((r) => r.attributes['role']).sort(), ['admin', 'member']);
    const edgeCases = await services.store.list({ types: ['EDGECASE'] });
    assert.ok(edgeCases.length > 0);
    const ops = await services.store.list({ types: ['OPS'] });
    assert.equal(ops.length, 2);
    const dependencies = await services.store.list({ types: ['DEPENDENCY'] });
    assert.ok(dependencies.some((d) => d.attributes['dependencyKind'] === 'map'));
    const findings = await services.store.list({ types: ['FINDING'] });
    assert.ok(findings.some((f) => f.attributes['findingKind'] === 'red-team-omission'));
    assert.ok(findings.some((f) => f.attributes['findingKind'] === 'industry-comparison-gap'));
    const contradictions = await services.store.list({ types: ['CONTRADICTION'] });
    assert.equal(contradictions.length, 0);
    const threatModels = await services.store.list({ types: ['THREAT_MODEL'] });
    assert.equal(threatModels.length, 1);
    assert.ok((await services.store.list({ types: ['SEC_REQ'] })).length > 0);

    // Passes 23 and 24 anchored their independent judgments in evidence.
    const evidence = await services.evidence.all();
    assert.ok(evidence.some((e) => e.summary.includes('Pass 23 (Boss Independent Reconstruction)')));
    assert.ok(evidence.some((e) => e.summary.includes('Discovery Audit (DW-E5)')));

    // Everything produced was tracked for the promotion gate.
    assert.ok(result.artifactIds.length > 0);
    assert.ok(result.artifactIds.includes('PROJECT-0001'));
  });

  it('converges even when the sweep bound is 1 (loop terminates honestly)', async () => {
    const services = makeServices();
    const result = await runDiscoverySequence(services, BRIEF, { maxSweeps: 1 });
    assert.equal(result.sequenceComplete, true);
    assert.equal(result.summary.sweeps, 1);
    assert.equal(result.passes.every((p) => p.status === 'passed'), true);
  });

  it('halts at Pass 0 without fabricating anything when readiness fails', async () => {
    const services = makeServices();
    const result = await runDiscoverySequence(services, BRIEF, {
      readiness: { ready: false, reason: 'Foundational Intelligence Layer offline.' },
    });

    assert.equal(result.sequenceComplete, false);
    assert.equal(result.haltedAt, 0);
    assert.equal(result.passes[0]?.status, 'halted');
    assert.equal(result.passes[0]?.exitReason, 'Foundational Intelligence Layer offline.');
    for (const pass of result.passes.slice(1)) {
      assert.equal(pass.status, 'skipped', `Pass ${pass.pass} must be skipped`);
      assert.match(pass.exitReason, /Not reached: sequence halted at Pass 0/);
    }
    assert.equal(result.summary.passesPassed, 0);
    assert.equal(result.auditCertificate, undefined);
    assert.deepEqual(result.reasons, ['Pass 0 (Department Readiness): Foundational Intelligence Layer offline.']);
    // No artifact, no evidence — a halted pass produces nothing.
    assert.equal((await services.store.list()).length, 0);
    assert.equal((await services.evidence.all()).length, 0);
  });

  it('halts at Pass 2 when a pre-built baseline carries no Domain Profile', async () => {
    const services = makeServices();
    const department = await new DiscoveryDepartment(services).discover(BRIEF);
    assert.equal(department.status, 'accepted');
    assert.ok(department.baseline !== undefined);

    const result = await runDiscoveryPassSequence(services, department.baseline, {
      brief: BRIEF,
    });

    assert.equal(result.sequenceComplete, false);
    assert.equal(result.haltedAt, 2);
    assert.equal(result.passes[0]?.status, 'passed');
    assert.equal(result.passes[1]?.status, 'passed');
    assert.equal(result.passes[2]?.status, 'halted');
    assert.match(result.passes[2]?.exitReason ?? '', /Domain Profile could not be certified/);
    for (const pass of result.passes.slice(3)) {
      assert.equal(pass.status, 'skipped');
    }
    assert.equal(result.auditCertificate, undefined);
    // The halt is recorded as a Discovery Question, never as invented profile text.
    const evidence = await services.evidence.all();
    assert.ok(evidence.some((e) => e.summary.includes('refusing to invent a Domain Profile')));
  });
});
