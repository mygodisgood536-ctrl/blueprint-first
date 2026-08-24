/**
 * Staged pipeline runner.
 *
 * A pipeline is an ordered list of stages sharing a context (services + a
 * state bag). Every execution produces per-stage records with timings, and a
 * run summary that never hides failures: a failed stage stops subsequent
 * stages (unless continueOnError) and is reflected in summary.success.
 *
 * This is the skeleton future engines (Discovery -> Design -> Build ->
 * Verify) will be composed from.
 */

import { randomUUID } from 'node:crypto';
import type { ArtifactStore } from '../core/store.ts';
import type { KnowledgeGraph } from '../core/graph.ts';
import type { EvidenceLog } from '../verification/evidence.ts';
import type { Logger } from '../core/logging.ts';

export interface PipelineServices {
  store: ArtifactStore;
  graph: KnowledgeGraph;
  evidence: EvidenceLog;
  logger?: Logger;
}

export class PipelineContext {
  readonly runId: string;
  readonly services: PipelineServices;
  /** Free-form state hand-off between stages; typed at use sites. */
  readonly state: Map<string, unknown>;

  constructor(services: PipelineServices, runId?: string) {
    this.runId = runId ?? randomUUID();
    this.services = services;
    this.state = new Map();
  }
}

export interface StageOutputs {
  [key: string]: unknown;
}

export interface PipelineStage {
  name: string;
  run(ctx: PipelineContext): Promise<StageOutputs | void>;
}

export interface StageRecord {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outputs?: StageOutputs;
  error?: { code: string; message: string };
}

export interface RunSummary {
  runId: string;
  success: boolean;
  stages: StageRecord[];
}

function toErrorCode(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return { code: typeof code === 'string' ? code : 'UNCAUGHT_ERROR', message: error.message };
  }
  return { code: 'UNCAUGHT_ERROR', message: String(error) };
}

export async function runPipeline(
  stages: readonly PipelineStage[],
  services: PipelineServices,
  options?: { continueOnError?: boolean; runId?: string },
): Promise<RunSummary> {
  const ctx = new PipelineContext(services, options?.runId);
  const records: StageRecord[] = [];
  let aborted = false;

  for (const stage of stages) {
    const record: StageRecord = {
      name: stage.name,
      status: 'skipped',
      startedAt: '',
      finishedAt: '',
      durationMs: 0,
    };
    if (aborted) {
      records.push(record);
      continue;
    }
    const startedAt = Date.now();
    record.startedAt = new Date(startedAt).toISOString();
    try {
      const outputs = await stage.run(ctx);
      record.status = 'ok';
      if (outputs !== undefined && outputs !== null && Object.keys(outputs).length > 0) {
        record.outputs = outputs;
      }
    } catch (error) {
      record.status = 'failed';
      record.error = toErrorCode(error);
      aborted = !(options?.continueOnError ?? false);
    } finally {
      const finishedAt = Date.now();
      record.finishedAt = new Date(finishedAt).toISOString();
      record.durationMs = finishedAt - startedAt;
    }
    records.push(record);
  }

  const failedStages = records.filter((r) => r.status === 'failed');
  services.logger?.info('pipeline.run', {
    runId: ctx.runId,
    stages: records.length,
    failedStages: failedStages.length,
  });
  return { runId: ctx.runId, success: failedStages.length === 0, stages: records };
}
