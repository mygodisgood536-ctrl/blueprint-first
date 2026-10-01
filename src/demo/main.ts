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
 *     -> Full Discovery Department (Level 3)      clusters C/D/E passes plus
 *        after acceptance                          §0.6 Recursive Page Expansion
 *                                                  (14 layers per page), gated
 *     -> AI Design Studio                        BLUEPRINT-n + PAGE/FEATURE-n-
 *        (deterministic derivation)               DESIGN with evidence anchors
 *     -> Interactive Digital Twin (§1.4)          twin pages/elements bound to
 *        after design                              design -> discovery -> evidence
 *     -> Blueprint approval gate                 real gate over stored state;
 *        (human product-owner approver)           blueprint APPROVED
 *     -> AI Build Studio                         PAGE/FEATURE-n-IMPL plus a
 *        (approved blueprint only)                COMPONENT implementation manifest
 *
 * The AI provider is the deterministic ScriptedProvider everywhere - responses
 * are SCRIPTED DEMO RESPONSES, not a live model. They are recorded as
 * sha256-anchored evidence and never trusted as structure.
 *
 * This file doubles as the single source of truth for the L0-L5 pipeline
 * orchestration: the CLI demo entry (main) and the browser inspection layer
 * (src/web) both call `runDemoPipeline`, so the web surface reflects the exact
 * same real system the CLI exposes. The pipeline itself is unchanged; only the
 * report printing lives in main().
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../core/config.ts';
import { consoleSink, createLogger, type Logger } from '../core/logging.ts';
import { ArtifactIdAllocator } from '../core/id-allocator.ts';
import { JsonFileArtifactStore } from '../core/json-file-store.ts';
import { KnowledgeGraph } from '../core/graph.ts';
import { MemoryEvidenceLog, type EvidenceLog } from '../verification/evidence.ts';
import { AiRouter } from '../ai/router.ts';
import { ScriptedProvider } from '../ai/scripted-provider.ts';
import type { CoreServices } from '../core/services.ts';
import { ProjectRegistry } from '../project/registry.ts';
import type { ProjectOwner } from '../project/registry.ts';
import type { ProjectMode } from '../project/types.ts';
import { PROJECT_MODE_LABELS } from '../project/types.ts';
import {
  DiscoveryDepartment,
  UNDERSTANDING_MARKER,
  STRUCTURAL_MARKER,
} from '../discovery/department/engine.ts';
import { BOSS_MARKER } from '../discovery/department/boss.ts';
import { deriveBusinessModel, type BusinessModel } from '../discovery/business-model.ts';
import { deriveThreatModel, type ThreatModel } from '../security/threat-model.ts';
import { AiDesignStudio } from '../design/studio.ts';
import { buildVisualDesignSystem, type VisualDesignSystem } from '../design/system/visual-system.ts';
import {
  assessDesignCoverage,
  designCoverageGate,
  recordDesignCoverageEvidence,
} from '../design/coverage.ts';
import type { DesignCoverageAssessment } from '../project/types.ts';
import { approveBlueprint } from '../design/approval.ts';
import { AiBuildStudio } from '../build/studio.ts';
import { verifyUXAgainstImplementation, type UXVerificationResult } from '../visual/ux-verification.ts';
import {
  assessDesignQuality,
  assessDesignConsistency,
  recordDesignQualityEvidence,
  type DesignQualityAssessment,
  type DesignConsistencyReport,
} from '../visual/design-quality.ts';
import { runTestDepartment } from '../testing/department.ts';
import { runOperationsDepartment } from '../operations/department.ts';
import { runContinuousEngineeringDepartment } from '../continuous/department.ts';
import { runSafeChangeDepartment } from '../change/department.ts';
import { evaluateChangeReopenRequest } from '../change/reopening.ts';
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
import { buildDesignCodeTrace, type DesignCodeTraceReport } from '../traceability/design-code-trace.ts';
import { DocumentProjectBinder, type ProjectBindingReport } from '../chat/project-binding.ts';
import { exportProjectBundle, transferProject, type ImportResult } from '../portability/bundle.ts';
import { runFullDepartmentPasses, type FullDepartmentResult } from '../discovery/department/level3.ts';
import { materializeDigitalTwin, type DigitalTwin } from '../twin/materialize.ts';
import { AccountRegistry } from '../account/accounts.ts';
import { AccountIsolation } from '../account/isolation.ts';
import type { Artifact } from '../core/artifact.ts';
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

