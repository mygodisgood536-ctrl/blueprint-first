/**
 * Foundation demo - what EXISTS vs what does not.
 *
 * This run demonstrates the implemented foundation mechanics only:
 *   - deterministic artifact ID allocation and canonical lineage IDs
 *   - artifact metadata/provenance, guarded status transitions
 *   - durable JSON persistence with atomic writes
 *   - Knowledge Graph registration and typed relations
 *   - AI routing through the provider seam using ScriptedProvider
 *     (DETERMINISTIC DEMO RESPONSES - this is NOT a live model)
 *   - evidence anchoring (sha256 of AI response content)
 *   - independent verification flow (worker -> specialist -> boss)
 *   - traceability reporting that honestly shows MISSING lineage links
 *
 * The Product Discovery Engine / Design Studio / Build Studio are scaffolded
 * interfaces at this stage; they are NOT demonstrated here because they do
 * not exist yet. See docs/status.md for exact completion state.
 */

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../core/config.ts';
import { consoleSink, createLogger } from '../core/logging.ts';
import { ArtifactIdAllocator } from '../core/id-allocator.ts';
import { JsonFileArtifactStore } from '../core/json-file-store.ts';
import { recordStatusChange } from '../core/store.ts';
import { KnowledgeGraph, syncArtifactToGraph } from '../core/graph.ts';
import { createArtifact } from '../core/artifact.ts';
import type { Actor } from '../core/artifact.ts';
import { AiRouter } from '../ai/router.ts';
import { ScriptedProvider } from '../ai/scripted-provider.ts';
import { MemoryEvidenceLog } from '../verification/evidence.ts';
import { summarizeReport } from '../verification/verifier.ts';
import type { VerificationFinding } from '../verification/verifier.ts';
import { certificationDecision } from '../verification/independence.ts';
import { runWorkerBossFlow } from '../orchestration/worker-boss.ts';
import { lineageStatus, coverageSummary } from '../traceability/trace.ts';

