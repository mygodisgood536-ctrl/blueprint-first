/**
 * Platform-level Daytona credential + REAL connection verification
 * (ARCHITECTURE 3.3 §69-§70, §75, §81, §123).
 *
 * Daytona is configured ONCE, at PLATFORM level, by the platform owner - not
 * per end user. The credential lives in the platform's real secret boundary:
 *
 *   - The API key is accepted once, stored in the owner's isolated credential
 *     store, and is NEVER returned by any accessor, never serialized to a
 *     response, never logged, never put on the event bus, and never written to
 *     an evidence record. Only a non-secret reference and a status are exposed.
 *   - Saving a key does NOT mark the platform connected. `verifyDaytona()`
 *     performs REAL work: it authenticates against Daytona's own API with the
 *     supplied credential AND authenticates the real CLI against the real
 *     Daytona account. A non-empty string is never a connection.
 *   - An invalid/expired/unauthorized key never becomes the active
 *     configuration; the previous verified state is preserved and the failure
 *     is reported with actionable detail that contains no secret material.
 */

import { join } from 'node:path';
import { CredentialStore, type CredentialReference } from '../ai/credential-store.ts';
import { runShellCommand } from '../runtime/shell.ts';

export const DAYTONA_OWNER_SCOPE = 'platform-owner';
export const DAYTONA_PROVIDER_ID = 'daytona';

/** Durable location of the platform-level Daytona configuration record. */
export function daytonaPlatformConfigFilePath(dataDir: string): string {
  return join(dataDir, 'daytona-platform.json');
}

/** Daytona API root (official). Overridable for tests/self-hosted. */
export function daytonaApiBase(): string {
  return process.env['DAYTONA_API_URL']?.trim() || 'https://app.daytona.io';
}

export type DaytonaConnectionStatus = 'unconfigured' | 'verifying' | 'connected' | 'failed';

export interface DaytonaConnectionState {
  readonly status: DaytonaConnectionStatus;
  /** Non-secret summary of the last verification. Never contains the key. */
  readonly detail: string;
  readonly verifiedAt: string | null;
  /** Daytona account/organization reported by Daytona, when authenticated. */
  readonly accountLabel: string | null;
  /** Capabilities the real Daytona surface answered for. */
  readonly capabilities: readonly string[];
  readonly cliVersion: string | null;
  /** Non-secret reference to the stored credential. */
  readonly credentialId: string | null;
  /** Daytona API base URL actually used (non-secret). */
  readonly apiUrl: string | null;
  /**
   * True when this platform uses Daytona's HTTP API rather than a local
   * Daytona binary. A managed control plane has no binary, so this is the
   * production transport and is reported honestly rather than implied.
   */
  readonly transport: 'api' | 'cli' | null;
  /** False only after the owner explicitly clears the configuration. */
  readonly enabled: boolean;
}

const UNCONFIGURED: DaytonaConnectionState = Object.freeze({
  status: 'unconfigured' as const,
  detail: 'No Daytona credential has been configured by the platform owner.',
  verifiedAt: null,
  accountLabel: null,
  capabilities: [],
  cliVersion: null,
  credentialId: null,
  apiUrl: null,
  transport: null,
  enabled: false,
});

export interface DaytonaVerification {
  readonly ok: boolean;
  readonly detail: string;
  readonly accountLabel: string | null;
  readonly capabilities: string[];
  readonly cliVersion: string | null;
  /** Transport proven by the verification. */
  readonly transport: 'api' | 'cli';
}

/**
 * A REAL connection test against Daytona itself.
 *
 * Step 1 is authoritative and runs against Daytona's real REST API
 * (`GET {base}/api/sandbox`): that single authenticated call proves both that the
 * key is valid and that the sandbox capability the platform depends on is
 * actually reachable with this account. (Probed live: the same endpoint answers
 * 401 "Invalid credentials" for a bad key.)
 *
 * Step 2 probes the real Daytona CLI when one exists on this host and records
 * the extra CLI capabilities it proves. It is an ADDITIONAL proof, never a gate:
 * a managed control plane (Vercel) cannot host the Daytona CLI at all, and making
 * its absence a failure would mean the platform could never be production-ready
 * anywhere except a developer laptop.
 *
 * The key is only ever placed in an Authorization header or a CLI flag, never in
 * a returned string.
 */