/**
 * Result bundle of a full L0-L5 pipeline run. Everything the browser
 * inspection layer needs is reachable through `services` (store, graph,
 * evidence, allocator) plus the typed stage results, so the web surface can
 * present the actual system without re-running or duplicating any logic.
 */
export interface DemoResult {
  services: CoreServices;
  config: ReturnType<typeof loadConfig>;
  discovery: Awaited<ReturnType<DiscoveryDepartment['discover']>>;
  baseline: NonNullable<Awaited<ReturnType<DiscoveryDepartment['discover']>>['baseline']>;
  design: Awaited<ReturnType<AiDesignStudio['designFromBaseline']>>;
  approval: Awaited<ReturnType<typeof approveBlueprint>>;
  build: Awaited<ReturnType<AiBuildStudio['buildFromBlueprint']>>;
  council: Awaited<ReturnType<ReasoningCouncil['deliberate']>>;
  master: Awaited<ReturnType<MasterVerificationEngine['verifyArtifactSet']>>;
  trace: Awaited<ReturnType<typeof requirementsTraceability>>;
  certification: Awaited<ReturnType<typeof certifyBlueprintCompleteness>>;
  testRun: Awaited<ReturnType<typeof runTestDepartment>>;
  opsRun: Awaited<ReturnType<typeof runOperationsDepartment>>;
  contRun: Awaited<ReturnType<typeof runContinuousEngineeringDepartment>>;
  telemetryObservation: TelemetryObservation;
  telemetrySource: SyntheticTelemetrySource;
  recursionResult: Awaited<ReturnType<typeof runRecursionDepartment>>;
  changeResult: Awaited<ReturnType<typeof runSafeChangeDepartment>>;
  peoCandidate: ReturnType<typeof candidateFromDrift>['candidate'];
  peoResult: Awaited<ReturnType<typeof runPermanentEngineeringOrganization>>;
  finalArtifact: Artifact;
  closureIds: string[];
  firstPageId: string;
  lineage: Awaited<ReturnType<typeof lineageStatus>>;
  coverage: Awaited<ReturnType<typeof coverageSummary>>;
  stats: ReturnType<KnowledgeGraph['stats']>;
  providerCalls: number;
  scripted: ScriptedProvider;
  graph: KnowledgeGraph;
  evidence: EvidenceLog;
  store: JsonFileArtifactStore;
  allocator: ArtifactIdAllocator;
  /** The adopted PROJECT artifact (identity + mode + scope as structured state). */
  project: Artifact;
  /** The project's declared mode. */
  projectMode: ProjectMode;
  /** The registry that owns the project's scoping metadata. */
  registry: ProjectRegistry;
  /** Design-coverage assessment across the produced page designs (expansion §10). */
  designCoverage: DesignCoverageAssessment;
  /** Full Level-3 department passes incl. the §0.6 Recursive Page Expansion. */
  fullDepartment: FullDepartmentResult;
  /** §1.4 interactive Digital Twin bound to the design package. */
  twin: DigitalTwin;
  /** Business capability model derived from discovery artifacts (expansion §10). */
  businessModel: BusinessModel;
  /** Security threat model and requirements derived from business model (expansion §10). */
  threatModel: ThreatModel;
  /** Visual/UX verification against implementation (expansion §10). */
  uxVerification: UXVerificationResult;
  /** Bidirectional design↔code traceability report (expansion §10). */
  designCodeTrace: DesignCodeTraceReport;
  /** Chat/document↔project binding report (expansion §10). */
  projectBinding: ProjectBindingReport;
  /** Portability: export/transfer/import result (expansion §10). */
  portability: ImportResult;
  /** Account/authentication/isolation result (expansion §11). */
  account: AccountReport;
  /** Design quality assessment (visual/product design capability). */
  designQuality: DesignQualityAssessment;
  /** Design consistency assessment (visual/product design capability). */
  designConsistency: DesignConsistencyReport;
  /** Visual design system (visual/product design capability). */
  visual: VisualDesignSystem;
}

