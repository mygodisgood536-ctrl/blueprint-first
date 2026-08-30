/**
 * Blueprint-First browser inspection layer (Level 0-5).
 *
 * Starts a minimal Express server that runs the SAME real L0-L5 pipeline the
 * CLI demo runs (single source of truth: src/demo/main.ts) and exposes the
 * resulting system state through a small REST API consumed by a static
 * frontend. The engineering core is untouched — this layer only reads the
 * existing modules and the pipeline result.
 */

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleSink, createLogger } from '../core/logging.ts';
import { runDemoPipeline, type DemoResult } from '../demo/main.ts';
import type { CoreServices } from '../core/services.ts';
import { docStateOf } from '../core/doc.ts';
import type { Artifact } from '../core/artifact.ts';
import { ConfigurationError, RoutingError } from '../core/errors.ts';
import { DuplicateCredentialError } from '../ai/credential-store.ts';
import { DocumentStore, DocumentNotFoundError } from '../chat/document.ts';
import { ModelCatalogue } from '../ai/model-catalogue.ts';
import { ModelsDevSource } from '../ai/models-dev-source.ts';
import { OpenRouterProvider } from '../ai/openrouter-provider.ts';
import { ProviderManager } from '../ai/provider-manager.ts';
import type { ModelAccessCategory } from '../ai/provider-metadata.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

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
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: express.Express;
  result: DemoResult;
  providerManager: ProviderManager;
  modelCatalogue: ModelCatalogue;
  documentStore: DocumentStore;
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
  const documentStore = options.documentStore ?? new DocumentStore();

  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  const services: CoreServices = result.services;

  // --- summary ---------------------------------------------------------------
  app.get('/api/summary', async (_req, res) => {
    const evidenceEntries = await result.evidence.all();
    res.json({
      productName: result.baseline.projectId,
      projectId: result.baseline.projectId,
      envName: result.config.envName,
      dataDir: result.config.dataDir,
      provider: 'ScriptedProvider (DETERMINISTIC DEMO RESPONSES - not a live model)',
      providerCalls: result.providerCalls,
      storeKind: services.store.kind,
      evidenceCount: evidenceEntries.length,
      graph: result.stats,
      discoveryArtifacts: result.baseline.totalArtifacts,
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
  // and never echoed; per-user isolation is enforced via the x-bf-user header
  // (a real account system will later replace this header as the identity source).

  const jsonError = (res: express.Response, status: number, error: unknown): void => {
    // Error messages never contain secrets (enforced by the core error types).
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };

  const userIdOf = (req: express.Request): string | null => {
    const raw = req.headers['x-bf-user'];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

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
      res.status(401).json({ error: 'missing x-bf-user header' });
      return;
    }
    res.json({ selection: providerManager.getCurrentSelection(user) });
  });

  app.post('/api/models/select', async (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'missing x-bf-user header' });
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
      res.status(401).json({ error: 'missing x-bf-user header' });
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
      res.status(401).json({ error: 'missing x-bf-user header' });
      return;
    }
    res.json({ credentials: providerManager.credentials.listCredentials(user) });
  });

  app.delete('/api/credentials/:id', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'missing x-bf-user header' });
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
      res.status(401).json({ error: 'missing x-bf-user header' });
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
      res.status(401).json({ error: 'missing x-bf-user header' });
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

  app.get('/api/documents', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'missing x-bf-user header' });
      return;
    }
    res.json({ documents: documentStore.listForOwner(user), count: documentStore.countForOwner(user) });
  });

  app.get('/api/documents/:id', (req, res) => {
    const user = userIdOf(req);
    if (user === null) {
      res.status(401).json({ error: 'missing x-bf-user header' });
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
      res.status(401).json({ error: 'missing x-bf-user header' });
      return;
    }
    try {
      documentStore.removeForOwner(user, req.params['id']!);
      res.status(204).end();
    } catch (error) {
      jsonError(res, error instanceof DocumentNotFoundError ? 404 : 400, error);
    }
  });

  return { app, result, providerManager, modelCatalogue, documentStore };
}

export async function startServer(): Promise<void> {
  const logger = createLogger({ level: 'info', sink: consoleSink() });
  const { app, result } = await buildServer();
  const host = process.env['BF_WEB_HOST']?.trim() || '127.0.0.1';
  const portRaw = Number(process.env['BF_WEB_PORT']?.trim() || '3000');
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : 3000;
  const server = app.listen(port, host, () => {
    logger.info('web.listening', { host, port, projectId: result.baseline.projectId });
    console.log('');
    console.log('Blueprint-First browser inspection layer');
    console.log('----------------------------------------');
    console.log(`  Project        : ${result.baseline.projectId}`);
    console.log(`  Blueprint      : ${result.design.blueprintId ?? 'n/a'}`);
    console.log(`  Certified      : ${result.certification.certified ? 'CERTIFIED' : 'NOT CERTIFIED'} (${result.certification.stampedArtifactIds.length} stamped)`);
    console.log(`  Council verdict: ${result.council.verdict}`);
    console.log(`  Safechange     : ${result.changeResult.status}`);
    console.log(`  PEO Guardian   : ${result.peoResult.watch.classifiedAs}`);
    console.log('');
    console.log(`  Open in Chrome : http://${host}:${port}`);
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
