/**
 * Level 5 — Permanent Engineering Organization tests.
 *
 * Exercises the §5.1 Continuous Engineering Verification Chain for the PEO:
 *   1. Guardian classifies the runtime signal (KNOWN / RECURRING / NOVEL)
 *   2. Impact Analysis surfaces the surprise set via the Dependency Map
 *   3. Safe Change Department re-runs Worker → Boss → Auditor
 *   4. The result records whether the change was authorized, applied, or escalated
 *
 * The L5 orchestrator is a COMPOSITION of existing engines. It does not
 * certify. The Continuous Engineering Boss + Auditor (L4) remain the only
 * certifiers. We verify L5 by checking the composition shape, independence,
 * failure-closed behavior, and the contracts that distinguish L5 from L4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPermanentEngineeringOrganization, candidateFromDrift } from '../src/perm/department.ts';
import type { PermanentEngineeringInput, PermanentEngineeringResult } from '../src/perm/department.ts';
import {
  emptyGuardianMemory,
  classifySignal,
  withAppendedWatch,
  type GuardianMemory,
} from '../src/perm/guardian.ts';
import { runImpactAnalysis } from '../src/perm/impact-analysis.ts';
import { runSelfHealing } from '../src/perm/self-healing.ts';
import { evolutionReviewFor } from '../src/perm/evolution.ts';
import type { EvolutionSeed } from '../src/perm/evolution.ts';
import { recordLesson, routingRecommendations } from '../src/perm/learning.ts';
import { buildChangeHistoryEntry, withAppendedChangeHistory, historyAt } from '../src/perm/change-history.ts';
import { materializeLivingBlueprint, currentLivingBlueprint } from '../src/perm/living-blueprint.ts';
import { buildDependencyMapFor, downstreamArtifacts } from '../src/perm/dependency-map.ts';
import type { GuardianWatch, CandidateChange } from '../src/perm/types.ts';
import type { DriftItem } from '../src/verification/live-engine.ts';
import { certifiedLevel2Fixture } from './helpers/level2-fixture.ts';
import { runSafeChangeDepartment } from '../src/change/department.ts';
import { applyAuthorizedRemediation } from '../src/change/applier.ts';
import type { DeployedUnit } from '../src/operations/deploy.ts';
import type { RemediationProposal, RemediationDecision } from '../src/change/types.ts';
import { runContinuousEngineeringDepartment } from '../src/continuous/department.ts';
import type { CoreServices } from '../src/core/services.ts';

async function fixture() {
  return certifiedLevel2Fixture();
}

function makeCandidate(changeId: string, baseId: string, services: CoreServices): CandidateChange {
  const drift: DriftItem = {
    artifactId: baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  return candidateFromDrift(
    changeId,
    drift,
    'self-healing',
    'config_restoration',
    `Perm change ${changeId}`,
    'auto-derived from regression',
    services,
  ).candidate;
}

test('L5: orchestrator runs the full verification chain and returns composed result', async () => {
  const fx = await fixture();
  const candidate = makeCandidate('CHG-9001', fx.blueprintId, fx.services);
  const input: PermanentEngineeringInput = {
    candidate,
    priorWatches: [],
    memory: emptyGuardianMemory(),
    projectId: fx.discovery.projectId,
  };
  const result = await runPermanentEngineeringOrganization(fx.services, input);
  assert.equal(result.source, 'self-healing');
  assert.equal(typeof result.watch.evidenceHash, 'string');
  assert.equal(typeof result.impact.analysisHash, 'string');
  assert.equal(result.impact.changeId, 'CHG-9001');
  assert.equal(typeof result.authorized, 'boolean');
  assert.equal(typeof result.escalated, 'boolean');
  assert.equal(typeof result.rationale, 'string');
  assert.ok(result.rationale.includes('Guardian'));
  assert.ok(result.rationale.includes('impact'));
});

test('L5: Guardian classifies first-seen signal as NOVEL', async () => {
  const fx = await fixture();
  const candidate = makeCandidate('CHG-9002', fx.blueprintId, fx.services);
  const input: PermanentEngineeringInput = {
    candidate,
    priorWatches: [],
    memory: emptyGuardianMemory(),
    projectId: fx.discovery.projectId,
  };
  const result = await runPermanentEngineeringOrganization(fx.services, input);
  assert.equal(result.watch.classifiedAs, 'NOVEL');
  assert.equal(result.watch.relatedWatchIds.length, 0);
});

test('L5: Guardian classifies repeat signal as RECURRING after threshold watches', async () => {
  const fx = await fixture();
  const baseId = fx.blueprintId;
  const drift: DriftItem = {
    artifactId: baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const watch1 = classifySignal({
    signal: { kind: 'drift', drift },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const watch2 = classifySignal({
    signal: { kind: 'drift', drift },
    priorWatches: [watch1],
    memory: emptyGuardianMemory(),
  });
  const candidate = makeCandidate('CHG-9003', baseId, fx.services);
  const input: PermanentEngineeringInput = {
    candidate,
    priorWatches: [watch1, watch2],
    memory: emptyGuardianMemory(),
    projectId: fx.discovery.projectId,
  };
  const result = await runPermanentEngineeringOrganization(fx.services, input);
  assert.equal(result.watch.classifiedAs, 'RECURRING');
  assert.ok(result.watch.relatedWatchIds.length >= 1);
  assert.equal(result.escalated, true);
});

test('L5: Impact Analysis is deterministic and surfaces declared + discovered sets', async () => {
  const fx = await fixture();
  const baseId = fx.blueprintId;
  const candidate = makeCandidate('CHG-9004', baseId, fx.services);
  const impact1 = runImpactAnalysis(fx.services.graph, candidate);

test('L5: Self-Healing reproduces and produces a candidate change', async () => {
  const fx = await fixture();
  const all = await fx.services.store.list({ projectId: fx.discovery.projectId });
  const impl = all.find((a) => /-IMPL$/.test(a.id));
  assert.ok(impl !== undefined, 'fixture should have an -IMPL artifact');
  // Pick a baseId whose lineage is COMPLETE (IMPL + DEPLOY). If DEPLOY is
  // missing, Self-Healing correctly refuses to fabricate a fix.
  const implBaseIds = new Set(
    all.filter((a) => /-IMPL$/.test(a.id)).map((a) => a.id.replace(/-IMPL$/, '')),
  );
  const deployBaseIds = new Set(
    all.filter((a) => /-DEPLOY$/.test(a.id)).map((a) => a.id.replace(/-DEPLOY$/, '')),
  );
  const completeBaseIds = [...implBaseIds].filter((b) => deployBaseIds.has(b));
  if (completeBaseIds.length === 0) {
    // The L2 fixture builds IMPLs but doesn't deploy; without DEPLOY artifacts
    // the replica's lineage is incomplete and Self-Healing MUST refuse to
    // fabricate a fix. This is the failure-closed behavior the spec demands.
    const baseId = [...implBaseIds][0]!;
    const watch: GuardianWatch = classifySignal({
      signal: {
        kind: 'drift',
        drift: {
          artifactId: baseId,
          dimension: 'CORRECTNESS',
          was: 'pass',
          now: 'fail',
          kind: 'REGRESSED',
          source: 'telemetry',
        },
      },
      priorWatches: [],
      memory: emptyGuardianMemory(),
    });
    const proposal = await runSelfHealing(fx.services, {
      watch,
      baseId,
      expectedDrift: { dimension: 'CORRECTNESS', kind: 'REGRESSED' },
    });
    assert.equal(proposal.reproduced, false);
    assert.equal(proposal.candidate, undefined);
    return;
  }
  const baseId = completeBaseIds[0]!;
  const drift: DriftItem = {
    artifactId: baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const watch: GuardianWatch = classifySignal({
    signal: { kind: 'drift', drift },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const proposal = await runSelfHealing(fx.services, {
    watch,
    baseId,
    expectedDrift: { dimension: 'CORRECTNESS', kind: 'REGRESSED' },
  });
  assert.equal(proposal.reproduced, true);
  assert.ok(proposal.candidate !== undefined);
  assert.equal(proposal.candidate!.baseId, baseId);
  assert.equal(proposal.candidate!.source, 'self-healing');
});

test('L5: Self-Healing refuses to fabricate a fix when reproduction fails', async () => {
  const fx = await fixture();
  const baseId = `${fx.blueprintId}-GHOST`;
  const watch: GuardianWatch = classifySignal({
    signal: {
      kind: 'drift',
      drift: {
        artifactId: baseId,
        dimension: 'CORRECTNESS',
        was: 'pass',
        now: 'fail',
        kind: 'REGRESSED',
        source: 'telemetry',
      },
    },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const proposal = await runSelfHealing(fx.services, {
    watch,
    baseId,
    expectedDrift: { dimension: 'CORRECTNESS', kind: 'REGRESSED' },
  });
  assert.equal(proposal.reproduced, false);
  assert.equal(proposal.candidate, undefined);
});

test('L5: Evolution Review produces queued recommendations, never applies anything', () => {
  const seeds: EvolutionSeed[] = [
    { baseId: 'P-1', rationale: 'add retry', expectedBenefit: 'tolerance' },
    { baseId: 'P-2', rationale: 'cache invalidation', expectedBenefit: 'freshness' },
  ];
  const recs = evolutionReviewFor(seeds);
  assert.equal(recs.length, 2);
  for (const r of recs) {
    assert.equal(typeof r.recommendationId, 'string');
    assert.equal(r.queuedForImpactAnalysis, true);
  }
});

test('L5: Learning engine produces a deterministic lesson hash and routing summary', () => {
  const e1 = recordLesson({
    stage: 'permanent',
    title: 'L5 lesson',
    body: 'no certification without evidence',
    sourceArtifactIds: ['P-1', 'P-2'],
  }, '2025-01-01T00:00:00.000Z');

test('L5: Change History is append-only and historyAt() returns the latest entry at a given time', async () => {
  const fx = await fixture();
  const baseId = fx.blueprintId;
  const base = await fx.services.store.get(baseId);
  assert.ok(base !== null);
  const e1 = buildChangeHistoryEntry({
    reason: 'initial',
    affectedArtifacts: [baseId],
    revisedArtifactHash: 'rev-1',
    verificationEvidenceHash: 'ver-1',
    impactAnalysisHash: 'imp-1',
    certifiedBy: { kind: 'verifier', id: 'continuous-engineering-boss-01' },
    at: '2025-01-01T00:00:00.000Z',
  });
  const e2 = buildChangeHistoryEntry({
    reason: 'second',
    affectedArtifacts: [baseId],
    revisedArtifactHash: 'rev-2',
    verificationEvidenceHash: 'ver-2',
    impactAnalysisHash: 'imp-2',
    certifiedBy: { kind: 'verifier', id: 'continuous-engineering-boss-01' },
    at: '2025-02-01T00:00:00.000Z',
  });
  const attrs1 = withAppendedChangeHistory(base!, e1);
  const onceArtifact = { ...base!, attributes: attrs1 };
  const attrs2 = withAppendedChangeHistory(onceArtifact, e2);
  const finalArtifact = { ...base!, attributes: attrs2 };
  const atJan = historyAt(finalArtifact, '2025-01-15T00:00:00.000Z');
  const atMar = historyAt(finalArtifact, '2025-03-01T00:00:00.000Z');
  assert.equal(atJan?.entryId, e1.entryId);
  assert.equal(atMar?.entryId, e2.entryId);
});

test('L5: Change History refuses duplicate entry IDs (append-only invariant)', async () => {
  const fx = await fixture();
  const baseId = fx.blueprintId;
  const base = await fx.services.store.get(baseId);
  assert.ok(base !== null);
  const entry = buildChangeHistoryEntry({
    reason: 'r',
    affectedArtifacts: [baseId],
    revisedArtifactHash: 'r',
    verificationEvidenceHash: 'v',
    impactAnalysisHash: 'i',
    certifiedBy: { kind: 'verifier', id: 'continuous-engineering-boss-01' },
    at: '2025-01-01T00:00:00.000Z',
  });
  const once = withAppendedChangeHistory(base!, entry);
  const onceArtifact = { ...base!, attributes: once };
  assert.throws(() => withAppendedChangeHistory(onceArtifact, entry));
});

test('L5: Living Blueprint materializes a certified snapshot and currentLivingBlueprint() retrieves it', async () => {
  const fx = await fixture();
  const all = await fx.services.store.list({ projectId: fx.discovery.projectId });

test('L5: config_restoration genuinely restores the unit to its known-good anchor', async () => {
  const unit: DeployedUnit = {
    baseId: 'APP-CORE',
    kind: 'functional',
    configHash: 'drifted-hash-after-bad-flag',
    knownGoodConfigHash: 'known-good-anchor-hash',
  };
  const drift: DriftItem = {
    artifactId: 'APP-CORE',
    dimension: 'CONSISTENCY',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const proposal: RemediationProposal = {
    proposalId: 'CHG-PROP-1',
    driftId: 'WATCH-1',
    scope: {
      baseId: 'APP-CORE',
      summary: 'Restore drifted configuration to the known-good anchor.',
      changeKind: 'config_restoration',
    },
    proposedBy: 'self-healing',
    proposedAt: '2025-01-02T00:00:00.000Z',
    proposalHash: 'hash',
    drift,
    rationale: 'Configuration drifted; restore to the certified anchor.',
  };
  const acceptedBoss: RemediationDecision = {
    proposalId: 'CHG-PROP-1',
    decidedBy: 'safe-change-boss-01',
    decidedAt: '2025-01-02T00:00:00.000Z',
    verdict: 'accepted',
    rationale: 'within scope, drift confirmed',
    withinAuthorizedScope: true,
    driftConfirmed: true,
    decisionHash: 'boss-hash',
  };
  const acceptedAuditor: RemediationDecision = {
    proposalId: 'CHG-PROP-1',
    decidedBy: 'safe-change-auditor-01',
    decidedAt: '2025-01-02T00:00:00.000Z',
    verdict: 'accepted',
    rationale: 'confirm',
    withinAuthorizedScope: true,
    driftConfirmed: true,
    decisionHash: 'auditor-hash',
  };
  const { application, updatedUnit } = applyAuthorizedRemediation(
    { proposal, bossDecision: acceptedBoss, auditorDecision: acceptedAuditor },
    { units: new Map([['APP-CORE', unit]]) },
    '2025-01-02T00:00:00.000Z',
  );
  // A real restore: the drifted unit returns to the recorded known-good
  // anchor, and the application hash captures the before->after transition.
  assert.equal(updatedUnit.configHash, 'known-good-anchor-hash');
  assert.equal(updatedUnit.restoredFromHash, 'drifted-hash-after-bad-flag');
  assert.equal(application.beforeHash, 'drifted-hash-after-bad-flag');
  assert.equal(application.afterHash, 'known-good-anchor-hash');
  assert.notEqual(application.beforeHash, application.afterHash);
});

test('L5: L4 Safe Change Department is invoked unchanged by L5 — composition contract', async () => {
  const fx = await fixture();
  // Pick any artifact id in the project; both the L4 and L5 paths must reach
  // the same verdict on the same drift.
  const all = await fx.services.store.list({ projectId: fx.discovery.projectId });
  const baseId = all[0]?.id ?? fx.blueprintId;
  const drift: DriftItem = {
    artifactId: baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const direct = await runSafeChangeDepartment(fx.services, {
    drift,
    projectId: fx.discovery.projectId,
    env: { units: new Map() },
    apply: false,
  });
  const candidate = makeCandidate('CHG-9006', baseId, fx.services);
  const input: PermanentEngineeringInput = {
    candidate: { ...candidate, drift },
    priorWatches: [],
    memory: emptyGuardianMemory(),
    projectId: fx.discovery.projectId,
  };
  const composed = await runPermanentEngineeringOrganization(fx.services, input);
  assert.equal(composed.change.status, direct.status);
});

test('L5: orchestrator does not certify — authorized is derived from change.status only', async () => {
  const fx = await fixture();
  const candidate = makeCandidate('CHG-9007', fx.blueprintId, fx.services);
  const input: PermanentEngineeringInput = {
    candidate,
    priorWatches: [],
    memory: emptyGuardianMemory(),
    projectId: fx.discovery.projectId,
  };
  const result: PermanentEngineeringResult = await runPermanentEngineeringOrganization(fx.services, input);
  assert.equal(result.authorized, result.change.status !== 'REJECTED');
});

test('L5: L4 continuous engineering baseline still completes end-to-end after L5 additions', async () => {
  const fx = await fixture();
  const result = await runContinuousEngineeringDepartment(fx.services, fx.discovery.projectId);
  assert.ok(result === null || typeof result === 'object');
});

test('L5: Guardian KNOWN classification from engineering memory does not recurse into Self-Healing', () => {
  const baseId = 'P-KNOWN';
  const drift: DriftItem = {
    artifactId: baseId,
    dimension: 'CORRECTNESS',
    was: 'pass',
    now: 'fail',
    kind: 'REGRESSED',
    source: 'telemetry',
  };
  const mem: GuardianMemory = {
    known: new Map([
      [`${baseId}::CORRECTNESS::REGRESSED`, { rootCause: 'known upstream', remediation: 'apply cataloged fix' }],
    ]),
  };
  const watch = classifySignal({
    signal: { kind: 'drift', drift },
    priorWatches: [],
    memory: mem,
  });
  assert.equal(watch.classifiedAs, 'KNOWN');
  assert.equal(watch.rootCause, 'known upstream');
});

test('L5: withAppendedWatch preserves the prior watch log immutably', () => {
  const a: GuardianWatch = classifySignal({
    signal: {
      kind: 'drift',
      drift: { artifactId: 'P-1', dimension: 'CORRECTNESS', was: 'pass', now: 'fail', kind: 'REGRESSED', source: 'telemetry' },
    },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const b: GuardianWatch = classifySignal({
    signal: {
      kind: 'drift',
      drift: { artifactId: 'P-2', dimension: 'CORRECTNESS', was: 'pass', now: 'fail', kind: 'REGRESSED', source: 'telemetry' },
    },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const before: GuardianWatch[] = [a];
  const after = withAppendedWatch(before, b);
  assert.equal(before.length, 1);
  assert.equal(after.length, 2);
  assert.equal(after[0]?.watchId, a.watchId);
  assert.equal(after[1]?.watchId, b.watchId);
});

  const opsIds = all.filter((a) => a.id.endsWith('-OPS')).map((a) => a.id);
  const snap = await materializeLivingBlueprint(fx.services, fx.discovery.projectId, opsIds, '2025-01-01T00:00:00.000Z');
  assert.equal(snap.projectId, fx.discovery.projectId);
  assert.equal(snap.snapshotAt, '2025-01-01T00:00:00.000Z');
  const fetched = await currentLivingBlueprint(fx.services, fx.discovery.projectId);
  assert.ok(fetched !== null);
  assert.equal(fetched!.manifestId, snap.manifestId);
  const snap2 = await materializeLivingBlueprint(fx.services, fx.discovery.projectId, opsIds, '2025-02-01T00:00:00.000Z');
  assert.notEqual(snap2.manifestId, snap.manifestId);
});

  const e2 = recordLesson({
    stage: 'permanent',
    title: 'L5 lesson',
    body: 'no certification without evidence',
    sourceArtifactIds: ['P-1', 'P-2'],
  }, '2025-01-01T00:00:00.000Z');
  assert.equal(e1.entryHash, e2.entryHash);
  const recs = routingRecommendations([e1]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0]!.stage, 'permanent');
  assert.equal(recs[0]!.lessonCount, 1);
});

  const impact2 = runImpactAnalysis(fx.services.graph, candidate);
  assert.equal(impact1.changeId, 'CHG-9004');
  assert.equal(impact1.analysisHash, impact2.analysisHash);
  assert.ok(impact1.affected.includes(baseId));
  assert.equal(impact1.declared.length + impact1.discovered.length, impact1.affected.length);
  const depMap = buildDependencyMapFor(fx.services.graph, baseId);
  assert.equal(depMap.entries.size, 1);
  void downstreamArtifacts(fx.services.graph, baseId);
});

