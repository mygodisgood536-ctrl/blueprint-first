/**
 * Worker-job model: the unit of assigned work in the execution foundation.
 *
 * A job represents one stage of one project executing against the project's
 * environment. Jobs inherit the project AI configuration at enqueue time
 * (provider + model identity is captured in the record and never silently
 * changed while it runs), are scheduled by the JobEngine with dependency and
 * environment readiness checks, and surface every transition through the
 * event bus. Status is derived from real backend work, never a frontend timer.
 */

import type { FailureClass, ProgressEvidence, RunSupervisor, RunSupervisorHandle, WaitKind } from '../supervisor/types.ts';
import type { JobEnvPort } from '../env/types.ts';

export type JobStatus =
  | 'PENDING'
  | 'BLOCKED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'RECOVERING'
  /** Governed wait for an external condition (see `waitKind`). Not a hang. */
  | 'WAITING'
  /** Governed wait for network restoration (LAW: network loss is not a hang). */
  | 'NETWORK_UNAVAILABLE';

export const JOB_TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
export const JOB_ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  'PENDING',
  'BLOCKED',
  'RUNNING',
  'PAUSED',
  'RECOVERING',
  'WAITING',
  'NETWORK_UNAVAILABLE',
]);

/** AI identity captured when the job was created (document §6: never silently switch). */
export interface JobAiBinding {
  readonly providerId: string;
  readonly modelId: string;
  /** Monotonic project AI-configuration version this job was bound with. */
  readonly configVersion: number;
  readonly boundAt: string;
}

/** Real outcome of running a job, produced by the injected executor. */
export interface JobResult {
  readonly ok: boolean;
  readonly summary: string;
  /** Non-retryable failures (NO_MODEL, CANCELLED…) stop the retry policy. */
  readonly retryable?: boolean;
  /** Governed failure classification (LAW - FAILURE CLASSIFICATION). */
  readonly failureClass?: FailureClass;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly latencyMs?: number;
  /** Agentic sessions report how many model steps and tool executions ran. */
  readonly steps?: number;
  readonly toolCalls?: number;
  /** Stage output verbatim (used as evidence payload source). */
  readonly content?: string;
  readonly payloadRef?: string;
  readonly error?: string;
}

export interface JobRecord {
  readonly id: string;
  readonly projectId: string;
  /** Owning tenant; isolation enforced on every accessor. */
  readonly ownerId: string;
  readonly envId: string | null;
  readonly stageKey: string;
  readonly label: string;
  readonly mode: string;
  readonly instruction: string;
  readonly dependsOn: readonly string[];
  readonly status: JobStatus;
  /** Times a run has failed and been recorded as such. */
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly blockReason: string | null;
  /** Governed wait identity when status is WAITING; null otherwise. */
  readonly waitKind: WaitKind | null;
  /** Human reason for the governed wait state. */
  readonly waitReason: string | null;
  readonly ai: JobAiBinding | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly result: JobResult | null;
  readonly error: string | null;
  readonly evidenceId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Context handed to the executor for this run. */
export interface JobRunContext {
  readonly signal: AbortSignal;
  readonly env: { status: string; workspaceRoot: string | null } | null;
  /**
   * Real meaningful-progress evidence for the Execution Supervisor. Reporting
   * an evidence item resets the independent hard-timeout window; heartbeats
   * and repeated identical items are ignored by the supervisor.
   */
  readonly reportProgress?: (evidence: ProgressEvidence) => void;
}

export type JobExecutor = (job: JobRecord, context: JobRunContext) => Promise<JobResult>;

export type { JobEnvPort } from '../env/types.ts';
export type { FailureClass, ProgressEvidence, RunSupervisor, RunSupervisorHandle, WaitKind } from '../supervisor/types.ts';