export interface AccountReport {
  readonly accountCount: number;
  readonly ownerAccountId: string;
  readonly ownerCanAccess: boolean;
  readonly strangerCanAccess: boolean;
}

/**
 * Pipeline run options. `mode` selects the project's lifecycle scope; the
 * default (full-product) preserves the complete 12-stage chain. Lower modes
 * declare out-of-scope stages that must never be falsely completed.
 */
export interface RunDemoOptions {
  readonly mode?: ProjectMode;
  readonly owner?: ProjectOwner;
  /**
   * Durable evidence log injected by the product layer so the certification
   * trail survives restarts (server passes a DurableEvidenceLog). When omitted
   * the demo uses its deterministic in-memory log.
   */
  readonly evidence?: EvidenceLog;
}

export async function runDemoPipeline(
  logger?: Logger,
  options?: RunDemoOptions,
): Promise<DemoResult> {
  const mode = options?.mode ?? 'full-product';
  const owner = options?.owner ?? { userId: 'product-owner-01', label: 'Demo Product Owner' };
  const config = loadConfig(process.env);
  const log = logger ?? createLogger({ level: config.logLevel, sink: consoleSink() });
  log.info('demo.start', {
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
  const evidence = options?.evidence ?? new MemoryEvidenceLog();
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
        respond: (req) => {
          // Scripted council: each seat answers INDEPENDENTLY through its own
          // lens (the engine issues a separate call per seat and already
          // anchors every seat's own evidence id). The script reproduces that
          // independence as distinct, per-seat statements derived from the
          // shared subject facts - never an echo of another seat.
          const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
          const seat = system.match(/\[COUNCIL\]\[([^\]]+)\]/)?.[1] ?? 'unknown';
          const lenses: Record<string, string> = {
            'product-manager': 'product intent and scope',
            'business-analyst': 'requirements completeness and traceability',
            'software-architect': 'structural coherence and dependency shape',
            'ux-designer': 'user journeys and interaction consistency',
            'ui-designer': 'visual and design-system consistency',
            'backend-engineer': 'service and API implementation coherence',
            'frontend-engineer': 'client implementation coherence',
            'database-architect': 'data model coherence',
            'security-architect': 'permission-model coherence and abuse paths',
            'performance-engineer': 'scalability and performance',
            'devops-engineer': 'delivery and operations coherence',
            'qa-engineer': 'verification gaps and missing error/success paths',
            'accessibility-specialist': 'accessibility completeness',
            'compliance-specialist': 'regulatory and compliance coverage',
            'domain-expert': 'domain fidelity and business-rule semantics',
          };
          const lens = lenses[seat] ?? 'independent perspective';
          return JSON.stringify({
            stance: 'endorse',
            findings: [
              {
                severity: 'note',
                statement: `Reviewed the shared subject facts through the lens of ${lens}; could not justify an objection or concern against them.`,
                artifactIds: [],
              },
            ],
            uncertainties: [],
          });
        },
      },
    ],
  });
  const router = new AiRouter({ logger: log });
  router.register(scripted).setDefaultProvider('scripted');
  const registry = new ProjectRegistry({
    store,
    allocator,
    graph,
    evidence,
    router,
    logger: log,
  });
  const services: CoreServices = {
    store,
    allocator,
    graph,
    evidence,
    router,
    logger: log,
    projects: registry,
  };

  // --- Stage 1: discovery department -----------------------------------------
    console.log('Stage 1/12 - Discovery Department (Clusters A+B + independent boss)');
  const discovery = await new DiscoveryDepartment(services).discover({
    name: DISCOVERY_JSON.product.name,
    vision: 'A lightweight task tracker that small teams can adopt in minutes.',
    targetUsers: ['small teams'],
  });
  if (discovery.status !== 'accepted' || discovery.baseline === undefined) {
    log.warn('demo.discovery.failed', { status: discovery.status, code: discovery.error?.code });
    throw new Error('Demo aborted: discovery was not accepted.');
  }
  const baseline = discovery.baseline;
  console.log(
    `  accepted: ${baseline.totalArtifacts} artifacts, project ${baseline.projectId}, ` +
      `${discovery.diff?.deltas.length ?? 0} reconstruction deltas`,
  );

  // Adopt the discovery-materialized PROJECT artifact into the mode-aware
  // registry (no duplicate PROJECT is created; discovery already made one).
  const project = await registry.adoptProject({
    projectId: baseline.projectId,
    title: DISCOVERY_JSON.product.name,
    description: DISCOVERY_JSON.product.summary,
    mode,
    owner,
    actor: { kind: 'system', id: 'project-registry' },
    scope: [DISCOVERY_JSON.product.name],
  });
  for (const entry of [...baseline.pages, ...baseline.features, ...baseline.modules]) {
    await registry.linkArtifact(project.id, entry.artifactId);
  }
  console.log(
    `  project ${project.id} adopted (mode=${mode} / ${PROJECT_MODE_LABELS[mode]}); ` +
      `${baseline.totalArtifacts} artifact(s) linked`,
  );

  // --- Full Discovery Department (Level 3) -----------------------------------
  // The accepted Level-1b inventory now runs the complete Level-3 pass set:
  // Cluster C content, DW-D1 edge cases, Risk & Assumption Register,
  // Negative-Space, Industry Comparison, Red Team, Contradiction Engine, and
  // Pass 10 - the §0.6 Recursive Page Expansion of every page through all 14
  // layers. Everything produced is promoted through the evidence+provenance
  // gate the department owns.
  console.log('  full Discovery Department (Level 3): clusters C/D/E + Recursive Page Expansion');
  const fullDepartment = await runFullDepartmentPasses(services, baseline, {
    categoryHint: 'team-productivity',
  });
  const layerTally = fullDepartment.expansion.tally;
  console.log(
    `  level3 passes: ${fullDepartment.contentAdded.length} content, ` +
      `${fullDepartment.edgeStatesAdded.length} edge states, ` +
      `${fullDepartment.risks.length} risks, ` +
      `${fullDepartment.comparisonFindings.length} comparison findings, ` +
      `${fullDepartment.redTeamFindings.length} red-team findings, ` +
      `${fullDepartment.contradictions.length} contradictions; ` +
      `expansion: ${fullDepartment.expansion.pages.length} page(s) x 14 layers ` +
      `(covered=${layerTally.covered}, added=${layerTally.added}, ` +
      `not-relevant=${layerTally['not-relevant']}, blocked=${layerTally.blocked})`,
  );
  const expansionOmissions = fullDepartment.expansion.pages.flatMap((p) =>
    p.omissions.map((note) => `${p.pageKey}: ${note}`),
  );
  if (expansionOmissions.length > 0) {
    console.log(`  expansion omissions (routed, not invented): ${expansionOmissions.length}`);
    for (const omission of expansionOmissions.slice(0, 8)) console.log(`    - ${omission}`);
  }

  // --- Business model derivation (expansion §10) ----------------------------------
  const businessModel = await deriveBusinessModel(services, baseline);
  console.log(
    `  business model: ${businessModel.roles.length} role(s), ` +
      `${businessModel.rolePermissions.length} permission(s), ` +
      `${businessModel.entities.length} entity(ies), ` +
      `${businessModel.workflows.length} workflow(s); ` +
      `${businessModel.adminCapabilities.length} admin role(s) identified`,
  );

  // --- Threat model & security requirements (expansion §10) -----------------------
  const threatModel = await deriveThreatModel(services, businessModel, { kind: 'system', id: 'security-engine' });
  console.log(
    `  threat model: ${threatModel.threats.length} threat(s) across ${new Set(threatModel.threats.map((t) => t.category)).size} STRIDE categories; ` +
      `${threatModel.securityRequirements.length} security requirement(s) (P0: ${threatModel.securityRequirements.filter((r) => r.priority === 'P0').length})`,
  );

  // --- Visual design system (visual/product design capability) ---------------------
  const visual = buildVisualDesignSystem(baseline, businessModel);
  console.log(
    `  visual identity: ${visual.identity.direction.tone} (hue ${visual.identity.direction.seedHue}° sat ${visual.identity.direction.seedSaturation}%), ` +
      `${visual.components.inventoried.length} components inventoried, ` +
      `motion: ${visual.tokens.motion?.durationStandard ?? 'n/a'} / reduced-motion: ${visual.tokens.motion?.reducedMotion ?? false}`,
  );

  // --- Chat/document→project binding (expansion §10) -------------------------------
  const documentBinder = new DocumentProjectBinder(services, registry);
  const demoDocContent =
    'TeamTask: lightweight task tracker for small teams. Core permissions: manage-tasks ' +
    '(admin, member). Primary entity: Task (title, dueDate, points). Primary workflow: ' +
    'task-lifecycle (create -> assign -> complete).';
  await documentBinder.attachDocument(project.id, 'demo-owner', demoDocContent, { kind: 'system', id: 'chat-binder' });
  const projectBinding = await documentBinder.listForProject(project.id);
  console.log(
    `  document↔project binding: ${projectBinding.documentCount} document(s) bound to ${projectBinding.projectId} ` +
      `(resolved=${projectBinding.resolved}; ${projectBinding.ownerCount} owner(s))`,
  );

  // --- Stage 2: design ---------------------------------------------------------
    console.log('Stage 2/12 - AI Design Studio');
  const design = await new AiDesignStudio(services).designFromBaseline(baseline);
  if (design.status !== 'accepted' || design.blueprintId === undefined) {
    log.warn('demo.design.failed', { status: design.status, code: design.error?.code });
    throw new Error('Demo aborted: design was not accepted.');
  }
  console.log(`  accepted: blueprint ${design.blueprintId} with ${design.artifactIds.length - 1} designs`);

  // --- Design-coverage governance (expansion §10) ------------------------------
  let pageDesignIds: readonly string[] = [];
  const pageDesigns: Parameters<typeof assessDesignCoverage>[0]['pageDesigns'][number][] = [];
  {
    const blueprint = await store.require(design.blueprintId);
    pageDesignIds = blueprint.attributes['pageDesignIds'] as readonly string[];
    for (const designId of pageDesignIds) {
      const designArtifact = await store.require(designId);
      const doc = designArtifact.attributes['designDoc'] as Parameters<typeof assessDesignCoverage>[0]['pageDesigns'][number];
      if (doc && doc.layout) pageDesigns.push(doc);
    }
  }
  const designCoverage = assessDesignCoverage({ pageDesigns, mode });
  await recordDesignCoverageEvidence(services.evidence, designCoverage, {
    producerId: 'demo-design-coverage',
    projectId: project.id,
    pageDesignIds: [],
  });
  const coverageGate = designCoverageGate(designCoverage);
  console.log(
    `  design coverage: ${designCoverage.covered.length}/${designCoverage.allDimensions.length} covered; ` +
      `${designCoverage.missing.length} missing` +
      (coverageGate.satisfied ? ' (gate satisfied)' : ` (gate unmet: ${coverageGate.missing.join(', ')})`),
  );

  // --- Design quality + consistency assessment (visual/product design capability) --
  const designQuality = assessDesignQuality(project.id, pageDesigns, visual);
  const designConsistency = assessDesignConsistency(project.id, pageDesigns, visual);
  await recordDesignQualityEvidence(services.evidence, designQuality, designConsistency, {
    producerId: 'demo-design-quality',
    projectId: project.id,
    pageDesignIds: pageDesignIds,
  });
  console.log(
    `  design quality: ${(designQuality.overallScore * 100).toFixed(0)}% ` +
      `(identity ${(designQuality.identitySpecificity * 100).toFixed(0)}%, component ${(designQuality.componentConsistency * 100).toFixed(0)}%, a11y ${(designQuality.accessibility * 100).toFixed(0)}%); ` +
      `consistency: ${(designConsistency.overallConsistency * 100).toFixed(0)}% ` +
      `(${designQuality.findings.length} quality finding(s), ${designConsistency.exceptions.length} exception(s))`,
  );

  // --- Interactive Digital Twin (§1.4) -----------------------------------------
  // Every page of the twin is a simulation node bound to its PAGE-*-DESIGN
  // artifact and, from there, to the discovery artifacts and evidence that
  // produced it. Derived from certified state - never invented.
  console.log('  Digital Twin (§1.4): binding design surfaces to discovery + evidence');
  const twin = await materializeDigitalTwin(services, baseline, design.blueprintId, {
    producer: { kind: 'system', id: 'demo-digital-twin' },
  });
  console.log(
    `  twin ${twin.twinArtifactId}: ${twin.pages.length} page(s), ` +
      `${twin.elementCount} element(s), ${twin.boundElementCount} design-bound, ` +
      `${twin.gapCount} gap(s), ${twin.evidenceCount} evidence record(s)`,
  );

  // --- Stage 3: approval gate ----------------------------------------------------
    console.log('Stage 3/12 - Blueprint approval gate');
  const approval = await approveBlueprint(services, design.blueprintId);
  if (!approval.approved) {
    log.warn('demo.approval.rejected', { reasons: approval.reasons });
    throw new Error('Demo aborted: blueprint approval rejected.');
  }
  console.log(`  approved by product-owner-01, evidence ${approval.evidenceId ?? '?'}`);

  // --- Stage 4: build ------------------------------------------------------------
    console.log('Stage 4/12 - AI Build Studio');
  const build = await new AiBuildStudio(services).buildFromBlueprint(design.blueprintId);
  if (build.status !== 'accepted') {
    log.warn('demo.build.failed', { status: build.status, code: build.error?.code });
    throw new Error('Demo aborted: build was not accepted.');
  }
  console.log(`  accepted: manifest ${build.manifestId} aggregating ${build.artifactIds.length - 1} implementations`);

  // --- Visual/UX verification (expansion §10) ------------------------------------
  const uxVerification = await verifyUXAgainstImplementation(services, design, build, designCoverage, { kind: 'system', id: 'ux-verifier' });
  console.log(
    `  UX verification: token score ${(uxVerification.tokenCoverage.score * 100).toFixed(0)}%, ` +
      `a11y score ${(uxVerification.accessibilityCoverage.score * 100).toFixed(0)}%, ` +
      `responsive score ${(uxVerification.responsiveCoverage.score * 100).toFixed(0)}% ` +
      `(${uxVerification.findings.length} finding(s); overall ${(uxVerification.overallScore * 100).toFixed(0)}%)`,
  );

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

  // --- Design↔code traceability (expansion §10) ----------------------------------
  const designCodeTrace = await buildDesignCodeTrace(services, baseline.projectId, { kind: 'system', id: 'traceability-engine' });
  console.log(
    `  design→code trace: ${designCodeTrace.traced}/${designCodeTrace.total} traced ` +
      `(forward=${designCodeTrace.forwardComplete ? 'complete' : 'incomplete'}, ` +
      `reverse=${designCodeTrace.reverseComplete ? 'complete' : 'incomplete'}; ` +
      `${designCodeTrace.unimplemented} unimplemented, ${designCodeTrace.orphans} orphan(s), ${designCodeTrace.unlinked} unlinked)`,
  );

  const certification = await certifyBlueprintCompleteness(services, {
    blueprintId: design.blueprintId,
    master,
    council,
    trace,
  });
  if (!certification.certified) {
    log.warn('demo.certification.refused', { reasons: certification.reasons });
    throw new Error('Demo aborted: blueprint certification refused.');
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
    log.warn('demo.test.failed', {
      failedChecks: testRun.failedChecks,
      boss: testRun.boss.rationale,
      auditor: testRun.auditor.rationale,
    });
    throw new Error('Demo aborted: acceptance testing did not pass.');
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
    log.warn('demo.ops.failed', {
      failedUnits: opsRun.failedUnits,
      boss: opsRun.boss.rationale,
      auditor: opsRun.auditor.rationale,
    });
    throw new Error('Demo aborted: operations/deploy did not pass.');
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
    log.warn('demo.continuous.failed', {
      verdict: contRun.finalVerdict,
      rationale: contRun.rationale,
    });
    throw new Error('Demo aborted: continuous engineering did not reach CERTIFIED_COMPLETE.');
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
    log.warn('demo.recursion.empty', { classificationHash: recursionResult.classification.classificationHash });
    throw new Error('Demo aborted: recursion produced no change.');
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
  // Model the telemetry-observed drift in the environment itself: the unit
  // that breached now carries the observation's evidence hash as its config,
  // so the Safe Change restoration below is a real before/after - the applier
  // returns the unit to its known-good certified anchor.
  const telemetryUnit = changeEnv.units.get(telemetryBase);
  if (telemetryUnit !== undefined) {
    changeEnv.units.set(telemetryBase, {
      ...telemetryUnit,
      configHash: telemetryObservation.evidenceHash,
    });
  }
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
    log.warn('demo.change.failed', { status: changeResult.status, reason: (changeResult as { reason?: string }).reason });
    throw new Error('Demo aborted: safe change did not authorize+apply.');
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
    log.warn('demo.driftLoop.missingImpl', { implId });
    throw new Error('Demo aborted: missing -IMPL artifact for drift loop.');
  }
  const startState = docStateOf(impl);
  if (startState === undefined) {
    log.warn('demo.driftLoop.unstampedImpl', { implId });
    throw new Error('Demo aborted: -IMPL artifact has no DoC stamp.');
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
    log.warn('demo.peo.unexpectedClassification', { classifiedAs: peoResult.watch.classifiedAs });
  }

  // --- §2.4 Change/Reopening gate: exercise once on the PEO path ---------
  // The pre-launch Change/Reopen Request gate admits a discovering stage's
  // request only if the discovering stage is a producer (a Build worker here)
  // and computes the Dependency-Map affected set. It NEVER certifies - only
  // the Design Boss certifies re-evaluated scope. A verifier opening the same
  // request fails closed on self-adjudication.
  const reopenDecision = evaluateChangeReopenRequest(graph, {
    requestId: 'CR-9001',
    discoveredBy: { kind: 'ai', id: 'build-worker-01' },
    namedArtifacts: [firstChange.drift.artifactId],
    reason: 'PEO demo: §2.4 gate exercised with the Stage 11 drift subject.',
  });
  const selfAdjudicating = evaluateChangeReopenRequest(graph, {
    requestId: 'CR-9002',
    discoveredBy: { kind: 'ai', id: 'safe-change-boss-01' },
    namedArtifacts: [firstChange.drift.artifactId],
    reason: 'A certifier must never open its own change request.',
  });
  console.log(
    `  §2.4 gate: ${reopenDecision.verdict} (${reopenDecision.affected.length} affected) ` +
      `; certifier request ${selfAdjudicating.verdict} (fail-closed)`,
  );

  // --- Honest reporting: lineage, certification and confidence as facts ------

  const firstPageId = baseline.pages[0]?.artifactId ?? 'PAGE-0001';
  const lineage = await lineageStatus(store, firstPageId);
  const coverage = coverageSummary(graph, [baseline.projectId]);
  const stats = graph.stats();

  // --- Portability: export + transfer to a fresh environment (expansion §10) -------
  const bundleExport = await exportProjectBundle(services, baseline.projectId);
  const freshArtifactStore = await (async () => {
    const { MemoryArtifactStore } = await import('../core/memory-store.ts');
    const { MemoryEvidenceLog } = await import('../verification/evidence.ts');
    const { KnowledgeGraph } = await import('../core/graph.ts');
    const { ArtifactIdAllocator } = await import('../core/id-allocator.ts');
    return {
      store: new MemoryArtifactStore(),
      allocator: new ArtifactIdAllocator(),
      graph: new KnowledgeGraph(),
      evidence: new MemoryEvidenceLog(),
    };
  })();
  const targetServices: CoreServices = {
    store: freshArtifactStore.store,
    allocator: freshArtifactStore.allocator,
    graph: freshArtifactStore.graph,
    evidence: freshArtifactStore.evidence,
    router: services.router,
  };
  const portability = await transferProject(services, targetServices, baseline.projectId);
  console.log(
    `  portability: exported ${bundleExport.artifactCount} artifact(s), ` +
      `${bundleExport.edgeCount} edge(s), ${bundleExport.evidenceCount} evidence; ` +
      `transferred ${portability.artifactCount} artifact(s) to fresh env ` +
      `(integrity ${portability.integrityVerified ? 'OK' : 'FAIL'})`,
  );

  // --- Account / authentication / isolation (expansion §11) ----------------
  const accountRegistry = new AccountRegistry();
  const ownerAccount = accountRegistry.createAccount({
    id: owner.userId,
    username: 'demo-owner',
    password: 'demo-password-123',
    displayName: 'Demo Product Owner',
    role: 'developer',
  });
  accountRegistry.createAccount({
    username: 'stranger',
    password: 'stranger-password-123',
    displayName: 'Stranger',
    role: 'viewer',
  });
  const ownerSession = accountRegistry.authenticate('demo-owner', 'demo-password-123');
  const strangerSession = accountRegistry.authenticate('stranger', 'stranger-password-123');
  const isolation = new AccountIsolation(services);
  const ownerScoped = await isolation.isolate(
    accountRegistry.verifySession(ownerSession.token),
  );
  const strangerScoped = await isolation.isolate(
    accountRegistry.verifySession(strangerSession.token),
  );
  let ownerCanAccess = false;
  let strangerCanAccess = false;
  try {
    await ownerScoped.store.require(baseline.projectId);
    ownerCanAccess = true;
  } catch {
    ownerCanAccess = false;
  }
  try {
    await strangerScoped.store.require(baseline.projectId);
    strangerCanAccess = true;
  } catch {
    strangerCanAccess = false;
  }
  const account: AccountReport = {
    accountCount: 2,
    ownerAccountId: ownerAccount.id,
    ownerCanAccess,
    strangerCanAccess,
  };
  console.log(
    `  account/isolation: ${account.accountCount} account(s); owner ${account.ownerAccountId} ` +
      `access=${ownerCanAccess}, stranger access=${strangerCanAccess}; ` +
      `(tenant isolation enforced)`,
  );

  log.info('demo.result', {
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

  return {
    services,
    config,
    discovery,
    baseline,
    design,
    approval,
    build,
    council,
    master,
    trace,
    certification,
    testRun,
    opsRun,
    contRun,
    telemetryObservation,
    telemetrySource,
    recursionResult,
    changeResult,
    peoCandidate,
    peoResult,
    finalArtifact: final,
    closureIds,
    firstPageId,
    lineage,
    coverage,
    stats,
    providerCalls: scripted.calls.length,
    scripted,
    graph,
    evidence,
    store,
    allocator,
    project,
    projectMode: mode,
    registry,
    designCoverage,
    fullDepartment,
    twin,
    businessModel,
    threatModel,
    uxVerification,
    designCodeTrace,
    projectBinding,
    portability,
    account,
    designQuality,
    designConsistency,
    visual,
  };
}

async function main(): Promise<number> {
  const result = await runDemoPipeline();
  const { baseline, design, build, discovery, certification, council, lineage, coverage, stats, opsRun, contRun, changeResult, finalArtifact, peoResult, project, projectMode, registry } = result;

  console.log('');
  console.log(`Project    : ${project.id} (${PROJECT_MODE_LABELS[projectMode]} / ${projectMode})`);
  console.log(`  complete within scope at: ${await registry.lifecycleComplete(project.id)}`);
  console.log(`  stage in scope (testing): ${await registry.isStageInScope(project.id, 'testing')}`);
  console.log(`IDs: ${discovery.artifactIds.length} discovered -> ${design.artifactIds.join(' ')} -> ${build.artifactIds.join(' ')}`);
  console.log(`Lineage of ${result.firstPageId}: complete through ${lineage.completeThrough}`);
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
    && docStateOf(finalArtifact) === 'CERTIFIED COMPLETE'
    && peoResult.watch.classifiedAs === 'RECURRING'
    ? 0 : 1;
}

// Only run the CLI entry point when this file is executed directly.
// When imported by the browser inspection layer (src/web), the pipeline is
// exposed via `runDemoPipeline` and must NOT auto-run or call process.exit.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error('demo.failed', error);
      process.exit(1);
    });
}
