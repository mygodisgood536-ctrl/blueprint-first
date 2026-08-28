/**
 * Level-1b end-to-end demo - what EXISTS vs what does not.
 *
 * One deterministic, fully offline run drives the complete implemented chain
 * through the real verification machinery:
 *
 *   Product Understanding Brief
 *     -> Discovery Department (Level 1b)         VERIFIED baseline into
 *        Clusters A+B -> self-checks ->            store + Knowledge Graph,
 *        specialists -> independent boss           confidence scored (§0.13)
 *        reconstruction on pages/features/
 *        workflows
 *     -> AI Design Studio                        BLUEPRINT-n + PAGE/FEATURE-n-
 *        (deterministic derivation)               DESIGN with evidence anchors
 *     -> Blueprint approval gate                 real gate over stored state;
 *        (human product-owner approver)           blueprint APPROVED
 *     -> AI Build Studio                         PAGE/FEATURE-n-IMPL plus a
 *        (approved blueprint only)                COMPONENT implementation manifest
 *
 * The AI provider is the deterministic ScriptedProvider everywhere - responses
 * are SCRIPTED DEMO RESPONSES, not a live model. They are recorded as
 * sha256-anchored evidence and never trusted as structure.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../core/config.ts';
import { consoleSink, createLogger } from '../core/logging.ts';
import { ArtifactIdAllocator } from '../core/id-allocator.ts';
import { JsonFileArtifactStore } from '../core/json-file-store.ts';
import { KnowledgeGraph } from '../core/graph.ts';
import { MemoryEvidenceLog } from '../verification/evidence.ts';
import { AiRouter } from '../ai/router.ts';
import { ScriptedProvider } from '../ai/scripted-provider.ts';
import type { CoreServices } from '../core/services.ts';
import {
  DiscoveryDepartment,
  UNDERSTANDING_MARKER,
  STRUCTURAL_MARKER,
} from '../discovery/department/engine.ts';
import { BOSS_MARKER } from '../discovery/department/boss.ts';
import { AiDesignStudio } from '../design/studio.ts';
import { approveBlueprint } from '../design/approval.ts';
import { AiBuildStudio } from '../build/studio.ts';
import { runTestDepartment } from '../testing/department.ts';
import { runOperationsDepartment } from '../operations/department.ts';
import { runContinuousEngineeringDepartment } from '../continuous/department.ts';
import { runSafeChangeDepartment } from '../change/department.ts';
import { runRecursionDepartment } from '../recursion/department.ts';
import { runPermanentEngineeringOrganization, candidateFromDrift } from '../perm/department.ts';
import { emptyGuardianMemory, classifySignal } from '../perm/guardian.ts';
import { SyntheticTelemetrySource } from '../telemetry/source.ts';
import {
  createDeploymentEnvironment,
  deployRelease,
  verifyDeployedUnit,
} from '../operations/deploy.ts';
import { recordDocGate, docStateOf } from '../core/doc.ts';
import { ReasoningCouncil } from '../council/council.ts';
import { MasterVerificationEngine } from '../verification/master-engine.ts';
import { createClosureVerifier } from '../verification/closure-verifier.ts';
import { certifyBlueprintCompleteness } from '../design/certification.ts';
import { lineageStatus, coverageSummary, requirementsTraceability } from '../traceability/trace.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import type { TelemetryObservation } from '../telemetry/source.ts';

/** Deterministic demo inventory (exactly what the discovery engine parses). */
const DISCOVERY_JSON = {
  product: { name: 'TeamTask', summary: 'A lightweight task tracker for small teams.' },
  modules: [
    { key: 'projects', title: 'Projects', purpose: 'Organize tasks into projects.' },
    { key: 'tasks', title: 'Tasks', purpose: 'Create and track work items.' },
  ],
  features: [
    { key: 'project-organizer', moduleKey: 'projects', title: 'Project organizer', description: 'Group and filter tasks by project.' },
    { key: 'task-crud', moduleKey: 'tasks', title: 'Task CRUD', description: 'Create, update and complete tasks.' },
  ],
  workflows: [
    { key: 'task-lifecycle', title: 'Task lifecycle', steps: ['create', 'assign', 'complete'] },
  ],
  pages: [
    {
      key: 'task-board',
      moduleKey: 'tasks',
      title: 'Task Board',
      purpose: 'See all tasks at a glance.',
      sections: [
        { key: 'board-columns', title: 'Columns', contentType: 'kanban' },
        { key: 'board-toolbar', title: 'Toolbar', contentType: 'toolbar' },
      ],
      actions: [
        { key: 'create-task', title: 'Create task', outcome: 'New task appears in first column.' },
        { key: 'move-task', title: 'Move task', outcome: 'Task changes column.' },
      ],
      states: [{ key: 'empty-board', name: 'Empty board', whenVisible: 'No tasks exist yet.' }],
      validations: [{ targetKey: 'create-task', message: 'Title is required.' }],
    },
    {
      key: 'task-details',
      moduleKey: 'tasks',
      title: 'Task Details',
      purpose: 'Edit a single task.',
      sections: [{ key: 'details-form', title: 'Details form', contentType: 'form' }],
      actions: [
        { key: 'save-changes', title: 'Save changes', outcome: 'Task persisted.' },
        { key: 'delete-task', title: 'Delete task', outcome: 'Task removed after confirm.' },
      ],
      states: [],
      validations: [],
    },
  ],
  rules: [{ key: 'confirm-before-delete', statement: 'Deleting a task always requires confirmation.' }],
  permissions: [{ key: 'manage-tasks', resource: 'task', roles: ['admin', 'member'] }],
  entities: [
    {
      key: 'task',
      name: 'Task',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'dueDate', type: 'date', required: false },
      ],
    },
  ],
  apis: [
    { key: 'create-task-api', method: 'POST', path: '/api/tasks', purpose: 'Create a task.', requestEntityKey: 'task', responseEntityKey: 'task' },
    { key: 'list-tasks-api', method: 'GET', path: '/api/tasks', purpose: 'List tasks.', responseEntityKey: 'task' },
  ],
  integrations: [
    { key: 'email-notify', name: 'Email notifications', direction: 'outbound', purpose: 'Notify assignees.' },
  ],
};

