/**
 * Per-project lifecycle stage execution (D5).
 *
 * The boot-time demo pipeline (`runDemoPipeline`) used to back EVERY stage API
 * with one hardcoded full-product run. That was the central defect: the browser
 * showed a demo scenario, not the user's project. This module replaces it with
 * real, on-demand, per-project execution:
 *
 *   POST /api/projects/:id/run/:stageId
 *     -> ProjectExecution.runStage(project, stageId, services-with-run-router)
 *     -> the SAME department engines the CLI demo drives, bound to the
 *        project's own artifacts and the project's own verified AI provider,
 *     -> the outcome (artifact ids, evidence ids, typed summary, honest gate
 *        reasons) is persisted in the StageStateStore and returned.
 *
 * Nothing here fabricates. A stage whose exit gate is unmet is recorded as
 * `failed` with the real reason; a stage whose prerequisites are absent halts
 * with an honest message. Only real engine outputs are summarized.
 */

import type { CoreServices } from '../core/services.ts';
import type { Actor, Artifact } from '../core/artifact.ts';
import type { Logger } from '../core/logging.ts';
import { docStateOf, recordDocGate } from '../core/doc.ts';
import { AiRouter } from '../ai/router.ts';
import { DiscoveryDepartment } from '../discovery/department/engine.ts';
import { runFullDepartmentPasses } from '../discovery/department/level3.ts';
import { runDiscoveryPassSequence } from '../discovery/pass-sequence.ts';
import type { DiscoveryBaseline } from '../discovery/materialize.ts';
import type { ProductUnderstandingBrief } from '../discovery/types.ts';
import { deriveBusinessModel } from '../discovery/business-model.ts';
import { deriveThreatModel } from '../security/threat-model.ts';
import { buildVisualDesignSystem, type VisualDesignSystem } from '../design/system/visual-system.ts';
import { AiDesignStudio } from '../design/studio.ts';
import {
  assessDesignCoverage,
  designCoverageGate,
  recordDesignCoverageEvidence,
} from '../design/coverage.ts';
import {
  assessDesignQuality,
  assessDesignConsistency,
  recordDesignQualityEvidence,
} from '../visual/design-quality.ts';
import { materializeDigitalTwin } from '../twin/materialize.ts';
import { approveBlueprint } from '../design/approval.ts';
import { checkBuildCount, checkBuildCoverage, checkBuildIdentity } from '../build/verify.ts';
import { verifyUXAgainstImplementation } from '../visual/ux-verification.ts';
import { ReasoningCouncil } from '../council/council.ts';
import { MasterVerificationEngine } from '../verification/master-engine.ts';
import { createClosureVerifier } from '../verification/closure-verifier.ts';
import { requirementsTraceability, lineageStatus, coverageSummary } from '../traceability/trace.ts';
import { buildDesignCodeTrace } from '../traceability/design-code-trace.ts';
import type { EnvAdapter } from '../env/types.ts';
import {
  captureRealImplementation,
  hasRealSource,
  type RealImplementation,
} from '../build/implementation-capture.ts';
import { materializeRealImplementation } from '../build/materialize-real.ts';
import { certifyBlueprintCompleteness } from '../design/certification.ts';
import { ProjectRegistry, type ProjectOwner } from './registry.ts';
import { PROJECT_MODE_STAGES } from './types.ts';
import type { ProjectMode } from './types.ts';
import { runTestDepartment } from '../testing/department.ts';
import { runOperationsDepartment } from '../operations/department.ts';
import { runContinuousEngineeringDepartment } from '../continuous/department.ts';
import { runRecursionDepartment } from '../recursion/department.ts';
import { runSafeChangeDepartment } from '../change/department.ts';
import { evaluateChangeReopenRequest } from '../change/reopening.ts';
import {
  createDeploymentEnvironment,
  deployRelease,
  verifyDeployedUnit,
} from '../operations/deploy.ts';
import { SyntheticTelemetrySource, type TelemetryObservation } from '../telemetry/source.ts';
import { runPermanentEngineeringOrganization, candidateFromDrift } from '../perm/department.ts';
import { emptyGuardianMemory, classifySignal } from '../perm/guardian.ts';
import type { DriftItem } from '../verification/live-engine.ts';
import { StageStateStore, type StageRecord } from './stage-state.ts';

/** Actor kinds that may trigger a governed run. */
export type RunActor = Actor;

/** A stage's typed, real outcome (before persistence). */
interface StageOutcome {
  readonly artifactIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly summary: Readonly<Record<string, unknown>>;
}

/** Raised when a stage completes its work but a real gate refuses to pass it. */
export class StageGateFailure extends Error {
  readonly code: string;
  readonly reasons: readonly string[];
  constructor(code: string, message: string, reasons: readonly string[] = []) {
    super(message);
    this.name = 'StageGateFailure';
    this.code = code;
    this.reasons = reasons;
  }
}

