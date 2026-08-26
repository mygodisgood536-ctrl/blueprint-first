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
import { ReasoningCouncil } from '../council/council.ts';
import { MasterVerificationEngine } from '../verification/master-engine.ts';
import { createClosureVerifier } from '../verification/closure-verifier.ts';
import { certifyBlueprintCompleteness } from '../design/certification.ts';
import { lineageStatus, coverageSummary, requirementsTraceability } from '../traceability/trace.ts';

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
    console.log('Stage 1/7 - Discovery Department (Clusters A+B + independent boss)');
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
    console.log('Stage 2/7 - AI Design Studio');
  const design = await new AiDesignStudio(services).designFromBaseline(baseline);
  if (design.status !== 'accepted' || design.blueprintId === undefined) {
    logger.warn('demo.design.failed', { status: design.status, code: design.error?.code });
    return 1;
  }
  console.log(`  accepted: blueprint ${design.blueprintId} with ${design.artifactIds.length - 1} designs`);

  // --- Stage 3: approval gate ----------------------------------------------------
    console.log('Stage 3/7 - Blueprint approval gate');
  const approval = await approveBlueprint(services, design.blueprintId);
  if (!approval.approved) {
    logger.warn('demo.approval.rejected', { reasons: approval.reasons });
    return 1;
  }
  console.log(`  approved by product-owner-01, evidence ${approval.evidenceId ?? '?'}`);

  // --- Stage 4: build ------------------------------------------------------------
    console.log('Stage 4/7 - AI Build Studio');
  const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
  if (build.status !== 'accepted') {
    logger.warn('demo.build.failed', { status: build.status, code: build.error?.code });
    return 1;
  }
  console.log(`  accepted: manifest ${build.manifestId} aggregating ${build.artifactIds.length - 1} implementations`);

  // --- Stage 5: verified engineering organization ------------------------------
    console.log('Stage 5/7 - Verified Engineering Organization');
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
    console.log('Stage 6/7 - AI Acceptance Testing Department');
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
  console.log('Stage 7/7 - AI Operations & Observability Layer (Deployment)');
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
    console.log('Level-3 demo finished.');
  return certification.certified && opsRun.status === 'passed' ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('demo.failed', error);
    process.exit(1);
  });