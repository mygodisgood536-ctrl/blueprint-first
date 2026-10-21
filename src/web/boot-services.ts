/**
 * Production boot state for the web server (Decision D5).
 *
 * Historically the web server booted by running the demo pipeline
 * (src/demo/main.ts) once per process: a single, hardcoded "TeamTask" scenario
 * using a ScriptedProvider. That made every lifecycle API describe one fake
 * project, cost ~15s per boot and could not survive serverless cold starts.
 *
 * This module builds the REAL core services instead - an empty durable artifact
 * store, knowledge graph, evidence log and router - plus the project registry,
 * the per-project stage-state store and the real ProjectExecution runner. No
 * pipeline runs at boot; projects are created and advanced on demand through
 * the API.
 *
 * `neutralBootResult` returns a DemoResult-shaped snapshot whose demo-only
 * scenario fields are absent, so the legacy stage endpoints degrade to their
 * honest PENDING_* payloads until they are migrated to per-project reads.
 */

import { join } from 'node:path';
import { ArtifactIdAllocator } from '../core/id-allocator.ts';
import { KnowledgeGraph } from '../core/graph.ts';
import { AiRouter } from '../ai/router.ts';
import { loadConfig } from '../core/config.ts';
import type { CoreServices } from '../core/services.ts';
import type { ArtifactStore } from '../core/store.ts';
import type { Logger } from '../core/logging.ts';
import type { EvidenceLog } from '../verification/evidence.ts';
import { ProjectRegistry } from '../project/registry.ts';
import { StageStateStore } from '../project/stage-state.ts';
import { ProjectExecution } from '../project/execution.ts';
import { composeArtifactStore, initArtifactStore, reserveIdBlocks } from '../storage/compose.ts';
import { initStorage, type StorageKind } from '../storage/index.ts';
import type { DemoResult } from '../demo/main.ts';

export interface BootServices {
  readonly services: CoreServices;
  readonly registry: ProjectRegistry;
  readonly stageState: StageStateStore;
  readonly execution: ProjectExecution;
  readonly store: ArtifactStore;
  readonly allocator: ArtifactIdAllocator;
  readonly graph: KnowledgeGraph;
  readonly config: ReturnType<typeof loadConfig>;
  /** Live durable backend: 'json-file' (development) or 'postgresql' (production). */
  readonly persistenceKind: StorageKind;
  /** Honest storage readiness for the startup gate. */
  readonly persistence: { ok: boolean; detail: string; migrations: string[] };
}

/** Durable artifact-store path (shared by every project in this data dir). */
export function blueprintStoreFilePath(dataDir: string): string {
  return join(dataDir, 'blueprint-store.json');
}

/** Durable per-project stage-state path. */
export function stageStateFilePath(dataDir: string): string {
  return join(dataDir, 'stage-state.json');
}

/**
 * Builds the real services, registry, stage-state store and execution runner.
 * No provider is bound to the boot router; per-request routers (bound to the
 * project's verified provider/model) are injected into `runStage` by the API.
 */
export async function createBootServices(input: {
  dataDir: string;
  evidence: EvidenceLog;
  logger?: Logger;
}): Promise<BootServices> {
  const config = loadConfig(process.env);
  const persistence = await initStorage();
  const allocator = new ArtifactIdAllocator();
  const composed = composeArtifactStore({
    filePath: blueprintStoreFilePath(input.dataDir),
    allocator,
  });
  const store = composed.store;
  // The IDs that already exist are observed BEFORE the canonical-ID blocks are
  // reserved. A reserved block is exclusive to the instance that reserved it
  // and must start above everything that has been minted, so the observation
  // has to happen first. Reserving first would place this instance's counter
  // at the end of its own fresh block, and the first ID it handed out would
  // look exhausted.
  await initArtifactStore(store);
  // Reserve canonical-ID headroom before the first request can mint one.
  await reserveIdBlocks(allocator);
  const graph = new KnowledgeGraph();
  const router = new AiRouter({ ...(input.logger !== undefined ? { logger: input.logger } : {}) });
  const registry = new ProjectRegistry({ store, allocator, graph, evidence: input.evidence, router, ...(input.logger !== undefined ? { logger: input.logger } : {}) });
  const services: CoreServices = {
    store,
    allocator,
    graph,
    evidence: input.evidence,
    router,
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
    projects: registry,
  };
  const stageState = new StageStateStore({ filePath: stageStateFilePath(input.dataDir) });
  await stageState.init();
  const execution = new ProjectExecution({ services, stages: stageState, ...(input.logger !== undefined ? { logger: input.logger } : {}) });
  return {
    services,
    registry,
    stageState,
    execution,
    store,
    allocator,
    graph,
    config,
    persistenceKind: composed.kind as StorageKind,
    persistence: { ok: persistence.ok, detail: persistence.detail, migrations: persistence.migrations },
  };
}

/**
 * A DemoResult-shaped view of the real boot services with no scenario data.
 * Used only so the not-yet-migrated endpoints keep returning their honest
 * PENDING_* payloads instead of crashing. Every scenario field is deliberately
 * absent; the core fields (services/store/graph/evidence/registry/config) are
 * the real objects.
 */
export function neutralBootResult(boot: BootServices): DemoResult {
  const missing = undefined as unknown;
  return {
    services: boot.services,
    config: boot.config,
    evidence: boot.services.evidence,
    stats: boot.graph.stats(),
    providerCalls: 0,
    graph: boot.graph,
    store: boot.store as DemoResult['store'],
    allocator: boot.allocator,
    registry: boot.registry,
    projectMode: 'full-product',
    discovery: missing as DemoResult['discovery'],
    baseline: missing as DemoResult['baseline'],
    design: missing as DemoResult['design'],
    approval: missing as DemoResult['approval'],
    build: missing as DemoResult['build'],
    council: missing as DemoResult['council'],
    master: missing as DemoResult['master'],
    trace: missing as DemoResult['trace'],
    certification: missing as DemoResult['certification'],
    testRun: missing as DemoResult['testRun'],
    opsRun: missing as DemoResult['opsRun'],
    contRun: missing as DemoResult['contRun'],
    telemetryObservation: missing as DemoResult['telemetryObservation'],
    telemetrySource: missing as DemoResult['telemetrySource'],
    recursionResult: missing as DemoResult['recursionResult'],
    changeResult: missing as DemoResult['changeResult'],
    peoCandidate: missing as DemoResult['peoCandidate'],
    peoResult: missing as DemoResult['peoResult'],
    finalArtifact: missing as DemoResult['finalArtifact'],
    closureIds: missing as DemoResult['closureIds'],
    firstPageId: missing as DemoResult['firstPageId'],
    lineage: missing as DemoResult['lineage'],
    coverage: missing as DemoResult['coverage'],
    project: missing as DemoResult['project'],
    designCoverage: missing as DemoResult['designCoverage'],
    fullDepartment: missing as DemoResult['fullDepartment'],
    twin: missing as DemoResult['twin'],
    businessModel: missing as DemoResult['businessModel'],
    threatModel: missing as DemoResult['threatModel'],
    uxVerification: missing as DemoResult['uxVerification'],
    designCodeTrace: missing as DemoResult['designCodeTrace'],
    projectBinding: missing as DemoResult['projectBinding'],
    portability: missing as DemoResult['portability'],
    account: missing as DemoResult['account'],
    designQuality: missing as DemoResult['designQuality'],
    designConsistency: missing as DemoResult['designConsistency'],
    visual: missing as DemoResult['visual'],
    scripted: missing as DemoResult['scripted'],
  };
}
