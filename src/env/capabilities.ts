/**
 * Capability-first execution-foundation discovery (LAW - USER KNOWLEDGE
 * INDEPENDENCE / LAW - CAPABILITY-FIRST, TECHNOLOGY-SECOND).
 *
 * The platform never assumes the user knows that Cline, Daytona, a database,
 * a scheduler or any other component is needed. At boot it DISCOVERS the
 * required capabilities, probes the real mechanisms available on the host,
 * records a durable decision (mechanism + status + rationale) and only then
 * builds. Nothing is assumed present and nothing absent is ever represented
 * as present.
 *
 * Decisions are written to a durable JSON log so the "recorded decision and
 * rationale" survives restarts and can be audited as evidence.
 */

import { join } from 'node:path';
import { runShellCommand } from '../runtime/shell.ts';
import { JsonFileStore } from '../web/durable.ts';
import { DaytonaApiClient } from './daytona-api.ts';

/** The mandatory execution capabilities of the finished platform. */
export type ExecutionCapability = 'opencode' | 'cline' | 'daytona' | 'local-workspace';

/** Component health states (LAW - COMPONENT HEALTH). */
export type CapabilityStatus =
  | 'PROVISIONING'
  | 'STARTING'
  | 'READY'
  | 'DEGRADED'
  | 'NETWORK_UNAVAILABLE'
  | 'RECOVERING'
  | 'FAILED'
  | 'TERMINATED'
  | 'NOT_INSTALLED'
  | 'INCOMPATIBLE';

/** A recorded capability-first decision (durable evidence). */
export interface CapabilityDecision {
  readonly capability: ExecutionCapability;
  readonly status: CapabilityStatus;
  /** The concrete mechanism chosen (binary, runtime, built-in adapter), or null. */
  readonly mechanism: string | null;
  readonly version: string | null;
  readonly rationale: string;
  readonly discoveredAt: string;
}

interface CapabilitySnapshot {
  nextSeq: number;
  decisions: CapabilityDecision[];
}

const SCHEMA_VERSION = 1;

export function capabilitiesFilePath(dataDir: string): string {
  return join(dataDir, 'capabilities.json');
}

function stderrToDetail(name: string, stderr: string, exitCode: number): string {
  const trimmed = stderr.replace(/\s+$/g, '');
  return trimmed.length > 0
    ? `${name} was probed but reported an error (exit ${exitCode}): ${trimmed.slice(0, 200)}`
    : `${name} was probed but failed (exit ${exitCode}).`;
}

/**
 * True when the shell reported that the command itself does not exist.
 *
 * This distinction matters because probes run THROUGH a shell. `cmd.exe /c
 * cline --version` always spawns successfully, so a missing binary comes back as
 * a non-zero exit rather than a spawn failure - which made an absent CLI
 * indistinguishable from an installed-but-broken one, and therefore reported as
 * DEGRADED ("installed, unresponsive") instead of NOT_INSTALLED ("absent").
 *
 * An absent execution component and a broken one are different facts and must be
 * reported as such: the readiness requirement is unchanged either way, but the
 * platform must not claim a component is installed when it is not.
 */
function commandNotFound(stderr: string, exitCode: number): boolean {
  // POSIX shells use 127 for "command not found".
  if (exitCode === 127) return true;
  const text = stderr.toLowerCase();
  if (text.includes('is not recognized as an internal or external command')) return true;
  if (text.includes('command not found')) return true;
  if (text.includes('no such file or directory') && exitCode !== 0) return true;
  return false;
}

/**
 * In-flight probes, keyed by command.
 *
 * `CapabilityDiscovery.discover()` and `ClineBoundary.capability()` both probe
 * the same binary, and a test suite runs many servers at once. Without this,
 * N concurrent callers each spawned their own `cmd.exe` → `cline` → node
 * chain. That is pure contention: the probes compete with each other for the
 * CPU they are waiting on, which is exactly what pushed them past the deadline.
 *
 * Deduplicating means concurrent callers share ONE probe. The result is a fact
 * about the machine at a point in time, so sharing it is correct - and it is
 * removed from the map as soon as it settles, so a later probe re-runs and the
 * readiness check is never cached across a re-check.
 */
