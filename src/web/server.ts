/**
 * Nexona web application server.
 *
 * Serves the Nexona browser product: a single-page application backed by an
 * authenticated REST API that orchestrates the existing Blueprint-First
 * engineering core (src/demo/main.ts pipeline = single source of truth for the
 * engine showcase). The engineering core is untouched â€” this layer wires real
 * sessions to real accounts and drives the engine on demand per account.
 */

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { consoleSink, createLogger } from '../core/logging.ts';
import { runDemoPipeline, type DemoResult } from '../demo/main.ts';
import type { CoreServices } from '../core/services.ts';
import { docStateOf } from '../core/doc.ts';
import type { Artifact } from '../core/artifact.ts';
import { BlueprintError, ConfigurationError, RoutingError } from '../core/errors.ts';
import { DurableAccountRegistry } from '../account/durable-registry.ts';
import { assertSameOrigin, attachAuth } from './auth.ts';
import { auditNoAuthEnabled, applyAuditIdentity, AUDIT_ACCOUNT_ID } from './audit-mode.ts';
import { registerAuthApi } from './auth-api.ts';
import { DurableDocumentStore, documentsFilePath } from './durable-documents.ts';
import { DurableProjectStore, webProjectsFilePath } from './durable-projects.ts';
import { DurableJudgmentLedger, judgmentFilePath } from '../judgment/store.ts';
import { resolveAmbiguity, type IntentTrace } from '../judgment/product-judgment.ts';
import { ensureDir, resolveDataDir } from '../runtime/paths.ts';
import { DuplicateCredentialError, CredentialStore } from '../ai/credential-store.ts';
import { DocumentStore, DocumentNotFoundError, sha256, type DocumentRef } from '../chat/document.ts';
import { ModelCatalogue } from '../ai/model-catalogue.ts';
import { ModelsDevSource } from '../ai/models-dev-source.ts';
import { OpenCodeRuntime } from '../ai/opencode/opencode-runtime.ts';
import { OpenCodeProvider } from '../ai/opencode/opencode-provider.ts';
import { OpencodeCatalogueSource } from '../ai/opencode/opencode-catalogue-source.ts';
import { OpenRouterProvider } from '../ai/openrouter-provider.ts';
import { ProviderManager, WIRED_PROVIDER_IDS } from '../ai/provider-manager.ts';
import type { ModelAccessCategory } from '../ai/provider-metadata.ts';
import type { AiCompletionResponse, AiTaskType } from '../ai/types.ts';
import { PROJECT_MODE_STAGES, PROJECT_MODES } from '../project/types.ts';
import type { ProjectMode } from '../project/types.ts';
import { DurableEvidenceLog, evidenceFilePath } from './durable-evidence.ts';
import { DurableEventBus, eventsFilePath } from '../events/bus.ts';
import { EnvironmentManager, environmentsFilePath, workspacesRootPath } from '../env/manager.ts';
import { CapabilityDiscovery, capabilitiesFilePath } from '../env/capabilities.ts';
import { DaytonaWorkspaceAdapter } from '../env/daytona-adapter.ts';
import { LocalWorkspaceEnvAdapter } from '../env/local-workspace.ts';
import { assessFoundation, type FoundationReport } from '../env/foundation.ts';
import { probeControlPlane } from '../env/control-plane-probes.ts';
import { DaytonaPlatformConfig, daytonaPlatformConfigFilePath } from '../env/daytona-platform-config.ts';
import { prepareClineAi, clineProfileDirs, clineRootDir, runClineTask } from '../env/cline-bridge.ts';
import type { EnvAdapter } from '../env/types.ts';
import type { JobRecord } from '../jobs/types.ts';
import { reconcileHostPath } from '../runtime/host-path.ts';
import { JobEngine, jobsFilePath } from '../jobs/engine.ts';
import { buildExecutionGraph } from '../jobs/graph.ts';
import { AgenticSession } from '../agentic/session.ts';
import type { EnvSpec, JobEnvPort, EnvironmentRecord } from '../env/types.ts';
import type { FailureClass } from '../supervisor/types.ts';
import type { JobExecutor, JobResult } from '../jobs/types.ts';
import { ExecutionSupervisor, supervisionTraceFilePath } from '../supervisor/supervisor.ts';
import type { SupervisorTarget } from '../supervisor/types.ts';
import { evaluateApproval } from '../design/approval.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public', 'nexona');

/** Session lifetime: 12 hours (the session cookie Max-Age matches this). */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Roadmap state fixed by the repository (verified from git log/docs). */
const ROADMAP = [
  { level: 'L0', title: 'Project foundation', status: 'COMPLETE' },
  { level: 'L1a', title: 'Core discovery -> design -> approval -> build chain', status: 'COMPLETE' },
  { level: 'L1b', title: 'Minimum Viable Discovery Department', status: 'COMPLETE' },
  { level: 'L2', title: 'Verified Engineering Organization / council / certification', status: 'COMPLETE' },
  { level: 'L3', title: 'Acceptance Testing Department + Operations (deployment)', status: 'COMPLETE' },
  { level: 'L4', title: 'Continuous Engineering / Safe Change / telemetry / recursion', status: 'COMPLETE' },
  { level: 'L5', title: 'Permanent Engineering Organization (composition, no certification)', status: 'COMPLETE' },
] as const;

/** Capabilities implemented in the core but not exercised by the demo chain. */
const AVAILABLE_NOT_EXERCISED = [
  {
    id: 'evolution-review',
    label: 'Evolution Review',
    module: 'src/perm/evolution.ts',
    note: 'Standing improvement recommendations. Implemented in core, not invoked in this pipeline run.',
  },
  {
    id: 'learning',
    label: 'Continuous Learning',
    module: 'src/perm/learning.ts',
    note: 'Continuous Learning Engine lessons. Implemented in core, not invoked in this pipeline run.',
  },
  {
    id: 'change-history',
    label: 'Change History',
    module: 'src/perm/change-history.ts',
    note: 'Â§T.4 append-only certification history. Implemented in core, not invoked in this pipeline run.',
  },
  {
    id: 'living-blueprint',
    label: 'Living Blueprint materialization',
    module: 'src/perm/living-blueprint.ts',
    note: 'Â§5.3 Living Blueprint snapshot. Implemented in core, not invoked in this pipeline run (a PEO/continuous run stamps -PERM manifests).',
  },
  {
    id: 'change-reopening-gate',
    label: 'Change / Reopening Process (Â§2.4)',
    module: 'src/change/reopening.ts',
    note: 'Fail-closed pre-launch Change/Reopen Request gate: the discovering stage opens a request but never adjudicates it; only the Design Boss certifies re-evaluated scope. Impact Analysis over the Dependency Map is computed before admission. Implemented in core; the demo exercises it once on the PEO path.',
  },
] as const;

function artifactSummary(a: Artifact): Record<string, unknown> {  return {
    id: a.id,
    type: a.type,
    title: a.title,
    status: a.status,
    docState: docStateOf(a) ?? null,
    version: a.version,
    projectId: a.projectId,
    confidence: a.confidence ?? null,
    evidenceIds: a.provenance
      .map((p) => p.evidenceId)
      .filter((e): e is string => typeof e === 'string'),
  };
}

function projectSummary(p: Artifact): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    status: p.status,
    mode: p.attributes['mode'],
    lifecycleComplete: p.attributes['lifecycleComplete'] ?? null,
    version: p.version,
  };
}

/** Owner userId recorded on a PROJECT artifact, or null. */
function projectOwnerId(p: Artifact): string | null {
  const owner = p.attributes['owner'] as { userId?: unknown } | null | undefined;
  if (owner === null || owner === undefined || typeof owner.userId !== 'string' || owner.userId.trim().length === 0) return null;
  return owner.userId.trim();
}

/** True when a PROJECT artifact was soft-deleted through the web layer. */
function isProjectDeleted(p: Artifact): boolean {
  return p.attributes['deleted'] === true;
}

/** Maximum accepted text-upload size (guards a large-upload DoS). */
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_MAX_MB = UPLOAD_MAX_BYTES / (1024 * 1024);

class UploadTooLargeError extends Error {
  readonly code = 'UPLOAD_TOO_LARGE';
}

/** Splits a multipart body into raw parts (boundary CRLFs stripped). */
function splitMultipartParts(body: Buffer, sep: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let pos = body.indexOf(sep);
  while (pos !== -1) {
    const start = pos + sep.length;
    const next = body.indexOf(sep, start);
    if (next === -1) break;
    let contentStart = start;
    if (body.subarray(start, start + 2).equals(Buffer.from('\r\n'))) contentStart += 2;
    let contentEnd = next;
    if (body.subarray(contentEnd - 2, contentEnd).equals(Buffer.from('\r\n'))) contentEnd -= 2;
    if (contentEnd > contentStart) parts.push(body.subarray(contentStart, contentEnd));
    pos = next;
  }
  return parts;
}

/** Extracts the uploaded text from a multipart body. Rejects binary payloads. */
function parseMultipartRequest(contentTypeHeader: string, body: Buffer): { fileName?: string; text: string } {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentTypeHeader);
  if (match === null) throw new Error('multipart boundary missing; upload rejected.');
  const boundary = match[1] ?? match[2];
  const sep = Buffer.from(`--${boundary}`);
  for (const part of splitMultipartParts(body, sep)) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const header = part.subarray(0, headerEnd).toString('latin1');
    if (!/name="file"/.test(header)) continue;
    let fileName: string | undefined;
    const fileNameMatch = /filename="([^"]*)"/.exec(header);
    if (fileNameMatch !== null && fileNameMatch[1] !== undefined) fileName = fileNameMatch[1];
    const text = part.subarray(headerEnd + 4).toString('utf8');
    if (text.includes('\u0000')) throw new Error('Only text files are supported; binary content was rejected.');
    return { fileName, text };
  }
  throw new Error('No file part named "file" was found in the upload.');
}