async function main(): Promise<number> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, sink: consoleSink() });
  logger.info('demo.start', {
    envName: config.envName,
    dataDir: config.dataDir,
    provider: 'ScriptedProvider (DETERMINISTIC DEMO RESPONSES - not a live model)',
  });

  // --- shared services: one allocator/store/graph/evidence/router per run ---
  const allocator = new ArtifactIdAllocator();
  const storePath = join(config.dataDir, 'blueprint-store.json');
  await fs.rm(storePath, { force: true }); // deterministic scenario: reset own file
  const store = new JsonFileArtifactStore({ filePath: storePath, allocator });
  const graph = new KnowledgeGraph();
  const evidence = new MemoryEvidenceLog();
  const scripted = new ScriptedProvider({
    rules: [
      // Level-1b department calls are routed by prompt markers and MUST
      // precede the generic DISCOVERY rule (they also carry taskType DISCOVERY).
      {
        match: (req) => req.messages.some((m) => m.content.includes(UNDERSTANDING_MARKER)),
        respond: () =>
          JSON.stringify({
            product: DISCOVERY_JSON.product,
            domainProfile: 'Lightweight team-productivity domain; small collaborative teams.',
            selfCheck: { uncertainties: ['Whether recurring tasks are in scope.'] },
          }),
      },
      {
        match: (req) => req.messages.some((m) => m.content.includes(STRUCTURAL_MARKER)),
        respond: () => JSON.stringify(DISCOVERY_JSON),
      },
      {
        match: (req) => req.messages.some((m) => m.content.includes(BOSS_MARKER)),
        respond: () =>
          JSON.stringify({
            productName: DISCOVERY_JSON.product.name,
            features: DISCOVERY_JSON.features.map((f) => ({ key: f.key, title: f.title })),
            workflows: DISCOVERY_JSON.workflows.map((w) => ({ key: w.key, title: w.title })),
            pages: DISCOVERY_JSON.pages.map((p) => ({ key: p.key, title: p.title })),
          }),
      },
      {
        match: (req) => req.taskType === 'DESIGN',
        respond: () =>
          'Scripted design rationale (deterministic): layout preserves the certified ' +
          'section order; interactions map one-to-one to discovered actions.',
      },
      {
        match: (req) => req.taskType === 'BUILD',
        respond: () =>
          'Scripted implementation note (deterministic): component skeleton derives ' +
          'from the approved design doc; validations surface next to their triggers.',
      },
      {
        match: (req) => req.messages.some((m) => m.content.includes('[COUNCIL]')),
        respond: () =>
          JSON.stringify({
            stance: 'endorse',
            findings: [],
            uncertainties: [],
          }),
      },
    ],
  });
  const router = new AiRouter({ logger });
  router.register(scripted).setDefaultProvider('scripted');
  const services: CoreServices = {
    store,
    allocator,
    graph,
    evidence,
    router,
    logger,
  };

  // --- Stage 1: discovery department -----------------------------------------
    console.log('Stage 1/12 - Discovery Department (Clusters A+B + independent boss)');
  const discovery = await new DiscoveryDepartment(services).discover({
    name: DISCOVERY_JSON.product.name,
    vision: 'A lightweight task tracker that small teams can adopt in minutes.',
    targetUsers: ['small teams'],
  });
  if (discovery.status !== 'accepted' || discovery.baseline === undefined) {
    logger.warn('demo.discovery.failed', { status: discovery.status, code: discovery.error?.code });
    return 1;
  }
  const baseline = discovery.baseline;
  console.log(
    `  accepted: ${baseline.totalArtifacts} artifacts, project ${baseline.projectId}, ` +
      `${discovery.diff?.deltas.length ?? 0} reconstruction deltas`,
  );

  // --- Stage 2: design ---------------------------------------------------------
    console.log('Stage 2/12 - AI Design Studio');
  const design = await new AiDesignStudio(services).designFromBaseline(baseline);
  if (design.status !== 'accepted' || design.blueprintId === undefined) {
    logger.warn('demo.design.failed', { status: design.status, code: design.error?.code });
    return 1;
  }
  console.log(`  accepted: blueprint ${design.blueprintId} with ${design.artifactIds.length - 1} designs`);

  // --- Stage 3: approval gate ----------------------------------------------------
    console.log('Stage 3/12 - Blueprint approval gate');
  const approval = await approveBlueprint(services, design.blueprintId);
  if (!approval.approved) {
    logger.warn('demo.approval.rejected', { reasons: approval.reasons });
    return 1;
  }
  console.log(`  approved by product-owner-01, evidence ${approval.evidenceId ?? '?'}`);

  // --- Stage 4: build ------------------------------------------------------------
    console.log('Stage 4/12 - AI Build Studio');
  const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
  if (build.status !== 'accepted') {
    logger.warn('demo.build.failed', { status: build.status, code: build.error?.code });
    return 1;
  }
  console.log(`  accepted: manifest ${build.manifestId} aggregating ${build.artifactIds.length - 1} implementations`);

  // --- Stage 5: verified engineering organization ------------------------------
    console.log('Stage 5/12 - Verified Engineering Organization');
  const closureIds = [
    ...new Set<string>([
      design.blueprintId,
      ...design.artifactIds,
      ...build.artifactIds,
      ...discovery.artifactIds,
    ]),
  ];
  const council = await new ReasoningCouncil(services).deliberate({
    subject: design.blueprintId,
    question: 'Is this blueprint complete, coherent and safe to certify?',
    contextSummary:
      `Certified inventory of ${baseline.totalArtifacts} artifacts; ` +
      `${design.artifactIds.length - 1} designs; ` +
      `${build.artifactIds.length - 1} implementations; all VERIFIED.`,
    artifactIds: [design.blueprintId],
  });
  const master = await new MasterVerificationEngine(services).verifyArtifactSet({
    artifactIds: closureIds,
    artifactClass: 'blueprint',
    verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
    producerActors: [
      { kind: 'ai', id: 'understanding-worker-01' },
      { kind: 'ai', id: 'structural-worker-01' },
      { kind: 'ai', id: 'design-worker-01' },
      { kind: 'ai', id: 'build-worker-01' },
    ],
    deliberation: council,
  });
  const trace = await requirementsTraceability(
    services.store,
    services.graph,
    services.evidence,
    baseline.projectId,
  );
  console.log(
    `  council=${council.verdict}, masterPassed=${master.masterPassed}, traceComplete=${trace.complete}`,
  );

  const certification = await certifyBlueprintCompleteness(services, {
    blueprintId: design.blueprintId,
    master,
    council,
    trace,
  });
  if (!certification.certified) {
    logger.warn('demo.certification.refused', { reasons: certification.reasons });
    return 1;
  }
  console.log(
    `  certification: CERTIFIED; ${certification.stampedArtifactIds.length} artifact(s) stamped; ` +
      `evidence ${certification.evidenceId ?? '?'}`,
  );

  // --- Stage 6: AI Acceptance Testing Department ------------------------------
  // Runs after certification so the governed DoC walker may legitimately advance
  // certified designs/implementations to DESIGN-VERIFIED / TEST-VERIFIED rather
  // than halting at an un-certified CERTIFIED boundary.
    console.log('Stage 6/12 - AI Acceptance Testing Department');
  const testRun = await runTestDepartment(services, baseline.projectId, { sampleSize: 2 });
  if (testRun.status !== 'passed') {
    logger.warn('demo.test.failed', {
      failedChecks: testRun.failedChecks,
      boss: testRun.boss.rationale,
      auditor: testRun.auditor.rationale,
    });
    return 1;
  }
  console.log(
    `  ${testRun.status}: ${testRun.executed.length} checks; boss=${testRun.boss.verdict}; ` +
      `auditor=${testRun.auditor.verdict}; report ${testRun.reportId ?? '(none)'}; ` +
      `evidence ${testRun.evidenceId ?? '(none)'}`,
  );
  console.log(
    `  ${testRun.testIds.length} -TEST artifact(s) persisted; ` +
      `advanced to TEST-VERIFIED: ${testRun.advancedToTestVerified.join(', ') || 'none'}; ` +
      `DoC halts: ${testRun.docHalts.map((h) => `${h.id}@${h.haltedAt}`).join(', ') || 'none'}`,
  );
    console.log(`  TEST lineage: ${testRun.testIds.join(' ')}`);

  // --- Stage 7: AI Operations & Observability Layer ----------------------------
  // Runs after the Acceptance Testing Department certifies the -TEST closure,
  // which is the only inventory Stage 4 is permitted to deploy.
  console.log('Stage 7/12 - AI Operations & Observability Layer (Deployment)');
  const opsRun = await runOperationsDepartment(services, baseline.projectId, { sampleSize: 2 });
  if (opsRun.status !== 'passed') {
    logger.warn('demo.ops.failed', {
      failedUnits: opsRun.failedUnits,
      boss: opsRun.boss.rationale,
      auditor: opsRun.auditor.rationale,
    });
    return 1;
  }
  console.log(
    `  ${opsRun.status}: ${opsRun.executed.length} unit(s) deployed to production; boss=${opsRun.boss.verdict}; ` +
      `auditor=${opsRun.auditor.verdict}; manifest ${opsRun.manifestId ?? '(none)'}; ` +
      `evidence ${opsRun.evidenceId ?? '(none)'}`,
  );
  console.log(
    `  ${opsRun.deployIds.length} -DEPLOY artifact(s) persisted; ` +
      `advanced to DEPLOYED-VERIFIED: ${opsRun.advancedToDeployedVerified.join(', ') || 'none'}; ` +
      `DoC halts: ${opsRun.docHalts.map((h) => `${h.id}@${h.haltedAt}`).join(', ') || 'none'}`,
  );
  console.log(`  DEPLOY lineage: ${opsRun.deployIds.join(' ')}`);

  // --- Stage 8: Continuous Engineering Department (Permanent Self-Healing Org) -
  // The only stage whose subject is the *live* state of an already-deployed
  // project. Drives the Worker Corps -> Boss -> Auditor -> Materialization
  // flow against the DEPLOYED-VERIFIED closure, and (when no drift is
  // detected) advances the Definition of Complete to CERTIFIED COMPLETE
  // by materializing -OPS lineage and the project's PERM manifest.
  console.log('Stage 8/12 - Continuous Engineering Department (Permanent Self-Healing Org)');
  const contRun = await runContinuousEngineeringDepartment(services, baseline.projectId, { sampleSize: 2 });
  if (contRun.finalVerdict !== 'CERTIFIED_COMPLETE') {
    logger.warn('demo.continuous.failed', {
      verdict: contRun.finalVerdict,
      rationale: contRun.rationale,
    });
    return 1;
  }
  console.log(
    `  ${contRun.finalVerdict}: ${contRun.workerReport.scopedCount} artifact(s) observed, ` +
      `${contRun.workerReport.stableCount} stable; ` +
      `boss=${contRun.bossDecision.verdict}; auditor=${contRun.auditorDecision.verdict}; ` +
      `manifest ${contRun.materialization?.manifestId ?? '(none)'}`,
  );
  console.log(`  OPS lineage: ${contRun.materialization?.opsIds.join(' ') ?? '(none)'}`);

  // --- Stage 9: Live Runtime Telemetry observation --------------------------
  // The Continuous Engineering Department at Stage 8 confirmed the system
  // was stable on the freshly-deployed env. In production, the platform's
  // runtime instrumentation now observes the live system. The synthetic
  // source stands in for that instrumentation; here we observe a single
  // base, PAGE-0001, and the SyntheticTelemetrySource deterministically
  // returns a breach (an error_rate above the default threshold). The
  // observation is sha256-anchored and carries its own id so the Safe
  // Change Auditor can later re-derive the same content byte-for-byte.
  console.log('Stage 9/12 - Live Runtime Telemetry observation (synthetic)');
  const telemetrySource = new SyntheticTelemetrySource();
  const telemetryBase = baseline.pages[0]?.artifactId ?? 'PAGE-0001';
  const telemetryObservation: TelemetryObservation = telemetrySource.observe(
    telemetryBase,
    { errorRate: 0.5 },
  );
  console.log(
    `  observation ${telemetryObservation.id} on ${telemetryObservation.baseId}: ` +
      `metric=${telemetryObservation.metric} breach=${telemetryObservation.breach} ` +
      `evidence=${telemetryObservation.evidenceHash.slice(0, 12)}…`,
  );

  // --- Stage 10: Continuous Discovery Recursion -----------------------------
  // The recursion department compares the current telemetry report against
  // the prior continuous-engineering worker report, classifies the delta,
  // and routes actionable/regression items to the Safe Change Department.
  // Since the new observation is a breach (was pass -> now fail, REGRESSED)
  // and was NOT in the prior report, it is classified as `regression`.
  console.log('Stage 10/12 - Continuous Discovery Recursion');
  const recursionResult = await runRecursionDepartment(services, {
    prior: contRun.workerReport.driftFindings,
    current: [
      {
        artifactId: telemetryObservation.baseId,
        dimension: 'CORRECTNESS',
        was: 'pass',
        now: 'fail',
        kind: 'REGRESSED',
        source: 'telemetry',
        evidenceRef: telemetryObservation.id,
      } satisfies DriftItem,
    ],
    projectId: baseline.projectId,
    env: { units: new Map() }, // empty env: change dept is only asked to classify, not apply
    apply: false,
  });
  console.log(
    `  ${recursionResult.classification.deltas.length} item(s) classified, ` +
      `${recursionResult.classification.regressions.length} regression(s), ` +
      `${recursionResult.classification.actionable.length} actionable; ` +
      `allRemediated=${recursionResult.allRemediated}; ` +
      `hash=${recursionResult.classification.classificationHash.slice(0, 12)}…`,
  );
  const firstChange = recursionResult.changes[0];
  if (firstChange === undefined) {
    logger.warn('demo.recursion.empty', { classificationHash: recursionResult.classification.classificationHash });
    return 1;
  }

  // --- Stage 11: Safe Change Intelligence -----------------------------------
  // Rebuild the deployed env so we can apply the authorized remediation in
  // place. The Safe Change Department runs the full pipeline: Change
  // Analyst -> Boss (independent) -> Auditor (hash-reproducing) -> apply.
  // On success, the artifact's DoC walks through the L4 drift loop:
  //   CERTIFIED COMPLETE -> REGRESSION_DETECTED -> RE-MEDIATED ->
  //   RE-MEDIATION-VERIFIED -> CERTIFIED COMPLETE
  console.log('Stage 11/12 - Safe Change Intelligence (apply + drift loop)');
  const changeEnv = createDeploymentEnvironment('production');
  await deployRelease(services, opsRun.scope, changeEnv);
  for (const exp of opsRun.scope) await verifyDeployedUnit(services, exp, changeEnv);
  const beforeHash = changeEnv.units.get(telemetryBase)?.configHash;
  const changeResult = await runSafeChangeDepartment(services, {
    drift: firstChange.drift,
    observation: telemetryObservation,
    projectId: baseline.projectId,
    env: changeEnv,
    apply: true,
  });
  const afterHash = changeEnv.units.get(telemetryBase)?.configHash;
  if (changeResult.status !== 'AUTHORIZED_AND_APPLIED') {
    logger.warn('demo.change.failed', { status: changeResult.status, reason: (changeResult as { reason?: string }).reason });
    return 1;
  }
  console.log(
    `  ${changeResult.status}: boss=${changeResult.trail.bossDecision.verdict} ` +
      `auditor=${changeResult.trail.auditorDecision.verdict}; ` +
      `proposal=${changeResult.materialization.proposalId} ` +
      `approval=${changeResult.materialization.approvalId} ` +
      `change=${changeResult.materialization.changeId ?? '(none)'}; ` +
      `configHash ${beforeHash?.slice(0, 12)}… -> ${afterHash?.slice(0, 12)}…`,
  );

  // Walk the L4 drift loop on the baseId's -IMPL artifact. The artifact
  // is currently at DEPLOYED-VERIFIED (advanced by the Operations Dept in
  // Stage 7). First advance to CERTIFIED COMPLETE (Stage 8's Continuous
  // Engineering Dept stamps this on the closure, but per-artifact this is
  // the explicit step). Then the runtime-regression detector downgrades
  // it to REGRESSION_DETECTED, the safe-change-boss accepts the
  // remediation (-> RE-MEDIATED), the safe-change-auditor confirms
  // (-> RE-MEDIATION-VERIFIED), and the cert engine re-stamps
  // CERTIFIED COMPLETE. Each step is recorded on the artifact's provenance.
  const implId = `${telemetryBase}-IMPL`;
  const impl = await services.store.get(implId);
  if (impl === null) {
    logger.warn('demo.driftLoop.missingImpl', { implId });
    return 1;
  }
  const startState = docStateOf(impl);
  if (startState === undefined) {
    logger.warn('demo.driftLoop.unstampedImpl', { implId });
    return 1;
  }
  // 0) DEPLOYED-VERIFIED -> CERTIFIED COMPLETE (cert engine) — this is the
  // prerequisite to the regression loop.
  const certified = await recordDocGate(services.store, implId, 'CERTIFIED COMPLETE', {
    kind: 'system',
    id: 'certification-engine',
  }, { gate: 'certification-engine' });
  void certified;
  // 1) CERTIFIED COMPLETE -> REGRESSION_DETECTED (runtime regression detector)
  await recordDocGate(services.store, implId, 'REGRESSION_DETECTED', {
    kind: 'system',
    id: 'runtime-regression-detector',
  }, { gate: 'runtime-regression-detector', evidenceId: telemetryObservation.id });
  // 2) REGRESSION_DETECTED -> RE-MEDIATED (safe-change-boss)
  await recordDocGate(services.store, implId, 'RE-MEDIATED', {
    kind: 'verifier',
    id: 'safe-change-boss-01',
  }, { gate: 'safe-change-boss', evidenceId: changeResult.trail.bossDecision.decisionHash });
  // 3) RE-MEDIATED -> RE-MEDIATION-VERIFIED (safe-change-auditor)
  await recordDocGate(services.store, implId, 'RE-MEDIATION-VERIFIED', {
    kind: 'verifier',
    id: 'safe-change-auditor-01',
  }, { gate: 'safe-change-auditor', evidenceId: changeResult.trail.auditorDecision.decisionHash });
  // 4) RE-MEDIATION-VERIFIED -> CERTIFIED COMPLETE (certification engine)
  const final = await recordDocGate(services.store, implId, 'CERTIFIED COMPLETE', {
    kind: 'system',
    id: 'certification-engine',
  }, { gate: 'certification-engine', evidenceId: changeResult.trail.auditorDecision.decisionHash });
  console.log(
    `  DoC drift loop on ${implId}: ${startState} -> REGRESSION_DETECTED -> ` +
      `RE-MEDIATED -> RE-MEDIATION-VERIFIED -> ${docStateOf(final)}`,
  );

  // --- Stage 12: Permanent Engineering Organization --------------------------
  // Level 5 — composition-only orchestrator that drives Guardian (signal
  // classification) → Impact Analysis (surprise set) → Safe Change
  // Department (Worker / Boss / Auditor) → Change History → Living Blueprint.
  // The PEO does NOT certify. The Continuous Engineering Boss + Auditor
  // remain the only certifiers. We exercise two signals so the demo shows:
  //   - a NOVEL first-seen drift (recommended, not applied — needs human)
  //   - a RECURRING drift that escalates to the L4 safe change path.
  console.log('Stage 12/12 - Permanent Engineering Organization (L5 composition)');
  const peoCandidate = candidateFromDrift(
    'CHG-PE-9001',
    firstChange.drift,
    'self-healing',
    'config_restoration',
    'PEO demo candidate from Stage 11 drift',
    'composition of Guardian + Impact + Safe Change',
    services,
  ).candidate;
  const peoDriftRecurring: DriftItem = {
    artifactId: firstChange.drift.artifactId,
    dimension: firstChange.drift.dimension,
    was: firstChange.drift.was,
    now: firstChange.drift.now,
    kind: firstChange.drift.kind,
    source: firstChange.drift.source,
  };
  const peoPriorWatch1 = classifySignal({
    signal: { kind: 'drift', drift: peoDriftRecurring },
    priorWatches: [],
    memory: emptyGuardianMemory(),
  });
  const peoPriorWatch2 = classifySignal({
    signal: { kind: 'drift', drift: peoDriftRecurring },
    priorWatches: [peoPriorWatch1],
    memory: emptyGuardianMemory(),
  });
  const peoResult = await runPermanentEngineeringOrganization(services, {
    candidate: peoCandidate,
    priorWatches: [peoPriorWatch1, peoPriorWatch2],
    memory: emptyGuardianMemory(),
    projectId: baseline.projectId,
  });
  console.log(
    `  PEO chain: source=${peoResult.source}; ` +
      `Guardian=${peoResult.watch.classifiedAs}; ` +
      `impact=${peoResult.impact.affected.length} affected (hash ${peoResult.impact.analysisHash.slice(0, 12)}…); ` +
      `SafeChange=${peoResult.change.status}; ` +
      `authorized=${peoResult.authorized}; ` +
      `escalated=${peoResult.escalated}; ` +
      `watchEvidence=${peoResult.watch.evidenceHash.slice(0, 12)}…; ` +
      `rationale=${peoResult.rationale.slice(0, 80)}…`,
  );
  if (peoResult.watch.classifiedAs !== 'RECURRING') {
    logger.warn('demo.peo.unexpectedClassification', { classifiedAs: peoResult.watch.classifiedAs });
  }

  // --- Honest reporting: lineage, certification and confidence as facts ------

  const firstPageId = baseline.pages[0]?.artifactId ?? 'PAGE-0001';
  const lineage = await lineageStatus(store, firstPageId);
  const coverage = coverageSummary(graph, [baseline.projectId]);
  const stats = graph.stats();

  logger.info('demo.result', {
    discoveryArtifacts: baseline.totalArtifacts,
    blueprintId: design.blueprintId,
    manifestId: build.manifestId ?? '',
    lineageLinks: lineage.links,
    completeThrough: lineage.completeThrough,
    lineageGaps: lineage.gaps.map((g) => g.id),
    requirementCoverage: coverage,
    graphStats: stats,
    providerCalls: scripted.calls.length,
    evidenceCount: (await evidence.all()).length,
    storeKind: store.kind,
    councilVerdict: council.verdict,
        certification: {
      certified: certification.certified,
      stamped: certification.stampedArtifactIds.length,
      confidenceAggregate: certification.confidence?.aggregateScore ?? null,
    },
    operations: {
      unitsReleased: opsRun.executed.length,
      deployArtifacts: opsRun.deployIds.length,
      deployedVerified: opsRun.advancedToDeployedVerified.length,
      docHalts: opsRun.docHalts.length,
      evidenceId: opsRun.evidenceId ?? null,
    },
  });

  console.log('');
  console.log(`IDs: ${discovery.artifactIds.length} discovered -> ${design.artifactIds.join(' ')} -> ${build.artifactIds.join(' ')}`);
  console.log(`Lineage of ${firstPageId}: complete through ${lineage.completeThrough}`);
  console.log(`Lineage gaps (beyond implemented levels): ${lineage.gaps.map((g) => g.id).join(', ') || 'none'}`);
  if (certification.certified) {
    console.log(
      `BLUEPRINT CERTIFIED: ${certification.stampedArtifactIds.length} artifact(s) at DoC CERTIFIED; evidence ${certification.evidenceId ?? '?'}`,
    );
  } else {
    console.log(`CERTIFICATION REFUSED: ${certification.reasons.join('; ')}`);
  }
  const unproduced =
    certification.confidence?.dimensions.filter((d) => d.score === null).map((d) => d.id) ?? [];
  console.log(
    `Blueprint confidence: ${certification.confidence?.aggregateScore ?? 'n/a'} ` +
      `(unproduced dimensions excluded: ${unproduced.join(', ') || 'none'})`,
  );
    console.log('Level-3 + Level-4 + Level-5 (Permanent Engineering Organization) + L4 Live Telemetry + Recursion + Safe Change demo finished.');
  return certification.certified
    && opsRun.status === 'passed'
    && contRun.finalVerdict === 'CERTIFIED_COMPLETE'
    && changeResult.status === 'AUTHORIZED_AND_APPLIED'
    && docStateOf(final) === 'CERTIFIED COMPLETE'
    && peoResult.watch.classifiedAs === 'RECURRING'
    ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('demo.failed', error);
    process.exit(1);
  });