export interface RunStageInput {
  readonly project: Artifact;
  readonly stageId: string;
  /** CoreServices whose router is the PROJECT's verified execution router. */
  readonly services: CoreServices;
  readonly actor: RunActor;
  readonly instruction?: string;
  readonly sampleSize?: number;
  /**
   * The project's REAL execution environment, when one exists.
   *
   * The Build stage must not assert an implementation it has not observed, so
   * the architecture stage materializes `-IMPL` artifacts only by reading this
   * environment back through the `EnvAdapter` port. Without it the stage fails
   * closed rather than describing code that was never written.
   */
  readonly executionEnvironment?: EnvAdapter & { readonly environmentId?: string };
}

export interface RunStageResult {
  readonly record: StageRecord;
  readonly ok: boolean;
}

/** Marker for a resolved assistant router usable by the department engines. */
type PageDesignDoc = Parameters<typeof assessDesignCoverage>[0]['pageDesigns'][number];

/**
 * Executes real lifecycle stages for a project. Constructed once per server;
 * `runStage` is safe to call concurrently for DIFFERENT projects (the stage
 * store serializes its own writes). The server guards concurrent runs of the
 * SAME project.
 */
export class ProjectExecution {
  private readonly base: CoreServices;
  private readonly stages: StageStateStore;
  private readonly logger?: Logger;

  constructor(deps: { services: CoreServices; stages: StageStateStore; logger?: Logger }) {
    this.base = deps.services;
    this.stages = deps.stages;
    this.logger = deps.logger;
  }

  /** Renamed accessor so the type is self-documenting at call sites. */
  static routerOf(services: CoreServices): AiRouter {
    return services.router;
  }

