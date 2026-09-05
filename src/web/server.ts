/**
 * Nexona web application server.
 *
 * Serves the Nexona browser product: a single-page application backed by an
 * authenticated REST API that orchestrates the existing Blueprint-First
 * engineering core (src/demo/main.ts pipeline = single source of truth for the
 * engine showcase). The engineering core is untouched — this layer wires real
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
import { ConfigurationError, RoutingError } from '../core/errors.ts';
import { DurableAccountRegistry } from '../account/durable-registry.ts';
import { assertSameOrigin, attachAuth } from './auth.ts';
import { registerAuthApi } from './auth-api.ts';
import { DurableDocumentStore, documentsFilePath } from './durable-documents.ts';
import { ensureDir, resolveDataDir } from '../runtime/paths.ts';
import { DuplicateCredentialError } from '../ai/credential-store.ts';
import { DocumentStore, DocumentNotFoundError } from '../chat/document.ts';
import { ModelCatalogue } from '../ai/model-catalogue.ts';
import { ModelsDevSource } from '../ai/models-dev-source.ts';
import { OpenRouterProvider } from '../ai/openrouter-provider.ts';
import { ProviderManager } from '../ai/provider-manager.ts';
import type { ModelAccessCategory } from '../ai/provider-metadata.ts';
import { PROJECT_MODE_STAGES, PROJECT_MODES } from '../project/types.ts';
import type { ProjectMode } from '../project/types.ts';

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
    note: '§T.4 append-only certification history. Implemented in core, not invoked in this pipeline run.',
  },
  {
    id: 'living-blueprint',
    label: 'Living Blueprint materialization',
    module: 'src/perm/living-blueprint.ts',
    note: '§5.3 Living Blueprint snapshot. Implemented in core, not invoked in this pipeline run (a PEO/continuous run stamps -PERM manifests).',
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
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: express.Express;
  result: DemoResult;
  providerManager: ProviderManager;
  modelCatalogue: ModelCatalogue;
  documentStore: DocumentStore | DurableDocumentStore;
  accounts: DurableAccountRegistry;
}> {
  const logger = createLogger({ level: 'warn', sink: consoleSink() });
  const result = options.result ?? (await runDemoPipeline(logger));
  const modelCatalogue =
    options.modelCatalogue ??
    new ModelCatalogue({
      modelsDevSource: new ModelsDevSource({}),
      ...(process.env['OPENROUTER_API_KEY']?.trim()
        ? {
            openRouterProvider: new OpenRouterProvider({
              apiKey: process.env['OPENROUTER_API_KEY'].trim(),
            }),
          }
        : {}),
    });
  const providerManager = options.providerManager ?? new ProviderManager({ logger });

  // --- Nexona durable application state (survives restarts) --------------------
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  const accounts =
    options.accounts ??
    (await DurableAccountRegistry.load(join(dataDir, 'accounts.json'), SESSION_TTL_MS));
  const documentStore: DocumentStore | DurableDocumentStore =
    options.documentStore ?? new DurableDocumentStore({ filePath: documentsFilePath(dataDir) });
  if (documentStore instanceof DurableDocumentStore) await documentStore.init();
  const persistDocuments = async (): Promise<void> => {
    if (documentStore instanceof DurableDocumentStore) await documentStore.persist();
  };

  const app = express();
  app.use(express.json());
  app.use(assertSameOrigin); // CSRF defense: cross-site writes are rejected
  app.use(attachAuth(accounts)); // identity = verified session cookie only
  app.use('/nexona', express.static(PUBLIC_DIR));

  // --- Nexona authentication & account security --------------------------------
  registerAuthApi(app, { accounts });

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
  app.get('/api/summary', async (_req, res) => {
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
      title: d.preview.length > 60 ? `${d.preview.slice(0, 60)}…` : d.preview,
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
      createdAt: project.createdAt,
      updatedAt: project.updatedAt ?? null,
      stages: stagesForMode.map((s) => ({
        stageId: s.stageId,
        label: s.label,
        inScope: s.inScope,
        status: !s.inScope ? 'OUT_OF_SCOPE' : stagesRun.some((r) => r.stageId === s.stageId) ? 'RECORDED' : 'PENDING',
        at: stagesRun.find((r) => r.stageId === s.stageId)?.at ?? null,
      })),
      approval: approval ?? null,
      stagesRunCount: stagesRun.length,
    });
  });
          

  // ── project update (settings) ─────────────────────────────────────────────
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
    const body = req.body as { title?: unknown; mode?: unknown };
    const newTitle =
      typeof body.title === 'string' && body.title.trim().length >= 2 && body.title.trim().length <= 64
        ? body.title.trim() : null;
    const newMode =
      typeof body.mode === 'string' && (PROJECT_MODES as readonly string[]).includes(body.mode)
        ? body.mode : null;
    if (newTitle === null && newMode === null) {
      res.status(400).json({ error: 'No valid updates provided. Supply title (2-64 chars) and/or a valid mode.' });
      return;
    }
    try {
      const updated = await result.services.store.update(project.id, project.version, (draft) => ({
        ...draft,
        ...(newTitle !== null ? { title: newTitle } : {}),
        attributes: { ...draft.attributes, ...(newMode !== null ? { mode: newMode } : {}) },
      }));
      res.json({ project: projectSummary(updated) });
    } catch (error) {
      jsonError(res, 400, error);
    }
  });

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
    const body = req.body as { name?: unknown; vision?: unknown; mode?: unknown };
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
    const account = req.account;
    try {
      const project = await result.registry.createProject({
        title: name,
        description: vision,
        mode: mode as ProjectMode,
        owner: { userId: user, label: account !== undefined ? account.displayName ?? account.username : user },
        actor: { kind: 'human', id: user },
        scope: [name],
        config: { vision, source: 'nexona-web' },
      });
      // Creating a project records a PROJECT artifact; it does NOT fabricate
      // a pipeline run, so the discovery artifact count is honestly zero.

      res.status(201).json({
        project: projectSummary(project),
        summary: {
          discoveryArtifacts: 0,
          message: 'Project created as a structured PROJECT artifact. Run lifecycle stages from the project page.',
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
    await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: { ...draft.attributes, deleted: true, deletedAt: new Date().toISOString() },
    }));
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
    const now = new Date().toISOString();
    const nextStages = [...stagesRun, { stageId, label: stage.label, at: now, recordedBy: user }];
    await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: { ...draft.attributes, stages: nextStages },
    }));
    await result.evidence.append({
      kind: 'inspection',
      summary: `Stage "${stage.label}" run checkpoint recorded for project ${project.id} (mode ${mode}) by ${user}.`,
      artifactIds: [project.id],
      producer: { kind: 'system', id: 'web-project-api' },
    });
    res.json({
      projectId: project.id,
      stageId,
      label: stage.label,
      status: 'RECORDED',
      at: now,
      summary: `Stage "${stage.label}" recorded on the project lifecycle ledger (mode ${mode}).`,
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
    const stagesRun = (project.attributes['stages'] as readonly { stageId: string }[] | undefined) ?? [];
    if (!stagesRun.some((r) => r.stageId === 'blueprint')) {
      res.status(409).json({ error: 'Run the Blueprint stage before approving it (the approval gate acts on the blueprint).' });
      return;
    }
    const now = new Date().toISOString();
    await result.services.store.update(project.id, project.version, (draft) => ({
      ...draft,
      attributes: { ...draft.attributes, approval: { status: 'APPROVED', approvedAt: now, approvedBy: user } },
    }));
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
  app.get('/api/roadmap', (_req, res) => {
    res.json({ roadmap: ROADMAP });
  });

  // --- caps (capabilities available vs not exercised) -------------------------
  app.get('/api/caps', (_req, res) => {
    res.json({ availableNotExercised: AVAILABLE_NOT_EXERCISED });
  });

  // --- project / discovery ----------------------------------------------------
  app.get('/api/discovery', (_req, res) => {
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

  // --- design / engineering artifacts -----------------------------------------
  app.get('/api/design', (_req, res) => {
    res.json({
      status: result.design.status,
      blueprintId: result.design.blueprintId ?? null,
      artifactIds: result.design.artifactIds,
      approval: result.approval,
    });
  });

  // --- multi-perspective reasoning council ------------------------------------
  app.get('/api/council', (_req, res) => {
    res.json({
      subject: result.council.subject ?? result.design.blueprintId,
      verdict: result.council.verdict,
      seats: result.council.seats ?? null,
    });
  });

  // --- master verification ----------------------------------------------------
  app.get('/api/verification', (_req, res) => {
    res.json({
      masterPassed: result.master.masterPassed,
      subjectsAudited: result.master.subjectCount,
      blockingFails: result.master.blockingFails,
      unresolvedInconclusive: result.master.unresolvedInconclusive,
      notes: result.master.notes,
      closureArtifactCount: result.closureIds.length,
      rollup: result.master.rollup,
      reports: Object.keys(result.master.reports).length,
    });
  });

  // --- acceptance testing ------------------------------------------------------
  app.get('/api/testing', (_req, res) => {
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
  app.get('/api/deployment', (_req, res) => {
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
  app.get('/api/telemetry', (_req, res) => {
    res.json({
      observation: result.telemetryObservation,
      sourceKind: result.telemetrySource.kind,
    });
  });

  // --- continuous engineering ----------------------------------------------------
  app.get('/api/continuous', (_req, res) => {
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
  app.get('/api/recursion', (_req, res) => {
    res.json({
      classification: result.recursionResult.classification,
      allRemediated: result.recursionResult.allRemediated,
      changeCount: result.recursionResult.changes.length,
      baseIds: result.recursionResult.changes.map((c) => c.drift.artifactId),
    });
  });

  // --- safe change ----------------------------------------------------------------
  app.get('/api/safe-change', (_req, res) => {
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
      finalDocState: docStateOf(result.finalArtifact) ?? null,
    });
  });

  // --- PEO (Permanent Engineering Organization) -----------------------------------
  app.get('/api/peo', (_req, res) => {
    res.json({
      source: result.peoResult.source,
      authorized: result.peoResult.authorized,
      escalated: result.peoResult.escalated,
      rationale: result.peoResult.rationale,
      watch: result.peoResult.watch,
      impact: result.peoResult.impact,
      change: result.peoResult.change,
      candidate: result.peoCandidate,
    });
  });

  // --- artifacts inventory --------------------------------------------------------
  app.get('/api/artifacts', async (_req, res) => {
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
  app.get('/api/dependency-map', (_req, res) => {
    const edges = services.graph.allEdges().map((e) => ({
      from: e.from,
      relation: e.relation,
      to: e.to,
    }));
    res.json({ nodeCount: result.stats.nodeCount, edgeCount: result.stats.edgeCount, edges });
  });

  // --- lineage / provenance --------------------------------------------------------
  app.get('/api/lineage', (_req, res) => {
    res.json({
      firstPageId: result.firstPageId,
      links: result.lineage.links,
      completeThrough: result.lineage.completeThrough,
      gaps: result.lineage.gaps,
    });
  });

  // --- evidence / certification detail ------------------------------------------------
  app.get('/api/evidence', async (_req, res) => {
    const all = await result.evidence.all();
    res.json({ count: all.length, entries: all });
  });

  app.get('/api/certification', (_req, res) => {
    res.json({
      certified: result.certification.certified,
      reasons: result.certification.reasons,
      stampedArtifactIds: result.certification.stampedArtifactIds,
      evidenceId: result.certification.evidenceId ?? null,
      confidence: result.certification.confidence ?? null,
      trace: result.trace,
    });
  });

  // --- traceability ----------------------------------------------------------------
  app.get('/api/traceability', (_req, res) => {
    res.json(result.trace);
  });

  // --- model selector (catalogue + credentials + selection) -------------------------
  // Honest-surface rules: a catalogue entry proves a model EXISTS; `verified`
  // proves ACCESSIBLE via a real connection test. Credentials are accepted once
  // and never echoed; per-user identity comes exclusively from the verified
  // session cookie — a client can never assert an identity via a header.

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

  app.get('/api/models', async (req, res) => {
    try {
      const rawCategories = req.query['accessCategory'];
      const requested = Array.isArray(rawCategories) ? rawCategories : rawCategories ? [rawCategories] : [];
      const categories = requested.filter((c): c is ModelAccessCategory =>
        typeof c === 'string' && (ACCESS_CATEGORIES as readonly string[]).includes(c),
      );
      const search = await modelCatalogue.search({
        ...(typeof req.query['q'] === 'string' && req.query['q'].length > 0
          ? { searchTerm: req.query['q'] }
          : {}),
        ...(categories.length > 0 ? { accessCategories: categories } : {}),
        ...(req.query['availableOnly'] === 'true' ? { availableOnly: true } : {}),
      });
      res.json({ total: search.total, models: search.models, sources: search.sources });
    } catch (error) {
      jsonError(res, 502, error); // upstream catalogue failure, reported honestly
    }
  });

  app.get('/api/models/stats', async (_req, res) => {
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
      if (body.providerId === 'openrouter') {
        const ref = providerManager.credentials.findByUserAndProvider(user, 'openrouter');
        if (ref === null) {
          res.status(409).json({
            error: 'No OpenRouter credential for this user. Add one (POST /api/credentials); CONFIGURED does not mean AVAILABLE.',
          });
          return;
        }
        res.json(await providerManager.selectOpenRouterModel(user, ref.id, body.modelId));
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
      if (ref.providerId !== 'openrouter') {
        // Honest surface: no fabricated verification for unimplemented providers.
        res.status(501).json({ error: `connection verification for provider \"${ref.providerId}\" is not implemented yet` });
        return;
      }
      providerManager.connectOpenRouter(user, ref.id, options.openRouterFetchImpl);
      res.json(await providerManager.verifyOpenRouter(user, req.params['id']!));
    } catch (error) {
      jsonError(res, 404, error);
    }
  });

  // --- chat-first / document handling (expansion §14-15) -------------------------
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

  // ── SPA entry point ─────────────────────────────────────────────────────────
  // Serve the NEXORA shell for the root path so the hash-router app loads.
  app.get('/', async (_req, res) => {
    try {
      const html = await fs.readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.type('html').send(html);
    } catch {
      res.status(404).send('Not found');
    }
  });

  return { app, result, accounts, providerManager, modelCatalogue, documentStore };
}

export async function startServer(): Promise<void> {
  const logger = createLogger({ level: 'info', sink: consoleSink() });
    const { app, accounts } = await buildServer();
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
}

// Allow `node src/web/server.ts` to start the dev server directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    console.error('web.start_failed', error);
    process.exit(1);
  });
}
