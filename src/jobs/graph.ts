/**
 * Execution graph: a pure derivation of jobs + dependencies into nodes,
 * edges and blockage states, used by the workspace UI to render a real
 * dependency map and live progress (nothing is manufactured by the frontend).
 */

import type { JobRecord, JobStatus } from './types.ts';
import { JOB_TERMINAL_STATUSES } from './types.ts';

export interface GraphNode {
  readonly id: string;
  readonly stageKey: string;
  readonly label: string;
  readonly status: JobStatus;
  readonly ai: { providerId: string; modelId: string } | null;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface ExecutionGraph {
  readonly projectId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly statusCounts: Readonly<Record<JobStatus, number>>;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly blockages: readonly { id: string; reason: string }[];
  /** All jobs reachable through the graph from terminal COMPLETED roots. */
  readonly unlocked: readonly string[];
}

export function buildExecutionGraph(jobs: readonly JobRecord[], projectId: string): ExecutionGraph {
  const nodes: GraphNode[] = jobs.map((job) => ({
    id: job.id,
    stageKey: job.stageKey,
    label: job.label,
    status: job.status,
    ai: job.ai === null ? null : { providerId: job.ai.providerId, modelId: job.ai.modelId },
  }));

  const edges: GraphEdge[] = [];
  for (const job of jobs) {
    for (const dep of job.dependsOn ?? []) edges.push({ from: dep, to: job.id });
  }

  const statusCounts = Object.fromEntries(
    (
      [
        'PENDING',
        'BLOCKED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'PAUSED',
        'CANCELLED',
        'RECOVERING',
        'WAITING',
        'NETWORK_UNAVAILABLE',
      ] as const
    ).map((s) => [s, 0]),
  ) as Record<JobStatus, number>;
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  }

  const blockages = jobs
    .filter((j) => j.status === 'BLOCKED' && j.blockReason !== null)
    .map((j) => ({ id: j.id, reason: j.blockReason! }));

  // unlocked = nodes whose dependencies are all COMPLETED (terminal roots).
  const unlocked: string[] = [];
  for (const job of jobs) {
    const depsOk = (job.dependsOn ?? []).every((depId) => {
      const dep = jobs.find((j) => j.id === depId);
      return dep !== undefined && dep.status === 'COMPLETED';
    });
    if (depsOk && !JOB_TERMINAL_STATUSES.has(job.status) && job.status !== 'RUNNING') {
      unlocked.push(job.id);
    }
  }

  return {
    projectId,
    nodes,
    edges,
    statusCounts,
    completedCount: statusCounts['COMPLETED'],
    totalCount: jobs.length,
    blockages,
    unlocked,
  };
}