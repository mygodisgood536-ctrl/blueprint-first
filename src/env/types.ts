/**
 * Project Execution Environment model.
 *
 * An environment is the durable, isolated workspace a project's Worker jobs
 * and Cline-style sessions execute against. Every lifecycle transition is a
 * real, persisted state change with evidence; readiness is verified before
 * work begins and a failure is never reported as a false success.
 *
 * The active backend on this host is the real local-workspace adapter. A
 * Daytona adapter implements the same contract and activates when the
 * `daytona` CLI is present (see daytona-adapter.ts). Nothing is simulated:
 * files, terminals, git and health checks operate on real state.
 */

/** Lifecycle states (document §10). */
export type EnvStatus =
  | 'REQUESTED'
  | 'PROVISIONING'
  | 'READY'
  | 'PAUSED'
  | 'RECOVERING'
  | 'FAILED'
  | 'DESTROYED';

export const ENV_TERMINAL_STATUSES: ReadonlySet<EnvStatus> = new Set(['DESTROYED']);
export const ENV_ACTIVE_STATUSES: ReadonlySet<EnvStatus> = new Set(['READY', 'PAUSED', 'RECOVERING']);

/** Legal single-step transitions. Invalid transitions throw InvalidTransitionError. */
export const ENV_ALLOWED_TRANSITIONS: Readonly<Record<EnvStatus, readonly EnvStatus[]>> = {
  // Crash recovery is a physical, explicit transition (boot only): any state
  // whose availability is not provably true the moment a process dies must
  // collapse to RECOVERING until a fresh real health check re-verifies it.
  REQUESTED: ['PROVISIONING', 'RECOVERING', 'DESTROYED'],
  PROVISIONING: ['READY', 'FAILED', 'RECOVERING', 'DESTROYED'],
  READY: ['PAUSED', 'RECOVERING', 'DESTROYED'],
  PAUSED: ['READY', 'DESTROYED'],
  RECOVERING: ['READY', 'FAILED', 'DESTROYED'],
  FAILED: ['RECOVERING', 'DESTROYED'],
  DESTROYED: [],
};

/**
 * Crash-safe collapse: states whose availability was not provably true the
 * moment the process died. become RECOVERING on boot.
 */
export const ENV_BOOT_RECOVER: Readonly<Record<EnvStatus, boolean>> = {
  REQUESTED: true,
  PROVISIONING: true,
  READY: true,
  PAUSED: false,
  RECOVERING: false,
  FAILED: false,
  DESTROYED: false,
};

/** What is being provisioned in the workspace. */
export interface EnvSpec {
  /** Human label, e.g. "default workspace". */
  readonly label: string;
  /** Whether to initialize a real git repository in the workspace. */
  readonly gitEnabled: boolean;
}

export interface EnvHealth {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly detail: string;
  readonly gitAvailable?: boolean;
  readonly gitBranch?: string;
}

export interface FileEntry {
  readonly name: string;
  readonly relPath: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly mtime: string;
}

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

export interface GitStatus {
  readonly branch: string;
  readonly entries: readonly GitStatusEntry[];
}

/** Real command outcome produced by an EnvAdapter (post redaction, capped). */
export interface CommandResultLike {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

/**
 * The adapter contract every environment backend must implement
 * (local-workspace today, Daytona when its CLI is present).
 */
export interface EnvAdapter {
  readonly kind: 'local-workspace' | 'daytona';
  /** Provisions the real workspace and reports real health. */
  provision(spec: EnvSpec): Promise<EnvHealth>;
  /** Verifies the workspace is still really healthy. */
  health(): Promise<EnvHealth>;
  /** Destroys the real workspace (never destroys evidence/certification history). */
  destroy(): Promise<void>;
  listFiles(relPath: string): Promise<FileEntry[]>;
  readFile(relPath: string): Promise<{ content: string; truncated: boolean }>;
  writeFile(relPath: string, content: string): Promise<void>;
  deleteFile(relPath: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  runCommand(command: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CommandResultLike>;
  gitStatus(): Promise<GitStatus>;
  gitCommit(message: string): Promise<{ commit: string }>;
}

/** A durable environment record persisted across restarts. */
export interface EnvironmentRecord {
  readonly id: string;
  readonly projectId: string;
  /** Owning tenant (account username). Isolation is enforced by this. */
  readonly ownerId: string;
  readonly spec: EnvSpec;
  readonly status: EnvStatus;
  /** Which real backend backs this environment. */
  readonly adapterKind: 'local-workspace' | 'daytona';
  /** Real path of the workspace when it exists. */
  readonly workspaceRoot: string | null;
  readonly lastHealth: EnvHealth | null;
  readonly lastTransition: {
    readonly from: EnvStatus;
    readonly to: EnvStatus;
    readonly at: string;
    readonly by: string;
  } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Port the job engine uses to enforce "environment ready before work". */
export interface JobEnvPort {
  envOf(envId: string): Promise<{ status: EnvStatus; workspaceRoot: string | null } | null>;
}