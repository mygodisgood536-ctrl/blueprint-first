/**
 * Product Judgment, Intent Preservation, Ambiguity Resolution, the Decision
 * Ledger, and the two product simulations (ARCHITECTURE 3.3 §105-§110).
 *
 * These tests assert the LAWS, not the implementation shape: the intent
 * baseline is immutable, drift from it is detected, material decisions escalate
 * instead of being guessed, the ledger is append-only and durable, judgment
 * reports without certifying, and both simulations derive their findings from
 * the real inventory they actually inspected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifact, type Artifact } from '../src/core/artifact.ts';
import {
  detectIntentDrift,
  establishIntent,
  judgeProduct,
  resolveAmbiguity,
  InMemoryDecisionLedger,
} from '../src/judgment/product-judgment.ts';
import { runAdversarialSimulation, runUserSimulation, runProductSimulations } from '../src/judgment/simulation.ts';
import { DurableJudgmentLedger } from '../src/judgment/store.ts';

const PRODUCER = { kind: 'ai' as const, id: 'test-worker' };
const at = '2026-01-01T00:00:00.000Z';

function artifact(id: string, type: Artifact['type'], extra: Partial<Artifact> = {}): Artifact {
  const [head, numberRaw = '0001'] = id.split('-');
  return createArtifact({
    id,
    type,
    title: extra.title ?? id,
    actor: PRODUCER,
    at,
    ...(extra.dependencies !== undefined ? { dependencies: extra.dependencies } : {}),
    ...(extra.attributes !== undefined ? { attributes: extra.attributes } : {}),
  });
}

test('§106 the product intent baseline is immutable and anchored', () => {
  const intent = establishIntent({
    projectId: 'PROJECT-0001',
    goals: ['let users file support tickets'],
    targetUsers: ['end users'],
    constraints: ['must work on a phone'],
    nonGoals: ['social feed'],
    at,
  });
  assert.equal(intent.anchor.length, 64);
  // The anchor is derived from the content, so a rewritten baseline is visible.
  const tampered = { ...intent, goals: ['let users file support tickets', 'and build a social feed'] };
  const drift = detectIntentDrift({ projectId: 'PROJECT-0001', intent: tampered, subjects: [], at });
  assert.equal(drift.length, 1);
  assert.equal(drift[0]?.kind, 'stale-baseline');
  assert.equal(drift[0]?.severity, 'error');
});

test('§106 drift is detected for untraceable artifacts and stated non-goals', () => {
  const intent = establishIntent({
    projectId: 'PROJECT-0001',
    goals: ['let users file support tickets'],
    targetUsers: ['end users'],
    constraints: [],
    nonGoals: ['social feed'],
    at,
  });
  const drift = detectIntentDrift({
    projectId: 'PROJECT-0001',
    intent,
    subjects: [
      { id: 'FEATURE-0001', label: 'Ticket list', trace: { kind: 'intent', reference: 'g1', detail: 'stated goal' } },
      { id: 'FEATURE-0002', label: 'Mystery module', trace: null },
      { id: 'FEATURE-0003', label: 'social feed', trace: { kind: 'justified-inference', rationale: 'seemed useful', detail: 'x' } },
    ],
    at,
  });
  const kinds = drift.map((d) => `${d.subject}:${d.kind}`);
  assert.ok(kinds.includes('FEATURE-0002 Mystery module:untraceable'), `missing untraceable drift in ${kinds.join('|')}`);
  assert.ok(kinds.includes('FEATURE-0003 social feed:contraindicated'), `missing non-goal drift in ${kinds.join('|')}`);
  // A properly traced artifact produces no drift finding.
  assert.ok(!kinds.some((k) => k.startsWith('FEATURE-0001')));
});

test('§107 material decisions escalate; safe inferences need a rationale', () => {
  for (const cls of ['money', 'permissions', 'identity', 'destructive-action', 'legal-compliance', 'external-commitment', 'product-intent', 'business-behavior']) {
    const resolution = resolveAmbiguity({ decisionClass: cls, rationale: 'we think it is fine', decidedBy: 'engineering' });
    assert.equal(resolution.kind, 'human-decision-required', `${cls} must escalate`);
  }
  // A non-material class with a rationale may be resolved by the organization.
  const safe = resolveAmbiguity({ decisionClass: 'naming-convention', rationale: 'matches existing code style', decidedBy: 'engineering' });
  assert.equal(safe.kind, 'safe-inference');
  // ...but never without a recorded rationale.
  const unsafe = resolveAmbiguity({ decisionClass: 'naming-convention' });
  assert.equal(unsafe.kind, 'human-decision-required');
});

test('§108 the decision ledger is append-only and keeps the full chain', () => {
  const ledger = new InMemoryDecisionLedger();
  const record = ledger.record({
    projectId: 'PROJECT-0001',
    decision: 'Refunds are issued only for payments captured in the same fiscal quarter',
    decisionClass: 'money',
    rationale: 'finance policy FY26',
    evidenceIds: ['EV-000001'],
    alternativesConsidered: ['always refund', 'never refund'],
    authorizedBy: 'finance-owner',
    affectedArtifactIds: ['RULE-0001', 'WORKFLOW-0002'],
    downstreamImpact: 'refund state machine and its tests change',
    resolution: 'human-decision-required',
    at,
  });
  assert.match(record.id, /^DEC-\d{6}$/);
  assert.equal(ledger.forProject('PROJECT-0001').length, 1);
  // Re-using an ID is rejected: history is never silently overwritten.
  assert.throws(() => ledger.record({ ...record, id: record.id }));
  assert.equal(ledger.forProject('PROJECT-0001').length, 1);
  assert.deepEqual(ledger.byId(record.id)?.alternativesConsidered, ['always refund', 'never refund']);
});

test('§105 product judgment reports without certifying', () => {
  const intent = establishIntent({ projectId: 'PROJECT-0001', goals: ['g'], targetUsers: ['u'], constraints: [], nonGoals: [], at });
  const drift = detectIntentDrift({
    projectId: 'PROJECT-0001',
    intent,
    subjects: [{ id: 'FEATURE-0009', label: 'Orphan', trace: null }],
    at,
  });
  const report = judgeProduct({
    projectId: 'PROJECT-0001',
    stages: [
      { id: 'discovery', label: 'Discovery', inScope: true, status: 'RECORDED' },
      { id: 'design', label: 'Design', inScope: true, status: 'PENDING' },
    ],
    pageCount: 12,
    roleCount: 0,
    workflowCount: 0,
    driftofIntent: drift,
    openDecisions: [
      {
        id: 'DEC-000001',
        projectId: 'PROJECT-0001',
        decision: 'who may delete an account',
        decisionClass: 'permissions',
        rationale: '',
        evidenceIds: [],
        alternativesConsidered: [],
        authorizedBy: null,
        affectedArtifactIds: ['PERMISSION-0001'],
        downstreamImpact: 'delete flow',
        resolution: 'human-decision-required',
        at,
      },
    ],
    at,
  });
  // Pages with no role and no workflow is a product-level defect the
  // completeness gates do not cover.
  assert.ok(report.findings.some((f) => f.dimension === 'navigability' && f.severity === 'defect'));
  // Real intent drift surfaces as a judgment defect.
  assert.ok(report.findings.some((f) => f.dimension === 'intent-coherence' && f.severity === 'defect'));
  // A material decision still awaiting a human is a live consistency defect.
  assert.ok(report.findings.some((f) => f.dimension === 'consistency' && f.severity === 'defect'));
  // An unrecorded in-scope stage is an observation, not a defect.
  assert.ok(report.findings.some((f) => f.dimension === 'outcome-clarity' && f.severity === 'observation'));
  assert.notEqual(report.verdict, 'SOUND');
  // Judgment is a report, never a certification: nothing here advances state.
  assert.match(report.summary, /never certifies/);
});

test('§109 user simulation reports not-applicable when there are no real surfaces', () => {
  const findings = runUserSimulation({ projectId: 'PROJECT-0001', artifacts: [], at });
  assert.equal(findings.length, 7, 'one entry per representative persona');
  assert.ok(findings.every((f) => f.severity === 'not-applicable'));
  assert.ok(findings.every((f) => f.examinedArtifactIds.length === 0));
});

test('§109 real user simulation finds genuine per-persona gaps in a real inventory', () => {
  const pages = [
    artifact('PAGE-0001', 'PAGE', { title: 'Ticket list' }),
    artifact('PAGE-0002', 'PAGE', { title: 'Ticket detail' }),
  ];
  const actions = [artifact('ACTION-0001', 'ACTION', { title: 'Create ticket', dependencies: ['PAGE-0001'] })];
  const findings = runUserSimulation({ projectId: 'PROJECT-0001', artifacts: [...pages, ...actions], at });
  // No state/responsive/a11y/validation substrate exists on these pages.
  assert.ok(findings.some((f) => f.persona === 'new-user' && f.dimension === 'first-run' && f.severity === 'defect'));
  assert.ok(findings.some((f) => f.persona === 'mobile-user' && f.dimension === 'responsive' && f.severity === 'defect'));
  assert.ok(findings.some((f) => f.persona === 'tablet-user' && f.dimension === 'responsive' && f.severity === 'defect'));
  assert.ok(findings.some((f) => f.persona === 'accessibility-oriented-user' && f.severity === 'defect'));
  assert.ok(findings.some((f) => f.persona === 'error-prone-user' && f.severity === 'defect'));
  // Every defect names the artifacts it actually inspected. The one exception is
  // the role-coverage defect, whose subject (roles/workflows) genuinely does not
  // exist - there is nothing to name, which is precisely what it reports.
  const defects = findings.filter((f) => f.severity === 'defect');
  assert.ok(defects.every((f) => f.examinedArtifactIds.length > 0 || f.subject === 'role-coverage'));
});

test('§110 adversarial simulation attacks every named dimension', () => {
  const artifacts = [
    artifact('FEATURE-0001', 'FEATURE', { title: 'Tickets' }),
    artifact('PAGE-0001', 'PAGE', { title: 'Ticket list', dependencies: ['FEATURE-0001'] }),
    artifact('ACTION-0001', 'ACTION', { title: 'Delete ticket', dependencies: ['PAGE-0001'] }),
  ];
  const findings = runAdversarialSimulation({ projectId: 'PROJECT-0001', artifacts, at });
  const dimensions = new Set(findings.map((f) => f.dimension));
  for (const required of [
    'workflows', 'permissions', 'navigation', 'business-rules', 'data-consistency',
    'ui-states', 'accessibility', 'performance', 'security', 'integrations', 'recovery', 'edge-cases',
  ]) {
    assert.ok(dimensions.has(required), `adversarial pass did not attack "${required}"`);
  }
  // A feature with no workflow and an action with no permission are real defects.
  assert.ok(findings.some((f) => f.dimension === 'workflows' && f.severity === 'defect'));
  assert.ok(findings.some((f) => f.dimension === 'permissions' && f.severity === 'defect'));
  // Dimensions with genuinely no subject are reported honestly, never as a pass.
  assert.ok(findings.some((f) => f.dimension === 'data-consistency' && f.severity === 'not-applicable'));
});

test('§110 an inventory with real coverage is reported as observation, not defect', () => {
  const artifacts = [
    artifact('FEATURE-0001', 'FEATURE', { title: 'Tickets' }),
    artifact('WORKFLOW-0001', 'WORKFLOW', { title: 'File a ticket', dependencies: ['FEATURE-0001'] }),
    artifact('ACTION-0001', 'ACTION', { title: 'Create ticket', dependencies: ['PAGE-0001'] }),
    artifact('PERMISSION-0001', 'PERMISSION', { title: 'May create tickets', dependencies: ['ACTION-0001'] }),
    artifact('ENTITY-0001', 'ENTITY', { title: 'Ticket' }),
    artifact('API-0001', 'API', { title: 'Create ticket', dependencies: ['ENTITY-0001'] }),
    artifact('RULE-0001', 'RULE', { title: 'Tickets start open', dependencies: ['ACTION-0001'] }),
    artifact('STATE-0001', 'STATE', { title: 'Empty', dependencies: ['ACTION-0001'] }),
    artifact('A11Y-0001', 'A11Y', { title: 'List keyboard path', dependencies: ['PAGE-0001'] }),
    artifact('A11Y-0002', 'A11Y', { title: 'Detail keyboard path', dependencies: ['PAGE-0002'] }),
    artifact('PERF-0001', 'PERF', { title: 'List pagination', dependencies: ['PAGE-0001'] }),
    artifact('PERF-0002', 'PERF', { title: 'Detail load budget', dependencies: ['PAGE-0002'] }),
    artifact('SEC_REQ-0001', 'SEC_REQ', { title: 'List authorization', dependencies: ['PAGE-0001'] }),
    artifact('SEC_REQ-0002', 'SEC_REQ', { title: 'Detail authorization', dependencies: ['PAGE-0002'] }),
    artifact('INTEGRATION-0001', 'INTEGRATION', { title: 'Email notification', dependencies: ['PAGE-0001'] }),
    artifact('INTEGRATION-0002', 'INTEGRATION', { title: 'Webhook on close', dependencies: ['PAGE-0002'] }),
    artifact('FINDING-0001', 'FINDING', { title: 'Delete implies restore', dependencies: ['ENTITY-0001'] }),
    artifact('PAGE-0002', 'PAGE', { title: 'Ticket detail', dependencies: ['FEATURE-0001'], attributes: { layers: ['States', 'Interactions', 'Responsive', 'Recovery'] } }),
    artifact('PAGE-0001', 'PAGE', { title: 'Ticket list', dependencies: ['FEATURE-0001'], attributes: { layers: ['States', 'Interactions', 'Responsive', 'Recovery'] } }),
  ];
  const findings = runAdversarialSimulation({ projectId: 'PROJECT-0001', artifacts, at });
  // Every defect class the attacks look for is closed by this inventory.
  const defects = findings.filter((f) => f.severity === 'defect');
  assert.deepEqual(defects.map((d) => `${d.dimension}:${d.subject}`), [], `unexpected adversarial defects: ${defects.map((d) => d.dimension + ':' + d.subject).join(', ')}`);
});

test('the judgment layer is durable across a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-judgment-'));
  try {
    const first = new DurableJudgmentLedger(join(dir, 'judgment.json'));
    await first.init();
    await first.establishIntentBaseline({ projectId: 'PROJECT-0001', goals: ['g1'], targetUsers: ['u1'], constraints: [], nonGoals: [], at });
    first.record({
      projectId: 'PROJECT-0001',
      decision: 'Adopt staged rollouts',
      decisionClass: 'business-behavior',
      rationale: 'staged rollout reduces blast radius',
      evidenceIds: [],
      alternativesConsidered: ['big bang'],
      authorizedBy: 'eng',
      affectedArtifactIds: ['OPS-0001'],
      downstreamImpact: 'deployment plan',
      resolution: 'safe-inference',
      at,
    });
    const simulated = await first.runSimulations({ projectId: 'PROJECT-0001', artifacts: [artifact('PAGE-0001', 'PAGE')], at });
    assert.ok(simulated.defects >= 0);

    // A fresh instance over the same file sees everything that was recorded.
    const second = new DurableJudgmentLedger(join(dir, 'judgment.json'));
    await second.init();
    assert.ok(second.intentOf('PROJECT-0001') !== null);
    assert.equal(second.forProject('PROJECT-0001').length, 1);
    assert.ok(second.latestSimulation('PROJECT-0001') !== null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runProductSimulations rolls both passes into one honest report', () => {
  const report = runProductSimulations({ projectId: 'PROJECT-0001', artifacts: [], at });
  assert.equal(report.userSimulation.length, 7);
  assert.equal(report.adversarialSimulation.length, 12);
  assert.equal(report.defects, 0);
  assert.equal(report.notApplicable, 19);
  assert.match(report.summary, /inputs to final certification/);
});
