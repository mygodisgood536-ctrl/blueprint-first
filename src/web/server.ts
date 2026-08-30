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

export async function buildServer(): Promise<{
  app: express.Express;
  result: DemoResult;
}> {
  const logger = createLogger({ level: 'warn', sink: consoleSink() });
  const result = await runDemoPipeline(logger);

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

  return { app, result };
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
