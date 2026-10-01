/**
 * Execution Supervisor contracts (ARCHITECTURE 3.3 HARDENING ADDENDUM).
 *
 * The Execution Supervisor is the central, event-driven control mechanism for
 * every active project, Worker, job, agent session, tool execution, process
 * and environment. It coordinates the Hang Monitor, Hard Timeout Manager,
 * Network Monitor, Job State Manager, Checkpoint/Recovery Engine,
 * Failure/Retry/Escalation Manager, Environment Health Monitor,
 * Resource/Quota Monitor and external-state Reconciliation Manager. These
 * are backend
 * control mechanisms - never frontend timers - and every decision is
 * recorded as durable evidence on the event bus.
 *
 * The types in this file are deliberately free of job-engine imports so the
 * supervision contract can live at one boundary and be implemented by any
 * governed execution component (today: the Worker Job engine).
 */

/**
 * Meaningful-progress evidence classes (LAW - REAL PROGRESS ONLY).
 *
 * Progress is evidence of actual state advancement: a completed tool
 * operation, a meaningful file mutation, command/process advancement, a
 * completed AI action, a verified checkpoint or a valid state transition.
 * Heartbeats, log spam, repeated status messages, token generation alone,
 * progress-bar animation or timestamp changes are NOT meaningful progress
 * and must not reset the supervision window.
 */
export type ProgressEvidence =
  | { readonly kind: 'tool'; readonly tool: string; readonly ok: boolean }
  | { readonly kind: 'file-mutation'; readonly path: string }
  | { readonly kind: 'command'; readonly command: string; readonly exitCode: number }
  | { readonly kind: 'process'; readonly pid: number; readonly detail: string }
  | { readonly kind: 'ai-step'; readonly providerId: string; readonly modelId: string }
  | { readonly kind: 'api'; readonly operation: string; readonly ok: boolean }
  | { readonly kind: 'test'; readonly passed: number; readonly failed: number }
  | { readonly kind: 'checkpoint'; readonly checkpointId: string }
  | { readonly kind: 'transition'; readonly from: string; readonly to: string };

/** Failure classification set (LAW - FAILURE CLASSIFICATION). */
export type FailureClass =
  | 'model'
  | 'provider'
  | 'authentication'
  | 'rate-limit'
  | 'tool'
  | 'cline'
  | 'opencode'
  | 'daytona'
  | 'network'
  | 'process'
  | 'dependency'
  | 'code'
  | 'requirement'
  | 'design'
  | 'environment'
  | 'security'
  | 'resource'
  | 'external-service'
  | 'data'
  | 'hang'
  | 'timeout'
  | 'unknown';

/** Governed wait-state kinds (LAW - GOVERNED WAIT STATES). */
export type WaitKind =
  | 'network'
  | 'rate-limit'
  | 'human-decision'
  | 'dependency'
  | 'environment'
  | 'resource';

/** Durable, owner-scoped view of an active run the supervisor can act on. */
export interface ActiveJobView {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly envId: string | null;
  readonly stageKey: string;
  readonly label: string;
  readonly status: string;
  readonly startedAt: string | null;
  /** Current environment status when the run is bound to one, else null. */
  readonly envStatus: string | null;
  /**
   * True when this run genuinely depends on an external network boundary.
   *
   * The Network Monitor observes the platform's outbound boundary. A run that
   * is satisfied entirely inside the machine - a local model runtime on
   * loopback, a local workspace, local commands - does NOT depend on that
   * boundary, so an outbound outage is irrelevant to it. Parking such a run
   * would interrupt real, healthy work for no reason, so the supervisor only
   * applies the network wait to runs that actually cross the boundary.
   */
  readonly networkDependent: boolean;
}

/**
 * What the supervisor may do to governed execution.
 *
 * Implemented by the governed runtime (today: the Worker Job engine) so the
 * supervisor can transition durable state, but authority stays in the Job
 * State Manager which validates every transition against its state machine.
 */
export interface SupervisorTarget {
  jobOf(jobId: string): Promise<ActiveJobView | null>;
  activeJobs(): Promise<ReadonlyArray<ActiveJobView>>;
  /** Abort + fail a run with a classified result (real termination, not a label). */
  forceFail(jobId: string, classification: FailureClass, summary: string): Promise<boolean>;
  /** Move a RUNNING run into a durable governed wait state; aborts in-flight work. */
  enterWait(jobId: string, waitKind: WaitKind, reason: string): Promise<boolean>;
  /** Return a waited run to eligible scheduling so it resumes automatically. */
  leaveWait(jobId: string, detail: string): Promise<boolean>;
}

/**
 * Handle the JobEngine gives back to an executor so a run can:
 *  - report meaningful progress (resets the hard-timeout window), and
 *  - mark the run finished (so the supervisor stops supervising it).
 */
export interface RunSupervisorHandle {
  reportProgress(evidence: ProgressEvidence): void;
  finish(): void;
}

/** The part of the supervisor a governed runtime consumes at run start. */
export interface RunSupervisor {
  runStarted(view: ActiveJobView): RunSupervisorHandle;
}

/** Durable supervision trace record for one active run (checkpoint). */
export interface SupervisionCheckpoint {
  readonly checkpointId: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly at: string;
  readonly lastProgressAt: string;
  readonly status: string;
  readonly latestEvidence: ProgressEvidence | null;
}