/**
 * Cline execution boundary (LAW - CLINE MUST BE INSTALLED, IMPLEMENTED AND
 * INTEGRATED / LAW - CLINE-DAYTONA BINDING / LAW - EXECUTION REALITY).
 *
 * Cline is the real Worker/agent execution boundary the finished platform
 * uses to operate assigned environments. This boundary is HONEST about what
 * exists: `detect()` probes the real `cline` CLI on the host, `health()`
 * re-verifies it live, and execution through Cline is only ever labelled
 * Cline when `canExecute()` is true (CLI installed AND health check green).
 *
 * When `cline` is not installed the state is reported as NOT_INSTALLED and
 * NO code path claims a Cline session ran. Worker/agent sessions continue
 * through the platform's own Worker Runtime (they are an exact Cline-STYLE
 * REPL over the real environment) and every piece of evidence is labelled
 * `platform-agentic`, never Cline. A documentation reference, UI mock, fake
 * adapter or unused package is not Cline; this boundary never pretends.
 */

import type { CapabilityDecision, ExecutionCapability } from './capabilities.ts';

export interface ClineHealth {
  readonly ready: boolean;
  readonly version: string | null;
  readonly detail: string;
  readonly checkedAt: string;
}

/** The dispatch the platform uses when a genuine Cline binary answers. */
export interface ClineExecutionBoundary {
  /**
   * Real, host-level detection. Never returns READY without a successful
   * `cline` probe; absence is a recorded decision, not an omission.
   */
  detect(): Promise<CapabilityDecision>;
  /** Live health check of the installed Cline mechanism. */
  health(): Promise<ClineHealth>;
  /** True ONLY when the Cline CLI is installed and its health check passes. */
  canExecute(): Promise<boolean>;
  /** The capability id this boundary reports for. */
  capability(): ExecutionCapability;
}

export interface ClineBoundaryOptions {
  /** Probe function overriding the real CLI probe (tests only). */
  probe?: () => Promise<{ exitCode: number; stdout: string; stderr: string } | null>;
}

/**
 * Live probe of the real `cline` binary.
 *
 * The real Cline CLI is a large Node bundle and takes several seconds to start
 * (measured ~7s on this host), so the probe allows a generous deadline: a
 * healthy install must never be reported absent merely because the machine is
 * busy. Genuine absence still fails fast, because a missing binary returns
 * immediately.
 */
const probeCline = async (): Promise<{ exitCode: number; stdout: string; stderr: string } | null> => {
  const { probeBinary } = await import('./capabilities.ts');
  return probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
};

export class RealClineBoundary implements ClineExecutionBoundary {
  private readonly probe: NonNullable<ClineBoundaryOptions['probe']>;

  constructor(options: ClineBoundaryOptions = {}) {
    this.probe = options.probe ?? probeCline;
  }

  capability(): ExecutionCapability {
    return 'cline';
  }

  async detect(): Promise<CapabilityDecision> {
    const now = new Date().toISOString();
    const cline = await this.probe();
    if (cline !== null && cline.exitCode === 0 && cline.stdout.trim() !== '') {
      const versionLine: string | null = cline.stdout.trim().split(/\r?\n/)[0] ?? null;
      const version = versionLine !== null && versionLine.length > 0 && versionLine !== 'true' ? versionLine : null;
      return {
        capability: 'cline',
        status: 'READY',
        mechanism: 'cline-cli',
        version,
        rationale: 'The `cline` CLI is present and answered a live probe.',
        discoveredAt: now,
      };
    }
    return {
      capability: 'cline',
      status: 'NOT_INSTALLED',
      mechanism: null,
      version: null,
      rationale:
        'The `cline` CLI is not present on this host. No Cline execution exists or is claimed; Worker/agent sessions are labelled platform-agentic until a real Cline mechanism is installed and health-checked.',
      discoveredAt: now,
    };
  }

  async health(): Promise<ClineHealth> {
    const detected = await this.detect();
    if (detected.status === 'READY') {
      return {
        ready: true,
        version: detected.version,
        detail: 'Real cline binary answered the health probe.',
        checkedAt: detected.discoveredAt,
      };
    }
    return {
      ready: false,
      version: null,
      detail:
        'Cline is not installed on this host. The platform does not simulate Cline execution; sessions run through the platform Worker Runtime (labelled platform-agentic).',
      checkedAt: detected.discoveredAt,
    };
  }

  async canExecute(): Promise<boolean> {
    const health = await this.health();
    return health.ready;
  }
}