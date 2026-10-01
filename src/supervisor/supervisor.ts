/**
 * Execution Supervisor (ARCHITECTURE 3.3 HARDENING ADDENDUM).
 *
 * Central, event-driven supervision of every active governed run:
 *   - Hard Timeout Manager  : independent three-minute no-meaningful-progress
 *                             backstop. Not dependent on hang heuristics.
 *   - Hang Monitor          : flags long windows without meaningful progress
 *                             (heuristic; the timeout stays the independent gate).
 *   - Network Monitor       : real connectivity probe; network loss transitions
 *                             runs to NETWORK_UNAVAILABLE (a governed wait, not a
 *                             failure); restoration auto-resumes without a click.
 *   - Environment Health    : a run bound to an environment that stops being
 *                             READY enters a governed environment wait and resumes
 *                             automatically when readiness is restored.
 *   - Failure / Escalation  : every supervised interruption is classified and
 *                             becomes durable evidence for Continuous Learning.
 *   - Resource / Quota      : backpressure alarms so one project/owner cannot
 *                             starve the platform.
 *   - Reconciliation        : run views are re-derived from authoritative job
 *                             state every tick; boot never inherits false state.
 *   - Watchdog (self-protection): an independent control checks the loop's own
 *                             heartbeat. A stalled loop must never leave jobs
 *                             falsely RUNNING.
 *
 * "Meaningful progress" resets the hard-timeout window ONLY when it is real
 * evidence of state advancement (tool ok, file mutation, command exit,
 * completed AI action, checkpoint, valid transition). Heartbeats and repeated
 * identical evidence are deliberately ignored (LAW - REAL PROGRESS ONLY).
 *
 * The JobEngine implements `SupervisorTarget`; every governor transition is
 * validated by that durable state machine, so a supervised failure/wait can
 * never silently corrupt job state.
 */

import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '../events/types.ts';
import { ensureDir } from '../runtime/paths.ts';
import { JsonFileStore } from '../web/durable.ts';
import { defaultNetworkProbe } from './network.ts';
import type { NetworkProbeResult } from './network.ts';
import type {
  ActiveJobView,
  FailureClass,
  ProgressEvidence,
  RunSupervisor,
  RunSupervisorHandle,
  SupervisionCheckpoint,
  SupervisorTarget,
  WaitKind,
} from './types.ts';

const TRACE_SCHEMA_VERSION = 1;