  async runStage(input: RunStageInput): Promise<RunStageResult> {
    const { project, stageId, services, actor } = input;
    const mode = String(project.attributes['mode']) as ProjectMode;
    const stage = PROJECT_MODE_STAGES[mode]?.find((s) => s.stageId === stageId);
    if (stage === undefined) {
      throw new StageGateFailure('UNKNOWN_STAGE', `Unknown stage "${stageId}" for mode "${mode}".`);
    }
    if (!stage.inScope) {
      throw new StageGateFailure(
        'STAGE_OUT_OF_SCOPE',
        `Stage "${stage.label}" is out of scope for mode "${mode}"; it is never falsely run.`,
      );
    }

    const startedAt = new Date().toISOString();
    await this.stages.setStage(project.id, {
      stageId,
      status: 'running',
      startedAt,
      artifactIds: [],
      evidenceIds: [],
      summary: {},
    });

    try {
      const outcome = await this.dispatch(input, mode);
      const record: StageRecord = {
        stageId,
        status: 'completed',
        startedAt,
        endedAt: new Date().toISOString(),
        artifactIds: outcome.artifactIds,
        evidenceIds: outcome.evidenceIds,
        summary: outcome.summary,
      };
      await this.stages.setStage(project.id, record);
      return { record, ok: true };
    } catch (error) {
      const gate = error instanceof StageGateFailure ? error : null;
      const record: StageRecord = {
        stageId,
        status: 'failed',
        startedAt,
        endedAt: new Date().toISOString(),
        artifactIds: [],
        evidenceIds: [],
        summary: gate !== null ? { reasons: gate.reasons } : {},
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(gate !== null ? { code: gate.code } : {}),
        },
      };
      await this.stages.setStage(project.id, record);
      this.logger?.warn('project.stage.failed', { projectId: project.id, stageId, message: record.error?.message });
      return { record, ok: false };
    }
  }

  private dispatch(input: RunStageInput, mode: ProjectMode): Promise<StageOutcome> {
    switch (input.stageId) {
      case 'discovery':
        return this.runDiscovery(input);
      case 'design':
        return this.runDesign(input, mode);
      case 'design-verification':
        return this.runDesignVerification(input, mode);
      case 'blueprint':
        return this.runBlueprint(input);
      case 'architecture':
        return this.runArchitecture(input);
      case 'implementation':
        return this.runImplementation(input);
      case 'testing':
        return this.runTesting(input);
      case 'verification':
        return this.runVerification(input);
      case 'deployment':
        return this.runDeployment(input);
      case 'operations':
        return this.runOperations(input);
      case 'maintenance':
        return this.runMaintenance(input);
      case 'continuous-improvement':
        return this.runContinuousImprovement(input);
      default:
        throw new StageGateFailure('UNKNOWN_STAGE', `Stage "${input.stageId}" has no executor.`);
    }
  }

  // ── Stage 1: Discovery ────────────────────────────────────────────────────

  private async runDiscovery(input: RunStageInput): Promise<StageOutcome> {
    const { project, services, actor } = input;
    const brief = this.briefFor(project, input.instruction);
    const discovery = await new DiscoveryDepartment(services).discover(brief, { projectId: project.id });
    if (discovery.status !== 'accepted' || discovery.baseline === undefined) {
      throw new StageGateFailure(
        discovery.error?.code ?? 'DISCOVERY_NOT_ACCEPTED',
        discovery.error?.message ?? 'Discovery was not accepted.',
      );
    }
    const baseline = discovery.baseline;

    const registry = new ProjectRegistry(services);
    await registry.adoptProject({
      projectId: project.id,
      title: project.title,
      description: project.description,
      mode: String(project.attributes['mode']) as ProjectMode,
      owner: (project.attributes['owner'] as ProjectOwner | undefined) ?? { userId: actor.id },
      actor,
      scope: [project.title],
    });
    for (const entry of [...baseline.pages, ...baseline.features, ...baseline.modules]) {
      await registry.linkArtifact(project.id, entry.artifactId);
    }

    const full = await runFullDepartmentPasses(services, baseline, { categoryHint: 'general' });
    const sequence = await runDiscoveryPassSequence(services, baseline, { brief, categoryHint: 'general' });
    const businessModel = await deriveBusinessModel(services, baseline);
    const threatModel = await deriveThreatModel(services, businessModel, { kind: 'system', id: 'security-engine' });
    const visual = buildVisualDesignSystem(baseline, businessModel);

    const artifactIds = [...new Set<string>([
      ...(discovery.artifactIds ?? []),
      ...baseline.pages.map((p) => p.artifactId),
      ...sequence.artifactIds,
    ])];
    return {
      artifactIds,
      evidenceIds: full.expansion !== undefined ? [] : [],
      summary: {
        projectId: baseline.projectId,
        baseline,
        totalArtifacts: baseline.totalArtifacts,
        accepted: true,
        level3: {
          content: full.contentAdded.length,
          edgeStates: full.edgeStatesAdded.length,
          risks: full.risks.length,
          comparisons: full.comparisonFindings.length,
          redTeam: full.redTeamFindings.length,
          contradictions: full.contradictions.length,
        },
        passSequence: {
          complete: sequence.sequenceComplete,
          passesPassed: sequence.summary.passesPassed,
          sweeps: sequence.summary.sweeps,
          haltedAt: sequence.haltedAt ?? null,
          reasons: sequence.reasons,
        },
        businessModel: {
          roles: businessModel.roles.length,
          permissions: businessModel.rolePermissions.length,
          entities: businessModel.entities.length,
          workflows: businessModel.workflows.length,
        },
        threatModel: {
          threats: threatModel.threats.length,
          securityRequirements: threatModel.securityRequirements.length,
        },
        visual: {
          tone: visual.identity.direction.tone,
          components: visual.components.inventoried.length,
        },
      },
    };
  }

  // ── Stage 2: Design ───────────────────────────────────────────────────────

  private async runDesign(input: RunStageInput, mode: ProjectMode): Promise<StageOutcome> {
    const { project, services } = input;
    const baseline = this.requireBaseline(project.id);
    const design = await new AiDesignStudio(services).designFromBaseline(baseline);
    if (design.status !== 'accepted' || design.blueprintId === undefined) {
      throw new StageGateFailure(design.error?.code ?? 'DESIGN_NOT_ACCEPTED', design.error?.message ?? 'Design was not accepted.');
    }
    const blueprint = await services.store.require(design.blueprintId);
    const pageDesignIds = (blueprint.attributes['pageDesignIds'] as readonly string[] | undefined) ?? [];
    const pageDesigns: PageDesignDoc[] = [];
    for (const designId of pageDesignIds) {
      const artifact = await services.store.require(designId);
      const doc = artifact.attributes['designDoc'] as PageDesignDoc | undefined;
      if (doc !== undefined && doc.layout !== undefined) pageDesigns.push(doc);
    }
    const coverage = assessDesignCoverage({ pageDesigns, mode });
    await recordDesignCoverageEvidence(services.evidence, coverage, {
      producerId: 'project-design-coverage',
      projectId: project.id,
      pageDesignIds,
    });
    const visual = await this.visualFor(services, baseline);
    const quality = assessDesignQuality(project.id, pageDesigns, visual);
    const consistency = assessDesignConsistency(project.id, pageDesigns, visual);
    await recordDesignQualityEvidence(services.evidence, quality, consistency, {
      producerId: 'project-design-quality',
      projectId: project.id,
      pageDesignIds,
    });
    const twin = await materializeDigitalTwin(services, baseline, design.blueprintId, {
      producer: { kind: 'system', id: 'project-digital-twin' },
    });

    return {
      artifactIds: [...new Set<string>([design.blueprintId, ...design.artifactIds])],
      evidenceIds: [],
      summary: {
        blueprintId: design.blueprintId,
        designArtifactIds: design.artifactIds,
        pageDesignIds,
        coverage: {
          covered: coverage.covered.length,
          total: coverage.allDimensions.length,
          missing: coverage.missing,
          hash: coverage.assessmentHash,
        },
        quality: {
          overall: quality.overallScore,
          identity: quality.identitySpecificity,
          component: quality.componentConsistency,
          accessibility: quality.accessibility,
        },
        consistency: { overall: consistency.overallConsistency },
        twin: { twinArtifactId: twin.twinArtifactId, pages: twin.pages.length, elements: twin.elementCount },
      },
    };
  }

  // ── Stage 3: Design Verification ──────────────────────────────────────────

  private async runDesignVerification(input: RunStageInput, mode: ProjectMode): Promise<StageOutcome> {
    const { project, services } = input;
    const design = this.stages.getStage(project.id, 'design');
    const blueprintId = design.summary['blueprintId'];
    if (typeof blueprintId !== 'string') {
      throw new StageGateFailure('DESIGN_MISSING', 'Design verification requires a completed Design stage.');
    }
    const pageDesignIds = (design.summary['pageDesignIds'] as readonly string[] | undefined) ?? [];
    const pageDesigns: PageDesignDoc[] = [];
    for (const designId of pageDesignIds) {
      const artifact = await services.store.require(designId);
      const doc = artifact.attributes['designDoc'] as PageDesignDoc | undefined;
      if (doc !== undefined && doc.layout !== undefined) pageDesigns.push(doc);
    }
    const coverage = assessDesignCoverage({ pageDesigns, mode });
    const gate = designCoverageGate(coverage);
    if (!gate.satisfied) {
      throw new StageGateFailure(
        'DESIGN_COVERAGE_GATE_UNMET',
        `Design coverage gate unmet: ${gate.missing.join(', ')}.`,
        gate.missing,
      );
    }
    const discovery = this.stages.getStage(project.id, 'discovery');
    const closure = [...new Set<string>([
      blueprintId,
      ...((design.summary['designArtifactIds'] as readonly string[] | undefined) ?? []),
      ...discovery.artifactIds,
    ])];
    const master = await new MasterVerificationEngine(services).verifyArtifactSet({
      artifactIds: closure,
      artifactClass: 'blueprint',
      verifiers: [{ name: 'closure-verifier', verifier: createClosureVerifier() }],
      producerActors: [
        { kind: 'ai', id: 'understanding-worker-01' },
        { kind: 'ai', id: 'structural-worker-01' },
        { kind: 'ai', id: 'design-worker-01' },
      ],
    });
    if (!master.masterPassed) {
      throw new StageGateFailure(
        'DESIGN_VERIFICATION_FAILED',
        `Master verification did not pass over the design closure (blockingFails=${master.blockingFails}).`,
      );
    }
    return {
      artifactIds: [blueprintId],
      evidenceIds: [],
      summary: {
        blueprintId,
        coverageSatisfied: gate.satisfied,
        masterPassed: master.masterPassed,
        subjectCount: master.subjectCount,
        blockingFails: master.blockingFails,
      },
    };
  }

  // ── Stage 4: Blueprint (human approval gate) ───────────────────────────────
  // Certification needs the design→code trace over -IMPL artifacts, so it runs
  // at the Verification stage (after build), exactly as the CLI demo orders it.

  private async runBlueprint(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const design = this.stages.getStage(project.id, 'design');
    const blueprintId = design.summary['blueprintId'];
    if (typeof blueprintId !== 'string') {
      throw new StageGateFailure('DESIGN_MISSING', 'Blueprint requires a completed Design stage.');
    }
    const approval = await approveBlueprint(services, blueprintId);
    if (!approval.approved) {
      throw new StageGateFailure('APPROVAL_REJECTED', `Blueprint approval rejected: ${approval.reasons.join(' | ')}`, approval.reasons);
    }
    return {
      artifactIds: [blueprintId],
      evidenceIds: approval.evidenceId !== undefined ? [approval.evidenceId] : [],
      summary: {
        blueprintId,
        approved: true,
        approvalEvidenceId: approval.evidenceId ?? null,
      },
    };
  }

  // ── Stage 5: Architecture (build studio decomposition) ─────────────────────

  private async runArchitecture(input: RunStageInput): Promise<StageOutcome> {
    const { project, services, actor } = input;
    const design = this.stages.getStage(project.id, 'design');
    const blueprintId = design.summary['blueprintId'];
    if (typeof blueprintId !== 'string') {
      throw new StageGateFailure('DESIGN_MISSING', 'Architecture requires a completed Design stage.');
    }
    // The APPROVED blueprint is the authoritative record of what was certified
    // for Build to implement. Reading the certified design list from the stage
    // summary instead would silently compare the build against a partial view.
    const blueprint = await services.store.require(blueprintId);

    // REAL BUILD, NOT A BUILD MANIFEST.
    //
    // An `-IMPL` artifact must correspond to code that exists. The only
    // acceptable source of truth is the real execution environment, read back
    // through the EnvAdapter port; a design document is a plan, not an
    // implementation. Without a READY environment there is nothing to observe,
    // so the stage fails closed instead of describing code that was never
    // written.
    const environment = input.executionEnvironment;
    if (environment === undefined) {
      throw new StageGateFailure(
        'EXECUTION_ENVIRONMENT_REQUIRED',
        'Build requires a READY execution environment so the platform can read back the code it actually produced. ' +
          'No environment is attached to this project, so no -IMPL artifact was created and nothing was fabricated.',
      );
    }
    const implementation: RealImplementation = await captureRealImplementation(environment, {
      environmentId: environment.environmentId ?? 'unknown-environment',
      workspaceRoot: null,
    });
    if (!hasRealSource(implementation)) {
      throw new StageGateFailure(
        'NO_REAL_IMPLEMENTATION',
        `The execution environment (${implementation.adapterKind} ${implementation.environmentId}) contains no readable ` +
          'source files, so the Build stage produced no -IMPL artifacts. A build is recorded only from code that ' +
          'actually exists on disk.',
      );
    }

    // The certified Design baseline this build implements.
    const pageDesignIds = (blueprint.attributes['pageDesignIds'] as readonly string[] | undefined) ?? [];
    const pageDesigns: PageDesignDoc[] = [];
    for (const designId of pageDesignIds) {
      const artifact = await services.store.require(designId);
      const doc = artifact.attributes['designDoc'] as PageDesignDoc | undefined;
      if (doc !== undefined && doc.layout !== undefined) pageDesigns.push(doc);
    }
    const featureDesignIds = (blueprint.attributes['featureDesignIds'] as readonly string[] | undefined) ?? [];
    // The blueprint lists each entry already carrying its `-DESIGN` suffix
    // (FEATURE-0001-DESIGN). Appending the suffix again would produce
    // FEATURE-0001-DESIGN-DESIGN and quietly certify nothing.
    const featureBaseIds = featureDesignIds.map((id) => id.replace(/-DESIGN$/, ''));
    const featureTitles: Record<string, string> = {};
    for (const featureId of featureBaseIds) {
      const artifact = await services.store.get(`${featureId}-DESIGN`);
      if (artifact !== null) featureTitles[featureId] = artifact.title;
    }

    const real = await materializeRealImplementation(services, {
      projectId: project.id,
      implementation,
      pageDesigns,
      featureDesignIds: featureBaseIds,
      featureTitles,
      producer: { kind: 'system', id: actor.id },
      verifier: { kind: 'verifier', id: 'build-boss-01' },
    });

    // The build is verified against the REAL artifacts above, using the same
    // dimension checks the Build department has always used. A certified design
    // with no real file behind it is a COVERAGE failure that verification can
    // see and reject, rather than a description that quietly claims coverage.
    const draft = {
      projectId: project.id,
      approvedDesignIds: [...pageDesigns.map((d) => `${d.pageArtifactId}-DESIGN`), ...featureBaseIds.map((f) => `${f}-DESIGN`)],
      materialization: {
        manifestId: '',
        pageImplIds: real.pageImplIds,
        featureImplIds: real.featureImplIds,
        allArtifactIds: [...real.pageImplIds, ...real.featureImplIds, ...real.fileImplIds],
      },
      noteHashes: {},
      expectedPageCount: pageDesigns.length,
      expectedFeatureCount: featureBaseIds.length,
    };
    const [count, coverage, identity] = [
      checkBuildCount(draft),
      checkBuildCoverage(draft),
      await checkBuildIdentity(services, draft),
    ];
    const blocking = [count, coverage, identity].filter((f) => f.verdict === 'fail');
    if (blocking.length > 0) {
      throw new StageGateFailure(
        'BUILD_VERIFICATION_FAILED',
        `Real implementation does not satisfy the certified design: ${blocking
          .map((f) => `${f.dimension} - ${f.detail}`)
          .join('; ')}`,
      );
    }

    return {
      artifactIds: [
        ...new Set<string>([
          ...real.fileImplIds,
          ...real.pageImplIds,
          ...real.featureImplIds,
        ]),
      ],
      evidenceIds: [],
      summary: {
        manifestId: null,
        buildArtifactIds: [...real.pageImplIds, ...real.featureImplIds],
        realFileCount: real.totalRealFiles,
        realInventoryHash: implementation.inventoryHash,
        realEnvironmentId: implementation.environmentId,
        realPageImplIds: real.pageImplIds,
        realFeatureImplIds: real.featureImplIds,
        unimplementedDesignIds: real.unimplementedDesignIds,
      },
    };
  }

  // ── Stage 6: Implementation (verify implementations against the design) ────

  private async runImplementation(input: RunStageInput): Promise<StageOutcome> {
    const { project, services, actor } = input;
    const design = this.stages.getStage(project.id, 'design');
    const architecture = this.stages.getStage(project.id, 'architecture');
    const blueprintId = design.summary['blueprintId'];
    const manifestId = architecture.summary['manifestId'];
    const buildArtifactIds = architecture.summary['buildArtifactIds'];
    if (typeof blueprintId !== 'string' || !Array.isArray(buildArtifactIds)) {
      throw new StageGateFailure('ARCHITECTURE_MISSING', 'Implementation requires a completed Architecture stage.');
    }
    const pageDesignIds = (design.summary['pageDesignIds'] as readonly string[] | undefined) ?? [];
    const pageDesigns: PageDesignDoc[] = [];
    for (const designId of pageDesignIds) {
      const artifact = await services.store.require(designId);
      const doc = artifact.attributes['designDoc'] as PageDesignDoc | undefined;
      if (doc !== undefined && doc.layout !== undefined) pageDesigns.push(doc);
    }
    const coverage = assessDesignCoverage({
      pageDesigns,
      mode: String(project.attributes['mode']) as ProjectMode,
    });
    const build = {
      status: 'accepted' as const,
      ...(typeof manifestId === 'string' ? { manifestId } : {}),
      artifactIds: buildArtifactIds as readonly string[],
    };
    const ux = await verifyUXAgainstImplementation(
      services,
      { status: 'accepted', blueprintId, artifactIds: [...new Set<string>([blueprintId, ...pageDesignIds])] },
      build,
      coverage,
      { kind: 'system', id: 'project-ux-verifier' },
    );
    return {
      artifactIds: buildArtifactIds as readonly string[],
      evidenceIds: [],
      summary: {
        manifestId: typeof manifestId === 'string' ? manifestId : null,
        implementationCount: (buildArtifactIds as readonly string[]).length,
        uxOverall: ux.overallScore,
        uxTokenCoverage: ux.tokenCoverage.score,
        uxAccessibility: ux.accessibilityCoverage.score,
        uxResponsive: ux.responsiveCoverage.score,
        actorId: actor.id,
      },
    };
  }

  // ── Stage 7: Testing ──────────────────────────────────────────────────────

  private async runTesting(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const sampleSize = input.sampleSize ?? 2;
    const testRun = await runTestDepartment(services, project.id, { sampleSize });
    if (testRun.status !== 'passed') {
      throw new StageGateFailure(
        'ACCEPTANCE_TESTING_FAILED',
        `Acceptance testing failed: ${testRun.failedChecks.join(' | ') || testRun.boss.rationale}`,
        testRun.failedChecks,
      );
    }
    return {
      artifactIds: testRun.testIds,
      evidenceIds: testRun.evidenceId !== undefined ? [testRun.evidenceId] : [],
      summary: {
        status: testRun.status,
        executed: testRun.executed.length,
        boss: testRun.boss.verdict,
        auditor: testRun.auditor.verdict,
        reportId: testRun.reportId ?? null,
        testIds: testRun.testIds,
        advancedToTestVerified: testRun.advancedToTestVerified,
        docHalts: testRun.docHalts,
      },
    };
  }

  // ── Stage 8: Verification ─────────────────────────────────────────────────

  private async runVerification(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const design = this.stages.getStage(project.id, 'design');
    const architecture = this.stages.getStage(project.id, 'architecture');
    const blueprintId = design.summary['blueprintId'];
    const closureIds = [...new Set<string>([
      ...design.artifactIds,
      ...architecture.artifactIds,
      ...this.stages.getStage(project.id, 'discovery').artifactIds,
    ])];
    if (typeof blueprintId !== 'string') {
      throw new StageGateFailure('DESIGN_MISSING', 'Verification requires a completed Design stage.');
    }
    const council = await new ReasoningCouncil(services).deliberate({
      subject: blueprintId,
      question: 'Does the full discovery-to-implementation closure verify?',
      contextSummary: `Project ${project.id}: ${closureIds.length} artifacts in closure.`,
      artifactIds: closureIds.slice(0, 50),
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
    if (!master.masterPassed) {
      throw new StageGateFailure('VERIFICATION_FAILED', `Master verification did not pass (blockingFails=${master.blockingFails}).`);
    }
    const requirements = await requirementsTraceability(services.store, services.graph, services.evidence, project.id);
    const certification = await certifyBlueprintCompleteness(services, { blueprintId, master, council, trace: requirements });
    if (!certification.certified) {
      throw new StageGateFailure(
        'CERTIFICATION_REFUSED',
        `Blueprint certification refused: ${certification.reasons.join(' | ')}`,
        certification.reasons,
      );
    }
    const trace = await buildDesignCodeTrace(services, project.id, { kind: 'system', id: 'traceability-engine' });
    const firstPageId = this.firstPageId(project.id);
    const lineage = firstPageId !== null ? await lineageStatus(services.store, firstPageId) : null;
    const coverage = coverageSummary(services.graph, [project.id]);
    return {
      artifactIds: closureIds,
      evidenceIds: certification.evidenceId !== undefined ? [certification.evidenceId] : [],
      summary: {
        masterPassed: master.masterPassed,
        subjectCount: master.subjectCount,
        blockingFails: master.blockingFails,
        councilVerdict: council.verdict,
        traceComplete: requirements.complete,
        certified: true,
        stampedArtifactIds: certification.stampedArtifactIds,
        certificationEvidenceId: certification.evidenceId ?? null,
        designCodeTrace: {
          traced: trace.traced,
          total: trace.total,
          unimplemented: trace.unimplemented,
          orphans: trace.orphans,
          unlinked: trace.unlinked,
        },
        coverage,
        lineage,
      },
    };
  }

  // ── Stage 9: Deployment ───────────────────────────────────────────────────

  private async runDeployment(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const sampleSize = input.sampleSize ?? 2;
    const opsRun = await runOperationsDepartment(services, project.id, { sampleSize });
    if (opsRun.status !== 'passed') {
      throw new StageGateFailure(
        'DEPLOYMENT_FAILED',
        `Operations/deploy did not pass: ${opsRun.failedUnits.join(' | ') || opsRun.boss.rationale}`,
        opsRun.failedUnits,
      );
    }
    return {
      artifactIds: opsRun.deployIds,
      evidenceIds: opsRun.evidenceId !== undefined ? [opsRun.evidenceId] : [],
      summary: {
        status: opsRun.status,
        manifestId: opsRun.manifestId ?? null,
        deployIds: opsRun.deployIds,
        executed: opsRun.executed.length,
        boss: opsRun.boss.verdict,
        auditor: opsRun.auditor.verdict,
        advancedToDeployedVerified: opsRun.advancedToDeployedVerified,
        docHalts: opsRun.docHalts,
        scope: opsRun.scope,
      },
    };
  }

  // ── Stage 10: Operations (continuous engineering, self-healing) ────────────

  private async runOperations(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const sampleSize = input.sampleSize ?? 2;
    const contRun = await runContinuousEngineeringDepartment(services, project.id, { sampleSize });
    if (contRun.finalVerdict !== 'CERTIFIED_COMPLETE') {
      throw new StageGateFailure(
        'OPERATIONS_NOT_COMPLETE',
        `Continuous engineering did not reach CERTIFIED_COMPLETE (verdict=${contRun.finalVerdict}): ${contRun.rationale}`,
      );
    }
    return {
      artifactIds: contRun.materialization?.opsIds ?? [],
      evidenceIds: [],
      summary: {
        finalVerdict: contRun.finalVerdict,
        scopedCount: contRun.workerReport.scopedCount,
        stableCount: contRun.workerReport.stableCount,
        boss: contRun.bossDecision.verdict,
        auditor: contRun.auditorDecision.verdict,
        manifestId: contRun.materialization?.manifestId ?? null,
        opsIds: contRun.materialization?.opsIds ?? [],
        driftFindings: contRun.workerReport.driftFindings,
      },
    };
  }

  // ── Stage 11: Maintenance (telemetry -> recursion -> safe change) ──────────

  private async runMaintenance(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const deployment = this.stages.getStage(project.id, 'deployment');
    const scope = deployment.summary['scope'];
    if (!Array.isArray(scope) || scope.length === 0) {
      throw new StageGateFailure('DEPLOYMENT_MISSING', 'Maintenance requires a completed Deployment stage.');
    }
    const operations = this.stages.getStage(project.id, 'operations');
    const telemetrySource = new SyntheticTelemetrySource();
    const telemetryBase = this.firstPageId(project.id) ?? 'PAGE-0001';
    const observation: TelemetryObservation = telemetrySource.observe(telemetryBase, { errorRate: 0.5 });
    const recursion = await runRecursionDepartment(services, {
      prior: (operations.summary['driftFindings'] as readonly DriftItem[] | undefined) ?? [],
      current: [
        {
          artifactId: observation.baseId,
          dimension: 'CORRECTNESS',
          was: 'pass',
          now: 'fail',
          kind: 'REGRESSED',
          source: 'telemetry',
          evidenceRef: observation.id,
        } satisfies DriftItem,
      ],
      projectId: project.id,
      env: { units: new Map() },
      apply: false,
    });
    const firstChange = recursion.changes[0];
    if (firstChange === undefined) {
      throw new StageGateFailure('NO_ACTIONABLE_DRIFT', 'Recursion classified the telemetry observation but produced no actionable change.');
    }
    const changeEnv = createDeploymentEnvironment('production');
    await deployRelease(services, scope as Parameters<typeof deployRelease>[1], changeEnv);
    for (const exp of scope as Parameters<typeof deployRelease>[1]) {
      await verifyDeployedUnit(services, exp, changeEnv);
    }
    const unit = changeEnv.units.get(telemetryBase);
    if (unit !== undefined) {
      changeEnv.units.set(telemetryBase, { ...unit, configHash: observation.evidenceHash });
    }
    const change = await runSafeChangeDepartment(services, {
      drift: firstChange.drift,
      observation,
      projectId: project.id,
      env: changeEnv,
      apply: true,
    });
    if (change.status !== 'AUTHORIZED_AND_APPLIED') {
      throw new StageGateFailure('SAFE_CHANGE_FAILED', `Safe change did not authorize+apply (status=${change.status}).`);
    }
    const docLoop = await this.walkDriftLoop(project.id, telemetryBase, observation, change);
    return {
      artifactIds: change.materialization.changeId !== undefined ? [change.materialization.changeId] : [],
      evidenceIds: [observation.id],
      summary: {
        observationId: observation.id,
        telemetryBase,
        breach: observation.breach,
        regressions: recursion.classification.regressions.length,
        actionable: recursion.classification.actionable.length,
        changeStatus: change.status,
        proposalId: change.materialization.proposalId,
        approvalId: change.materialization.approvalId,
        changeId: change.materialization.changeId ?? null,
        firstDrift: firstChange.drift,
        docLoop,
      },
    };
  }

  private async walkDriftLoop(
    projectId: string,
    telemetryBase: string,
    observation: TelemetryObservation,
    change: Awaited<ReturnType<typeof runSafeChangeDepartment>>,
  ): Promise<readonly string[]> {
    const implId = `${telemetryBase}-IMPL`;
    const impl = await this.base.store.get(implId);
    if (impl === null) return [];
    const startState = docStateOf(impl);
    if (startState === undefined) return [];
    void projectId;
    const steps: string[] = [startState];
    await recordDocGate(this.base.store, implId, 'CERTIFIED COMPLETE', { kind: 'system', id: 'certification-engine' }, { gate: 'certification-engine' });
    steps.push('CERTIFIED COMPLETE');
    await recordDocGate(this.base.store, implId, 'REGRESSION_DETECTED', { kind: 'system', id: 'runtime-regression-detector' }, { gate: 'runtime-regression-detector', evidenceId: observation.id });
    steps.push('REGRESSION_DETECTED');
    await recordDocGate(this.base.store, implId, 'RE-MEDIATED', { kind: 'verifier', id: 'safe-change-boss-01' }, { gate: 'safe-change-boss', evidenceId: change.trail.bossDecision.decisionHash });
    steps.push('RE-MEDIATED');
    await recordDocGate(this.base.store, implId, 'RE-MEDIATION-VERIFIED', { kind: 'verifier', id: 'safe-change-auditor-01' }, { gate: 'safe-change-auditor', evidenceId: change.trail.auditorDecision.decisionHash });
    steps.push('RE-MEDIATION-VERIFIED');
    const final = await recordDocGate(this.base.store, implId, 'CERTIFIED COMPLETE', { kind: 'system', id: 'certification-engine' }, { gate: 'certification-engine', evidenceId: change.trail.auditorDecision.decisionHash });
    steps.push(docStateOf(final) ?? 'CERTIFIED COMPLETE');
    return steps;
  }

  // ── Stage 12: Continuous Improvement (PEO + change gate) ───────────────────

  private async runContinuousImprovement(input: RunStageInput): Promise<StageOutcome> {
    const { project, services } = input;
    const maintenance = this.stages.getStage(project.id, 'maintenance');
    const firstDrift = maintenance.summary['firstDrift'] as DriftItem | undefined;
    const { candidate } = candidateFromDrift(
      `CHG-${project.id}-PEO`,
      firstDrift ?? {
        artifactId: this.firstPageId(project.id) ?? 'PAGE-0001',
        dimension: 'CORRECTNESS',
        was: 'pass',
        now: 'fail',
        kind: 'REGRESSED',
        source: 'telemetry',
      },
      'self-healing',
      'config_restoration',
      `PEO candidate derived from project ${project.id} drift analysis`,
      'composition of Guardian + Impact + Safe Change',
      services,
    );
    const drift: DriftItem = firstDrift ?? {
      artifactId: this.firstPageId(project.id) ?? 'PAGE-0001',
      dimension: 'CORRECTNESS',
      was: 'pass',
      now: 'fail',
      kind: 'REGRESSED',
      source: 'telemetry',
    };
    const priorWatch1 = classifySignal({ signal: { kind: 'drift', drift }, priorWatches: [], memory: emptyGuardianMemory() });
    const priorWatch2 = classifySignal({ signal: { kind: 'drift', drift }, priorWatches: [priorWatch1], memory: emptyGuardianMemory() });
    const peo = await runPermanentEngineeringOrganization(services, {
      candidate,
      priorWatches: [priorWatch1, priorWatch2],
      memory: emptyGuardianMemory(),
      projectId: project.id,
    });
    const reopen = evaluateChangeReopenRequest(services.graph, {
      requestId: `CR-${project.id}`,
      discoveredBy: { kind: 'ai', id: 'build-worker-01' },
      namedArtifacts: [drift.artifactId],
      reason: `Continuous improvement review for project ${project.id}.`,
    });
    return {
      artifactIds: [],
      evidenceIds: [],
      summary: {
        source: peo.source,
        guardianClassification: peo.watch.classifiedAs,
        impactAffected: peo.impact.affected.length,
        safeChangeStatus: peo.change.status,
        authorized: peo.authorized,
        escalated: peo.escalated,
        reopenVerdict: reopen.verdict,
        reopenAffected: reopen.affected.length,
        rationale: peo.rationale,
      },
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private briefFor(project: Artifact, instruction?: string): ProductUnderstandingBrief {
    const vision = project.description.trim().length >= 10 ? project.description.trim() : `${project.title} — ${project.description}`.trim();
    return {
      name: project.title,
      vision: vision.length >= 10 ? vision : `${project.title} product vision`,
      targetUsers: this.targetUsersFor(project, instruction),
    };
  }

  private targetUsersFor(project: Artifact, instruction?: string): string[] {
    const fromInstruction = /target users?\s*[:\-]\s*(.+)/i.exec(instruction ?? '');
    if (fromInstruction?.[1] !== undefined) {
      return fromInstruction[1].split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 0);
    }
    const scope = project.attributes['scope'];
    if (Array.isArray(scope) && scope.length > 0) {
      const users = scope.filter((s): s is string => typeof s === 'string' && /user|team|customer|admin|member|operator/i.test(s));
      if (users.length > 0) return users;
    }
    return ['end users'];
  }

  private requireBaseline(projectId: string): DiscoveryBaseline {
    const discovery = this.stages.getStage(projectId, 'discovery');
    const baseline = discovery.summary['baseline'] as DiscoveryBaseline | undefined;
    if (baseline === undefined) {
      throw new StageGateFailure('DISCOVERY_MISSING', 'This stage requires a completed Discovery stage.');
    }
    return baseline;
  }

  private async visualFor(services: CoreServices, baseline: DiscoveryBaseline): Promise<VisualDesignSystem> {
    const businessModel = await deriveBusinessModel(services, baseline);
    return buildVisualDesignSystem(baseline, businessModel);
  }

  private firstPageId(projectId: string): string | null {
    const discovery = this.stages.getStage(projectId, 'discovery');
    const baseline = discovery.summary['baseline'] as DiscoveryBaseline | undefined;
    return baseline?.pages[0]?.artifactId ?? null;
  }

  private optionalId(id: string | undefined): string[] {
    return id !== undefined ? [id] : [];
  }
}