const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'foundation-demo' };
const WORKER_ACTOR: Actor = { kind: 'ai', id: 'worker-build-01', modelId: 'scripted-deterministic-v1' };
const SPECIALIST_ACTOR: Actor = { kind: 'verifier', id: 'specialist-verify-01' };
const BOSS_ACTOR: Actor = { kind: 'verifier', id: 'boss-review-01' };

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function main(): Promise<number> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, sink: consoleSink() });
  logger.info('demo.start', {
    envName: config.envName,
    dataDir: config.dataDir,
    defaultAiProvider: config.ai.defaultProvider,
    openaiCompatibleConfigured: {
      baseUrlSet: !!process.env['OPENAI_COMPATIBLE_BASE_URL'],
      apiKeyEnvVarName: config.ai.openaiCompatible.apiKeyEnvVar,
    },
  });

  const allocator = new ArtifactIdAllocator();
  const storePath = join(config.dataDir, 'blueprint-store.json');
  // The demo is a deterministic scenario: reset its own state file each run.
  await fs.rm(storePath, { force: true });
  const store = new JsonFileArtifactStore({
    filePath: storePath,
    allocator,
  });
  const evidence = new MemoryEvidenceLog();
  const graph = new KnowledgeGraph();

  // --- AI routing through the provider seam (scripted = deterministic) ------
  const scripted = new ScriptedProvider({
    rules: [
      {
        match: (req) => req.taskType === 'DESIGN',
        respond: () =>
          JSON.stringify({
            page: 'Customer List',
            purpose: 'Browse, search and open customer records.',
            sections: ['Header', 'Search bar', 'Results table'],
          }),
      },
    ],
  });
  const router = new AiRouter({ logger });
  router.register(scripted).setDefaultProvider('scripted');

  // --- Deterministic artifact creation --------------------------------------
  const project = createArtifact({
    id: allocator.nextId('PROJECT'),
    type: 'PROJECT',
    title: 'Demo Customer Portal',
    description: 'Foundation demo project created by src/demo/main.ts',
    actor: SYSTEM_ACTOR,
  });
  await store.append(project);

  const feature = createArtifact({
    id: allocator.nextId('FEATURE'),
    type: 'FEATURE',
    title: 'Customer directory',
    projectId: project.id,
    actor: SYSTEM_ACTOR,
    dependencies: [project.id],
  });
  await store.append(feature);

  const page = createArtifact({
    id: allocator.nextId('PAGE'),
    type: 'PAGE',
    title: 'Customer List page',
    projectId: project.id,
    actor: WORKER_ACTOR,
    dependencies: [feature.id],
  });
  await store.append(page);

  for (const artifact of [project, feature, page]) {
    syncArtifactToGraph(graph, artifact);
  }
  graph.link(feature.id, 'CONTAINS', project.id);
  graph.link(page.id, 'CONTAINS', feature.id);
  graph.addNode(SPECIALIST_ACTOR.id);
  graph.addNode(WORKER_ACTOR.id, undefined);

  // --- AI-assisted design step through the router (scripted, honest) -------
  const designResponse = await router.complete({
    taskType: 'DESIGN',
    messages: [{ role: 'user', content: `Design the "${page.title}" page for ${feature.title}.` }],
    requestId: 'demo-design-0001',
  });
  const designEvidence = await evidence.append({
    kind: 'external-response',
    summary: `ScriptedProvider DESIGN response (sha256=${sha256(designResponse.content).slice(0, 16)}...)`,
    artifactIds: [page.id],
    payloadRef: `sha256:${sha256(designResponse.content)}`,
    producer: { kind: 'ai', id: designResponse.providerId, modelId: designResponse.modelId },
  });

  const designArtifact = createArtifact({
    id: `${page.id}-DESIGN`,
    type: 'PAGE',
    title: `Design: ${page.title}`,
    actor: { kind: 'ai', id: designResponse.providerId, modelId: designResponse.modelId },
    dependencies: [page.id],
  });
  await store.append(designArtifact);
  syncArtifactToGraph(graph, { id: designArtifact.id, dependencies: [page.id] });
  graph.link(designArtifact.id, 'DERIVED_FROM', page.id);
  graph.link(designArtifact.id, 'VERIFIED_BY', SPECIALIST_ACTOR.id);

  // --- Worker -> Specialist -> Boss flow producing PAGE-IMPL ----------------
  const outcome = await runWorkerBossFlow<{ implId: string; summary: string }>({
    task: { title: `Implement ${page.id}`, detail: 'Produce the implementation artifact.' },
    worker: {
      actor: WORKER_ACTOR,
      produce: async () => ({
        implId: `${page.id}-IMPL`,
        summary: 'Implementation draft produced by scripted worker (demo plumbing).',
      }),
    },
    selfVerifier: {
      actor: WORKER_ACTOR,
      selfVerify: async (_task, draft) => ({
        passed: true,
        notes: `Self-check by producer origin (NON-CERTIFYING): ${draft.summary}`,
      }),
    },
    specialistVerifier: {
      actor: SPECIALIST_ACTOR,
      verify: async (_task, draft) => {
        const findings: VerificationFinding[] = [];
        findings.push({
          dimension: 'IDENTITY',
          verdict: draft.implId === `${page.id}-IMPL` ? 'pass' : 'fail',
          detail: `Implementation ID matches canonical lineage of ${page.id}.`,
        });
        const designExists = (await store.get(`${page.id}-DESIGN`)) !== null;
        findings.push({
          dimension: 'TRACEABILITY',
          verdict: designExists ? 'pass' : 'fail',
          detail: designExists
            ? `Design artifact ${page.id}-DESIGN exists and is linked.`
            : `Missing design artifact ${page.id}-DESIGN.`,
          evidenceId: designEvidence.id,
        });
        const depsOk = (await store.get(feature.id)) !== null && (await store.get(project.id)) !== null;
        findings.push({
          dimension: 'DEPENDENCY_INTEGRITY',
          verdict: depsOk ? 'pass' : 'fail',
          detail: 'All declared dependencies resolve to stored artifacts.',
        });
        const designEvidenceForPage = await evidence.forArtifact(page.id);
        findings.push({
          dimension: 'EVIDENCE_OF_WORK',
          verdict: designEvidenceForPage.length > 0 ? 'pass' : 'fail',
          detail:
            designEvidenceForPage.length > 0
              ? `Design step is backed by evidence record ${designEvidenceForPage[0]?.id ?? '?'}.`
              : `No evidence records reference ${page.id}.`,
        });
        return {
          artifactId: draft.implId,
          verifier: SPECIALIST_ACTOR,
          findings,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          notes: 'Specialist verification over a deliberate four-dimension subset (foundation demo).',
        };
      },
    },
    boss: {
      actor: BOSS_ACTOR,
      decide: async (_task, _draft, self, report) => {
        const summary = summarizeReport(report);
        if (!self.passed || summary.hasBlockingFailure) {
          return { decision: 'rejected', rationale: `Verification failures present.` };
        }
        return {
          decision: 'accepted',
          rationale: `Self-check ok; specialist findings pass (${summary.passed}) with no blocking failures. Certification NOT claimed - only ${summary.coveredDimensions.length}/11 dimensions covered.`,
        };
      },
    },
  });

  if (outcome.accepted && outcome.draft !== null) {
    const impl = createArtifact({
      id: outcome.draft.implId,
      type: 'PAGE',
      title: `Implementation: ${page.title}`,
      actor: WORKER_ACTOR,
      dependencies: [designArtifact.id],
      attributes: { implementedBy: WORKER_ACTOR.id },
    });
    await store.append(impl);
    syncArtifactToGraph(graph, { id: impl.id, dependencies: [designArtifact.id] });
    graph.link(impl.id, 'DERIVED_FROM', designArtifact.id);
    await recordStatusChange(store, impl.id, 'IN_REVIEW', SYSTEM_ACTOR, { note: 'Submitted after boss acceptance.' });
    await recordStatusChange(store, impl.id, 'VERIFIED', BOSS_ACTOR, { note: outcome.decision?.rationale ?? '' });
  }

  // --- Honest traceability reporting ----------------------------------------
  const lineage = await lineageStatus(store, page.id);
  const coverage = coverageSummary(graph, [project.id]);
  const stats = graph.stats();
  const cert = outcome.specialistReport
    ? certificationDecision(outcome.specialistReport, WORKER_ACTOR)
    : null;

  logger.info('demo.result', {
    allocatedIds: [project.id, feature.id, page.id, designArtifact.id],
    lineageLinks: lineage.links,
    lineageGaps: lineage.gaps.map((g) => g.id),
    completeThrough: lineage.completeThrough,
    requirementCoverage: coverage,
    graphStats: stats,
    flowAccepted: outcome.accepted,
    flowSteps: outcome.steps,
    certificationDecision: cert,
    providerCalls: scripted.calls,
    evidenceCount: (await evidence.all()).length,
    storeKind: store.kind,
  });

  console.log('Foundation demo finished.');
  console.log(`IDs: ${[project.id, feature.id, page.id, `${page.id}-DESIGN`, `${page.id}-IMPL`].join(' ')}`);
  console.log(`Lineage gaps (expected at this stage): ${lineage.gaps.map((g) => g.id).join(', ') || 'none'}`);
  console.log(`Certifiable now? ${cert?.certifiable === true ? 'yes' : `no (${cert?.reasons.join('; ')})`}`);
  return outcome.accepted ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('demo.failed', error);
    process.exit(1);
  });