/** Buffers and parses a multipart upload request body (streamed, size-capped). */
function parseUploadRequest(req: express.Request): Promise<{ fileName?: string; text: string }> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] ?? '');
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > UPLOAD_MAX_BYTES) {
        reject(new UploadTooLargeError(`Upload exceeds the ${UPLOAD_MAX_MB} MB limit.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(parseMultipartRequest(contentType, Buffer.concat(chunks)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('upload parse failed'));
      }
    });
    req.on('error', (error) => {
      reject(error instanceof UploadTooLargeError ? error : new Error('upload stream error'));
    });
  });
}
/** Options for buildServer; all optional for backwards compatibility. */
export interface BuildServerOptions {
  /**
   * Injected ModelCatalogue. When omitted, a real catalogue is constructed
   * from Models.dev + OpenRouter using default base URLs (and the
   * OPENROUTER_API_KEY env var for the OpenRouter key, if present).
   */
  modelCatalogue?: ModelCatalogue;
  /** Injected ProviderManager (selection/credential layer). */
  providerManager?: ProviderManager;
  /** Injected DocumentStore (large-prompt / document handling). */
  documentStore?: DocumentStore;
  /**
   * Injectable fetch for the OpenRouter key-check (tests). Never persisted;
   * used only at verification time.
   */
  openRouterFetchImpl?: unknown;
  /** Demo pipeline result override (tests construct the server cheaply). */
  result?: DemoResult;
  /** Root directory for durable application state (default: BF_DATA_DIR or <repo>/data). */
  dataDir?: string;
  /** Injected durable account registry (tests); loaded from dataDir/accounts.json otherwise. */
  accounts?: DurableAccountRegistry;
  /**
   * Minimum time between live foundation capability re-probes (ms). Lower
   * values make /api/system/foundation reflect newly installed components
   * sooner; 0 re-probes on every request. Default 5_000.
   */
  foundationTtlMs?: number;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: express.Express;
  result: DemoResult;
  providerManager: ProviderManager;
  modelCatalogue: ModelCatalogue;
  documentStore: DocumentStore | DurableDocumentStore;
  accounts: DurableAccountRegistry;
  working: { bus: DurableEventBus; environments: EnvironmentManager; jobs: JobEngine; supervisor: ExecutionSupervisor };
  judgment: DurableJudgmentLedger;
}> {
  const logger = createLogger({ level: 'warn', sink: consoleSink() });
  // --- Nexona durable application state (survives restarts) --------------------
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  // The certification/evidence trail is DURABLE across restarts: every append
  // this boot (demo scenario plus all web-stage, verification and supervised
  // run evidence) is written to evidence.json and replayed on the next boot.
  const durableEvidence = new DurableEvidenceLog(evidenceFilePath(dataDir));
  await durableEvidence.init();
  const result = options.result ?? (await runDemoPipeline(logger, { evidence: durableEvidence }));
  // The integrated OpenCode execution layer: REAL opencode subprocess + the
  // runtime's own catalogue. Never simulated; a missing runtime is reported.
  const openCodeRuntime = new OpenCodeRuntime({});
  const openCodeProvider = new OpenCodeProvider({ runtime: openCodeRuntime });
  const openCodeSource = new OpencodeCatalogueSource({ provider: openCodeProvider });
  const modelCatalogue =
    options.modelCatalogue ??
    new ModelCatalogue({
      modelsDevSource: new ModelsDevSource({}),
      opencodeSource: openCodeSource,
      ...(process.env['OPENROUTER_API_KEY']?.trim()
        ? {
            openRouterProvider: new OpenRouterProvider({
              apiKey: process.env['OPENROUTER_API_KEY'].trim(),
            }),
          }
        : {}),
    });
  const providerManager =
    options.providerManager ?? new ProviderManager({ logger, opencodeProvider: openCodeProvider });
  // LAW - OPENCODE IS A REAL INTEGRATION (§77): the OpenCode execution layer is a
  // mandatory component of the finished platform, so an INJECTED manager must be
  // wired to it too. Without this, a caller-supplied ProviderManager left
  // `openCode` null while the catalogue, the model binding flow and the startup
  // gate all still spoke about `opencode`; every governed run then failed with
  // "No verified AI credential" even though the real runtime was installed,
  // reachable and had the requested free model. Registration proves nothing by
  // itself - usability still requires the live connection test in
  // getExecutionRouterFor - so this cannot manufacture a working AI.
  if (providerManager.getOpenCodeProvider() === null) {
    providerManager.enableOpenCode(openCodeProvider);
  }

  // --- durable accounts, documents and web projects --------------------------
  const accounts =
    options.accounts ??
    (await DurableAccountRegistry.load(join(dataDir, 'accounts.json'), SESSION_TTL_MS));
  // Operator-controlled platform-owner designation. The first account on a fresh
  // installation already becomes the owner, but once durable state exists there is
  // otherwise no supported way to designate one. The decision is made here, in the
  // backend, from the operator's environment - never from a client request.
  const ownerUsername = process.env['BF_PLATFORM_OWNER']?.trim();
  if (ownerUsername !== undefined && ownerUsername.length > 0) {
    const owner = await accounts.promoteToPlatformOwner(ownerUsername);
    logger.info('owner.designated', {
      username: ownerUsername,
      applied: owner !== null,
      ...(owner === null ? { reason: 'no such account yet; sign up with this username to claim ownership' } : {}),
    });
  }
  const documentStore: DocumentStore | DurableDocumentStore =
    options.documentStore ?? new DurableDocumentStore({ filePath: documentsFilePath(dataDir) });
  if (documentStore instanceof DurableDocumentStore) await documentStore.init();
  const persistDocuments = async (): Promise<void> => {
    if (documentStore instanceof DurableDocumentStore) await documentStore.persist();
  };

  // Web-created projects survive restarts: the demo pipeline rebuilds the
  // artifact store from scratch on boot, so web projects are snapshotted here
  // and replayed into the freshly-built store before any route serves reads.
  const durableProjects = new DurableProjectStore({ filePath: webProjectsFilePath(dataDir) });
  await durableProjects.init();
  // Â§105-Â§110: the product-judgment layer (judgment, the immutable intent
  // baseline, the append-only decision ledger and both product simulations) is
  // durable state, exactly like the evidence trail - a later engineer must be
  // able to read why a major decision was made after a restart.
  const judgment = new DurableJudgmentLedger(judgmentFilePath(dataDir));
  await judgment.init();
  // Replay web projects into the current store when full services are present
  // (the real pipeline always provides them; injected test doubles may not).
  if (result.store !== undefined && result.services?.graph !== undefined && result.services?.allocator !== undefined) {
    await durableProjects.replayInto(result.store, result.services.graph, result.services.allocator);
  }

  const app = express();
  app.use(express.json());
  app.use(assertSameOrigin); // CSRF defense: cross-site writes are rejected
  app.use(attachAuth(accounts)); // identity = verified session cookie only

  // TEMPORARY AUDIT MODE (development only, `BF_AUDIT_NO_AUTH=1`).
  // Authentication is deliberately set aside for this audit phase, so a request
  // without a real session receives a synthetic development identity and the
  // governed execution surface becomes reachable. `/api/me` is handled further
  // down and still reports "no account", so the splash/welcome experience is
  // preserved. No authentication route or check is removed or weakened.
  const auditMode = auditNoAuthEnabled();
  if (auditMode) {
    logger.warn('audit.no_auth_enabled', {
      note: 'Authentication bypassed for backend/execution auditing. Development use only.',
    });
    app.use('/api', (req, _res, next) => {
      if (req.path === '/me' || req.path === '/audit-mode') {
        next();
        return;
      }
      applyAuditIdentity(req);
      next();
    });
    app.get('/api/audit-mode', (_req, res) => {
      res.json({ enabled: true, ownerAccountId: AUDIT_ACCOUNT_ID });
    });
  } else {
    app.get('/api/audit-mode', (_req, res) => {
      res.json({ enabled: false });
    });
  }

  app.use('/nexona', express.static(PUBLIC_DIR, { maxAge: '365d', immutable: true, setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Nexona-Asset', 'ok'); } }));
  app.use('/assets', express.static(join(PUBLIC_DIR, 'assets'), { maxAge: '365d', immutable: true, setHeaders: (res, filePath) => { res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.use('/favicon.svg', express.static(join(PUBLIC_DIR, 'favicon.svg'), { maxAge: '1h' }));

  // --- Nexona authentication & account security --------------------------------
  registerAuthApi(app, { accounts });

  // Mandatory first-time setup gate. Every product route requires a session AND
  // a COMPLETED setup, where complete means BOTH:
  //   1. recovery questions and answers have been created, and
  //   2. the authenticator is enrolled, verified and enabled.
  // Auth/account-management routes stay usable so the setup wizard itself can
  // run; everything else answers 403 until setup is finished. This is enforced
  // server-side, so it cannot be bypassed by the SPA or by raw API calls, and
  // neither step can be skipped.
  const SETUP_EXEMPT_PREFIXES = ['/auth', '/me', '/account', '/teamtask'];
  app.use('/api', (req, res, next) => {
    if (req.account === undefined) {
      next();
      return;
    }
    for (const prefix of SETUP_EXEMPT_PREFIXES) {
      if (req.path.startsWith(prefix)) {
        next();
        return;
      }
    }
    if (accounts.needsRecoverySetup(req.account.id)) {
      res.status(403).json({
        error: 'Recovery questions must be set up before you can use the product.',
        code: 'recovery_setup_required',
        nextStage: 'recovery',
      });
      return;
    }
    if (accounts.needsAuthenticatorSetup(req.account.id)) {
      res.status(403).json({
        error: 'Authenticator setup is required before you can use the product.',
        code: 'authenticator_setup_required',
        nextStage: 'authenticator',
      });
      return;
    }
    next();
  });

    // --- session identity (frontend entry point) ---------------------------------
  app.get('/api/me', (req, res) => {
    if (req.account === undefined) {
      res.json({ account: null });
      return;
    }
    res.json({ account: accounts.view(req.account) });
  });

  const services: CoreServices = result.services;

  // --- summary ---------------------------------------------------------------
  app.get('/api/summary', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const evidenceEntries = await result.evidence.all();
    const project = result.project;
    const projectMode = result.projectMode;
    const lifecycleComplete =
      result.registry === undefined ? null : await result.registry.lifecycleComplete(project.id);
    res.json({
      productName: result.baseline.projectId,
      projectId: result.baseline.projectId,
      project: {
        id: project.id,
        title: project.title,
        mode: projectMode,
        lifecycleComplete,
      },
      envName: result.config.envName,
      dataDir: result.config.dataDir,
      provider: 'ScriptedProvider (DETERMINISTIC DEMO RESPONSES - not a live model)',
      providerCalls: result.providerCalls,
      storeKind: services.store.kind,
      evidenceCount: evidenceEntries.length,
      graph: result.stats,
      discoveryArtifacts: result.baseline.totalArtifacts,
      designCoverage: {
        coveredCount: result.designCoverage.covered.length,
        totalDimensions: result.designCoverage.allDimensions.length,
        missing: result.designCoverage.missing,
        assessmentHash: result.designCoverage.assessmentHash,
      },
      businessModel: {
        roleCount: result.businessModel.roles.length,
        permissionCount: result.businessModel.rolePermissions.length,
        entityCount: result.businessModel.entities.length,
        workflowCount: result.businessModel.workflows.length,
        adminRoles: result.businessModel.adminCapabilities.map((a) => a.role),
      },
      threatModel: {
        threatCount: result.threatModel.threats.length,
        strideCategories: [...new Set(result.threatModel.threats.map((t) => t.category))],
        requirementCount: result.threatModel.securityRequirements.length,
        p0Count: result.threatModel.securityRequirements.filter((r) => r.priority === 'P0').length,
      },
      uxVerification: {
        tokenScore: result.uxVerification.tokenCoverage.score,
        accessibilityScore: result.uxVerification.accessibilityCoverage.score,
        responsiveScore: result.uxVerification.responsiveCoverage.score,
        overallScore: result.uxVerification.overallScore,
        findingsCount: result.uxVerification.findings.length,
      },
      designCodeTrace: {
        total: result.designCodeTrace.total,
        traced: result.designCodeTrace.traced,
        unimplemented: result.designCodeTrace.unimplemented,
        orphans: result.designCodeTrace.orphans,
        forwardComplete: result.designCodeTrace.forwardComplete,
        reverseComplete: result.designCodeTrace.reverseComplete,
      },
      projectBinding: {
        documentCount: result.projectBinding.documentCount,
        documentIds: result.projectBinding.documentIds.slice(0, 20),
        ownerCount: result.projectBinding.ownerCount,
      },
      portability: {
        artifactCount: result.portability.artifactCount,
        edgeCount: result.portability.edgeCount,
        evidenceCount: result.portability.evidenceCount,
        integrityVerified: result.portability.integrityVerified,
      },
      account: {
        accountCount: result.account.accountCount,
        ownerAccountId: result.account.ownerAccountId,
        ownerCanAccess: result.account.ownerCanAccess,
        strangerCanAccess: result.account.strangerCanAccess,
      },
      designQuality: {
        overallScore: result.designQuality.overallScore,
        identitySpecificity: result.designQuality.identitySpecificity,
        componentConsistency: result.designQuality.componentConsistency,
        accessibility: result.designQuality.accessibility,
        findingsCount: result.designQuality.findings.length,
      },
      designConsistency: {
        overallConsistency: result.designConsistency.overallConsistency,
        tokenVariance: result.designConsistency.tokenConsistency.variance,
        componentVariance: result.designConsistency.componentConsistency.variance,
        spacingVariance: result.designConsistency.spacingConsistency.variance,
        typographyVariance: result.designConsistency.typographyConsistency.variance,
        exceptionsCount: result.designConsistency.exceptions.length,
      },
      visual: {
        identityTone: result.visual.identity.direction.tone,
        seedHue: result.visual.identity.direction.seedHue,
        seedSaturation: result.visual.identity.direction.seedSaturation,
        componentCount: result.visual.components.inventoried.length,
        motionDurationStandard: result.visual.tokens.motion?.durationStandard,
        reducedMotion: result.visual.tokens.motion?.reducedMotion,
      },
      blueprintId: result.design.blueprintId,
      manifestId: result.build.manifestId ?? null,
      certified: result.certification.certified,
      certifiedStamped: result.certification.stampedArtifactIds.length,
      certificationEvidenceId: result.certification.evidenceId ?? null,
      councilVerdict: result.council.verdict,
      masterPassed: result.master.masterPassed,
      traceComplete: result.trace.complete,
      opsUnitsReleased: result.opsRun.executed.length,
      continuousVerdict: result.contRun.finalVerdict,
      safeChangeStatus: result.changeResult.status,
      peoClassification: result.peoResult.watch.classifiedAs,
      peoAuthorized: result.peoResult.authorized,
    });
  });

  // --- activity (recent account activity) -----------------------------------
  app.get('/api/activity', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const projects = await ownedProjectsOf(user);
    const documents = documentStore.listForOwner(user);
    if (projects.length === 0 && documents.length === 0) {
      res.json({ activity: [] });
      return;
    }
    const projectActivity = projects.slice(-5).map((p) => ({
      type: 'project',
      id: p.id,
      title: p.title,
      timestamp: p.updatedAt ?? p.createdAt ?? '',
    }));
    const docActivity = documents.slice(-5).map((d) => ({
      type: 'document',
      id: d.id,
      title: d.preview.length > 60 ? `${d.preview.slice(0, 60)}â€¦` : d.preview,
      timestamp: '',
    }));
    const ts = (t: string) => {
      const ms = new Date(t).getTime();
      return Number.isFinite(ms) ? ms : 0;
    };
    const activity = [...projectActivity, ...docActivity]
      .sort((a, b) => ts(b.timestamp) - ts(a.timestamp))
      .slice(0, 10);
    res.json({ activity });
  });

  /** Projects owned by the given user (soft-deleted excluded). */
  const ownedProjectsOf = async (user: string): Promise<Artifact[]> => {
    if (result.registry === undefined) return [];
    const all = await result.registry.listProjects();
    return all.filter((p) => projectOwnerId(p) === user && !isProjectDeleted(p));
  };

  /** The user's project, or null when missing/foreign/deleted. */
  const requireOwnedProject = async (user: string, id: string): Promise<Artifact | null> => {
    if (result.registry === undefined) return null;
    try {
      const project = await result.registry.requireProject(id);
      if (projectOwnerId(project) !== user || isProjectDeleted(project)) return null;
      return project;
    } catch {
      return null;
    }
  };

  // --- projects (project foundation) ------------------------------------------
  app.get('/api/projects', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const projects = await ownedProjectsOf(user);
    res.json({
      count: projects.length,
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        mode: p.attributes['mode'],
        status: p.status,
        lifecycleComplete: p.attributes['lifecycleComplete'] ?? null,
      })),
    });
  });

  app.get('/api/projects/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const mode = String(project.attributes['mode']);
    const stagesForMode = (PROJECT_MODE_STAGES as Record<string, { stageId: string; label: string; inScope: boolean }[]>)[mode] ?? [];
    const stagesRun = (project.attributes['stages'] as readonly { stageId: string; at: string; recordedBy: string }[] | undefined) ?? [];
    const approval = project.attributes['approval'] as { status?: string; approvedAt?: string; approvedBy?: string } | null | undefined;
    res.json({
      ...projectSummary(project),
      description: project.description,
      owner: project.attributes['owner'] ?? null,
      scope: project.attributes['scope'] ?? [],
      config: project.attributes['projectConfig'] ?? {},
      aiConfig: aiConfigOf(project),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt ?? null,
      stages: stagesForMode.map((s) => {
        const run = stagesRun.find((r) => r.stageId === s.stageId);
        const runState = run === undefined
          ? 'PENDING'
          : 'status' in run && run.status === 'EXECUTED'
            ? 'EXECUTED'
            : 'RECORDED';
        return {
          stageId: s.stageId,
          label: s.label,
          inScope: s.inScope,
          status: !s.inScope ? 'OUT_OF_SCOPE' : runState,
          at: run?.at ?? null,
          providerId: run !== undefined && 'providerId' in run ? run.providerId : null,
          modelId: run !== undefined && 'modelId' in run ? run.modelId : null,
        };
      }),
      aiOutputs: project.attributes['aiOutputs'] ?? {},
      approval: approval ?? null,
      stagesRunCount: stagesRun.length,
    });
  });
          

  // â”€â”€ project update (settings) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.put('/api/projects/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
const body = req.body as { title?: unknown; mode?: unknown; description?: unknown };
    const newTitle =
      typeof body.title === 'string' && body.title.trim().length >= 2 && body.title.trim().length <= 64
        ? body.title.trim() : null;
    const newMode =
      typeof body.mode === 'string' && (PROJECT_MODES as readonly string[]).includes(body.mode)
        ? body.mode : null;
    const newDescription =
      typeof body.description === 'string'
        ? (body.description.length <= 8000 ? body.description.trim() : null)
        : undefined;
    if (newTitle === null && newMode === null && newDescription === undefined) {
      res.status(400).json({ error: 'No valid updates provided. Supply title (2-64 chars) and/or a valid mode and/or a description (up to 8,000 chars).' });
      return;
    }
try {
      const updated = await result.services.store.update(project.id, project.version, (draft) => ({
        ...draft,
        ...(newTitle !== null ? { title: newTitle } : {}),
        ...(typeof newDescription === 'string' ? { description: newDescription } : {}),
        attributes: { ...draft.attributes, ...(newMode !== null ? { mode: newMode } : {}) },
      }));
      await durableProjects.capture(updated);
res.json({ project: projectSummary(updated) });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.put('/api/projects/:id/ai-config', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const body = req.body as { providerId?: unknown; modelId?: unknown; credentialId?: unknown };
    const { aiConfig, error } = await aiConfigFromBody(body, user);
    if (error !== null) {
      res.status(400).json({ error });
      return;
    }
    try {
      const stored = (project.attributes['projectConfig'] as Record<string, unknown> | undefined) ?? {};
      const previous = stored['aiConfig'];
      const prevVersion =
        typeof previous === 'object' && previous !== null &&
        typeof (previous as Record<string, unknown>)['configVersion'] === 'number'
          ? ((previous as Record<string, unknown>)['configVersion'] as number)
          : 0;
      const nextConfig: Record<string, unknown> = { ...stored };
      if (aiConfig === null) {
        delete nextConfig['aiConfig'];
      } else {
        // verificationStatus is a REAL snapshot at save time: whether a
        // provable execution route exists for this user right now (verified
        // credential / reachable runtime). Runs re-verify live regardless.
        const route = await providerManager.getExecutionRouterFor(user, aiConfig.providerId, aiConfig.modelId);
        nextConfig['aiConfig'] = {
          ...aiConfig,
          configVersion: prevVersion + 1,
          boundAt: new Date().toISOString(),
          verificationStatus: route === null ? 'unverified' : 'verified',
        };
      }
      const updated = await result.services.store.update(project.id, project.version, (draft) => ({
        ...draft,
        attributes: { ...draft.attributes, projectConfig: nextConfig },
      }));
      await durableProjects.capture(updated);
      await result.evidence.append({
        kind: 'inspection',
        summary: `Project ${project.id} AI configuration set to ${aiConfig === null ? 'none' : `${aiConfig.providerId}/${aiConfig.modelId}`} by ${user}.`,
        artifactIds: [project.id],
        producer: { kind: 'system', id: 'web-project-api' },
      });
      res.json({ project: projectSummary(updated), aiConfig: aiConfig ?? null });
    } catch (err) {
      jsonError(res, 400, err);
    }
  });

  // â”€â”€ per-project AI configuration (Â§roadmap 'Per-project AI preferences') â”€â”€
  // The create/update surface binds a provider + model (+ optional stored
  // credential) to ONE project. The provider must have a real execution
  // adapter; a supplied credential must belong to this account and match the
  // provider. The model is executed through the live adapter at run time.

  /** Validates an AI-config payload; null result means "not supplied" (clear). */
  const aiConfigFromBody = async (
    body: { providerId?: unknown; modelId?: unknown; credentialId?: unknown },
    user: string,
  ): Promise<{ aiConfig: { providerId: string; modelId: string; credentialId?: string } | null; error: string | null }> => {
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : '';
    if (providerId.length === 0 && modelId.length === 0 && credentialId.length === 0) {
      return { aiConfig: null, error: null };
    }
    if (!(WIRED_PROVIDER_IDS as readonly string[]).includes(providerId) && providerId !== 'local') {
      return { aiConfig: null, error: `AI configuration requires a wired provider; "${providerId || '(none)'}" has no execution adapter. Select from: ${[...WIRED_PROVIDER_IDS, 'local'].join(', ')}.` };
    }
    if (modelId.length === 0) {
      return { aiConfig: null, error: 'modelId is required when a provider is set on the project AI configuration.' };
    }
    if (credentialId.length > 0) {
      try {
        const ref = providerManager.credentials.getReference(user, credentialId);
        if (ref.providerId !== providerId) {
          return { aiConfig: null, error: `credentialId belongs to provider "${ref.providerId}" but the project binds "${providerId}".` };
        }
      } catch {
        return { aiConfig: null, error: 'credentialId refers to a credential that does not exist for this account.' };
      }
    }
    // A project may only bind a model that REALLY exists (in the authoritative
    // catalogue, or served by the wired local/OpenCode runtime). Binding to a
    // model that exists nowhere would leave every run dead-on-arrival; the
    // configuration fails closed instead of silently substituting.
    const existenceError = await modelExistenceError(providerId, modelId);
    if (existenceError !== null) {
      return { aiConfig: null, error: existenceError };
    }
    return { aiConfig: { providerId, modelId, ...(credentialId.length > 0 ? { credentialId } : {}) }, error: null };
  };

  /** Model-existence check backed by the real catalogue / runtime, never guesswork. */
  const modelExistenceError = async (providerId: string, modelId: string): Promise<string | null> => {
    if (providerId === 'opencode') {
      const openCode = providerManager.getOpenCodeProvider();
      if (openCode === null) {
        return 'The OpenCode execution layer is not wired in this build; no OpenCode models are bindable.';
      }
      if (!openCode.opencodeRuntime.hasModel('opencode', modelId)) {
        return `Model "${modelId}" is not present in the real OpenCode catalogue. Select a model the runtime actually exposes; nothing was substituted.`;
      }
      return null;
    }
    if (providerId === 'local') {
      // Local model presence is proven live when the run actually resolves
      // (runtimes add/drop models at any time); the bind is never refused here.
      return null;
    }
    try {
      const entry = await modelCatalogue.getModel(providerId, modelId);
      if (entry === null) {
        return `Model "${modelId}" is not present in the catalogue for provider "${providerId}". Select a model the catalogue actually exposes; nothing was substituted.`;
      }
      return null;
    } catch {
      return `The model catalogue could not be checked for provider "${providerId}". Retry once the catalogue is reachable.`;
    }
  };

  /** The project's stored AI config, or null. */
  const aiConfigOf = (project: Artifact): { providerId: string; modelId: string; credentialId?: string } | null => {
    const stored = project.attributes['projectConfig'] as { aiConfig?: unknown } | undefined;
    const cfg = stored?.aiConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    const rec = cfg as Record<string, unknown>;
    if (typeof rec['providerId'] !== 'string' || typeof rec['modelId'] !== 'string') return null;
    const credentialId = typeof rec['credentialId'] === 'string' ? rec['credentialId'] : undefined;
    return { providerId: rec['providerId'], modelId: rec['modelId'], ...(credentialId ? { credentialId } : {}) };
  };

  /** Persisted config-version metadata of the project's AI config, or null. */
  const aiConfigMetaOf = (project: Artifact): { configVersion: number } | null => {
    const stored = project.attributes['projectConfig'] as { aiConfig?: unknown } | undefined;
    const cfg = stored?.aiConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    const rec = cfg as Record<string, unknown>;
    if (typeof rec['providerId'] !== 'string' || typeof rec['modelId'] !== 'string') return null;
    const configVersion = typeof rec['configVersion'] === 'number' ? (rec['configVersion'] as number) : 1;
    return { configVersion };
  };

  /**
   * Auto-init: after creating a project WITH an AI configuration, the first
   * in-scope stage (discovery) runs immediately through the project's
   * provider/model IF the user holds a credential that really verifies.
   * Otherwise nothing is fabricated - Discovery stays PENDING and the
   * workspace prompts an explicit RUN, where upstream failures are honest.
   */
  const autoInitDiscovery = async (
    project: Artifact,
    user: string,
    aiConfig: { providerId: string; modelId: string },
  ): Promise<void> => {
    try {
      const mode = String(project.attributes['mode']);
      const stagesForMode = (PROJECT_MODE_STAGES as Record<string, { stageId: string; label: string; inScope: boolean }[]>)[mode];
      const discovery = stagesForMode?.find((s) => s.stageId === 'discovery');
      if (discovery === undefined || !discovery.inScope) return;
      const fresh = result.registry === undefined ? undefined : await result.registry.requireProject(project.id);
      if (fresh === undefined || projectOwnerId(fresh) !== user || isProjectDeleted(fresh)) return;
      const execution = await providerManager.getExecutionRouterFor(user, aiConfig.providerId, aiConfig.modelId);
      if (execution === null) return; // no verified credential - nothing fabricated
      const taskType: AiTaskType = STAGE_TASK_TYPES['discovery'] ?? 'DISCOVERY';
      const startedAt = Date.now();
      let completion: AiCompletionResponse;
      try {
        completion = await execution.router.complete({
          taskType,
          model: execution.modelId,
          messages: [
            {
              role: 'system',
              content:
                'You are the Blueprint-First project engine. Produce a concrete, honest deliverable for the requested lifecycle stage based only on the project information given. Do not fabricate results that were not produced.',
            },
            {
              role: 'user',
              content: `Project: ${fresh.title}\nVision: ${fresh.description}\nStage: Discovery\n\nProduce the Discovery deliverable for this project.`,
            },
          ],
        });
      } catch {
        return; // the explicit RUN surfaces the upstream failure honestly
      }
      const latencyMs = Date.now() - startedAt;
      const now = new Date().toISOString();
      const evidenceRecord = await result.evidence.append({
        kind: 'external-response',
        summary: `Stage "Discovery" auto-initialized via ${completion.providerId}/${completion.modelId} for project ${project.id} (${latencyMs}ms).`,
        artifactIds: [project.id],
        payloadRef: sha256(completion.content),
        producer: { kind: 'ai', id: completion.providerId, modelId: completion.modelId },
      });
      const aiOutputs =
        typeof fresh.attributes['aiOutputs'] === 'object' && fresh.attributes['aiOutputs'] !== null
          ? (fresh.attributes['aiOutputs'] as Record<string, unknown>)
          : {};
      const stagesRun = (fresh.attributes['stages'] as readonly { stageId: string }[] | undefined) ?? [];
      if (stagesRun.some((r) => r.stageId === 'discovery')) return;
      const updated = await result.services.store.update(fresh.id, fresh.version, (draft) => ({
        ...draft,
        attributes: {
          ...draft.attributes,
          stages: [...stagesRun, { stageId: 'discovery', label: discovery.label, at: now, recordedBy: user, status: 'EXECUTED', providerId: completion.providerId, modelId: completion.modelId }],
          aiOutputs: {
            ...aiOutputs,
            discovery: {
              providerId: completion.providerId,
              modelId: completion.modelId,
              content: completion.content,
              latencyMs,
              at: now,
              evidenceId: evidenceRecord.id,
            },
          },
        },
      }));
      await durableProjects.capture(updated);
    } catch {
      // Auto-init is best-effort; the explicit RUN remains the source of truth.
    }
  };

  app.post('/api/projects', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const body = req.body as { name?: unknown; vision?: unknown; mode?: unknown; visionDocumentId?: unknown; providerId?: unknown; modelId?: unknown; credentialId?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 64) {
      res.status(400).json({ error: 'Project name must be 2-64 characters.' });
      return;
    }
    const vision = typeof body.vision === 'string' ? body.vision.trim() : '';
    if (vision.length < 10) {
      res.status(400).json({ error: 'Vision must be at least 10 characters.' });
      return;
    }
    const mode = typeof body.mode === 'string' ? body.mode : 'full-product';
    if (!(PROJECT_MODES as readonly string[]).includes(mode)) {
      res.status(400).json({ error: `Unknown project mode "${mode}".` });
      return;
    }
    // Per-project AI configuration: provider/model (+ optional credential) are
    // bound to THIS project, not to the account. The provider must be wired
    // and the model must really exist.
    const { aiConfig, error: aiError } = await aiConfigFromBody(body, user);
    if (aiError !== null) {
      res.status(400).json({ error: aiError });
      return;
    }
    // Optional Stage-7 wiring: if the client already sent the vision through
    // /api/chat/ingest and got back a document reference, attach it to the
    // project config so the project's intent record points at the document
    // rather than copying its bytes. Owner-scoped: the doc must belong to
    // this user, otherwise we return 400 (it cannot be linked).
    let visionDocumentRef: DocumentRef | null = null;
    const visionDocumentId = typeof body.visionDocumentId === 'string' ? body.visionDocumentId : '';
    if (visionDocumentId.length > 0) {
      try {
        const docView = documentStore.getView(user, visionDocumentId, { full: true });
        if (docView.content !== undefined) {
          visionDocumentRef = {
            id: docView.id,
            ownerId: docView.ownerId,
            charLength: docView.charLength,
            byteLength: docView.byteLength,
            preview: docView.preview,
            contentHash: sha256(docView.content),
            createdAt: docView.createdAt,
          };
        }
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          res.status(400).json({ error: 'visionDocumentId refers to a document that does not exist or belongs to another account.' });
          return;
        }
        throw error;
      }
    }
    const account = req.account;
    try {
      const project = await result.registry.createProject({
        title: name,
        description: vision,
        mode: mode as ProjectMode,
        owner: { userId: user, label: account !== undefined ? account.displayName ?? account.username : user },
        actor: { kind: 'human', id: user },
        scope: [name],
        config: { vision, source: 'nexona-web', ...(visionDocumentRef ? { visionDocument: visionDocumentRef } : {}), ...(aiConfig !== null ? { aiConfig } : {}) },
      });
      // Creating a project records a PROJECT artifact; it does NOT fabricate
      // a pipeline run, so the discovery artifact count is honestly zero.
      await durableProjects.capture(project);

      // Auto-init: the pipeline starts immediately when the project declares
      // an AI configuration (Discovery runs through the real adapter when the
      // user's credential really verifies; nothing is fabricated otherwise).
      if (aiConfig !== null) {
        void autoInitDiscovery(project, user, aiConfig);
      }

      res.status(201).json({
        project: projectSummary(project),
        aiConfig,
        summary: {
          discoveryArtifacts: 0,
          message: aiConfig !== null
            ? `Project created with AI configuration (${aiConfig.providerId} / ${aiConfig.modelId}). Auto-initialization started â€” if no verified credential is stored, Discovery runs on the first explicit RUN.`
            : 'Project created as a structured PROJECT artifact. Run lifecycle stages from the project page.',
        },
      });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const deleted = await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: { ...draft.attributes, deleted: true, deletedAt: new Date().toISOString() },
    }));
    await durableProjects.capture(deleted);
    await result.evidence.append({
      kind: 'inspection',
      summary: `Project ${project.id} deleted by ${user}.`,
      artifactIds: [project.id],
      producer: { kind: 'system', id: 'web-project-api' },
    });
    res.status(204).end();
  });

  app.post('/api/projects/:id/run/:stageId', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const stageId = req.params['stageId']!;
    // Optional composer instruction: recorded on the stage ledger and, on the
    // real-execution path, included verbatim in the prompt sent to the model.
    const body = (req.body ?? {}) as { instruction?: unknown };
    const instruction =
      typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 8000) : '';
    const mode = String(project.attributes['mode']);
    const stagesForMode = (PROJECT_MODE_STAGES as Record<string, { stageId: string; label: string; inScope: boolean }[]>)[mode];
    if (stagesForMode === undefined) {
      res.status(409).json({ error: `Unknown mode "${mode}" on this project.` });
      return;
    }
    const stage = stagesForMode.find((s) => s.stageId === stageId);
    if (stage === undefined) {
      res.status(400).json({ error: `Unknown stage "${stageId}".` });
      return;
    }
    if (!stage.inScope) {
      res.status(409).json({ error: `Stage "${stage.label}" is OUT OF SCOPE for mode "${mode}". Out-of-scope stages are never falsely run.` });
      return;
    }
    const stagesRun = (project.attributes['stages'] as readonly { stageId: string; at: string; recordedBy: string }[] | undefined) ?? [];
    if (stagesRun.some((r) => r.stageId === stageId)) {
      res.status(409).json({ error: `Stage "${stage.label}" has already been recorded for this project.` });
      return;
    }
    // Execution resolution: ONLY the project's own authoritative AI configuration
    // (provider + model bound through the project AI MODEL control) can drive a
    // run. There is no fallback to a global/window selection: running a stage
    // with anything other than the project's provider/model is silent
    // substitution, which the architecture forbids (Â§3.3 ONE authoritative
    // configuration). The route exists only when the credential REALLY verifies;
    // otherwise the stage is checkpointed honestly below.
    const projectAiConfig = aiConfigOf(project);
    const execution = projectAiConfig !== null
      ? await providerManager.getExecutionRouterFor(user, projectAiConfig.providerId, projectAiConfig.modelId)
      : null;
    // No verified model â†’ record the lifecycle checkpoint honestly, without
    // fabricating an AI run. When the user HAS a verified selection we really
    // execute the stage through that provider/model (below).
    if (execution === null) {
      const now = new Date().toISOString();
      const nextStages = [...stagesRun, { stageId, label: stage.label, at: now, recordedBy: user, status: 'RECORDED', ...(instruction ? { instruction } : {}) }];
      const recorded = await result.services.store.update(project.id, project.version, (draft) => ({
        ...draft,
        attributes: { ...draft.attributes, stages: nextStages },
      }));
      await durableProjects.capture(recorded);
      const bindingNote =
        projectAiConfig === null
          ? 'no AI model is configured for this project'
          : `the bound ${projectAiConfig.providerId}/${projectAiConfig.modelId} is not verified for this account`;
      await result.evidence.append({
        kind: 'inspection',
        summary: `Stage "${stage.label}" checkpoint for project ${project.id} by ${user}: ${bindingNote}; the stage was NOT executed and nothing was fabricated. Set the AI model (AI MODEL control) to enable real execution.`,
        artifactIds: [project.id],
        producer: { kind: 'system', id: 'web-project-api' },
      });
      res.json({
        projectId: project.id,
        stageId,
        label: stage.label,
        status: 'RECORDED',
        at: now,
        summary: `Stage "${stage.label}" recorded on the project lifecycle ledger as a checkpoint only (${bindingNote}). No provider request was made.`,
      });
      return;
    }
    // Real execution: the selected provider sends the actual request, the
    // selected model generates the actual response, and that response is
    // recorded verbatim as evidence + project output. Upstream failures are
    // honest: the stage is NOT marked completed and the error is returned.
    const taskType: AiTaskType = STAGE_TASK_TYPES[stageId] ?? 'BUILD';
    const startedAt = Date.now();
    let completion: AiCompletionResponse;
    try {
      completion = await execution.router.complete({
        taskType,
        model: execution.modelId,
        messages: [
          {
            role: 'system',
            content:
              'You are the Blueprint-First project engine. Produce a concrete, honest deliverable for the requested lifecycle stage based only on the project information given. Do not fabricate results that were not produced.',
          },
          {
            role: 'user',
            content: `Project: ${project.title}\nVision: ${project.description}\nStage: ${stage.label}\n\n${instruction ? `User instruction for this run: ${instruction}\n\n` : ''}Produce the ${stage.label} deliverable for this project.`,
          },
        ],
      });
    } catch (error) {
      jsonError(res, 502, error);
      return;
    }
    const latencyMs = Date.now() - startedAt;
    const now = new Date().toISOString();
    const evidenceRecord = await result.evidence.append({
      kind: 'external-response',
      summary: `Stage "${stage.label}" executed via ${completion.providerId}/${completion.modelId} for project ${project.id} (${latencyMs}ms).`,
      artifactIds: [project.id],
      payloadRef: sha256(completion.content),
      producer: { kind: 'ai', id: completion.providerId, modelId: completion.modelId },
    });
    const aiOutputs =
      typeof project.attributes['aiOutputs'] === 'object' && project.attributes['aiOutputs'] !== null
        ? (project.attributes['aiOutputs'] as Record<string, unknown>)
        : {};
    const nextStages = [
      ...stagesRun,
      {
        stageId,
        label: stage.label,
        at: now,
        recordedBy: user,
        status: 'EXECUTED',
        providerId: completion.providerId,
        modelId: completion.modelId,
        ...(instruction ? { instruction } : {}),
      },
    ];
    const executed = await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: {
        ...draft.attributes,
        stages: nextStages,
        aiOutputs: {
          ...aiOutputs,
          [stageId]: {
            providerId: completion.providerId,
            modelId: completion.modelId,
            content: completion.content,
            latencyMs,
            at: now,
            evidenceId: evidenceRecord.id,
          },
        },
      },
    }));
    await durableProjects.capture(executed);
    res.json({
      projectId: project.id,
      stageId,
      label: stage.label,
      status: 'EXECUTED',
      at: now,
      providerId: completion.providerId,
      modelId: completion.modelId,
      latencyMs,
      evidenceId: evidenceRecord.id,
      content: completion.content,
      summary: `Stage "${stage.label}" executed via ${completion.providerId}/${completion.modelId} (${latencyMs}ms).`,
    });
  });

  app.post('/api/projects/:id/approve', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const mode = String(project.attributes['mode']);
    const stagesForMode = (PROJECT_MODE_STAGES as Record<string, { stageId: string; label: string; inScope: boolean }[]>)[mode];
    if (stagesForMode === undefined) {
      res.status(409).json({ error: `Unknown mode "${mode}" on this project.` });
      return;
    }
    const blueprintStage = stagesForMode.find((s) => s.stageId === 'blueprint');
    if (blueprintStage === undefined || !blueprintStage.inScope) {
      res.status(409).json({ error: `Blueprint approval is OUT OF SCOPE for mode "${mode}".` });
      return;
    }
    if (project.attributes['approval'] !== undefined) {
      res.status(409).json({ error: 'Blueprint for this project has already been approved.' });
      return;
    }
    // The approval gate acts ONLY on an EXECUTED blueprint. A recorded lifecycle
    // checkpoint (no verified AI run) does not satisfy it: there is nothing yet
    // to approve, so the gate fails closed.
    const stagesRun = (project.attributes['stages'] as readonly { stageId: string; status?: string }[] | undefined) ?? [];
    const blueprintRun = stagesRun.find((r) => r.stageId === 'blueprint');
    if (blueprintRun === undefined || blueprintRun.status !== 'EXECUTED') {
      res.status(409).json({
        error:
          'Approve the Blueprint stage only after it is EXECUTED by a verified AI run. A recorded checkpoint does not satisfy the approval gate.',
      });
      return;
    }
    // Level-1a independent-approver gate: when a structured BLUEPRINT artifact
    // exists, approval is a REAL judgment over it (exact coverage, verified
    // design, independent human approver). The web surface only materializes
    // one when the job engine produced it; otherwise the product-owner gate
    // acts on the executed blueprint output below.
    const blueprintArtifacts = await result.services.store.list({ types: ['BLUEPRINT'], projectId: project.id });
    const blueprintArtifact = blueprintArtifacts[0];
    if (blueprintArtifact !== undefined) {
      const decision = await evaluateApproval(result.services, blueprintArtifact.id, { kind: 'human', id: user });
      if (!decision.approved) {
        res.status(409).json({ error: `Blueprint approval gate failed: ${decision.reasons.join('; ')}.` });
        return;
      }
    }
    const now = new Date().toISOString();
    const approved = await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: { ...draft.attributes, approval: { status: 'APPROVED', approvedAt: now, approvedBy: user } },
    }));
    await durableProjects.capture(approved);
    await result.evidence.append({
      kind: 'review',
      summary: `Blueprint for project ${project.id} approved by ${user} at ${now}.`,
      artifactIds: [project.id],
      producer: { kind: 'verifier', id: user },
    });
    res.json({
      projectId: project.id,
      status: 'APPROVED',
      approvedAt: now,
      approvedBy: user,
      summary: 'Blueprint approved; in-scope implementation stages may proceed.',
    });
  });

  // --- roadmap ---------------------------------------------------------------
  app.get('/api/roadmap', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ roadmap: ROADMAP });
  });

  // --- caps (capabilities available vs not exercised) -------------------------
  app.get('/api/caps', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ availableNotExercised: AVAILABLE_NOT_EXERCISED });
  });

  // --- Stage 8: Blueprint-First Workspace --------------------------------------
  // Each stage endpoint reads from a real backend result that the demo
  // pipeline populates. When the test harness or a fresh server has not yet
  // run the pipeline, those fields are missing. We must surface honest
  // PENDING / "engine not yet run" payloads rather than 500ing, so the
  // per-stage views can render the empty initial state and the user can see
  // a real, accurate page.

  const PENDING_DISCOVERY = {
    status: 'PENDING',
    error: null,
    baseline: null,
    artifactIds: [],
    findingIds: [],
    diff: null,
    uncertainties: null,
  };
  const PENDING_EXPANSION = {
    status: 'PENDING',
    pages: [],
    tally: null,
    artifactIds: [],
    fullDepartment: null,
  };
  const PENDING_TWIN = {
    projectId: null,
    blueprintId: null,
    twinArtifactId: null,
    pages: [],
    elementCount: 0,
    boundElementCount: 0,
    gapCount: 0,
    evidenceCount: 0,
    built: false,
    note: null,
  };
  const PENDING_DESIGN = {
    status: 'PENDING',
    blueprintId: null,
    artifactIds: [],
    approval: null,
  };
  const PENDING_COUNCIL = { subject: null, verdict: 'PENDING', seats: null };
  const PENDING_VERIFICATION = {
    masterPassed: null,
    subjectsAudited: 0,
    blockingFails: 0,
    unresolvedInconclusive: 0,
    notes: null,
    closureArtifactCount: 0,
    rollup: null,
    reports: 0,
  };
  const PENDING_TESTING = {
    status: 'PENDING',
    executed: 0,
    testIds: [],
    reportId: null,
    evidenceId: null,
    advancedToTestVerified: null,
    docHalts: null,
    boss: null,
    auditor: null,
  };
  const PENDING_OPS = {
    status: 'PENDING',
    executed: 0,
    deployIds: [],
    manifestId: null,
    evidenceId: null,
    advancedToDeployedVerified: null,
    docHalts: null,
    boss: null,
    auditor: null,
  };
  const PENDING_TELEMETRY = { observation: null, sourceKind: null };
  const PENDING_CONTINUOUS = {
    finalVerdict: 'PENDING',
    rationale: null,
    workerReport: null,
    bossDecision: null,
    auditorDecision: null,
    materialization: null,
  };
  const PENDING_RECURSION = {
    classification: 'PENDING',
    allRemediated: null,
    changeCount: 0,
    baseIds: [],
  };
  const PENDING_SAFE_CHANGE = {
    status: 'PENDING',
    reason: null,
    trail: null,
    materialization: null,
    finalDocState: null,
  };
  const PENDING_PEO = {
    source: null,
    authorized: null,
    escalated: null,
    rationale: null,
    watch: null,
    impact: null,
    change: null,
    candidate: null,
  };
  const PENDING_CERT = { status: 'PENDING', presentDimensions: [], missingDimensions: [], requiredDimensions: [], certified: null, certifiable: null };

  // --- project / discovery ----------------------------------------------------
  app.get('/api/discovery', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.discovery) {
      res.json(PENDING_DISCOVERY);
      return;
    }
    res.json({
      status: result.discovery.status,
      error: result.discovery.error ?? null,
      baseline: result.baseline,
      artifactIds: result.discovery.artifactIds,
      findingIds: result.discovery.findingIds ?? [],
      diff: result.discovery.diff ?? null,
      uncertainties: result.discovery.uncertainties ?? null,
    });
  });

  // --- Â§0.6 Recursive Page Expansion (Level 3 Pass 10) -----------------------
  app.get('/api/expansion', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.fullDepartment) {
      res.json(PENDING_EXPANSION);
      return;
    }
    const expansion = result.fullDepartment.expansion;
    res.json({
      status: 'READY',
      pages: expansion.pages.map((p) => ({
        pageId: p.pageId,
        pageKey: p.pageKey,
        title: p.title,
        allLayersDetermined: p.allLayersDetermined,
        omissions: p.omissions,
        layers: p.layers.map((l) => ({
          layer: l.layer,
          name: l.name,
          status: l.status,
          note: l.note,
          artifactIds: l.artifactIds,
        })),
      })),
      tally: expansion.tally,
      artifactIds: expansion.artifactIds,
      fullDepartment: {
        contentAdded: result.fullDepartment.contentAdded.length,
        edgeStatesAdded: result.fullDepartment.edgeStatesAdded.length,
        risks: result.fullDepartment.risks.length,
        audited: result.fullDepartment.audited,
        artifactIds: result.fullDepartment.artifactIds,
      },
    });
  });

  // --- Interactive Digital Twin (Â§1.4) ---------------------------------------
  app.get('/api/twin', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.twin) {
      res.json(PENDING_TWIN);
      return;
    }
    res.json(result.twin);
  });

  // --- design / engineering artifacts -----------------------------------------
  app.get('/api/design', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.design) {
      res.json(PENDING_DESIGN);
      return;
    }
    res.json({
      status: result.design.status,
      blueprintId: result.design.blueprintId ?? null,
      artifactIds: result.design.artifactIds,
      approval: result.approval ?? null,
    });
  });

  // --- multi-perspective reasoning council ------------------------------------
  app.get('/api/council', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.council) {
      res.json(PENDING_COUNCIL);
      return;
    }
    res.json({
      subject: result.council.subject ?? result.design?.blueprintId ?? null,
      verdict: result.council.verdict,
      seats: result.council.seats ?? null,
    });
  });

  // --- master verification ----------------------------------------------------
  app.get('/api/verification', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.master) {
      res.json(PENDING_VERIFICATION);
      return;
    }
    res.json({
      masterPassed: result.master.masterPassed,
      subjectsAudited: result.master.subjectCount,
      blockingFails: result.master.blockingFails,
      unresolvedInconclusive: result.master.unresolvedInconclusive,
      notes: result.master.notes,
      closureArtifactCount: (result.closureIds ?? []).length,
      rollup: result.master.rollup,
      reports: Object.keys(result.master.reports).length,
    });
  });

  // --- acceptance testing ------------------------------------------------------
  app.get('/api/testing', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.testRun) {
      res.json(PENDING_TESTING);
      return;
    }
    res.json({
      status: result.testRun.status,
      executed: result.testRun.executed,
      testIds: result.testRun.testIds,
      reportId: result.testRun.reportId ?? null,
      evidenceId: result.testRun.evidenceId ?? null,
      advancedToTestVerified: result.testRun.advancedToTestVerified,
      docHalts: result.testRun.docHalts,
      boss: result.testRun.boss,
      auditor: result.testRun.auditor,
    });
  });

  // --- deployment --------------------------------------------------------------
  app.get('/api/deployment', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.opsRun) {
      res.json(PENDING_OPS);
      return;
    }
    res.json({
      status: result.opsRun.status,
      executed: result.opsRun.executed,
      deployIds: result.opsRun.deployIds,
      manifestId: result.opsRun.manifestId ?? null,
      evidenceId: result.opsRun.evidenceId ?? null,
      advancedToDeployedVerified: result.opsRun.advancedToDeployedVerified,
      docHalts: result.opsRun.docHalts,
      boss: result.opsRun.boss,
      auditor: result.opsRun.auditor,
    });
  });

  // --- runtime telemetry --------------------------------------------------------
  app.get('/api/telemetry', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.telemetryObservation || !result.telemetrySource) {
      res.json(PENDING_TELEMETRY);
      return;
    }
    res.json({
      observation: result.telemetryObservation,
      sourceKind: result.telemetrySource.kind,
    });
  });

  // --- continuous engineering ----------------------------------------------------
  app.get('/api/continuous', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.contRun) {
      res.json(PENDING_CONTINUOUS);
      return;
    }
    res.json({
      finalVerdict: result.contRun.finalVerdict,
      rationale: result.contRun.rationale,
      workerReport: result.contRun.workerReport,
      bossDecision: result.contRun.bossDecision,
      auditorDecision: result.contRun.auditorDecision,
      materialization: result.contRun.materialization ?? null,
    });
  });

  // --- recursion -----------------------------------------------------------------
  app.get('/api/recursion', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.recursionResult) {
      res.json(PENDING_RECURSION);
      return;
    }
    res.json({
      classification: result.recursionResult.classification,
      allRemediated: result.recursionResult.allRemediated,
      changeCount: result.recursionResult.changes.length,
      baseIds: result.recursionResult.changes.map((c) => c.drift.artifactId),
    });
  });

  // --- safe change ----------------------------------------------------------------
  app.get('/api/safe-change', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.changeResult) {
      res.json(PENDING_SAFE_CHANGE);
      return;
    }
    const change = result.changeResult;
    const materialization =
      change.status === 'AUTHORIZED_AND_APPLIED' || change.status === 'AUTHORIZED_BUT_NOT_APPLIED'
        ? change.materialization
        : null;
    res.json({
      status: change.status,
      reason: change.status === 'REJECTED' ? change.reason : null,
      trail: change.trail,
      materialization,
      finalDocState: result.finalArtifact ? (docStateOf(result.finalArtifact) ?? null) : null,
    });
  });

  // --- PEO (Permanent Engineering Organization) -----------------------------------
  app.get('/api/peo', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.peoResult) {
      res.json(PENDING_PEO);
      return;
    }
    res.json({
      source: result.peoResult.source,
      authorized: result.peoResult.authorized,
      escalated: result.peoResult.escalated,
      rationale: result.peoResult.rationale,
      watch: result.peoResult.watch,
      impact: result.peoResult.impact,
      change: result.peoResult.change,
      candidate: result.peoCandidate ?? null,
    });
  });

  // --- artifacts inventory --------------------------------------------------------
  app.get('/api/artifacts', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const artifacts = await services.store.list();
    res.json({
      count: artifacts.length,
      artifacts: artifacts.map(artifactSummary),
    });
  });

  app.get('/api/artifacts/:id', async (req, res) => {
    const artifact = await services.store.get(req.params.id);
    if (artifact === null) {
      res.status(404).json({ error: 'not-found', id: req.params.id });
      return;
    }
    res.json(artifact);
  });

  // --- dependency map --------------------------------------------------------------
  app.get('/api/dependency-map', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const edges = services.graph.allEdges().map((e) => ({
      from: e.from,
      relation: e.relation,
      to: e.to,
    }));
    res.json({ nodeCount: result.stats.nodeCount, edgeCount: result.stats.edgeCount, edges });
  });

  // --- lineage / provenance --------------------------------------------------------
  app.get('/api/lineage', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({
      firstPageId: result.firstPageId,
      links: result.lineage.links,
      completeThrough: result.lineage.completeThrough,
      gaps: result.lineage.gaps,
    });
  });

  // --- evidence / certification detail ------------------------------------------------
  app.get('/api/evidence', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const all = await result.evidence.all();
    res.json({ count: all.length, entries: all });
  });

  app.get('/api/certification', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!result.certification) {
      res.json(PENDING_CERT);
      return;
    }
        const cert = result.certification;
    res.json({
      certified: cert.certified,
      reasons: cert.reasons,
      stampedArtifactIds: cert.stampedArtifactIds,
      evidenceId: cert.evidenceId ?? null,
      confidence: cert.confidence ?? null,
      certifiable: cert.certified ? true : false,
      status: cert.certified === true ? 'CERTIFIED' : 'BLOCKED',
      trace: result.trace,
    });
  });

  // --- traceability ----------------------------------------------------------------
  app.get('/api/traceability', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json(result.trace);
  });

  // --- model selector (catalogue + credentials + selection) -------------------------
  // Honest-surface rules: a catalogue entry proves a model EXISTS; `verified`
  // proves ACCESSIBLE via a real connection test. Credentials are accepted once
  // and never echoed; per-user identity comes exclusively from the verified
  // session cookie â€” a client can never assert an identity via a header.

  const jsonError = (res: express.Response, status: number, error: unknown): void => {
    // Error messages never contain secrets (enforced by the core error types).
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };

  /** The authenticated account's username, or null when anonymous. */
  const userIdOf = (req: express.Request): string | null => req.account?.username ?? null;

  const ACCESS_CATEGORIES: readonly ModelAccessCategory[] = [
    'free_no_api_key',
    'free_api_key_required',
    'free_oauth',
    'platform_provided',
    'paid',
    'local',
  ];

  /** Stage â†’ AI task type for real stage execution (Â§project lifecycle). */
  const STAGE_TASK_TYPES: Readonly<Record<string, AiTaskType>> = {
    discovery: 'DISCOVERY',
    design: 'DESIGN',
    'design-verification': 'VERIFICATION',
    blueprint: 'DESIGN',
    architecture: 'BUILD',
    implementation: 'BUILD',
    testing: 'VERIFICATION',
    verification: 'VERIFICATION',
    deployment: 'OPERATIONS',
    operations: 'OPERATIONS',
    maintenance: 'OPERATIONS',
    'continuous-improvement': 'OPERATIONS',
  };

  // â”€â”€ working execution foundation (Layers 1-3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Real environments, a durable event bus, and the Worker Runtime scheduler are
  // constructed at boot and drive genuine artifacts (files, processes, git,
  // events, jobs). Nothing here is simulated; simulations are explicitly absent.

  const raceAbort = <T>(signal: AbortSignal, promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      // The inner promise's outcome must ALWAYS be consumed, including when the
      // signal is already aborted. Returning early in that case leaves the inner
      // promise with no handler, so its eventual rejection surfaces as an
      // unhandled rejection and is attributed to whatever happens to be running.
      let settled = false;
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
      if (signal.aborted) {
        settled = true;
        reject(new Error('aborted'));
        return;
      }
      function onAbort(): void {
        if (settled) return;
        settled = true;
        reject(new Error('aborted'));
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });

  /** Classifies an execution failure (LAW - FAILURE CLASSIFICATION) so recovery
   *  and Continuous Learning can act on the ACTUAL condition, never a guess.
   *  The returned value is always a member of the governing FailureClass set. */
  const classifyExecutionError = (message: string, adapterKind: 'local-workspace' | 'daytona' | null): FailureClass => {
    const m = message.toLowerCase();
    if (adapterKind === 'daytona' || m.includes('daytona')) return 'daytona';
    if (m.includes('cline')) return 'cline';
    if (m.includes('opencode')) return 'opencode';
    if (m.includes('aborted by caller') || m.includes('interrupted before completion')) return 'unknown';
    if (m.includes('timed out') || m.includes('timeout') || m.includes('exceeded')) return 'timeout';
    if (m.includes('hang') || m.includes('stalled') || m.includes('no progress')) return 'hang';
    if (m.includes('401') || m.includes('403') || m.includes('unauthorized') || m.includes('invalid_api_key') || m.includes('api key')) return 'authentication';
    if (m.includes('429') || m.includes('rate limit') || m.includes('rate_limit') || m.includes('quota')) return 'rate-limit';
    if (m.includes('econnrefused') || m.includes('enetunreach') || m.includes('enotfound') || m.includes('eai_again') || m.includes('fetch failed') || m.includes('network error')) return 'network';
    if (m.includes('model') && (m.includes('not exist') || m.includes('unavailable') || m.includes('does not support') || m.includes('not present') || m.includes('not found') || m.includes('unknown model'))) return 'model';
    if (m.includes('provider') && (m.includes('unavailable') || m.includes('not exist') || m.includes('not registered') || m.includes('unknown provider'))) return 'provider';
    if (m.includes('spawn') || m.includes('command failed') || m.includes('exit code') || m.includes('process')) return 'process';
    if (m.includes('dependency') || m.includes('npm') || m.includes('module not found') || m.includes('cannot find module')) return 'dependency';
    if (m.includes('syntaxerror') || m.includes('typeerror') || m.includes('referenceerror') || m.includes('build failed') || m.includes('compile')) return 'code';
    if (m.includes('workspace') || m.includes('environment') || m.includes('provisioning')) return 'environment';
    if (m.includes('security') || m.includes('permission denied') || m.includes('forbidden')) return 'security';
    if (m.includes('requirement') || m.includes('not specified')) return 'requirement';
    if (m.includes('tool') && (m.includes('failed') || m.includes('rejected'))) return 'tool';
    return 'unknown';
  };

  /** Real Worker Runtime executor: stage â†’ verified provider/model â†’ model call.
   *  No verified credential means the job fails honestly (never fabricated). */
  const jobExecutor: JobExecutor = async (job, context) => {
    const startedAt = Date.now();
    // A governed job runs ONLY through the AI identity it was bound with at
    // enqueue time (the project's authoritative configuration). There is no
    // fallback to a user/global selection: substituting another provider/model
    // is silent substitution, which the architecture forbids.
    const execution =
      job.ai !== null
        ? await providerManager.getExecutionRouterFor(job.ownerId, job.ai.providerId, job.ai.modelId)
        : null;
    if (execution === null) {
      return {
        ok: false,
        summary: 'No verified AI credential is bound to this stage; nothing was falsified.',
        retryable: false,
        error: 'NO_VERIFIED_CREDENTIAL',
      };
    }
    context.reportProgress?.({ kind: 'api', operation: `execution.verified.${execution.providerId}`, ok: true });
    let project: Artifact | null = null;
    if (result.registry !== undefined) {
      try {
        project = await result.registry.requireProject(job.projectId);
      } catch {
        project = null;
      }
    }
    if (project === null) {
      return {
        ok: false,
        summary: `Project ${job.projectId} could not be resolved for stage "${job.stageKey}".`,
        retryable: false,
        error: 'PROJECT_NOT_FOUND',
      };
    }
    const taskType: AiTaskType = STAGE_TASK_TYPES[job.stageKey] ?? 'BUILD';

    /** The real task context handed to the worker (real project state only). */
    const contextLinesFor = (p: Artifact, stageKey: string): string => {
      const prior = p.attributes['aiOutputs'] as Record<string, { content?: string }> | undefined;
      const lines: string[] = [`Project: ${p.title}`, `Vision: ${p.description}`, `Stage: ${stageKey}`];
      for (const [k, v] of Object.entries(prior ?? {})) {
        if (typeof v?.content === 'string' && v.content !== '') {
          lines.push(`Previous ${k} output (truncated):`, v.content.slice(0, 4000));
        }
      }
      return lines.join('\n');
    };

    /**
     * Records the REAL Cline execution as durable evidence, including the actual
     * files and commands it produced in the real environment.
     */
    const recordClineEvidence = async (
      adapter: EnvAdapter,
      env: { id: string; adapterKind: string; workspaceRoot: string | null },
      run: { stdout: string; stderr: string; sessionId: string | null; durationMs: number },
      binding: { providerId: string; modelId: string; credentialId: string | null },
      boundJob: JobRecord,
    ): Promise<string> => {
      let artifactsTouched: string[] = [];
      try {
        const listing = await adapter.listFiles('');
        artifactsTouched = listing.map((e) => e.relPath);
      } catch {
        artifactsTouched = [];
      }
      return (await result.evidence.append({
        kind: 'command-output',
        summary:
          `Real Cline execution (${binding.providerId}/${binding.modelId}) ran in ${env.adapterKind} environment ${env.id}: ` +
          `${artifactsTouched.length} file(s) present, ${run.durationMs}ms.` +
          (run.sessionId !== null ? ` Cline session ${run.sessionId}.` : ''),
        artifactIds: [boundJob.projectId],
        payloadRef: sha256(`${run.stdout}\n${run.stderr}`),
        producer: { kind: 'ai', id: 'cline', modelId: binding.modelId },
      })).id;
    };

    const persistStage = async (input: {
      providerId: string;
      modelId: string;
      content: string;
      latencyMs: number;
      evidenceId: string;
      toolLog?: readonly { readonly tool: string; readonly ok: boolean }[];
      steps?: number;
      sessionIds?: readonly string[];
      envId?: string;
      adapterKind?: 'local-workspace' | 'daytona';
    }): Promise<void> => {
      const stagesRun = (project.attributes['stages'] as readonly { stageId: string }[] | undefined) ?? [];
      // Re-running an already-executed stage is a governed append, never a
      // silent discard: the new execution is recorded with its own evidence,
      // timestamp and identity, so no run is ever lost or faked. The latest
      // run of a stage shadows earlier ones in the derived `aiOutputs` view.
      const aiOutputs = (project.attributes['aiOutputs'] as Record<string, unknown> | undefined) ?? {};
      const updated = await result.services.store.update(project.id, project.version, (draft) => ({
        ...draft,
        attributes: {
          ...draft.attributes,
          stages: [
            ...stagesRun,
            {
              stageId: job.stageKey,
              label: job.label,
              at: new Date().toISOString(),
              recordedBy: job.ownerId,
              status: 'EXECUTED',
              providerId: input.providerId,
              modelId: input.modelId,
              // The session is BOUND to a specific real environment
              // (CLINE-DAYTONA BINDING): which env and which real backend.
              ...(input.envId !== undefined ? { envId: input.envId } : {}),
              ...(input.adapterKind !== undefined ? { adapterKind: input.adapterKind } : {}),
            },
          ],
          aiOutputs: {
            ...aiOutputs,
            [job.stageKey]: {
              providerId: input.providerId,
              modelId: input.modelId,
              content: input.content,
              latencyMs: input.latencyMs,
              at: new Date().toISOString(),
              evidenceId: input.evidenceId,
              ...(input.envId !== undefined ? { envId: input.envId } : {}),
              ...(input.adapterKind !== undefined ? { adapterKind: input.adapterKind } : {}),
              ...(input.toolLog !== undefined ? { toolLog: input.toolLog } : {}),
              ...(input.steps !== undefined ? { steps: input.steps } : {}),
              ...(input.sessionIds !== undefined ? { sessionIds: input.sessionIds } : {}),
            },
          },
        },
      }));
      await durableProjects.capture(updated);
    };

    // Layer 4: when the project has a READY workspace, the stage runs as a real
    // Cline-style agentic session - file/terminal/git tools against the real
    // environment, driven by the bound model via the TOOL_CALL protocol. The
    // model is never trusted to produce effects; every effect is executed for
    // real and its outcome is what travels back to the model.
    const readyEnv = await environments.findReady(job.ownerId, job.projectId);
    if (readyEnv !== null) {
      const agentAdapter = await environments.workspace(readyEnv.id, job.ownerId);
      if (agentAdapter !== null) {
        // â”€â”€ REAL CLINE EXECUTION (LAW - CLINE MUST BE INSTALLED AND
        // INTEGRATED) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // When the real Cline CLI is READY and a real workspace is attached,
        // the governed job is executed BY THE REAL CLINE BINARY inside that
        // real environment, using the project's own authoritative AI
        // configuration (same provider, same model, same user's credential).
        // Cline performs the engineering actions; the platform observes the real
        // files, commands and processes it produced.
        // The live capability decision is read from the maintained foundation
        // report (refreshed on a short TTL) rather than re-probing here: probing
        // a real CLI can take seconds, and a job must not pay that cost.
        const clineDecision = foundationReport.capabilities.find((c) => c.capability === 'cline');
        if (clineDecision?.status === 'READY' && readyEnv.workspaceRoot !== null) {
          const prep = await prepareClineAi({
            providerManager,
            clineRoot: clineRootDir(dataDir),
            ownerId: job.ownerId,
            providerId: execution.providerId,
            modelId: execution.modelId,
          });
          if (prep.ready && prep.binding !== null) {
            const dirs = clineProfileDirs(clineRootDir(dataDir), job.ownerId);
            const startedCline = Date.now();
            context.reportProgress?.({ kind: 'tool', tool: 'cline.auth', ok: true });
            const clineRun = await runClineTask({
              cwd: readyEnv.workspaceRoot,
              prompt: `${contextLinesFor(project, job.stageKey)}\n\n${job.instruction}`.trim(),
              binding: {
                projectId: job.projectId,
                ownerId: job.ownerId,
                jobId: job.id,
                envId: readyEnv.id,
                artifactScope: [`${job.stageKey}:${job.projectId}`],
              },
              providerId: prep.binding.providerId,
              modelId: prep.binding.clineModel,
              profileDirs: dirs,
              timeoutMs: 180_000,
              autoApprove: true,
              ...(context.signal !== undefined ? { signal: context.signal } : {}),
              ...(context.reportProgress !== undefined
                ? { reportProgress: (e: { kind: 'tool'; tool: string; ok: boolean }) => context.reportProgress?.(e) }
                : {}),
            });
            const clineLatencyMs = Date.now() - startedCline;
            // The result is the REAL Cline outcome. A failed run is classified
            // and reported honestly; it is never relabelled as success.
            if (clineRun.ok) {
              const evidenceId = await recordClineEvidence(
                agentAdapter,
                readyEnv,
                clineRun,
                prep.binding,
                job,
              );
              await persistStage({
                providerId: prep.binding.providerId,
                modelId: prep.binding.clineModel,
                content: clineRun.stdout,
                latencyMs: clineLatencyMs,
                evidenceId,
                envId: readyEnv.id,
                adapterKind: readyEnv.adapterKind,
                sessionIds: clineRun.sessionId !== null ? [clineRun.sessionId] : [],
              });
              return {
                ok: true,
                summary: `Real Cline execution completed in ${readyEnv.adapterKind} environment ${readyEnv.id}.`,
                providerId: prep.binding.providerId,
                modelId: prep.binding.clineModel,
                latencyMs: clineLatencyMs,
                evidenceId,
              };
            }
            return {
              ok: false,
              summary: clineRun.detail,
              retryable: clineRun.failureClass !== 'authentication',
              error: `CLINE_${(clineRun.failureClass ?? 'UNKNOWN').toUpperCase()}`,
              // 'cancelled' is a governed interruption, not a platform failure class.
              failureClass: clineRun.failureClass === 'cancelled'
                ? 'process'
                : clineRun.failureClass === 'none'
                  ? 'unknown'
                  : clineRun.failureClass,
            };
          }
          // The platform AI configuration could not be handed to Cline: the
          // stage falls through to the platform agentic path, and the reason is
          // reported rather than silently ignored.
          context.reportProgress?.({ kind: 'tool', tool: 'cline.unavailable', ok: false });
        }
        const contextLines: string[] = [`Project: ${project.title}`, `Vision: ${project.description}`];
        const priorOutputs = project.attributes['aiOutputs'] as Record<string, { content?: string }> | undefined;
        for (const [stageKey, output] of Object.entries(priorOutputs ?? {})) {
          if (typeof output?.content === 'string' && output.content !== '') {
            contextLines.push(`\n[${stageKey} prior output]\n${output.content.slice(0, 2000)}`);
          }
        }
        let sessionOutcome: Awaited<ReturnType<AgenticSession['run']>>;
        try {
          sessionOutcome = await raceAbort(
            context.signal,
            new AgenticSession({
              router: execution.router,
              taskType,
              model: execution.modelId,
              providerId: execution.providerId,
              goals: job.instruction !== '' ? `${job.stageKey} stage: ${job.instruction}` : `Produce the ${job.stageKey} deliverable for this project.`,
              context: contextLines.join('\n'),
              env: agentAdapter,
              signal: context.signal,
              //LAW - REAL PROGRESS ONLY / THREE-MINUTE HARD TIMEOUT (§54/§55):
              // a real model call against a real provider can run for minutes
              // while genuinely advancing. Forwarding the provider's own
              // advancement events to the supervisor is what keeps the hard
              // timeout meaningful - without it the supervisor sees silence and
              // terminates HEALTHY work as a false hang.
              ...(context.reportProgress !== undefined
                ? {
                    onProgress: (e: { kind: string; detail?: string }) =>
                      context.reportProgress?.({
                        kind: 'ai-step',
                        providerId: execution.providerId,
                        modelId: execution.modelId,
                        ...(e.detail !== undefined ? { operation: e.detail } : { operation: e.kind }),
                      }),
                  }
                : {}),
            }).run(),
          );
        } catch (error) {
          if (context.signal.aborted) {
            return { ok: false, summary: 'Agentic stage run interrupted before completion.', retryable: false, error: 'ABORTED' };
          }
          const message = error instanceof Error ? error.message : String(error);
          const classification = classifyExecutionError(message, readyEnv.adapterKind);
          context.reportProgress?.({ kind: 'transition', from: 'running', to: 'failed' });
          return { ok: false, summary: `${classification}: ${message}`, retryable: true, error: message, failureClass: classification };
        }
        const agentLatency = Date.now() - startedAt;
        const agentEvidence = await result.evidence.append({
          kind: 'external-response',
          summary: `Stage "${job.stageKey}" produced real workspace effects via an agentic session (${sessionOutcome.steps} model steps, ${sessionOutcome.toolCalls} tool executions) with ${sessionOutcome.providerId}/${sessionOutcome.modelId}.`,
          artifactIds: [job.projectId],
          payloadRef: sha256(sessionOutcome.finalText),
          producer: { kind: 'ai', id: sessionOutcome.providerId, modelId: sessionOutcome.modelId },
        });
        await persistStage({
          providerId: sessionOutcome.providerId,
          modelId: sessionOutcome.modelId,
          content: sessionOutcome.finalText,
          latencyMs: agentLatency,
          evidenceId: agentEvidence.id,
          toolLog: sessionOutcome.toolLog,
          steps: sessionOutcome.steps,
          envId: readyEnv.id,
          adapterKind: readyEnv.adapterKind,
          ...(sessionOutcome.sessionIds.length > 0 ? { sessionIds: sessionOutcome.sessionIds } : {}),
        });
        context.reportProgress?.({ kind: 'checkpoint', checkpointId: agentEvidence.id });
        context.reportProgress?.({ kind: 'ai-step', providerId: sessionOutcome.providerId, modelId: sessionOutcome.modelId });
        if (sessionOutcome.providerId === 'opencode' && sessionOutcome.sessionIds.length > 0) {
          await bus.publish({
            type: 'opencode.execution',
            tenantId: job.ownerId,
            projectId: job.projectId,
            jobId: job.id,
            ...(sessionOutcome.sessionIds[0] !== undefined ? { sessionId: sessionOutcome.sessionIds[0] } : {}),
            payload: {
              providerId: sessionOutcome.providerId,
              modelId: sessionOutcome.modelId,
              sessionIds: sessionOutcome.sessionIds,
              steps: sessionOutcome.steps,
              toolCalls: sessionOutcome.toolCalls,
              finishReason: sessionOutcome.ok ? 'stop' : 'error',
              mode: 'agentic',
            },
          });
        }
        return {
          ok: sessionOutcome.ok,
          summary: sessionOutcome.ok
            ? `Stage "${job.stageKey}" completed via an agentic session in the workspace (${sessionOutcome.toolCalls} tool calls, ${sessionOutcome.steps} model steps).`
            : `Agentic session for stage "${job.stageKey}" did not finish cleanly within its tool budget.`,
          providerId: sessionOutcome.providerId,
          modelId: sessionOutcome.modelId,
          latencyMs: agentLatency,
          evidenceId: agentEvidence.id,
          steps: sessionOutcome.steps,
          toolCalls: sessionOutcome.toolCalls,
          content: sessionOutcome.finalText,
        };
      }
    }

    // No READY workspace yet: fall back to a direct, real model completion for
    // this stage. Honest either way - only a genuinely produced response is
    // ever recorded as executed.
    let completion: AiCompletionResponse;
    try {
      completion = await raceAbort(
        context.signal,
execution.router.complete({
          taskType,
          model: execution.modelId,
          signal: context.signal,
          messages: [
            {
              role: 'system',
              content:
                'You are the Blueprint-First project engine. Produce a concrete, honest deliverable for the requested lifecycle stage based only on the information given. Do not fabricate results that were not produced.',
            },
            {
              role: 'user',
              content: `Project: ${project.title}\nVision: ${project.description}\nStage: ${job.stageKey}\n\n${
                job.instruction !== '' ? `User instruction for this run:\n${job.instruction}\n\n` : ''
              }Produce the ${job.stageKey} deliverable for this project.`,
            },
          ],
        }),
      );
    } catch (error) {
      if (context.signal.aborted) {
        return { ok: false, summary: 'Stage run interrupted before completion.', retryable: false, error: 'ABORTED' };
      }
      const message = error instanceof Error ? error.message : String(error);
      const classification = classifyExecutionError(message, null);
      return { ok: false, summary: `${classification}: ${message}`, retryable: true, error: message, failureClass: classification };
    }
    const latencyMs = Date.now() - startedAt;
    const evidenceRecord = await result.evidence.append({
      kind: 'external-response',
      summary: `Stage "${job.stageKey}" executed via ${completion.providerId}/${completion.modelId} for project ${job.projectId} (${latencyMs}ms).`,
      artifactIds: [job.projectId],
      payloadRef: sha256(completion.content),
      producer: { kind: 'ai', id: completion.providerId, modelId: completion.modelId },
    });
    await persistStage({
      providerId: completion.providerId,
      modelId: completion.modelId,
      content: completion.content,
      latencyMs,
      evidenceId: evidenceRecord.id,
      ...(completion.sessionId !== undefined ? { sessionIds: [completion.sessionId] } : {}),
    });
    context.reportProgress?.({ kind: 'ai-step', providerId: completion.providerId, modelId: completion.modelId });
    context.reportProgress?.({ kind: 'checkpoint', checkpointId: evidenceRecord.id });
    if (completion.providerId === 'opencode') {
      await bus.publish({
        type: 'opencode.execution',
        tenantId: job.ownerId,
        projectId: job.projectId,
        jobId: job.id,
        ...(completion.sessionId !== undefined ? { sessionId: completion.sessionId } : {}),
        payload: {
          providerId: completion.providerId,
          modelId: completion.modelId,
          sessionID: completion.sessionId ?? null,
          tokens: completion.usage ?? null,
          cost: completion.cost ?? null,
          finishReason: completion.finishReason ?? null,
          mode: 'direct',
        },
      });
    }
    return {
      ok: true,
      summary: `Stage "${job.stageKey}" completed via ${completion.providerId}/${completion.modelId}.`,
      providerId: completion.providerId,
      modelId: completion.modelId,
      latencyMs,
      evidenceId: evidenceRecord.id,
    };
  };

  // A long-running service inherits a stale PATH. A Cline or Daytona CLI
  // installed AFTER boot writes to the machine/user PATH registry, so the
  // platform merges the live registry before it probes capabilities - that is
  // what lets a genuinely installed CLI become READY without a restart
  // (LAW - no architectural rewrite to go live).
  const pathEntriesAdded = reconcileHostPath();

  const bus = new DurableEventBus(eventsFilePath(dataDir));
  await bus.init();
  // â”€â”€ Platform Startup Gate (capability-first) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Required execution capabilities are DISCOVERED (real CLI probes), the
  // decision + rationale is durable evidence, and the backend for new
  // environments is chosen from what REALLY exists. A mandatory component that
  // is absent is recorded as NOT_INSTALLED - never faked or claimed.
  const capabilityDiscovery = new CapabilityDiscovery({
    filePath: capabilitiesFilePath(dataDir),
    // OpenCode is READY only when a real opencode executable resolves on this
    // host; per-model availability is verified live at each run.
    probeOpenCode: async () => {
      const openCode = providerManager.getOpenCodeProvider();
      if (openCode === null) return false;
      try {
        return openCode.available();
      } catch {
        return false;
      }
    },
  });
  const capabilityDecisions = await capabilityDiscovery.discover();
  const daytonaReady = capabilityDecisions.some((c) => c.capability === 'daytona' && c.status === 'READY');
  // The ACTIVE environment backend is LIVE state, not a boot constant: when a
  // capability re-probe finds a newly installed mandatory CLI (e.g. the daytona
  // CLI appearing mid-run) refreshFoundation() flips it and NEW environments
  // bind to the real Daytona backend WITHOUT a restart or architectural
  // rewrite. A daytona CLI that stops answering flips the platform back to the
  // real local-workspace backend on the next refresh - never a fabricated claim.
  let activeBackend: 'local-workspace' | 'daytona' = daytonaReady ? 'daytona' : 'local-workspace';
  let foundationReport = assessFoundation({
    capabilities: capabilityDecisions,
    environmentBackend: activeBackend,
  });
  const environments = new EnvironmentManager({
    filePath: environmentsFilePath(dataDir),
    workspacesRoot: workspacesRootPath(dataDir),
    bus,
    // Adapter selection is PER ENVIRONMENT: each record keeps its own real
    // backend (CLINE-DAYTONA BINDING). A runtime foundation flip changes only
    // which backend NEW environments bind; existing workspaces keep theirs.
    adapterFactories: {
      localWorkspace: (root) => new LocalWorkspaceEnvAdapter(root),
      daytona: (root) => new DaytonaWorkspaceAdapter(root),
    },
    defaultAdapterKind: activeBackend,
  });
  await environments.init();
  // Live foundation refresh: re-DISCOVERS the real mechanisms (fresh CLI and
  // provider probes), flips activeBackend when discovered truth changes and
  // keeps the EnvironmentManager aligned. The short TTL bounds probe cost
  // while keeping the reported state a live fact rather than a boot snapshot.
  const foundationTtlMs =
    typeof options.foundationTtlMs === 'number' && options.foundationTtlMs >= 0 ? options.foundationTtlMs : 5_000;
  let lastFoundationRefresh = Date.now();
  const refreshFoundation = async (force: boolean): Promise<FoundationReport> => {
    if (!force && Date.now() - lastFoundationRefresh < foundationTtlMs) return foundationReport;
    const decisions = await capabilityDiscovery.discover();
    const nextDaytonaReady = decisions.some((c) => c.capability === 'daytona' && c.status === 'READY');
    const nextBackend: 'local-workspace' | 'daytona' = nextDaytonaReady ? 'daytona' : 'local-workspace';
    lastFoundationRefresh = Date.now();
    if (nextBackend !== activeBackend) {
      const from = activeBackend;
      environments.setDefaultAdapterKind(nextBackend);
      activeBackend = nextBackend;
      try {
        await result.evidence.append({
          kind: 'inspection',
          summary: `Foundation environment backend transitioned ${from} -> ${nextBackend} after a live capability re-probe (${
            nextDaytonaReady
              ? 'the daytona CLI is answering; new environments bind to real Daytona workspaces'
              : 'the daytona CLI is no longer answering; new environments bind to the real local-workspace adapter'
          }).`,
          artifactIds: [],
          producer: { kind: 'system', id: 'platform-foundation-refresh' },
        });
      } catch {
        // evidence wiring may be unavailable; the report still states the truth
      }
    }
    foundationReport = assessFoundation({
      capabilities: decisions,
      // Control-plane verdicts come from the real boot probes (Â§134) and are
      // structural, not a per-refresh capability: a CLI appearing later changes
      // the component verdicts, not whether durable storage still works.
      controlPlane: foundationReport.controlPlane,
      environmentBackend: activeBackend,
    });
    return foundationReport;
  };
  // Record the Platform Startup Gate decision as durable evidence: the real,
  // discovered state of each mandatory execution component. A degraded
  // foundation must never be represented as ready (LAW - PLATFORM STARTUP GATE).
  try {
    await result.evidence.append({
      kind: 'inspection',
      summary: `Platform startup gate: ${foundationReport.summary} (policy: ${foundationReport.policy}, environment backend: ${foundationReport.environmentBackend}).`,
      artifactIds: [],
      producer: { kind: 'system', id: 'platform-startup-gate' },
    });
  } catch {
    // evidence wiring may be unavailable in minimal builds; the report endpoint
    // and capability log still state the real found state
  }
  // â”€â”€ PLATFORM-LEVEL DAYTONA CONFIGURATION (owner-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Daytona is configured ONCE by the platform owner in an owner-only area and
  // is then used by the whole platform. The credential lives in the platform's
  // real secret boundary and is never returned by any endpoint.
  const daytonaPlatform = new DaytonaPlatformConfig(
    new CredentialStore(),
    daytonaPlatformConfigFilePath(dataDir),
  );

  /** Applies a verified Daytona connection to the LIVE execution configuration. */
  const activateDaytonaBackend = async (): Promise<void> => {
    if (activeBackend === 'daytona') return;
    const from = activeBackend;
    environments.setDefaultAdapterKind('daytona');
    activeBackend = 'daytona';
    foundationReport = assessFoundation({
      capabilities: await capabilityDiscovery.discover(),
      controlPlane: foundationReport.controlPlane,
      environmentBackend: activeBackend,
    });
    try {
      await result.evidence.append({
        kind: 'inspection',
        summary: `Daytona execution backend activated platform-wide (${from} -> daytona) after the owner credential was verified against the real Daytona API and CLI. New environments now provision real Daytona sandboxes; existing environments keep their own binding.`,
        artifactIds: [],
        producer: { kind: 'system', id: 'daytona-platform-activation' },
      });
      await bus.publish({
        type: 'supervisor.stopped',
        payload: { note: 'daytona-activated', from, to: 'daytona' },
      });
    } catch {
      // evidence/bus wiring may be unavailable; the live configuration stands
    }
  };

  const envPort: JobEnvPort = {
    envOf: async (envId) => {
      const env = await environments.get(envId);
      if (env === null) return null;
      return { status: env.status, workspaceRoot: env.workspaceRoot };
    },
  };
  // Execution Supervisor: the central, event-driven control mechanism for
  // every governed run (hang monitor, hard timeout, network monitor, governed
  // wait states, auto-resume, watchdog). Its target is late-bound over the job
  // engine so neither component must exist before the other.
  let jobEngineRef: JobEngine | undefined;
  const superviseTarget: SupervisorTarget = {
    jobOf: (id) => jobEngineRef!.supervisorJobOf(id),
    activeJobs: () => jobEngineRef!.supervisorActiveJobs(),
    forceFail: (id, classification, summary) => jobEngineRef!.forceFailFromSupervisor(id, classification, summary),
    enterWait: (id, waitKind, reason) => jobEngineRef!.enterWaitFromSupervisor(id, waitKind, reason),
    leaveWait: (id, detail) => jobEngineRef!.leaveWaitFromSupervisor(id, detail),
  };
  const supervisor = new ExecutionSupervisor({
    bus,
    traceFilePath: supervisionTraceFilePath(dataDir),
    target: superviseTarget,
  });
  await supervisor.init();
  const jobEngine = new JobEngine({
    filePath: jobsFilePath(dataDir),
    bus,
    executor: jobExecutor,
    env: envPort,
    supervisor,
  });
  jobEngineRef = jobEngine;
  await jobEngine.init();
  supervisor.start();

  //LAW - DEPENDENCY-GATED SCHEDULING / GOVERNED WAIT STATES /
  // NO MANUAL CONTINUE FOR ORDINARY RECOVERY (§83, §116, §132).
  //
  // A job gated on an environment is BLOCKED (not FAILED) while that
  // environment is still REQUESTED/PROVISIONING/RECOVERING. Provisioning is
  // asynchronous, so the enqueue-time pass almost always sees a not-yet-READY
  // environment. Without a wake-up on the readiness event such a job would stay
  // BLOCKED forever and only a manual retry could free it - which is exactly
  // the "ordinary recovery requires a Continue click" the architecture forbids,
  // and it silently starves every worker queued behind that environment.
  //
  // So: whenever an environment settles into READY (fresh provisioning, a
  // recovery, or a re-verified health check) the scheduler is re-run so gated
  // jobs are re-evaluated immediately and automatically. Transitions that make
  // an environment unusable are ignored here on purpose: re-running the pass
  // then would simply re-block the jobs, and the Execution Supervisor owns the
  // governed wait for a run that is already in flight.
  bus.subscribe((event) => {
    if (event.type === 'env.readiness_verified' || event.type === 'env.transition') {
      if (event.payload?.['to'] === 'READY') {
        void jobEngine.schedule();
      }
    }
  });

  // If a Daytona credential is supplied through the environment secret boundary,
  // verify it against the REAL Daytona service here and, only on genuine success,
  // switch the live execution backend before the startup gate runs. The secret is
  // read from the environment, never written to source, durable files or responses.
  {
    const bootState = await daytonaPlatform.configureFromEnvironment().catch(() => null);
    if (bootState?.status === 'connected') {
      await activateDaytonaBackend();
    }
  }

  // Â§134 PLATFORM STARTUP GATE â€” the control-plane foundations are VERIFIED with
  // real operations, not declared: a real durable write/read, a real event
  // publish/subscribe round trip, a real durable job-state read, a real
  // scheduling pass, a real credential-boundary round trip, and a real evidence
  // append/read-back. A degraded foundation is never represented as ready, and
  // these verdicts are folded into the same startup-gate report the UI shows.
  const controlPlaneDecisions = await probeControlPlane({
    dataDir,
    bus,
    jobStateCount: async () => (await jobEngine.all()).length,
    schedulerPass: async () => { await jobEngine.schedule(); },
    secretBoundary: async () => {
      const owner = 'startup-gate-probe';
      const secret = `probe-${Date.now()}`;
      const ref = providerManager.credentials.addCredential(owner, 'openrouter', secret);
      if (ref.id === secret || JSON.stringify(ref).includes(secret)) {
        throw new Error('the credential reference leaked the secret value');
      }
      if (providerManager.credentials.resolveSecret(owner, ref.id) !== secret) {
        throw new Error('the authorized owner could not recover the secret for runtime use');
      }
      let denied = false;
      try {
        providerManager.credentials.resolveSecret('someone-else', ref.id);
      } catch {
        denied = true;
      }
      if (!denied) throw new Error('a different owner was able to read the secret');
      providerManager.credentials.removeCredential(owner, ref.id);
    },
    observability: async () => {
      const record = await result.evidence.append({
        kind: 'inspection',
        summary: 'Platform startup gate observability probe: the evidence trail accepted a real record.',
        artifactIds: [],
        producer: { kind: 'system', id: 'platform-startup-gate' },
      });
      const readBack = await result.evidence.forArtifact(record.artifactIds[0] ?? '__none__');
      void readBack;
      const all = await result.evidence.all();
      if (!all.some((e) => e.id === record.id)) {
        throw new Error(`the appended evidence record ${record.id} could not be read back`);
      }
    },
  });
  foundationReport = assessFoundation({
    capabilities: capabilityDecisions,
    controlPlane: controlPlaneDecisions,
    environmentBackend: activeBackend,
  });
  {
    const failedProbes = controlPlaneDecisions.filter((c) => !c.ready);
    try {
      await result.evidence.append({
        kind: 'inspection',
        summary:
          `Control-plane foundation probes: ${controlPlaneDecisions.length - failedProbes.length}/${controlPlaneDecisions.length} passed` +
          `${failedProbes.length > 0 ? `; FAILED: ${failedProbes.map((c) => `${c.capability} (${c.detail})`).join('; ')}` : ''}.`,
        artifactIds: [],
        producer: { kind: 'system', id: 'platform-startup-gate' },
      });
    } catch {
      // evidence wiring may be unavailable in minimal builds
    }
  }

  const envRecordView = (e: EnvironmentRecord): Record<string, unknown> => ({
    id: e.id,
    projectId: e.projectId,
    ownerId: e.ownerId,
    status: e.status,
    label: e.spec.label,
    gitEnabled: e.spec.gitEnabled,
    // The CLINE-DAYTONA BINDING is observable: which REAL backend this
    // environment is bound to (local-workspace or a real Daytona workspace).
    adapterKind: e.adapterKind,
    workspaceRoot: e.workspaceRoot,
    lastHealth: e.lastHealth,
    lastTransition: e.lastTransition,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  });

  const jsonBlueprint = (res: express.Response, error: unknown): void => {
    if (error instanceof BlueprintError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    jsonError(res, 400, error);
  };

  /** The owned, live environment's adapter, or null after sending a 4xx. */
  const requireAdapter = async (req: express.Request, res: express.Response) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return null;
    }
    const envId = typeof req.query['envId'] === 'string' ? req.query['envId'] : '';
    if (envId.length === 0) {
      res.status(400).json({ error: 'envId is required.' });
      return null;
    }
    const adapter = await environments.workspace(envId, user);
    if (adapter === null) {
      const owned = await environments.get(envId, user);
      res.status(owned === null ? 404 : 409).json({
        error: owned === null ? 'environment-not-found' : 'environment-not-ready',
      });
      return null;
    }
    return adapter;
  };

  app.get('/api/working/environments', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const projectIdParam = req.query['projectId'];
    const envs =
      typeof projectIdParam === 'string'
        ? await environments.forProject(projectIdParam, user)
        : await environments.list(user);
    res.json({ environments: envs.map(envRecordView) });
  });

  app.post('/api/working/environments', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = (req.body ?? {}) as { projectId?: unknown; label?: unknown; gitEnabled?: unknown };
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (projectId.length === 0) {
      res.status(400).json({ error: 'projectId is required.' });
      return;
    }
    const project = await requireOwnedProject(user, projectId);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : 'Development workspace';
    const gitEnabled = body.gitEnabled !== false;
    try {
      const record = await environments.request({
        ownerId: user,
        projectId,
        spec: { label, gitEnabled } satisfies EnvSpec,
        by: 'web-working-api',
      });
      res.status(201).json(envRecordView(record));
    } catch (error) {
      jsonBlueprint(res, error);
    }
  });

  app.get('/api/working/environments/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const record = await environments.get(req.params['id']!, user);
    if (record === null) {
      res.status(404).json({ error: 'environment-not-found' });
      return;
    }
    res.json(envRecordView(record));
  });

  app.patch('/api/working/environments/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const id = req.params['id']!;
    const action = typeof (req.body as { action?: unknown } | undefined)?.action === 'string'
      ? (req.body as { action: string }).action
      : '';
    try {
      let record: EnvironmentRecord | null = null;
      if (action === 'pause') record = await environments.pause(id, user);
      else if (action === 'resume') record = await environments.resume(id, user);
      else if (action === 'destroy') record = await environments.destroy(id, user);
      else if (action === 'verify') record = await environments.verifyHealth(id, user);
      else {
        res.status(400).json({ error: `Unknown environment action "${action}".` });
        return;
      }
      if (record === null) {
        res.status(404).json({ error: 'environment-not-found' });
        return;
      }
      res.json(envRecordView(record));
    } catch (error) {
      jsonBlueprint(res, error);
    }
  });

  // real files in the environment workspace
  app.get('/api/working/files', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      res.json({ path: rel, entries: await adapter.listFiles(rel) });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.get('/api/working/file', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      res.json(await adapter.readFile(rel));
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.put('/api/working/file', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    const content = typeof (req.body as { content?: unknown })?.content === 'string'
      ? (req.body as { content: string }).content
      : '';
    try {
      await adapter.writeFile(rel, content);
      res.json({ ok: true, path: rel });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.delete('/api/working/file', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      await adapter.deleteFile(rel);
      res.json({ ok: true, path: rel });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  // real terminal output (credential-masked) and real git
  app.post('/api/working/terminal', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const command = typeof (req.body as { command?: unknown })?.command === 'string'
      ? (req.body as { command: string }).command.trim().slice(0, 8000)
      : '';
    if (command.length === 0) {
      res.status(400).json({ error: 'command is required.' });
      return;
    }
    try {
      const result = await adapter.runCommand(command);
      res.json(result);
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.get('/api/working/git/status', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    try {
      res.json(await adapter.gitStatus());
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.post('/api/working/git/commit', async (req, res) => {
    const adapter = await requireAdapter(req, res);
    if (adapter === null) return;
    const message = typeof (req.body as { message?: unknown })?.message === 'string'
      ? (req.body as { message: string }).message.trim().slice(0, 2000)
      : 'workspace change';
    try {
      await adapter.gitCommit(message);
      res.json({ ok: true, commitMessage: message });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  // Worker Runtime jobs
  app.get('/api/working/jobs', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const projectIdParam = req.query['projectId'];
    const jobs =
      typeof projectIdParam === 'string'
        ? (await jobEngine.forProject(projectIdParam)).filter((j) => j.ownerId === user)
        : (await jobEngine.all()).filter((j) => j.ownerId === user);
    res.json({ count: jobs.length, jobs });
  });

  app.get('/api/working/supervisor', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const snapshot = supervisor.snapshot();
    res.json({
      bootId: snapshot.bootId,
      lastTickAt: snapshot.lastTickAt,
      tickSeq: snapshot.tickSeq,
      networkUp: snapshot.networkUp,
      lastProbe: snapshot.lastProbe,
      progressWindowMs: snapshot.progressWindowMs,
      active: snapshot.active.filter((run) => run.ownerId === user),
    });
  });

  // Platform Start-up Gate report: the real, discovered state of every
  // mandatory execution component (OpenCode / Cline / Daytona / local). A
  // degraded foundation is reported as such - never represented as ready.
  app.get('/api/system/foundation', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const report = await refreshFoundation(false);
    const daytonaDecision = report.capabilities.find((c) => c.capability === 'daytona');
    const clineDecision = report.capabilities.find((c) => c.capability === 'cline');
    res.json({
      generatedAt: report.generatedAt,
      policy: report.policy,
      productionReady: report.productionReady,
      startupGateOpen: report.startupGateOpen,
      opencodeReady: report.opencodeReady,
      clineReady: report.clineReady,
      clineDetail: clineDecision?.rationale,
      daytonaReady: report.daytonaReady,
      daytonaDetail: daytonaDecision?.rationale,
      localReady: report.localReady,
      environmentBackend: report.environmentBackend,
      summary: report.summary,
      capabilities: report.capabilities,
      controlPlane: report.controlPlane,
    });
  });

  // â”€â”€ Â§135 PROJECT START GATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Before a project enters active engineering the platform must have a durable
  // project identity, source-control/workspace state, a VERIFIED project AI
  // configuration, the required execution capabilities, an initial checkpoint
  // and an execution policy. Each item is reported from real state; a missing
  // item is an unmet gate, never an assumed pass.
  app.get('/api/projects/:id/start-gate', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const aiConfig = aiConfigOf(project);
    const envs = await environments.forProject(project.id, user);
    const jobs = await jobEngine.forProject(project.id, user);
    const report = await refreshFoundation(false);
    const items = [
      {
        requirement: 'durable project identity',
        met: project.id.length > 0 && project.createdAt.length > 0,
        detail: `Project ${project.id} exists as durable state (created ${project.createdAt}).`,
      },
      {
        requirement: 'source-control/workspace state',
        met: envs.length > 0,
        detail:
          envs.length > 0
            ? `${envs.length} execution environment(s) recorded (${envs.map((e) => `${e.id}:${e.status}`).join(', ')}).`
            : 'No execution environment has been provisioned for this project yet.',
      },
      {
        requirement: 'verified project AI configuration',
        met: aiConfig !== null && aiConfigMetaOf(project)?.configVersion !== undefined,
        detail:
          aiConfig === null
            ? 'No AI configuration is bound to this project; AI execution cannot pretend to be ready.'
            : `Bound to ${aiConfig.providerId}/${aiConfig.modelId} at configuration version ${aiConfigMetaOf(project)?.configVersion ?? 1}.`,
      },
      {
        requirement: 'required execution capabilities',
        met: report.localReady,
        detail: report.summary,
      },
      {
        requirement: 'initial checkpoint',
        met: jobs.length > 0,
        detail:
          jobs.length > 0
            ? `${jobs.length} job record(s) exist; the durable supervision trace is written on every boot.`
            : 'No job has been enqueued; the first execution establishes the initial checkpoint.',
      },
      {
        requirement: 'execution policy',
        met: true,
        detail: `Policy "${report.policy}" with environment backend "${report.environmentBackend}"; the three-minute hard timeout, network wait/resume and governed retry rules are enforced by the Execution Supervisor.`,
      },
    ];
    const unmet = items.filter((i) => !i.met);
    res.json({
      projectId: project.id,
      gateOpen: unmet.length === 0,
      items,
      unmet: unmet.map((i) => i.requirement),
      summary:
        unmet.length === 0
          ? 'Every project-start requirement is satisfied from real state; the project may enter active engineering.'
          : `Project-start gate is not open. Unmet: ${unmet.map((i) => i.requirement).join('; ')}.`,
    });
  });

  // â”€â”€ OWNER-ONLY INFRASTRUCTURE CONFIGURATION (server-enforced) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Ordinary users must never see or touch platform infrastructure.
  //
  // The boundary is applied ONCE, as a router-level guard, rather than repeated
  // inside each handler. That way every HTTP method - including one no route
  // currently implements - and every route added here in future is covered by
  // the same check, so a new handler cannot be shipped unprotected by omission.
  // This is enforced in the BACKEND; hiding the navigation entry is only
  // presentation.

  const isPlatformOwner = (req: express.Request): boolean => req.account?.role === 'admin';

  const ownerRouter = express.Router();

  // Guard: applies to EVERY method and every path under /api/owner.
  ownerRouter.use((req, res, next) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!isPlatformOwner(req)) {
      res.status(403).json({ error: 'owner-only: platform infrastructure settings are not available to this account.' });
      return;
    }
    next();
  });

  // Any unhandled method or path under the owner boundary is refused with the
  // same authorization posture, never a generic 404 that could be probed. It is
  // registered AFTER the real routes (see below) so it only handles what they
  // did not, and it is a path-less middleware so it is independent of wildcard
  // syntax differences between router versions.
  const refuseUnhandledOwnerRoute: express.RequestHandler = (_req, res) => {
    res.status(405).json({ error: 'method-not-allowed on an owner-only resource' });
  };

  app.use('/api/owner', ownerRouter);

  ownerRouter.get('/daytona', async (_req, res) => {
    const state = daytonaPlatform.current();
    res.json({
      // The non-secret state only. The API key is never returned here.
      daytona: state,
      activeBackend: activeBackend,
      daytonaConfigured: state.status === 'connected',
      signupUrl: 'https://app.daytona.io/signup',
      docsUrl: 'https://www.daytona.io/docs/en/getting-started',
    });
  });

  ownerRouter.put('/daytona', async (req, res) => {
    const body = (req.body ?? {}) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    if (apiKey.trim().length === 0) {
      res.status(400).json({ error: 'A Daytona API key is required.' });
      return;
    }
    try {
      // REAL connection test: Daytona itself decides whether this key works.
      const state = await daytonaPlatform.configure(apiKey.trim(), {
        ...(options.openRouterFetchImpl !== undefined ? { fetchImpl: options.openRouterFetchImpl as unknown as typeof fetch } : {}),
      });
      if (state.status === 'connected') {
        // The verified credential becomes the LIVE platform execution
        // configuration immediately: no rebuild, no restart, no per-project key.
        await activateDaytonaBackend();
      }
      res.json({
        daytona: state,
        activeBackend: activeBackend,
        daytonaConfigured: state.status === 'connected',
      });
    } catch (error) {
      res.status(502).json({ error: `Daytona verification could not complete: ${(error as Error).message}` });
    }
  });

  ownerRouter.delete('/daytona', async (_req, res) => {
    const state = daytonaPlatform.clear();
    environments.setDefaultAdapterKind('local-workspace');
    activeBackend = 'local-workspace';
    foundationReport = assessFoundation({
      capabilities: await capabilityDiscovery.discover(),
      controlPlane: foundationReport.controlPlane,
      environmentBackend: activeBackend,
    });
    res.json({ daytona: state, activeBackend: activeBackend, daytonaConfigured: false });
  });

  // Terminal handler for the owner boundary, registered last so it only sees
  // requests the real owner routes did not handle.
  ownerRouter.use(refuseUnhandledOwnerRoute);

  // â”€â”€ Â§88 STALE JOB INVALIDATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // When certified upstream state changes, dependent queued work is identified
  // and stopped for real rather than executing against stale assumptions.
  app.post('/api/projects/:id/invalidate-stale-jobs', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const body = (req.body ?? {}) as { changedArtifactIds?: unknown; reason?: unknown };
    const changed = Array.isArray(body.changedArtifactIds)
      ? body.changedArtifactIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : 'Certified upstream state changed; dependent work must be re-planned.';
    if (changed.length === 0) {
      res.status(400).json({ error: 'changedArtifactIds is required so the affected downstream set can be identified.' });
      return;
    }
    const invalidated = await jobEngine.invalidateStaleJobs({
      projectId: project.id,
      changedArtifactIds: changed,
      reason,
      by: user,
    });
    res.json({
      invalidated: invalidated.map((j) => ({ id: j.id, stageKey: j.stageKey, status: j.status, blockReason: j.blockReason })),
      count: invalidated.length,
    });
  });

  // â”€â”€ Â§105-Â§110 PRODUCT JUDGMENT, INTENT, AMBIGUITY, DECISIONS, SIMULATIONS â”€â”€â”€â”€
  // Judgment is a capability BESIDE the completeness gates, never inside them.
  // These routes let the organization establish the immutable intent baseline,
  // record material decisions in the append-only ledger, run the independent
  // judgment pass, and run both product simulations. Nothing here advances an
  // artifact's state or certifies anything: the outputs are findings and
  // ledger entries, which the final certification council consumes.

  const projectArtifacts = async (projectId: string): Promise<Artifact[]> => {
    if (result.store === undefined) return [];
    const listed = await result.store.list({ projectId });
    return listed;
  };

  const projectStages = async (projectId: string): Promise<Array<{ id: string; label: string; inScope: boolean; status: string }>> => {
    const project = result.registry === undefined ? null : await result.registry.requireProject(projectId).catch(() => null);
    if (project === null) return [];
    const stages = project.attributes['stages'];
    if (!Array.isArray(stages)) return [];
    return stages.map((s) => {
      const rec = s as Record<string, unknown>;
      return {
        id: String(rec['stageId'] ?? rec['id'] ?? ''),
        label: String(rec['label'] ?? rec['stageId'] ?? rec['id'] ?? ''),
        inScope: rec['inScope'] === true,
        status: String(rec['status'] ?? 'PENDING'),
      };
    });
  };

  app.put('/api/judgment/:id/intent', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const body = (req.body ?? {}) as { goals?: unknown; targetUsers?: unknown; constraints?: unknown; nonGoals?: unknown };
    const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
    const goals = asStrings(body.goals);
    const targetUsers = asStrings(body.targetUsers);
    if (goals.length === 0 || targetUsers.length === 0) {
      res.status(400).json({ error: 'goals and targetUsers are required to establish the intent baseline.' });
      return;
    }
    // The baseline is immutable: re-establishing returns the ORIGINAL baseline
    // (never an overwrite). Amendment goes through Change/Reopening.
    const intent = await judgment.establishIntentBaseline({
      projectId: project.id,
      goals,
      targetUsers,
      constraints: asStrings(body.constraints),
      nonGoals: asStrings(body.nonGoals),
    });
    res.json({ intent });
  });

  app.get('/api/judgment/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const artifacts = await projectArtifacts(project.id);
    const stages = await projectStages(project.id);
    const report = await judgment.runJudgment({ projectId: project.id, artifacts, stages });
    const simulation = await judgment.runSimulations({ projectId: project.id, artifacts });
    await judgment.recordDrift({
      projectId: project.id,
      subjects: artifacts.map((a) => ({
        id: a.id,
        label: a.title,
        // Every durable artifact carries provenance back to the project brief
        // chain; an artifact with no recorded upstream at all is untraceable.
        trace: a.dependencies.length > 0 || a.provenance.length > 0
          ? ({ kind: 'requirement', artifactId: project.id, detail: 'traced through the project artifact chain' } satisfies IntentTrace)
          : null,
      })),
    });
    res.json({
      intent: judgment.intentOf(project.id),
      decisions: judgment.forProject(project.id),
      drift: judgment.driftFor(project.id),
      judgment: report,
      simulation,
    });
  });

  app.post('/api/judgment/:id/decisions', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const body = (req.body ?? {}) as {
      decision?: unknown; decisionClass?: unknown; rationale?: unknown;
      alternativesConsidered?: unknown; affectedArtifactIds?: unknown;
      downstreamImpact?: unknown; evidenceIds?: unknown; authorize?: unknown;
    };
    const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
    const decisionClass = typeof body.decisionClass === 'string' ? body.decisionClass.trim() : '';
    if (decision.length === 0 || decisionClass.length === 0) {
      res.status(400).json({ error: 'decision and decisionClass are required.' });
      return;
    }
    // Â§107 fail-closed: a material decision class, or a safe inference with no
    // recorded rationale, is escalated to a human decision rather than guessed.
    const resolution = resolveAmbiguity({
      decisionClass,
      ...(typeof body.rationale === 'string' ? { rationale: body.rationale } : {}),
      decidedBy: user,
    });
    const authorized = body.authorize === true;
    if (resolution.kind === 'human-decision-required' && authorized) {
      res.status(409).json({
        error: resolution.reason,
        resolution,
      });
      return;
    }
    const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    try {
      const record = judgment.record({
        projectId: project.id,
        decision,
        decisionClass,
        rationale: typeof body.rationale === 'string' ? body.rationale : '',
        evidenceIds: asStrings(body.evidenceIds),
        alternativesConsidered: asStrings(body.alternativesConsidered),
        authorizedBy: resolution.kind === 'human-decision-required' ? (authorized ? user : null) : user,
        affectedArtifactIds: asStrings(body.affectedArtifactIds),
        downstreamImpact: typeof body.downstreamImpact === 'string' ? body.downstreamImpact : '',
        resolution: resolution.kind,
        at: new Date().toISOString(),
      });
      await result.evidence.append({
        kind: 'review',
        summary: `Decision ${record.id} (${record.decisionClass}) recorded for project ${project.id} as ${record.resolution}.`,
        artifactIds: [project.id],
        producer: { kind: 'system', id: 'product-judgment' },
      });
      res.status(201).json({ decision: record, resolution });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

  app.post('/api/working/jobs', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (result.registry === undefined) {
      res.status(501).json({ error: 'The project engine is not available in this build.' });
      return;
    }
    const body = (req.body ?? {}) as {
      projectId?: unknown;
      stageKey?: unknown;
      instruction?: unknown;
      envId?: unknown;
      dependsOn?: unknown;
      providerId?: unknown;
      modelId?: unknown;
      credentialId?: unknown;
    };
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const project = await requireOwnedProject(user, projectId);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const stageKey = typeof body.stageKey === 'string' ? body.stageKey : '';
    const mode = String(project.attributes['mode']);
    const stagesForMode =
      (PROJECT_MODE_STAGES as Record<string, { stageId: string; label: string; inScope: boolean }[]>)[mode] ??
      [];
    const stage = stagesForMode.find((s) => s.stageId === stageKey);
    if (stage === undefined) {
      res.status(400).json({ error: `Unknown stage "${stageKey}".` });
      return;
    }
    if (!stage.inScope) {
      res.status(409).json({
        error: `Stage "${stage.label}" is OUT OF SCOPE for mode "${mode}". Out-of-scope stages are never falsely run.`,
      });
      return;
    }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 8000) : '';
    const envId = typeof body.envId === 'string' && body.envId.length > 0 ? body.envId : undefined;
    if (envId !== undefined) {
      const owned = await environments.get(envId, user);
      if (owned === null) {
        res.status(404).json({ error: 'environment-not-found' });
        return;
      }
    }
    const dependsOnRaw = Array.isArray(body.dependsOn) ? body.dependsOn : [];
    const dependsOn = dependsOnRaw.filter((x): x is string => typeof x === 'string');
    // Â§3.3 ONE AUTHORITATIVE CONFIGURATION: a governed job inherits the
    // project's bound AI configuration. A per-run provider/model override is
    // not a configuration surface (it would let a caller silently run another
    // model) and the architecture provides no second model selector (Â§"No
    // second AI model selector"). Explicit change happens through the project
    // AI MODEL control, then shows up here as the new project config.
    if (
      typeof body.providerId === 'string' ||
      typeof body.modelId === 'string' ||
      typeof body.credentialId === 'string'
    ) {
      res.status(400).json({
        error:
          'Per-run provider/model overrides are not supported. The project has ONE authoritative AI configuration; change it through the project AI MODEL control.',
      });
      return;
    }
    const projectAiConfig = aiConfigOf(project);
    const configVersion = aiConfigMetaOf(project)?.configVersion ?? 1;
    const projectBinding =
      projectAiConfig === null
        ? undefined
        : {
            providerId: projectAiConfig.providerId,
            modelId: projectAiConfig.modelId,
            configVersion,
            boundAt: new Date().toISOString(),
          };
    const ai =
      projectBinding === undefined
        ? undefined
        : {
            providerId: projectBinding.providerId,
            modelId: projectBinding.modelId,
            configVersion: projectBinding.configVersion,
            boundAt: new Date().toISOString(),
          };
    try {
      const job = await jobEngine.enqueue({
        projectId,
        ownerId: user,
        stageKey,
        label: stage.label,
        mode,
        instruction,
        ...(envId !== undefined ? { envId } : {}),
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        ...(ai !== undefined ? { ai } : {}),
      });
      res.status(201).json(job);
    } catch (error) {
      jsonBlueprint(res, error);
    }
  });

  app.get('/api/working/jobs/:id', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const job = await jobEngine.get(req.params['id']!, user);
    if (job === null) {
      res.status(404).json({ error: 'job-not-found' });
      return;
    }
    res.json(job);
  });

  app.post('/api/working/jobs/:id/pause', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const record = await jobEngine.pause(req.params['id']!, user);
    if (record === null) {
      res.status(404).json({ error: 'job-not-found' });
      return;
    }
    res.json(record);
  });

  app.post('/api/working/jobs/:id/resume', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const record = await jobEngine.resume(req.params['id']!, user);
    if (record === null) {
      res.status(404).json({ error: 'job-not-found' });
      return;
    }
    res.json(record);
  });

  app.post('/api/working/jobs/:id/cancel', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const record = await jobEngine.cancel(req.params['id']!, user);
    if (record === null) {
      res.status(404).json({ error: 'job-not-found' });
      return;
    }
    res.json(record);
  });

  app.post('/api/working/jobs/:id/retry', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const record = await jobEngine.retry(req.params['id']!, user);
    if (record === null) {
      res.status(404).json({ error: 'job-not-found' });
      return;
    }
    res.json(record);
  });

  // execution graph + event log + live event stream for a project
  app.get('/api/working/project/:id/graph', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    res.json(buildExecutionGraph(await jobEngine.forProject(project.id, user), project.id));
  });

  app.get('/api/working/project/:id/events', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    const after = Number(req.query['after'] ?? 0);
    const events = await bus.after(Number.isFinite(after) ? after : 0);
    res.json({ events: events.filter((e) => e.projectId === project.id) });
  });

  app.get('/api/working/project/:id/stream', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const project = await requireOwnedProject(user, req.params['id']!);
    if (project === null) {
      res.status(404).json({ error: 'project-not-found' });
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const writeEvent = (e: { seq: number; type: string }): void => {
      res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const after = Number(req.query['after'] ?? 0);
    for (const e of await bus.after(Number.isFinite(after) ? after : 0)) {
      if (e.projectId === project.id) writeEvent(e);
    }
    const unsubscribe = bus.subscribe((e) => {
      if (e.projectId === project.id) writeEvent(e);
    });
    const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  app.get('/api/models', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const rawCategories = req.query['accessCategory'];
      const requested = Array.isArray(rawCategories) ? rawCategories : rawCategories ? [rawCategories] : [];
      const categories = requested.filter((c): c is ModelAccessCategory =>
        typeof c === 'string' && (ACCESS_CATEGORIES as readonly string[]).includes(c),
      );
      // Local models are served by the user's runtime and never appear in the
      // catalogue; the runtime's own /models list is the honest source.
      if (req.query['providerId'] === 'local') {
        const local = providerManager.getLocalRuntime();
        if (local === null) {
          res.json({ total: 0, models: [], sources: ['local-runtime'], localHubUnavailable: true });
          return;
        }
        const raw = await local.listModels();
        const term = typeof req.query['q'] === 'string' ? req.query['q'].trim().toLowerCase() : '';
        const models = term.length === 0
          ? raw
: raw.filter((m) =>
                `${m.name} ${m.modelId} ${m.providerName}`.toLowerCase().includes(term),
              );
        res.json({ total: models.length, models, sources: ['local-runtime'], localHubUnavailable: false });
        return;
      }
      const search = await modelCatalogue.search({
        ...(typeof req.query['q'] === 'string' && req.query['q'].length > 0
          ? { searchTerm: req.query['q'] }
          : {}),
        ...(typeof req.query['providerId'] === 'string' && req.query['providerId'].length > 0
          ? { providerId: req.query['providerId'] }
          : {}),
        ...(categories.length > 0 ? { accessCategories: categories } : {}),
        ...(req.query['availableOnly'] === 'true' ? { availableOnly: true } : {}),
      });
      res.json({ total: search.total, models: search.models, sources: search.sources });
    } catch (error) {
      jsonError(res, 502, error); // upstream catalogue failure, reported honestly
    }
  });

  app.get('/api/models/stats', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      res.json(await modelCatalogue.getStats());
    } catch (error) {
      jsonError(res, 502, error);
    }
  });

  app.get('/api/models/selection', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ selection: providerManager.getCurrentSelection(user) });
  });

  app.get('/api/providers', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      // Real catalogue counts by provider; upstream failure is reported honestly.
      const stats = await modelCatalogue.getStats();
      res.json({ providers: providerManager.describeProviders(user, stats.byProviderInfo) });
    } catch (error) {
      jsonError(res, 502, error);
    }
  });

  app.post('/api/providers/:providerId/verify', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const result = await providerManager.verifyProviderConnection(
        user,
        req.params['providerId']!,
        options.openRouterFetchImpl,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        // Distinguish "not wired here" (501) from "needs a step first" (409).
        if (/not implemented yet/.test(error.message)) {
          res.status(501).json({ error: error.message });
        } else {
          res.status(409).json({ error: error.message });
        }
        return;
      }
      jsonError(res, 404, error);
    }
  });

  app.post('/api/models/select', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { providerId?: unknown; modelId?: unknown };
    if (
      typeof body.providerId !== 'string' || typeof body.modelId !== 'string' ||
      body.providerId.trim().length === 0 || body.modelId.trim().length === 0
    ) {
      res.status(400).json({ error: 'providerId and modelId are required' });
      return;
    }
    try {
      if (body.providerId === 'local') {
        res.json(await providerManager.selectLocalModel(user, body.modelId));
        return;
      }
      // OpenCode is a REAL wired provider, but its catalogue is reached through the
      // installed runtime rather than through a per-user credential: the genuinely
      // free models are served by OpenCode itself and need no user API key. It is
      // therefore selected through its own path, which re-verifies the real
      // connection and refuses any model the runtime does not actually expose.
      // Routing it through the credential path below would 409 every credential-free
      // model and make real AI execution unreachable.
      if (body.providerId === 'opencode') {
        res.json(await providerManager.selectOpenCodeModel(user, body.modelId));
        return;
      }
      if (body.providerId === 'openrouter' || (WIRED_PROVIDER_IDS as readonly string[]).includes(body.providerId)) {
        const ref = providerManager.credentials.findByUserAndProvider(user, body.providerId);
        if (ref === null) {
          res.status(409).json({
            error: `No ${body.providerId} credential for this user. Add one (POST /api/credentials); CONFIGURED does not mean AVAILABLE.`,
          });
          return;
        }
        if (body.providerId === 'openrouter') {
          res.json(await providerManager.selectOpenRouterModel(user, ref.id, body.modelId));
        } else {
          res.json(await providerManager.selectHostedModel(user, ref.id, body.providerId, body.modelId));
        }
        return;
      }
      res.status(501).json({ error: `selection for provider \"${body.providerId}\" is not implemented yet` });
    } catch (error) {
      jsonError(res, error instanceof RoutingError ? 409 : 502, error);
    }
  });

  app.get('/api/models/:providerId/:modelId', async (req, res) => {
    try {
      const model = await modelCatalogue.getModel(req.params['providerId']!, req.params['modelId']!);
      if (model === null) {
        res.status(404).json({ error: 'model-not-found' });
        return;
      }
      res.json(model);
    } catch (error) {
      jsonError(res, 502, error);
    }
  });

  app.post('/api/credentials', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { providerId?: unknown; secret?: unknown };
    if (typeof body.providerId !== 'string' || body.providerId.trim().length === 0 ||
        typeof body.secret !== 'string' || body.secret.trim().length === 0) {
      res.status(400).json({ error: 'providerId and secret are required' });
      return;
    }
    try {
      const ref = providerManager.credentials.addCredential(user, body.providerId, body.secret);
      res.status(201).json(ref); // opaque reference only; the secret is never echoed
    } catch (error) {
      jsonError(res, error instanceof DuplicateCredentialError ? 409 : 400, error);
    }
  });

  app.get('/api/credentials', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ credentials: providerManager.credentials.listCredentials(user) });
  });

  app.delete('/api/credentials/:id', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      providerManager.credentials.removeCredential(user, req.params['id']!);
      res.status(204).end();
    } catch (error) {
      jsonError(res, error instanceof ConfigurationError ? 404 : 400, error);
    }
  });

  app.post('/api/credentials/:id/verify', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const ref = providerManager.credentials.getReference(user, req.params['id']!);
      if (ref.providerId !== 'openrouter' && !(WIRED_PROVIDER_IDS as readonly string[]).includes(ref.providerId)) {
        // Honest surface: no fabricated verification for unimplemented providers.
        res.status(501).json({ error: `connection verification for provider \"${ref.providerId}\" is not implemented yet` });
        return;
      }
      const result = await providerManager.verifyCredential(user, req.params['id']!, options.openRouterFetchImpl);
      res.json(result);
    } catch (error) {
      jsonError(res, 404, error);
    }
  });

  // --- chat-first / document handling (expansion Â§14-15) -------------------------
  // Short inputs stay inline chat messages; large inputs become document
  // references so chat state stays lightweight. Classification is the single
  // deterministic threshold (default 4000 chars; override via BF_DOCUMENT_MAX_CHARS
  // once auto-configured). Processing is async and non-blocking: the server
  // computes quickly, the client shows progress/recovery, and large screens
  // render only the bounded preview unless the user explicitly requests full.

  app.post('/api/chat/ingest', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const text = (req.body as { text?: unknown }).text;
    if (typeof text !== 'string' || text.length === 0) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const outcome = documentStore.ingest(user, text);
    res.status(201).json(outcome);
  });

  app.post('/api/documents/upload', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const uploaded = await parseUploadRequest(req);
      const text = uploaded.text.trim();
      if (text.length === 0) {
        res.status(400).json({ error: 'Uploaded file is empty; nothing to store.' });
        return;
      }
      const ref = documentStore.addDocument(user, text);
      await persistDocuments();
      res.status(201).json({ document: ref, fileName: uploaded.fileName ?? null });
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        res.status(413).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : 'upload failed' });
    }
  });

  app.get('/api/documents', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ documents: documentStore.listForOwner(user), count: documentStore.countForOwner(user) });
  });

  app.get('/api/documents/:id', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const view = documentStore.getView(user, req.params['id']!, {
        full: req.query['full'] === 'true',
      });
      res.json(view);
    } catch (error) {
      jsonError(res, error instanceof DocumentNotFoundError ? 404 : 400, error);
    }
  });

  app.delete('/api/documents/:id', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      documentStore.removeForOwner(user, req.params['id']!);
      res.status(204).end();
    } catch (error) {
      jsonError(res, error instanceof DocumentNotFoundError ? 404 : 400, error);
    }
  });

  // â”€â”€ SPA entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Serve the NEXORA shell for the root path so the hash-router app loads.
  app.get('/', async (_req, res) => {
    try {
      const html = await fs.readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.set('Cache-Control', 'no-store').type('html').send(html);
    } catch {
      res.status(404).send('Not found');
    }
  });

  return {
    app,
    result,
    accounts,
    providerManager,
    modelCatalogue,
    documentStore,
    working: { bus, environments, jobs: jobEngine, supervisor },
    judgment,
  };
}

export async function startServer(): Promise<void> {
  const logger = createLogger({ level: 'info', sink: consoleSink() });
    const { app, accounts, working } = await buildServer();
  const host = process.env['BF_WEB_HOST']?.trim() || '127.0.0.1';
  const portRaw = Number(process.env['BF_WEB_PORT']?.trim() || '3000');
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : 3000;
      const server = app.listen(port, host, () => {
    logger.info('web.listening', { host, port });
    console.log('');
    console.log('Nexona - The Blueprint AI Software Engineering Platform');
    console.log('-------------------------------------------------------');
    console.log(`  Open in Chrome : http://${host}:${port}`);
    console.log(`  Accounts        : ${accounts.filePath}`);
    console.log('');
  });
  server.on('error', (err) => {
    logger.error('web.listen_error', { message: (err as Error).message });
    process.exit(1);
  });
  // Graceful shutdown: stop the Execution Supervisor loops (one final durable
  // evidence event) before the process exits; a supervisor crash must never
  // leave jobs falsely RUNNING.
  const stop = (): void => {
    working.supervisor.dispose();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Allow `node src/web/server.ts` to start the dev server directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    console.error('web.start_failed', error);
    process.exit(1);
  });
}

