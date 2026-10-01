/**
 * JobEngine: durable Worker job scheduler with dependency + environment gates.
 *
 *  - Jobs are persisted; a crash never leaves a job falsely RUNNING (they
 *    collapse to RECOVERING on boot and resume only through an explicit
 *    user action or retry).
 *  - Scheduling is single-flight with a reschedule flag, so bursts of
 *    enqueues collapse into one pass and dependents unlock as parents
 *    finish.
 *  - A job only starts when every dependency is COMPLETED and, when it has
 *    an environment, that environment is READY (verified by real health).
 *  - Pause/cancel abort the in-flight executor via an AbortSignal; the
 *    result of an interrupted run is never recorded as a success.
 *  - Every transition is an event on the bus with full attribution.
 */

import { join } from 'node:path';
import { BlueprintError, InvalidTransitionError } from '../core/errors.ts';
import { JsonFileStore } from '../web/durable.ts';
import type { EventBus } from '../events/types.ts';
import type { ActiveJobView, FailureClass, RunSupervisor, RunSupervisorHandle, WaitKind } from '../supervisor/types.ts';
import type { JobEnvPort } from '../env/types.ts';
import {
  JOB_TERMINAL_STATUSES,
  type JobExecutor,
  type JobRecord,
  type JobResult,
  type JobRunContext,
  type JobStatus,
} from './types.ts';

const SCHEMA_VERSION = 1;