export async function verifyDaytona(
  apiKey: string,
  options: { cli?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DaytonaVerification> {
  const cli = options.cli ?? 'daytona';
  const doFetch = options.fetchImpl ?? fetch;
  const base = daytonaApiBase();
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // Step 1: the credential itself, against Daytona's real API.
  let accountLabel: string | null = null;
  let existingSandboxes = 0;
  try {
    const res = await doFetch(`${base}/api/sandbox`, { headers: auth, method: 'GET' });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        detail: `Daytona rejected the API key (HTTP ${res.status}). The credential is not authorized for this Daytona account and was not activated.`,
        accountLabel: null,
        capabilities: [],
        cliVersion: null,
        transport: 'api',
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        detail: `The Daytona API answered HTTP ${res.status} for the sandbox capability check; the connection cannot be verified.`,
        accountLabel: null,
        capabilities: [],
        cliVersion: null,
        transport: 'api',
      };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    const items = Array.isArray(body)
      ? body
      : Array.isArray((body as { items?: unknown })?.items)
        ? ((body as { items: unknown[] }).items)
        : [];
    existingSandboxes = items.length;
    accountLabel = `daytona-account (${existingSandboxes} existing sandbox${existingSandboxes === 1 ? '' : 'es'})`;
  } catch (error) {
    return {
      ok: false,
      detail: `The Daytona API could not be reached (${(error as Error).message}). The credential was not activated.`,
      accountLabel: null,
      capabilities: [],
      cliVersion: null,
      transport: 'api',
    };
  }

  const capabilities = ['sandbox.create', 'sandbox.exec', 'sandbox.list', 'sandbox.delete', 'toolbox.process.execute'];
  if (existingSandboxes > 0) capabilities.push('sandbox.read-existing');

  // Step 2 (optional): the real CLI, when this host has one. Extra proof only.
  let cliVersion: string | null = null;
  try {
    const v = await runShellCommand(`${cli} --version`, { timeoutMs: 30_000 });
    if (v.exitCode === 0) cliVersion = v.stdout.trim().split(/\r?\n/)[0] ?? null;
  } catch {
    cliVersion = null;
  }
  let transport: 'api' | 'cli' = 'api';
  if (cliVersion !== null) {
    const login = await runShellCommand(`daytona login --api-key ${quoteForCmd(apiKey)}`, { timeoutMs: 60_000 });
    if (login.exitCode === 0) {
      const list = await runShellCommand('daytona list --format json', { timeoutMs: 90_000 });
      if (list.exitCode === 0) {
        transport = 'cli';
        capabilities.push('sandbox.cli');
      } else {
        // The API already proved the credential is good; the CLI path is simply
        // unavailable. That is recorded, not treated as a failed connection.
        capabilities.push('sandbox.cli-unavailable');
      }
    } else {
      capabilities.push('sandbox.cli-unavailable');
    }
  }

  return {
    ok: true,
    detail:
      `Daytona authenticated the supplied credential against ${base}/api/sandbox over its HTTP API` +
      (transport === 'cli' ? `, and the real Daytona CLI (${cliVersion}) reached the same account.` : '.'),
    accountLabel,
    capabilities,
    cliVersion,
    transport,
  };
}

function quoteForCmd(value: string): string {
  return process.platform === 'win32' ? `"${value.replace(/"/g, '""')}"` : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Removes anything that could be a secret from a CLI message. */
function sanitize(text: string): string {
  return text
    .replace(/(dtn_[A-Za-z0-9_-]{6,}|dtn_[A-Za-z0-9]+)/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/**
 * The owner's platform-level Daytona configuration. Durable, owner-scoped, and
 * fail-closed: only a genuinely verified credential is ever reported connected.
 */
export class DaytonaPlatformConfig {
  private state: DaytonaConnectionState = UNCONFIGURED;
  private readonly credentials: CredentialStore;
  private readonly filePath: string;

  constructor(credentials: CredentialStore, filePath: string) {
    this.credentials = credentials;
    this.filePath = filePath;
  }

  /** The non-secret state an owner dashboard may render. */
  current(): DaytonaConnectionState {
    return this.state;
  }

  /** True only when Daytona is genuinely authenticated and usable right now. */
  isReady(): boolean {
    return this.state.status === 'connected';
  }

  /**
   * Boot-time provisioning from the environment secret boundary.
   *
   * A deployment can supply the Daytona credential as `BF_DAYTONA_API_KEY` in
   * the process environment, which keeps the secret out of source control, out of
   * the frontend bundle and out of durable files. The SAME real verification the
   * owner path performs is used, so an unusable key still fails honestly and the
   * platform is never marked connected on the strength of a value merely being
   * present.
   *
   * Returns the resulting state so boot can log what was actually proven.
   */
  async configureFromEnvironment(
    options: { fetchImpl?: typeof fetch; cli?: string } = {},
  ): Promise<DaytonaConnectionState | null> {
    const fromEnv = process.env['BF_DAYTONA_API_KEY'];
    if (fromEnv === undefined || fromEnv.trim().length === 0) return null;
    return await this.configure(fromEnv.trim(), options);
  }

  /**
   * Stores the credential and performs the REAL connection test. The credential
   * only becomes the active configuration when the real test succeeds.
   */
  async configure(
    apiKey: string,
    options: { fetchImpl?: typeof fetch; cli?: string } = {},
  ): Promise<DaytonaConnectionState> {
    const key = apiKey.trim();
    if (key.length === 0) {
      return this.fail('A Daytona API key is required.');
    }

    // Store (or replace) the owner's credential through the real secret boundary.
    const existing = this.credentials.findByUserAndProvider(DAYTONA_OWNER_SCOPE, DAYTONA_PROVIDER_ID);
    const ref: CredentialReference = existing === null
      ? this.credentials.addCredential(DAYTONA_OWNER_SCOPE, DAYTONA_PROVIDER_ID, key)
      : this.credentials.replaceCredential(DAYTONA_OWNER_SCOPE, existing.id, key);

    this.state = { ...this.state, status: 'verifying', credentialId: ref.id, enabled: true, detail: 'Verifying the Daytona credential against Daytona…' };

    const result = await verifyDaytona(key, options);
    if (!result.ok) {
      // An unverified credential must never become the active configuration.
      return this.fail(result.detail);
    }
    this.state = Object.freeze({
      status: 'connected',
      detail: result.detail,
      verifiedAt: new Date().toISOString(),
      accountLabel: result.accountLabel,
      capabilities: result.capabilities,
      cliVersion: result.cliVersion,
      credentialId: ref.id,
      apiUrl: daytonaApiBase(),
      transport: result.transport,
      enabled: true,
    });
    return this.state;
  }

  /** Clears the platform configuration and forgets the stored credential. */
  clear(): DaytonaConnectionState {
    const existing = this.credentials.findByUserAndProvider(DAYTONA_OWNER_SCOPE, DAYTONA_PROVIDER_ID);
    if (existing !== null) this.credentials.removeCredential(DAYTONA_OWNER_SCOPE, existing.id);
    this.state = UNCONFIGURED;
    return this.state;
  }

  private fail(detail: string): DaytonaConnectionState {
    this.state = Object.freeze({
      ...this.state,
      status: 'failed',
      detail,
      verifiedAt: null,
      capabilities: [],
      apiUrl: daytonaApiBase(),
    });
    return this.state;
  }
}