const inFlightProbes = new Map<string, Promise<{ exitCode: number; stdout: string; stderr: string } | null>>();

/**
 * Real command probe: resolves with the command's status, or null when the
 * binary does not exist at all (→ NOT_INSTALLED).
 */
export async function probeBinary(
  name: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string } | null> {
  const key = `${name} ${args.join(' ')}`;
  const existing = inFlightProbes.get(key);
  if (existing !== undefined) return await existing;

  const probe = (async () => {
    try {
      const result = await runShellCommand(`${name} ${args.join(' ')}`, { timeoutMs: options.timeoutMs ?? 10_000 });
      // The shell spawned, but the command may simply not exist. Report that as
      // "not installed" rather than as a component that is installed and broken.
      if (commandNotFound(result.stderr, result.exitCode)) return null;
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch {
      // spawn/shell failure of the binary itself → binary not usable
      return null;
    }
  })();

  inFlightProbes.set(key, probe);
  try {
    return await probe;
  } finally {
    // Never cached across calls: a subsequent probe must re-run, so a component
    // that appears (or stops answering) is still detected.
    inFlightProbes.delete(key);
  }
}

export class CapabilityDiscovery {
  private readonly file: JsonFileStore<CapabilitySnapshot>;
  private decisions = new Map<ExecutionCapability, CapabilityDecision>();
  private nextSeq = 1;
  private loaded = false;
  /** Live OpenCode reachability probe (provider wired + reachable); default false. */
  private readonly probeOpenCode: () => Promise<boolean>;
  /** Live Daytona API credential probe; returns `configured: false` when unset. */
  private readonly daytonaCredential: () => { apiKey: string; apiUrl?: string } | null;

  constructor(options: {
    filePath: string;
    probeOpenCode?: () => Promise<boolean>;
    daytonaCredential?: () => { apiKey: string; apiUrl?: string } | null;
  }) {
    this.file = new JsonFileStore<CapabilitySnapshot>({
      filePath: options.filePath,
      schemaVersion: SCHEMA_VERSION,
    });
    this.probeOpenCode = options.probeOpenCode ?? (async () => false);
    this.daytonaCredential = options.daytonaCredential ?? (() => null);
  }

  /**
   * Probes Daytona's real HTTP API with the owner-configured credential.
   *
   * Returns `configured: false` when no credential exists at all (so the caller
   * falls through to the CLI probe), and an honest usable/degraded verdict when
   * one does. The credential itself never appears in the result.
   */
  private async probeDaytonaApi(): Promise<{
    configured: boolean;
    usable: boolean;
    detail: string;
    version: string | null;
    apiUrl: string;
  }> {
    const credential = this.daytonaCredential();
    const apiUrl = credential?.apiUrl ?? 'https://app.daytona.io/api';
    if (credential === null || credential.apiKey.trim().length === 0) {
      return { configured: false, usable: false, detail: 'no Daytona credential configured', version: null, apiUrl };
    }
    const client = new DaytonaApiClient({
      apiKey: credential.apiKey,
      apiUrl,
      timeoutMs: 15_000,
    });
    const verified = await client.verifyCredential();
    if (!verified.ok) {
      return { configured: true, usable: false, detail: verified.detail, version: null, apiUrl };
    }
    // READY requires that Daytona can actually perform the required operation,
    // not merely that the credential is accepted: list the real sandboxes.
    const listing = await client.listSandboxes().then(
      (items) => ({ ok: true as const, detail: `${items.length} sandbox(es) visible` }),
      (error: Error) => ({ ok: false as const, detail: error.message }),
    );
    return {
      configured: true,
      usable: listing.ok,
      detail: listing.detail,
      version: 'api',
      apiUrl,
    };
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      this.nextSeq = snapshot.nextSeq;
      for (const decision of snapshot.decisions) this.decisions.set(decision.capability, decision);
    }
    this.loaded = true;
  }

  private record(decision: CapabilityDecision): void {
    this.decisions.set(decision.capability, decision);
    this.nextSeq += 1;
  }

  /** Runs the real probes and records durable decisions. Returns the latest decisions. */
  async discover(): Promise<CapabilityDecision[]> {
    await this.init();
    const now = new Date().toISOString();

    // OpenCode: the integrated AI execution/provider layer (built-in adapter).
    // Live truth outranks declarations: the provider is READY only when a
    // reachable OpenCode provider is actually wired at this boot.
    const openCodeReachable = await this.probeOpenCode();
    this.record(openCodeReachable
      ? {
          capability: 'opencode',
          status: 'READY',
          mechanism: 'opencode-runtime',
          version: null,
          rationale:
            'The OpenCode execution adapter is wired and its runtime answered a live reachability probe. Model availability is re-verified per run; a silent model switch is forbidden.',
          discoveredAt: now,
        }
      : {
          capability: 'opencode',
          status: 'DEGRADED',
          mechanism: 'opencode-runtime',
          version: null,
          rationale:
            'The OpenCode execution adapter is part of the platform build, but no reachable OpenCode provider is connected at this boot. OpenCode stages cannot be executed; nothing is claimed until a live answer is verified.',
          discoveredAt: now,
        });

    // Daytona: the mandatory real project execution environment (LAW - DAYTONA).
    //
    // Two real transports are probed, API first because it is the only one a
    // managed control plane can use:
    //   1. Daytona's HTTP API with a verified credential (production)
    //   2. the `daytona` CLI (a development host that has Daytona installed)
    // A configured record, a stored key or a resolvable binary are each
    // insufficient: READY is reported only when Daytona itself answers a real
    // request for this platform.
    const apiProbe = await this.probeDaytonaApi();
    let daytonaUsable = false;
    let daytonaVersion: string | null = null;
    if (apiProbe.configured) {
      daytonaUsable = apiProbe.usable;
      daytonaVersion = apiProbe.version;
    } else {
      const daytona = await probeBinary('daytona', ['--version']);
      if (daytona !== null && daytona.exitCode === 0) {
        const versionLine: string | null = daytona.stdout.trim().split(/\r?\n/)[0] ?? null;
        daytonaVersion = versionLine !== null && versionLine.length > 0 ? versionLine : null;
        const usable = await probeBinary('daytona', ['list', '--format', 'json'], { timeoutMs: 30_000 });
        daytonaUsable = usable !== null && usable.exitCode === 0;
      }
    }

    // Cline: the real Worker/agent execution boundary (LAW - MANDATORY CLINE).
    //
    // Cline executes INSIDE the project execution environment (the Daytona
    // sandbox), not on the control plane. A managed control plane therefore
    // never has a `cline` binary on its PATH, and that is not a fault: probing
    // the control plane for Cline measures the wrong host. The control-plane
    // probe below therefore reports only what it can actually prove, and the real
    // Cline presence check happens per session inside the bound environment
    // before any Cline-bound work is claimed.
    const cline = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
    if (cline !== null && cline.exitCode === 0) {
      const versionLine: string | null = cline.stdout.trim().split(/\r?\n/)[0] ?? null;
      const clineVersion = versionLine !== null && versionLine.length > 0 ? versionLine : null;
      this.record({
        capability: 'cline',
        status: 'READY',
        mechanism: 'cline-cli',
        version: clineVersion,
        rationale: 'The `cline` CLI is installed on this host and answers; Cline-bound sessions can run through it directly.',
        discoveredAt: now,
      });
} else if (daytonaUsable) {
      // A real Daytona environment is available, so Cline can be provisioned and
      // verified inside the sandbox. The control plane still does not claim the
      // CLI is READY here — it is not — it records where the real check happens.
      this.record({
        capability: 'cline',
        status: 'DEGRADED',
        mechanism: 'cline-cli-in-execution-environment',
        version: null,
        rationale:
          'No `cline` binary exists on the control plane, which is expected: Cline executes inside the project execution environment. Daytona is reachable, so a Cline CLI is provisioned into each project sandbox and its `--version` is verified before any Cline-bound session is claimed. Until that per-session check passes, no Cline execution is reported.',
        discoveredAt: now,
      });
    } else if (cline === null) {
    this.record({
      capability: 'cline',
      status: 'NOT_INSTALLED',
      mechanism: null,
      version: null,
      rationale:
        'No `cline` CLI is present on this host and no remote project execution environment is reachable, so no Cline execution exists anywhere for this platform. The platform never fabricates a Cline session. Worker/agent sessions run through the platform Worker Runtime and are labelled platform-agentic (never Cline). Make Daytona reachable, or install Cline here, to lift this state.',
      discoveredAt: now,
    });
  } else {
    // The binary RESOLVED but did not answer within the probe deadline. That is
    // materially different from "not installed" - the CLI is present on this
    // host, it simply did not answer (a saturated machine, a cold start, or a
    // genuine fault). Reporting NOT_INSTALLED here would be a false negative
    // and would misdescribe the host. DEGRADED is the honest state: readiness is
    // never fabricated, and absence is never claimed without evidence.
    this.record({
      capability: 'cline',
      status: 'DEGRADED',
      mechanism: 'cline-cli',
      version: null,
      rationale: `The \`cline\` CLI is present on this host but did not answer \`cline --version\` within the probe deadline (exit code ${cline.exitCode}). This is an unresponsive installed CLI, not an absent one. Cline-bound sessions will not run until it answers; the platform never fabricates a Cline session.`,
      discoveredAt: now,
    });
  }

    // Daytona: record the decision from the probe already performed above.
    if (apiProbe.configured) {
      this.record({
        capability: 'daytona',
        status: daytonaUsable ? 'READY' : 'DEGRADED',
        mechanism: 'daytona-api',
        version: daytonaVersion,
        rationale: daytonaUsable
          ? `A Daytona credential is configured and the Daytona API (${apiProbe.apiUrl}) answered a real authenticated request for this platform, so real Daytona sandboxes can be created, executed in and destroyed over the API. This is the production transport: no local Daytona binary is required.`
          : `A Daytona credential is configured but the Daytona API did not accept it: ${apiProbe.detail}. This is a genuine degraded state, not a ready one. Environments are backed by the real local-workspace adapter and no Daytona workspace is claimed.`,
        discoveredAt: now,
      });
    } else if (daytonaUsable) {
      this.record({
        capability: 'daytona',
        status: 'READY',
        mechanism: 'daytona-cli',
        version: daytonaVersion,
        rationale:
          'The `daytona` CLI is installed and Daytona answered a real sandbox listing for this platform, so real Daytona sandboxes can be created and used. For production, configure a Daytona credential so the platform uses the Daytona API instead of a local binary.',
        discoveredAt: now,
      });
    } else if (daytonaVersion !== null) {
      this.record({
        capability: 'daytona',
        status: 'DEGRADED',
        mechanism: 'daytona-cli',
        version: daytonaVersion,
        rationale:
          'The `daytona` CLI is installed, but Daytona has no usable account for this platform yet, so no sandbox can actually be created. This is a genuine degraded state, not a ready one: configure and verify a Daytona credential in the owner area. Until then, environments are backed by the real local-workspace adapter and no Daytona workspace is claimed.',
        discoveredAt: now,
      });
    } else {
      this.record({
        capability: 'daytona',
        status: 'NOT_INSTALLED',
        mechanism: null,
        version: null,
        rationale:
          'No Daytona credential is configured and the `daytona` CLI is not present on this host. Environments are backed by the real local-workspace adapter; no Daytona workspace is claimed to exist. Configure and verify a Daytona credential (owner area) or install the CLI to lift this state.',
        discoveredAt: now,
      });
    }

    // local-workspace: always a real mechanism (the built-in adapter).
    this.record({
      capability: 'local-workspace',
      status: 'READY',
      mechanism: 'local-workspace-adapter',
      version: null,
      rationale: 'The local-workspace adapter provisions real directories, processes and git on this host; nothing is simulated.',
      discoveredAt: now,
    });

    await this.file.save({ nextSeq: this.nextSeq, decisions: [...this.decisions.values()] });
    return [...this.decisions.values()];
  }

  async latest(): Promise<CapabilityDecision[]> {
    await this.init();
    return [...this.decisions.values()];
  }

  async decisionOf(capability: ExecutionCapability): Promise<CapabilityDecision | null> {
    await this.init();
    return this.decisions.get(capability) ?? null;
  }
}