interface JobSnapshot {
  nextSeq: number;
  jobs: JobRecord[];
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_ATTEMPTS = 2;

export interface JobEngineOptions {
  filePath: string;
  bus: EventBus;
  executor: JobExecutor;
  /** Environment port; when omitted jobs with envId start only if it is null. */
  env?: JobEnvPort;
  /** Execution Supervisor (optional): runs report real progress evidence to it. */
  supervisor?: RunSupervisor;
  maxConcurrent?: number;
  maxAttempts?: number;
}

export function jobsFilePath(dataDir: string): string {
  return join(dataDir, 'jobs.json');
}

function padJobSeq(seq: number): string {
  return `JOB-${String(seq).padStart(6, '0')}`;
}

export class JobConflictError extends BlueprintError {
  constructor(projectId: string, stageKey: string) {
    super(
      'JOB_CONFLICT',
      `Project ${projectId} already has an active job for stage "${stageKey}". Wait for it to finish or cancel it first.`,
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface EnqueueJobInput {
  projectId: string;
  ownerId: string;
  stageKey: string;
  label: string;
  mode: string;
  instruction: string;
  dependsOn?: readonly string[];
  envId?: string | null;
  maxAttempts?: number;
  ai?: JobRecord['ai'];
}

export class JobEngine {
  private readonly file: JsonFileStore<JobSnapshot>;
  private readonly bus: EventBus;
  private readonly executor: JobExecutor;
  private readonly env: JobEnvPort | undefined;
  private readonly supervisor: RunSupervisor | undefined;
  private readonly maxConcurrent: number;
  private readonly defaultMaxAttempts: number;
  private jobs = new Map<string, JobRecord>();
  private nextSeq = 1;
  private loaded = false;
  private scheduling = false;
  private rescheduleRequested = false;
  private readonly inflight = new Map<string, AbortController>();

  constructor(options: JobEngineOptions) {
    this.file = new JsonFileStore<JobSnapshot>({
      filePath: options.filePath,
      schemaVersion: SCHEMA_VERSION,
    });
    this.bus = options.bus;
    this.executor = options.executor;
    this.env = options.env;
    this.supervisor = options.supervisor;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.defaultMaxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      this.nextSeq = snapshot.nextSeq;
      for (const job of snapshot.jobs) this.jobs.set(job.id, job);
      // Backfill the governed-wait fields for records written before the
      // Execution Supervisor existed (additive migration, schema v1).
      for (const job of [...this.jobs.values()]) {
        if (job.waitKind === undefined || job.waitReason === undefined) {
          await this.patch(job, { waitKind: job.waitKind ?? null, waitReason: job.waitReason ?? null }, 'system:migration');
        }
      }
      // Crash recovery (same rule as environments): work is never booted
      // straight back into RUNNING without a fresh explicit signal.
      for (const job of [...this.jobs.values()]) {
        if (job.status === 'RUNNING') {
          await this.patch(job, { status: 'RECOVERING', error: null }, 'system:crash-recovery');
          await this.emitTransition(job.id, 'RUNNING', 'RECOVERING', 'Server restarted; job must be explicitly resumed.');
        }
      }
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.init();
  }

  private async persist(): Promise<void> {
    await this.file.save({ nextSeq: this.nextSeq, jobs: [...this.jobs.values()] });
  }

  private async patch(current: JobRecord, partial: Partial<JobRecord>, _by: string): Promise<JobRecord> {
    const next: JobRecord = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    // Persist BEFORE swapping memory so a reader (or a restarted engine on the
    // same durable file) can never observe a status the disk does not yet hold.
    await this.file.save({
      nextSeq: this.nextSeq,
      jobs: [...this.jobs.values()].map((j) => (j.id === current.id ? next : j)),
    });
    this.jobs.set(current.id, next);
    return next;
  }

  private async emitTransition(jobId: string, from: string, to: string, detail: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job === undefined) return;
    await this.bus.publish({
      type: 'job.transition',
      tenantId: job.ownerId,
      projectId: job.projectId,
      jobId: job.id,
      payload: { stageKey: job.stageKey, from, to, at: new Date().toISOString(), detail },
    });
  }

  /** Blockers for a job: unsatisfied dependencies or an unready environment. */
  private async blockersFor(job: JobRecord): Promise<string[]> {
    const reasons: string[] = [];
    for (const dep of job.dependsOn ?? []) {
      const depJob = this.jobs.get(dep);
      if (depJob === undefined) {
        reasons.push(`Dependency job ${dep} does not exist.`);
        continue;
      }
      // Dependencies are scoped: a job may only be gated by jobs of the SAME
      // project and owner, so one tenant can never gate (or leak) another's.
      if (depJob.projectId !== job.projectId || depJob.ownerId !== job.ownerId) {
        reasons.push(`Dependency ${dep} belongs to another project/owner; it cannot gate this job.`);
        continue;
      }
      if (depJob.status !== 'COMPLETED') {
        reasons.push(`Dependency ${dep} (${depJob.label}) has not completed (status ${depJob.status}).`);
      }
    }
    if (job.envId !== null && job.envId !== undefined) {
      if (this.env === undefined) {
        reasons.push(`Job requires environment ${job.envId} but no environment port is configured.`);
      } else {
        const env = await this.env.envOf(job.envId);
        if (env === null) {
          reasons.push(`Environment ${job.envId} no longer exists.`);
        } else if (env.status !== 'READY') {
          reasons.push(`Environment ${job.envId} is ${env.status}; readiness must be verified before work begins.`);
        }
      }
      // §86: a workspace backs at most one RUNNING job, so concurrent Workers
      // can never write over each other in the same tree.
      const conflicts = await this.workspaceConflicts(job);
      if (conflicts.length > 0) {
        reasons.push(`Workspace ${job.envId} is in use by running job(s) ${conflicts.join(', ')}; concurrent work is isolated, so this job waits for the workspace.`);
      }
    }
    return reasons;
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    await this.ensureLoaded();
    for (const job of this.jobs.values()) {
      if (
        job.projectId === input.projectId &&
        job.stageKey === input.stageKey &&
        !JOB_TERMINAL_STATUSES.has(job.status)
      ) {
        throw new JobConflictError(input.projectId, input.stageKey);
      }
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const id = padJobSeq(seq);
    // Dependencies are validated at enqueue: a phantom or cross-tenant
    // dependency is a wiring error, rejected loudly instead of a job that
    // sits BLOCKED forever. A brand-new job cannot be anyone's ancestor, so
    // no new cycle is possible here.
    for (const dep of input.dependsOn ?? []) {
      const depJob = this.jobs.get(dep);
      if (depJob === undefined) {
        throw new BlueprintError('INVALID_DEPENDENCY', `Dependency job ${dep} does not exist; refusing to enqueue a phantom dependency.`);
      }
      if (depJob.projectId !== input.projectId || depJob.ownerId !== input.ownerId) {
        throw new BlueprintError('INVALID_DEPENDENCY', `Dependency ${dep} is scoped to a different project/owner; cross-project dependencies are forbidden.`);
      }
    }
    const now = new Date().toISOString();
    const ai = input.ai ?? null;
    const base: JobRecord = {
      id,
      projectId: input.projectId,
      ownerId: input.ownerId,
      envId: input.envId ?? null,
      stageKey: input.stageKey,
      label: input.label,
      mode: input.mode,
      instruction: input.instruction,
      dependsOn: [...(input.dependsOn ?? [])],
      status: 'PENDING',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
      blockReason: null,
      waitKind: null,
      waitReason: null,
      ai,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      evidenceId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, base);
    await this.persist();
    await this.bus.publish({
      type: 'job.created',
      tenantId: input.ownerId,
      projectId: input.projectId,
      jobId: id,
      payload: { stageKey: input.stageKey, label: input.label, ai: ai ?? null, envId: input.envId ?? null },
    });
    void this.schedule();
    const created = this.jobs.get(id)!;
    return clone(created);
  }

  /** Re-evaluates PENDING/BLOCKED jobs against current dependency+env state. */
  private async recompute(record: JobRecord): Promise<JobRecord | null> {
    if (record.status !== 'PENDING' && record.status !== 'BLOCKED') return null;
    const reasons = await this.blockersFor(record);
    if (reasons.length === 0) {
      if (record.status === 'BLOCKED') {
        const next = await this.patch(record, { status: 'PENDING', blockReason: null }, 'scheduler');
        await this.emitTransition(record.id, 'BLOCKED', 'PENDING', 'Dependencies now satisfied.');
        return next;
      }
      return record;
    }
    const reason = reasons.join(' ');
    if (record.status === 'PENDING' || record.blockReason !== reason) {
      const next = await this.patch(record, { status: 'BLOCKED', blockReason: reason }, 'scheduler');
      await this.bus.publish({
        type: 'job.blocked',
        tenantId: record.ownerId,
        projectId: record.projectId,
        jobId: record.id,
        payload: { stageKey: record.stageKey, reason },
      });
      return next;
    }
    return record;
  }

  /** Single-flight scheduling pass: start runnable jobs up to the concurrency cap. */
  async schedule(): Promise<void> {
    if (this.scheduling) {
      this.rescheduleRequested = true;
      return;
    }
    this.scheduling = true;
    try {
      for (;;) {
        // Recomputed snapshot of every queued job.
        const all = [...this.jobs.values()];
        for (const record of all) {
          if (record.status === 'PENDING' || record.status === 'BLOCKED') {
            await this.recompute(record);
          }
        }
        const runningCount = [...this.jobs.values()].filter((j) => j.status === 'RUNNING').length;
        const runnable = [...this.jobs.values()]
          .filter((j) => j.status === 'PENDING' && !this.inflight.has(j.id))
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
        const capacity = Math.max(0, this.maxConcurrent - runningCount);
        const toStart = runnable.slice(0, capacity);
        if (toStart.length === 0) break;
        for (const job of toStart) {
          await this.startRun(job);
        }
      }
    } finally {
      this.scheduling = false;
      if (this.rescheduleRequested) {
        this.rescheduleRequested = false;
        void this.schedule();
      }
    }
  }

  private async startRun(record: JobRecord): Promise<void> {
    const started = await this.patch(record, { status: 'RUNNING', startedAt: new Date().toISOString(), error: null }, 'scheduler');
    const controller = new AbortController();
    this.inflight.set(record.id, controller);
    const env = record.envId !== null && this.env !== undefined
      ? await this.env.envOf(record.envId)
      : null;
    // Register the run with the Execution Supervisor before any other await so
    // supervision sees the RUNNING run at the same instant the engine does.
    const handle: RunSupervisorHandle | undefined =
      this.supervisor === undefined
        ? undefined
        : this.supervisor.runStarted({
            id: started.id,
            projectId: started.projectId,
            ownerId: started.ownerId,
            envId: started.envId,
            stageKey: started.stageKey,
            label: started.label,
            status: started.status,
            startedAt: started.startedAt,
            envStatus: env === null ? null : env.status,
            networkDependent: this.dependsOnNetwork(started),
          });
    await this.emitTransition(record.id, record.status, 'RUNNING', 'Boss assigned work to the Worker Runtime.');
    const context: JobRunContext = {
      signal: controller.signal,
      env: env === null ? null : { status: env.status, workspaceRoot: env.workspaceRoot },
      ...(handle !== undefined
        ? { reportProgress: (evidence) => handle.reportProgress(evidence) }
        : {}),
    };
    void (async () => {
      const outcome: JobResult = await (async () => {
        try {
          return await this.executor(this.jobs.get(record.id) ?? started, context);
        } catch (error) {
          return {
            ok: false,
            summary: `Executor threw: ${(error as Error).message}`,
            retryable: true,
            error: (error as Error).message,
          };
        }
      })();
      // Result is only meaningful if the job was not interrupted while running.
      const current = this.jobs.get(record.id);
      if (current?.status === 'RUNNING') {
        await this.settle(current, outcome);
      } else if (current?.status === 'PAUSED') {
        await this.emitTransition(record.id, 'RUNNING', 'PAUSED', 'Run interrupted by user pause; result discarded.');
      } else if (current?.status === 'CANCELLED') {
        await this.emitTransition(record.id, 'RUNNING', 'CANCELLED', 'Run interrupted by user cancellation; result discarded.');
      }
      if (handle !== undefined) handle.finish();
      this.inflight.delete(record.id);
    })();
  }

  private async settle(record: JobRecord, result: JobResult): Promise<void> {
    if (result.ok) {
      const now = new Date().toISOString();
      const finished = await this.patch(record, { status: 'COMPLETED', result, finishedAt: now }, 'worker-runtime');
      await this.emitTransition(record.id, 'RUNNING', 'COMPLETED', result.summary);
      await this.bus.publish({
        type: 'job.completed',
        tenantId: finished.ownerId,
        projectId: finished.projectId,
        jobId: finished.id,
        payload: {
          stageKey: finished.stageKey,
          summary: result.summary,
          providerId: result.providerId ?? null,
          modelId: result.modelId ?? null,
          latencyMs: result.latencyMs ?? null,
        },
      });
      void this.schedule();
      return;
    }
    const attempts = record.attempts + 1;
    if (attempts < record.maxAttempts && result.retryable !== false && record.status !== 'CANCELLED') {
      const retried = await this.patch(record, { status: 'PENDING', attempts, error: result.error ?? result.summary }, 'worker-runtime');
      await this.emitTransition(record.id, 'RUNNING', 'PENDING', `Attempt ${attempts} failed (${result.summary}); scheduling retry.`);
      await this.bus.publish({
        type: 'job.retry',
        tenantId: retried.ownerId,
        projectId: retried.projectId,
        jobId: retried.id,
        payload: { stageKey: retried.stageKey, attempts, error: result.error ?? result.summary },
      });
      void this.schedule();
      return;
    }
    const now = new Date().toISOString();
    const failed = await this.patch(
      record,
      { status: 'FAILED', attempts, result, error: result.error ?? result.summary, finishedAt: now },
      'worker-runtime',
    );
    await this.emitTransition(record.id, 'RUNNING', 'FAILED', result.summary);
    await this.bus.publish({
      type: 'job.failed',
      tenantId: failed.ownerId,
      projectId: failed.projectId,
      jobId: failed.id,
      payload: { stageKey: failed.stageKey, attempts, error: result.error ?? result.summary },
    });
    void this.schedule();
  }

  async pause(id: string, ownerId?: string): Promise<JobRecord | null> {
    const record = await this.get(id, ownerId);
    if (record === null) return null;
    if (record.status !== 'PENDING' && record.status !== 'BLOCKED' && record.status !== 'RUNNING') return record;
    const paused = await this.patch(record, { status: 'PAUSED' }, 'user');
    notify(this.inflight.get(id));
    await this.emitTransition(id, record.status, 'PAUSED', 'Job paused by user.');
    return clone(paused);
  }

  async resume(id: string, ownerId?: string): Promise<JobRecord | null> {
    const record = await this.get(id, ownerId);
    if (record === null) return null;
    if (record.status !== 'PAUSED' && record.status !== 'RECOVERING') return record;
    const resumed = await this.patch(record, { status: 'PENDING', error: null }, 'user');
    await this.emitTransition(id, record.status, 'PENDING', 'Job resumed by user; scheduling.');
    void this.schedule();
    return clone(resumed);
  }

  async cancel(id: string, ownerId?: string): Promise<JobRecord | null> {
    const record = await this.get(id, ownerId);
    if (record === null) return null;
    if (JOB_TERMINAL_STATUSES.has(record.status)) return record;
    const cancelled = await this.patch(record, { status: 'CANCELLED', finishedAt: new Date().toISOString() }, 'user');
    notify(this.inflight.get(id));
    await this.emitTransition(id, record.status, 'CANCELLED', 'Job cancelled by user.');
    return clone(cancelled);
  }

  async retry(id: string, ownerId?: string): Promise<JobRecord | null> {
    const record = await this.get(id, ownerId);
    if (record === null) return null;
    if (!JOB_TERMINAL_STATUSES.has(record.status)) return record;
    const retried = await this.patch(
      record,
      { status: 'PENDING', attempts: 0, error: null, result: null, startedAt: null, finishedAt: null },
      'user',
    );
    await this.emitTransition(id, record.status, 'PENDING', 'Job retried by user.');
    void this.schedule();
    return clone(retried);
  }

  async get(id: string, ownerId?: string): Promise<JobRecord | null> {
    await this.ensureLoaded();
    const job = this.jobs.get(id);
    if (job === undefined) return null;
    if (ownerId !== undefined && job.ownerId !== ownerId) return null;
    return clone(job);
  }

  async forProject(projectId: string, ownerId?: string): Promise<JobRecord[]> {
    await this.ensureLoaded();
    return [...this.jobs.values()]
      .filter((j) => j.projectId === projectId && (ownerId === undefined || j.ownerId === ownerId))
      .map((j) => clone(j));
  }

  async all(ownerId?: string): Promise<JobRecord[]> {
    await this.ensureLoaded();
    return [...this.jobs.values()]
      .filter((j) => ownerId === undefined || j.ownerId === ownerId)
      .map((j) => clone(j));
  }

  // ── Execution Supervisor target (governed, authoritative state transitions) ──

  private async toActiveView(job: JobRecord): Promise<ActiveJobView> {
    let envStatus: string | null = null;
    if (job.envId !== null && this.env !== undefined) {
      const env = await this.env.envOf(job.envId);
      envStatus = env === null ? null : env.status;
    }
    return {
      id: job.id,
      projectId: job.projectId,
      ownerId: job.ownerId,
      envId: job.envId,
      stageKey: job.stageKey,
      label: job.label,
      status: job.status,
      startedAt: job.startedAt,
      envStatus,
      networkDependent: this.dependsOnNetwork(job),
    };
  }

  /**
   * Whether a run genuinely crosses the platform's outbound network boundary.
   *
   * A run is local-only when the model it executes against is a runtime on this
   * machine (the `local` provider), because that runtime serves over loopback
   * and needs no outbound path. Such a run keeps working when the internet is
   * unreachable, so an outbound outage must not park or abort it. Everything
   * else - a hosted model provider, an unresolved configuration, a remote
   * workspace - genuinely depends on the boundary and is treated as
   * network-dependent, so the conservative default is always "yes".
   */
  private dependsOnNetwork(job: JobRecord): boolean {
    const providerId = job.ai?.providerId;
    if (providerId === undefined || providerId === '') return true;
    return providerId !== 'local';
  }

  async supervisorJobOf(jobId: string): Promise<ActiveJobView | null> {
    await this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (job === undefined) return null;
    return this.toActiveView(job);
  }

  async supervisorActiveJobs(): Promise<ActiveJobView[]> {
    await this.ensureLoaded();
    const views: ActiveJobView[] = [];
    for (const job of this.jobs.values()) {
      if (!JOB_TERMINAL_STATUSES.has(job.status)) views.push(await this.toActiveView(job));
    }
    return views;
  }

  /**
   * Supervisor hard fail: only a RUNNING job may transition; the in-flight
   * executor is really aborted (not hidden behind a label) and the failure is
   * classified so Continuous Learning can consume it.
   */
  async forceFailFromSupervisor(jobId: string, classification: FailureClass, summary: string): Promise<boolean> {
    await this.ensureLoaded();
    const record = this.jobs.get(jobId);
    if (record === undefined || record.status !== 'RUNNING') return false;
    const failed = await this.patch(
      record,
      {
        status: 'FAILED',
        error: summary,
        result: { ok: false, summary, retryable: false, error: summary, failureClass: classification },
        finishedAt: new Date().toISOString(),
      },
      'execution-supervisor',
    );
    // The status is durable first so the run's executor continuation (which
    // only settles when the record still reads RUNNING) discards its late
    // result instead of racing and overwriting the supervised kill.
    notify(this.inflight.get(jobId));
    await this.emitTransition(jobId, 'RUNNING', 'FAILED', summary);
    await this.bus.publish({
      type: 'job.supervised_failure',
      tenantId: failed.ownerId,
      projectId: failed.projectId,
      jobId: failed.id,
      payload: { stageKey: failed.stageKey, classification, summary },
    });
    void this.schedule();
    return true;
  }

  /**
   * Supervisor governed wait: RUNNING -> WAITING (or NETWORK_UNAVAILABLE for
   * network loss). In-flight work is aborted because it cannot proceed; the
   * job is preserved and resumes automatically when the condition clears.
   */
  async enterWaitFromSupervisor(jobId: string, waitKind: WaitKind, reason: string): Promise<boolean> {
    await this.ensureLoaded();
    const record = this.jobs.get(jobId);
    if (record === undefined || record.status !== 'RUNNING') return false;
    const status: JobStatus = waitKind === 'network' ? 'NETWORK_UNAVAILABLE' : 'WAITING';
    const waited = await this.patch(record, { status, waitKind, waitReason: reason }, 'execution-supervisor');
    notify(this.inflight.get(jobId));
    await this.emitTransition(jobId, 'RUNNING', status, reason);
    await this.bus.publish({
      type: 'job.waiting',
      tenantId: waited.ownerId,
      projectId: waited.projectId,
      jobId: waited.id,
      payload: { stageKey: waited.stageKey, waitKind, reason },
    });
    return true;
  }

  /** Supervisor auto-resume: WAITING/NETWORK_UNAVAILABLE -> PENDING -> schedule. */
  async leaveWaitFromSupervisor(jobId: string, detail: string): Promise<boolean> {
    await this.ensureLoaded();
    const record = this.jobs.get(jobId);
    if (record === undefined) return false;
    if (record.status !== 'WAITING' && record.status !== 'NETWORK_UNAVAILABLE') return false;
    const from = record.status;
    const resumed = await this.patch(
      record,
      { status: 'PENDING', waitKind: null, waitReason: null },
      'execution-supervisor',
    );
    await this.emitTransition(jobId, from, 'PENDING', `Auto-resumed: ${detail}`);
    await this.bus.publish({
      type: 'job.auto_resumed',
      tenantId: resumed.ownerId,
      projectId: resumed.projectId,
      jobId: resumed.id,
      payload: {
        stageKey: resumed.stageKey,
        waitKind: from === 'NETWORK_UNAVAILABLE' ? 'network' : (record.waitKind ?? 'unknown'),
        detail,
      },
    });
    void this.schedule();
    return true;
  }

  /**
   * LAW - STALE JOB INVALIDATION (3.3 §88).
   *
   * When certified upstream state changes, every downstream job that relied on
   * the stale state must be identified and routed through governance rather
   * than being allowed to execute - and then become certified - against
   * assumptions that no longer hold.
   *
   * `invalidateStaleJobs` takes the set of upstream artifact/versions that just
   * changed certification state and returns every non-terminal job in the same
   * project whose dependency chain reaches them. Those jobs are stopped for
   * real (an in-flight run is aborted, exactly like a governed interruption),
   * returned to PENDING with the reason recorded, and a durable event records
   * the invalidation so it survives into the execution history.
   */
  async invalidateStaleJobs(input: {
    projectId: string;
    changedArtifactIds: readonly string[];
    reason: string;
    by: string;
  }): Promise<readonly JobRecord[]> {
    await this.ensureLoaded();
    const changed = new Set(input.changedArtifactIds);
    if (changed.size === 0) return [];

    // Reverse dependency walk: which jobs transitively depend on the change?
    const dependents = new Map<string, string[]>();
    for (const job of this.jobs.values()) {
      for (const dep of job.dependsOn ?? []) {
        const list = dependents.get(dep);
        if (list === undefined) dependents.set(dep, [job.id]);
        else list.push(job.id);
      }
    }
    const affected = new Set<string>();
    const queue = [...changed];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const dependentId of dependents.get(current) ?? []) {
        if (affected.has(dependentId)) continue;
        affected.add(dependentId);
        queue.push(dependentId);
      }
    }

    const invalidated: JobRecord[] = [];
    for (const jobId of affected) {
      const record = this.jobs.get(jobId);
      if (record === undefined) continue;
      if (record.projectId !== input.projectId) continue;
      // Terminal work is never rewritten: its certification history is immutable
      // and is re-evaluated through the Change/Reopening process instead.
      if (JOB_TERMINAL_STATUSES.has(record.status)) continue;
      const next = await this.patch(
        record,
        { status: 'PENDING', blockReason: input.reason, waitKind: null, waitReason: null },
        input.by,
      );
      // A job that was actually running is really interrupted, not relabelled.
      notify(this.inflight.get(jobId));
      await this.emitTransition(jobId, record.status, 'PENDING', `Invalidated: ${input.reason}`);
      await this.bus.publish({
        type: 'job.invalidated',
        tenantId: next.ownerId,
        projectId: next.projectId,
        jobId: next.id,
        payload: {
          stageKey: next.stageKey,
          reason: input.reason,
          changedArtifactIds: [...changed],
          by: input.by,
        },
      });
      invalidated.push(next);
    }
    if (invalidated.length > 0) void this.schedule();
    return invalidated;
  }

  /**
   * LAW - CONCURRENT WORK IS ISOLATED (3.3 §86).
   *
   * Two jobs of the same project must never execute against the same workspace
   * at the same time, or one Worker could silently overwrite another's files.
   * A workspace may back at most one RUNNING job, so a second run is held in a
   * governed wait (never failed) until the workspace is free, and resumes
   * automatically. Different projects are unaffected by design: their
   * workspaces are distinct roots.
   */
  private async workspaceConflicts(record: JobRecord): Promise<string[]> {
    if (record.envId === null || record.envId === undefined) return [];
    const conflicts: string[] = [];
    for (const [id, other] of this.jobs) {
      if (id === record.id) continue;
      if (other.envId !== record.envId) continue;
      if (other.status === 'RUNNING') conflicts.push(id);
    }
    return conflicts;
  }
}

function notify(controller: AbortController | undefined): void {
  if (controller !== undefined && !controller.signal.aborted) {
    try {
      controller.abort();
    } catch {
      // already aborted
    }
  }
}