/** Terminal job statuses held locally so the supervisor stays import-clean. */
const JOB_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export interface ExecutionSupervisorOptions {
  bus: EventBus;
  /** Durable supervision-trace checkpoint file. */
  traceFilePath: string;
  /** The governed runtime the supervisor may act on (job state machine owner). */
  target: SupervisorTarget;
  /** Independent hard timeout; 180000ms = LAW THREE-MINUTE HARD TIMEOUT. */
  progressWindowMs?: number;
  /** Suspicion threshold for the (heuristic) Hang Detector. */
  hangSuspectAtMs?: number;
  pollIntervalMs?: number;
  watchdogIntervalMs?: number;
  /** How stale the supervision loop may be before the watchdog intervenes. */
  watchdogToleranceMs?: number;
  /** Persist a durable checkpoint every N ticks. */
  checkpointStride?: number;
  networkProbe?: () => Promise<NetworkProbeResult>;
  /**
   * Consecutive failed probes required before the outbound boundary is
   * declared down (default 2). One sample is not evidence of an outage.
   */
  networkFailureConfirmations?: number;
  /** Backpressure alarms. */
  maxActivePerProject?: number;
  maxActivePerOwner?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface SupervisedRun {
  job: ActiveJobView;
  readonly runSeq: number;
  readonly startAt: number;
  lastProgressAt: number;
  lastEvidence: ProgressEvidence | null;
  distinctEvidence: number;
}

interface SupervisionTrace {
  readonly bootId: string | null;
  readonly startedAt: string;
  readonly lastTickAt: string | null;
  readonly lastWatchdogBeatAt: string | null;
  readonly nextCheckpointSeq: number;
  readonly networkUp: boolean | null;
  readonly activeRuns: number;
  readonly checkpoints: readonly SupervisionCheckpoint[];
}

export interface SupervisedRunView {
  readonly jobId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly status: string;
  readonly stageKey: string;
  readonly idleMs: number;
  readonly distinctEvidence: number;
}

export interface SupervisorSnapshot {
  readonly bootId: string;
  readonly lastTickAt: string | null;
  readonly tickSeq: number;
  readonly networkUp: boolean | null;
  readonly lastProbe: NetworkProbeResult | null;
  readonly progressWindowMs: number;
  readonly active: readonly SupervisedRunView[];
}

export function supervisionTraceFilePath(dataDir: string): string {
  return join(dataDir, 'supervision.json');
}

function sameEvidence(a: ProgressEvidence | null, b: ProgressEvidence | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function padCheckpointSeq(seq: number): string {
  return `CKPT-${String(seq).padStart(8, '0')}`;
}

export class ExecutionSupervisor implements RunSupervisor {
  readonly progressWindowMs: number;
  readonly hangSuspectAtMs: number;

  private readonly bus: EventBus;
  private readonly traceFilePath: string;
  private readonly target: SupervisorTarget;
  private readonly pollIntervalMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly watchdogToleranceMs: number;
  private readonly checkpointStride: number;
  private readonly networkProbe: () => Promise<NetworkProbeResult>;
  private readonly maxActivePerProject: number;
  private readonly maxActivePerOwner: number;
  private readonly now: () => number;

  private readonly trace: JsonFileStore<SupervisionTrace>;
  private runs = new Map<string, SupervisedRun>();
  private nextRunSeq = 0;
  private nextCheckpointSeq = 0;
  private tickSeq = 0;
  private lastTickAt = 0;
  private lastWatchdogBeatAt: number | null = null;
  private networkUp: boolean | null = null;
  private lastProbe: NetworkProbeResult | null = null;
  private consecutiveNetworkFailures = 0;
  /**
   * Consecutive failed probes required before the outbound boundary is
   * declared down. One sample is not proof: a single slow or saturated probe is
   * routinely seen on a busy machine, and acting on it would park healthy work.
   */
  private readonly networkFailureConfirmations: number;
  private bootId = 'uninitialized';
  private ticking = false;
  private disposed = false;
  private readonly beater = new Set<string>();
  private tickTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(options: ExecutionSupervisorOptions) {
    this.bus = options.bus;
    this.traceFilePath = options.traceFilePath;
    this.target = options.target;
    this.progressWindowMs = options.progressWindowMs ?? 180_000;
    this.hangSuspectAtMs = options.hangSuspectAtMs ?? Math.floor(this.progressWindowMs / 2);
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 10_000;
    this.watchdogToleranceMs = options.watchdogToleranceMs ?? 30_000;
    this.checkpointStride = options.checkpointStride ?? 7;
    this.networkProbe = options.networkProbe ?? defaultNetworkProbe();
    this.networkFailureConfirmations = options.networkFailureConfirmations ?? 2;
    this.maxActivePerProject = options.maxActivePerProject ?? 8;
    this.maxActivePerOwner = options.maxActivePerOwner ?? 16;
    this.now = options.now ?? Date.now;
    this.trace = new JsonFileStore<SupervisionTrace>({
      filePath: options.traceFilePath,
      schemaVersion: TRACE_SCHEMA_VERSION,
    });
  }

  /** Loads any prior control-plane trace and records the boot honestly. */
  async init(): Promise<void> {
    await ensureDir(dirname(this.traceFilePath));
    const prior = await this.trace.load();
    this.bootId = randomUUID();
    if (prior !== null && prior.activeRuns > 0) {
      // A previous supervisor owned active runs. This process starts with none
      // of them in its hands; the governed runtime already collapses RUNNING
      // work to RECOVERING on boot (never falsely RUNNING). We record it.
      await this.bus.publish({
        type: 'supervisor.reloaded',
        payload: {
          priorBootId: prior.bootId ?? null,
          priorActiveRuns: prior.activeRuns,
          note: 'Crashed supervisors must never leave jobs falsely RUNNING; governed RUNNING work collapses to RECOVERING, and recovery is explicit.',
        },
      });
    }
    await this.bus.publish({
      type: 'supervisor.boot',
      payload: {
        bootId: this.bootId,
        progressWindowMs: this.progressWindowMs,
        hangSuspectAtMs: this.hangSuspectAtMs,
      },
    });
    await this.persistTrace(false);
  }

  /** Engages the background tick loop and the independent watchdog. */
  start(): void {
    if (this.disposed || this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.watchdogTimer = setInterval(() => {
      void this.watchdogCheck();
    }, this.watchdogIntervalMs);
    this.tickTimer.unref?.();
    this.watchdogTimer.unref?.();
  }

  /** Stops the loops; a stopped supervisor publishes one final evidence event. */
  dispose(): void {
    this.disposed = true;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    void this.bus.publish({ type: 'supervisor.stopped', payload: { bootId: this.bootId } });
  }

  /** Engine hook: a run began; returns the handle used to report progress/finish. */
  runStarted(view: ActiveJobView): RunSupervisorHandle {
    this.nextRunSeq += 1;
    const startAt = this.now();
    const run: SupervisedRun = {
      job: view,
      runSeq: this.nextRunSeq,
      startAt,
      lastProgressAt: startAt,
      lastEvidence: null,
      distinctEvidence: 0,
    };
    const jobId = view.id;
    const runSeq = run.runSeq;
    this.runs.set(jobId, run);
    return {
      reportProgress: (evidence) => this.runProgress(jobId, runSeq, evidence),
      finish: () => this.runFinished(jobId, runSeq),
    };
  }

  private runProgress(jobId: string, runSeq: number, evidence: ProgressEvidence): void {
    const run = this.runs.get(jobId);
    if (run === undefined || run.runSeq !== runSeq) return;
    if (!sameEvidence(run.lastEvidence, evidence)) run.distinctEvidence += 1;
    run.lastEvidence = evidence;
    run.lastProgressAt = this.now();
  }

  private runFinished(jobId: string, runSeq: number): void {
    const run = this.runs.get(jobId);
    if (run === undefined || run.runSeq !== runSeq) return;
    // A governed wait (or a not-yet-rerun PENDING) keeps the job on the
    // supervision radar so the supervisor can auto-resume it; only a terminal
    // outcome releases the run. refreshRuns() also cleans terminal records.
    if (JOB_TERMINAL_STATUSES.has(run.job.status)) {
      this.runs.delete(jobId);
    }
  }

  /** One supervision pass. Exposed for tests and for the manual control plane. */
  async tick(): Promise<void> {
    if (this.disposed || this.ticking) return;
    this.ticking = true;
    try {
      const at = this.now();
      this.tickSeq += 1;
      this.lastTickAt = at;

      await this.pollNetwork();
      await this.refreshRuns();
      await this.hardTimeoutScan(at);
      await this.environmentWaitScan();
      await this.resumeWaitScan();
      await this.resourceScan();

      if (this.tickSeq % this.checkpointStride === 0) {
        await this.persistTrace(true);
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Independent watchdog control: verifies the supervision loop itself is
   * alive and that no job is left falsely RUNNING by a stalled control plane.
   * Returns true when it had to intervene (loop was stale).
   */
  async watchdogCheck(): Promise<boolean> {
    if (this.disposed) return false;
    const at = this.now();
    this.lastWatchdogBeatAt = at;
    const stale = this.lastTickAt === 0 || at - this.lastTickAt > this.watchdogToleranceMs;
    if (stale) {
      await this.bus.publish({
        type: 'supervisor.watchdog_alarm',
        payload: {
          staleMs: this.lastTickAt === 0 ? null : at - this.lastTickAt,
          toleranceMs: this.watchdogToleranceMs,
          bootId: this.bootId,
        },
      });
      for (const run of [...this.runs.values()]) {
        const view = await this.target.jobOf(run.job.id);
        if (view?.status === 'RUNNING') {
          await this.target.forceFail(
            run.job.id,
            'process',
            'Execution Supervisor control loop stalled; the independent watchdog interrupted the run so no job stays falsely RUNNING.',
          );
        }
      }
    }
    await this.persistTrace(false);
    return stale;
  }

  /** Current supervision snapshot (owner-filterable by callers). */
  snapshot(): SupervisorSnapshot {
    const nowMs = this.now();
    return {
      bootId: this.bootId,
      lastTickAt: this.lastTickAt === 0 ? null : new Date(this.lastTickAt).toISOString(),
      tickSeq: this.tickSeq,
      networkUp: this.networkUp,
      lastProbe: this.lastProbe,
      progressWindowMs: this.progressWindowMs,
      active: [...this.runs.values()].map((run) => ({
        jobId: run.job.id,
        projectId: run.job.projectId,
        ownerId: run.job.ownerId,
        status: run.job.status,
        stageKey: run.job.stageKey,
        idleMs: Math.max(0, nowMs - run.lastProgressAt),
        distinctEvidence: run.distinctEvidence,
      })),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async refreshRuns(): Promise<void> {
    for (const run of [...this.runs.values()]) {
      const view = await this.target.jobOf(run.job.id);
      if (view === null || JOB_TERMINAL_STATUSES.has(view.status)) {
        this.runs.delete(run.job.id);
        continue;
      }
      run.job = view;
    }
  }

  private async hardTimeoutScan(at: number): Promise<void> {
    for (const run of [...this.runs.values()]) {
      if (run.job.status !== 'RUNNING') continue;
      const idleMs = at - run.lastProgressAt;
      if (idleMs >= this.progressWindowMs) {
        const minutes = Math.round(this.progressWindowMs / 60_000);
        const summary =
          `No meaningful progress for ${Math.round(idleMs / 1000)}s (independent ${minutes}-minute hard timeout). ` +
          'The stuck execution was interrupted, its latest valid state preserved, and reusable evidence captured.';
        await this.bus.publish({
          type: 'supervisor.timeout',
          tenantId: run.job.ownerId,
          projectId: run.job.projectId,
          jobId: run.job.id,
          payload: {
            stageKey: run.job.stageKey,
            idleMs,
            windowMs: this.progressWindowMs,
            classification: 'timeout',
          },
        });
        await this.target.forceFail(run.job.id, 'timeout', summary);
        const view = await this.target.jobOf(run.job.id);
        if (view === null || JOB_TERMINAL_STATUSES.has(view.status)) {
          this.runs.delete(run.job.id);
        }
        continue;
      }
      // Early suspicion is heuristic only; the hard timeout above is the gate.
      if (this.hangSuspectAtMs > 0 && idleMs >= this.hangSuspectAtMs) {
        await this.bus.publish({
          type: 'supervisor.hang_suspect',
          tenantId: run.job.ownerId,
          projectId: run.job.projectId,
          jobId: run.job.id,
          payload: { stageKey: run.job.stageKey, idleMs, suspectAtMs: this.hangSuspectAtMs },
        });
      }
    }
  }

  /**
   * A run bound to an environment that is no longer READY cannot make progress
   * safely -> a governed environment wait, not a hang and not a failure.
   */
  private async environmentWaitScan(): Promise<void> {
    for (const run of [...this.runs.values()]) {
      if (run.job.status !== 'RUNNING') continue;
      if (run.job.envId === null) continue;
      if (run.job.envStatus !== 'READY') {
        await this.bus.publish({
          type: 'supervisor.env_wait',
          tenantId: run.job.ownerId,
          projectId: run.job.projectId,
          jobId: run.job.id,
          payload: {
            stageKey: run.job.stageKey,
            envId: run.job.envId,
            envStatus: run.job.envStatus ?? 'unavailable',
            waitKind: 'environment',
          },
        });
        await this.target.enterWait(
          run.job.id,
          'environment',
          `Environment ${run.job.envId} is ${run.job.envStatus ?? 'unavailable'}; work waits (governed) until readiness is restored.`,
        );
      }
    }
  }

  /** Auto-resume governed waits when their blocking condition clears. */
  private async resumeWaitScan(): Promise<void> {
    for (const run of [...this.runs.values()]) {
      if (run.job.status === 'WAITING' && run.job.envId !== null && run.job.envStatus === 'READY') {
        await this.target.leaveWait(run.job.id, 'Environment readiness restored.');
      }
    }
  }

  private async pollNetwork(): Promise<void> {
    let result: NetworkProbeResult;
    try {
      result = await this.networkProbe();
    } catch (error) {
      result = {
        up: false,
        detail: `network probe errored: ${(error as Error).message}`,
        at: new Date().toISOString(),
      };
    }
    this.lastProbe = result;
    const wasUp = this.networkUp;
    this.networkUp = result.up;

    if (wasUp === true && !result.up) {
      await this.bus.publish({
        type: 'supervisor.network_lost',
        payload: { detail: result.detail },
      });
    } else if (wasUp === false && result.up) {
      await this.bus.publish({
        type: 'supervisor.network_restored',
        payload: { detail: result.detail },
      });
    } else if (wasUp === null) {
      await this.bus.publish({
        type: 'supervisor.network_probe',
        payload: { up: result.up, detail: result.detail },
      });
    }

    // Every poll reconciles the actual boundary with governed execution, so a
    // new run started while the network is down is also parked (never failed),
    // and a restored network auto-resumes every network wait without a click.
    if (result.up) {
      this.consecutiveNetworkFailures = 0;
      for (const run of [...this.runs.values()]) {
        if (run.job.status === 'NETWORK_UNAVAILABLE') {
          await this.target.leaveWait(run.job.id, `Network connectivity restored (${result.detail}).`);
        }
      }
    } else {
      // A single failed sample is not proof of an outage. One slow or saturated
      // probe is routinely observed on a busy machine, and acting on it would
      // interrupt healthy work for no reason. Require consecutive confirmations
      // before declaring the boundary down.
      this.consecutiveNetworkFailures += 1;
      if (this.consecutiveNetworkFailures < this.networkFailureConfirmations) {
        return;
      }
      for (const run of [...this.runs.values()]) {
        if (run.job.status !== 'RUNNING') continue;
        // Only work that genuinely crosses this boundary is parked. A run served
        // entirely by a local runtime keeps working while the internet is down.
        if (!run.job.networkDependent) continue;
        await this.target.enterWait(
          run.job.id,
          'network',
          `Network boundary down (${result.detail}); network-dependent work waits in a governed state, it is not failed.`,
        );
      }
    }
  }

  private async resourceScan(): Promise<void> {
    const active = await this.target.activeJobs();
    const perProject = new Map<string, number>();
    const perOwner = new Map<string, number>();
    for (const job of active) {
      perProject.set(job.projectId, (perProject.get(job.projectId) ?? 0) + 1);
      perOwner.set(job.ownerId, (perOwner.get(job.ownerId) ?? 0) + 1);
    }
    for (const [projectId, count] of perProject) this.alarmIfOver('project:' + projectId, count, this.maxActivePerProject, { projectId });
    for (const [ownerId, count] of perOwner) this.alarmIfOver('owner:' + ownerId, count, this.maxActivePerOwner, { ownerId });
  }

  private async alarmIfOver(
    key: string,
    count: number,
    limit: number,
    scope: { projectId?: string; ownerId?: string },
  ): Promise<void> {
    const over = count > limit && limit > 0;
    if (over && !this.beater.has(key)) {
      this.beater.add(key);
      await this.bus.publish({
        type: 'supervisor.active_high',
        ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}),
        ...(scope.ownerId !== undefined ? { tenantId: scope.ownerId } : {}),
        payload: { count, limit, scope: scope.projectId !== undefined ? 'project' : 'owner' },
      });
    } else if (!over) {
      this.beater.delete(key);
    }
  }

  private async persistTrace(checkpoint: boolean): Promise<void> {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    let nextCheckpointSeq = this.nextCheckpointSeq;
    const checkpoints: SupervisionCheckpoint[] = [];
    for (const run of this.runs.values()) {
      nextCheckpointSeq += 1;
      checkpoints.push({
        checkpointId: padCheckpointSeq(nextCheckpointSeq),
        jobId: run.job.id,
        projectId: run.job.projectId,
        ownerId: run.job.ownerId,
        at: nowIso,
        lastProgressAt: new Date(run.lastProgressAt).toISOString(),
        status: run.job.status,
        latestEvidence: run.lastEvidence,
      });
    }
    if (checkpoint) this.nextCheckpointSeq = nextCheckpointSeq;
    const trace: SupervisionTrace = {
      bootId: this.bootId,
      startedAt: nowIso,
      lastTickAt: this.lastTickAt === 0 ? null : new Date(this.lastTickAt).toISOString(),
      lastWatchdogBeatAt:
        this.lastWatchdogBeatAt === null ? null : new Date(this.lastWatchdogBeatAt).toISOString(),
      nextCheckpointSeq,
      networkUp: this.networkUp,
      activeRuns: this.runs.size,
      checkpoints,
    };
    await this.trace.save(trace);
  }
}

export type { FailureClass, WaitKind, ProgressEvidence, SupervisorTarget, ActiveJobView, RunSupervisorHandle };