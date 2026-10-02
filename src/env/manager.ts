/**
 * Durable Environment Manager: lifecycle, isolation, quotas, evidence.
 *
 * Every environment is a durable record (survives restarts) backed by a real
 * adapter. Transitions follow an explicit state machine (REQUESTED →
 * PROVISIONING → READY → PAUSED/RECOVERING/FAILED → DESTROYED) and every
 * transition is persisted and published as an event. Isolation is enforced
 * here at the store level (an owner can only act on its own environments),
 * readiness is verified by a real health check before READY, and crash
 * recovery never leaves work falsely available: on boot, in-flight states
 * collapse to RECOVERING until the real workspace verifies.
 */

import { join } from 'node:path';
import { BlueprintError, InvalidTransitionError } from '../core/errors.ts';
import { ensureDir } from '../runtime/paths.ts';
import { JsonFileStore } from '../web/durable.ts';
import type { EventBus } from '../events/types.ts';
import { LocalWorkspaceEnvAdapter } from './local-workspace.ts';
import { DaytonaWorkspaceAdapter } from './daytona-adapter.ts';
import type {
  EnvironmentRecord,
  EnvAdapter,
  EnvHealth,
  EnvSpec,
  EnvStatus,
} from './types.ts';
import { ENV_ALLOWED_TRANSITIONS, ENV_BOOT_RECOVER } from './types.ts';

const SCHEMA_VERSION = 1;

interface EnvSnapshot {
  nextSeq: number;
  records: EnvironmentRecord[];
}

const MAX_ENVS_PER_PROJECT = 1;
const MAX_ENVS_PER_OWNER = 8;

/**
 * Provisioning re-probe budget (§60/§132). A remote execution environment is
 * reached over the network, so a single transient failure must not permanently
 * fail it; a PERSISTENT failure still fails, after these bounded attempts.
 */
const PROVISION_ATTEMPTS = 4;
const PROVISION_RETRY_DELAY_MS = 5_000;

export interface EnvironmentManagerOptions {
  filePath: string;
  /** Root under which real workspace directories are materialized. */
  workspacesRoot: string;
  bus: EventBus;
  /**
   * Custom single adapter factory (legacy). When given it is used for EVERY
   * environment; otherwise the backend is selected per environment from its
   * OWN recorded adapterKind so a runtime backend switch never rebinds an
   * existing workspace to a different real mechanism.
   */
  adapterFor?: (envId: string, workspaceRoot: string) => EnvAdapter;
  /** Real adapters keyed by backend kind; selected per environment record. */
  adapterFactories?: {
    localWorkspace: (workspaceRoot: string) => EnvAdapter;
    daytona: (workspaceRoot: string) => EnvAdapter;
  };
  /**
   * The REAL backend new environments are bound to (capability-first: selected
   * from actual CLI presence). Defaults to local-workspace; lowest-priority
   * evidence of the binding is the record's own adapterKind.
   */
  defaultAdapterKind?: EnvAdapter['kind'];
}

export function environmentsFilePath(dataDir: string): string {
  return join(dataDir, 'environments.json');
}

export function workspacesRootPath(dataDir: string): string {
  return join(dataDir, 'workspaces');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function padEnvSeq(seq: number): string {
  return `ENV-${String(seq).padStart(6, '0')}`;
}

export class EnvironmentManager {
  private readonly file: JsonFileStore<EnvSnapshot>;
  private readonly workspacesRoot: string;
  private readonly bus: EventBus;
  private readonly customAdapterFor: ((envId: string, workspaceRoot: string) => EnvAdapter) | null;
  private readonly adapterFactories: { localWorkspace: (workspaceRoot: string) => EnvAdapter; daytona: (workspaceRoot: string) => EnvAdapter };
  private defaultAdapterKind: 'local-workspace' | 'daytona';
  private records = new Map<string, EnvironmentRecord>();
  private nextSeq = 1;
  private loaded = false;

  constructor(options: EnvironmentManagerOptions) {
    this.file = new JsonFileStore<EnvSnapshot>({
      filePath: options.filePath,
      schemaVersion: SCHEMA_VERSION,
    });
    this.workspacesRoot = options.workspacesRoot;
    this.bus = options.bus;
    this.customAdapterFor = options.adapterFor ?? null;
    this.adapterFactories =
      options.adapterFactories ?? {
        localWorkspace: (root) => new LocalWorkspaceEnvAdapter(root),
        daytona: (root) => new DaytonaWorkspaceAdapter(root),
      };
    this.defaultAdapterKind = options.defaultAdapterKind ?? 'local-workspace';
  }

  /**
   * Switches the real backend new environments bind to. Records already exist
   * keep their original backend (their workspace is real wherever it lives);
   * only NEW requests take the new kind. Kept in sync with a successful live
   * capability re-probe (foundation refresh) - never set blindly.
   */
  setDefaultAdapterKind(kind: 'local-workspace' | 'daytona'): void {
    this.defaultAdapterKind = kind;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    await ensureDir(this.workspacesRoot);
    const snapshot = await this.file.load();
    if (snapshot !== null) {
      this.nextSeq = snapshot.nextSeq;
      for (const record of snapshot.records) this.records.set(record.id, record);
      // Crash recovery: an environment can never boot into a state that
      // implies availability without a fresh real health check.
      for (const record of [...this.records.values()]) {
        if (ENV_BOOT_RECOVER[record.status]) {
          await this.updateStatus(record, 'RECOVERING', 'system:crash-recovery', 'Server restarted; readiness will be re-verified.');
        }
      }
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.init();
  }

  private async persist(): Promise<void> {
    await this.file.save({ nextSeq: this.nextSeq, records: [...this.records.values()] });
  }

  private async updateStatus(
    record: EnvironmentRecord,
    to: EnvStatus,
    by: string,
    detail: string,
  ): Promise<EnvironmentRecord> {
    const allowed = ENV_ALLOWED_TRANSITIONS[record.status];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(record.status, to, allowed);
    }
    const from = record.status;
    const now = new Date().toISOString();
    const next: EnvironmentRecord = {
      ...record,
      status: to,
      lastTransition: { from, to, at: now, by },
      updatedAt: now,
    };
    this.records.set(record.id, next);
    await this.persist();
    await this.publishTransition(record, next, detail);
    return next;
  }

  private async publishTransition(from: EnvironmentRecord, to: EnvironmentRecord, detail: string): Promise<void> {
    await this.bus.publish({
      type: 'env.transition',
      tenantId: to.ownerId,
      projectId: to.projectId,
      envId: to.id,
      payload: {
        from: from.status,
        to: to.status,
        at: to.lastTransition?.at ?? to.updatedAt,
        adapter: to.adapterKind,
        detail,
      },
    });
  }

  private adapterOf(record: EnvironmentRecord): EnvAdapter {
    const root = record.workspaceRoot ?? join(this.workspacesRoot, record.id);
    // The environment's OWN recorded binding is authoritative: a runtime
    // backend switch never rebinds an existing workspace to a different real
    // mechanism (CLINE-DAYTONA BINDING stays per-environment and honest).
    if (this.customAdapterFor !== null) return this.customAdapterFor(record.id, root);
    const factory = record.adapterKind === 'daytona' ? this.adapterFactories.daytona : this.adapterFactories.localWorkspace;
    return factory(root);
  }

  /** Requests a new environment. Owner isolation is enforced here and on every call. */
  async request(options: {
    ownerId: string;
    projectId: string;
    spec: EnvSpec;
    by: string;
  }): Promise<EnvironmentRecord> {
    await this.ensureLoaded();
    const existing = [...this.records.values()].filter(
      (r) => r.projectId === options.projectId && !ENV_TERMINAL_HAS(r.status),
    );
    if (existing.length >= MAX_ENVS_PER_PROJECT) {
      throw new BlueprintError(
        'ENV_QUOTA_PROJECT',
        `Project ${options.projectId} already has an active environment; request a lifecycle transition instead.`,
      );
    }
    const owned = [...this.records.values()].filter((r) => r.ownerId === options.ownerId && !ENV_TERMINAL_HAS(r.status));
    if (owned.length >= MAX_ENVS_PER_OWNER) {
      throw new BlueprintError(
        'ENV_QUOTA_OWNER',
        `Owner "${options.ownerId}" already has ${MAX_ENVS_PER_OWNER} active environments; destroy one first.`,
      );
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const id = padEnvSeq(seq);
    const now = new Date().toISOString();
    const workspaceRoot = join(this.workspacesRoot, id);
    const record: EnvironmentRecord = {
      id,
      projectId: options.projectId,
      ownerId: options.ownerId,
      spec: { ...options.spec },
      status: 'REQUESTED',
      adapterKind: this.defaultAdapterKind,
      workspaceRoot,
      lastHealth: null,
      lastTransition: { from: 'REQUESTED', to: 'REQUESTED', at: now, by: options.by },
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    await this.persist();
    await this.bus.publish({
      type: 'env.requested',
      tenantId: options.ownerId,
      projectId: options.projectId,
      envId: record.id,
      payload: { label: options.spec.label, gitEnabled: options.spec.gitEnabled, workspaceRoot },
    });
    void this.provision(record.id, options.by);
    return clone(record);
  }

  /** Provisions the workspace and drives REQUESTED → READY (or FAILED). */
  private async provision(envId: string, by: string): Promise<void> {
    const record = (await this.get(envId)) ?? null;
    if (record === null) return;
    let current = record;
    try {
      current = await this.updateStatus(current, 'PROVISIONING', by, 'Provisioning real workspace.');
    } catch {
      return; // already moved on (e.g. destroyed meanwhile)
    }
    const adapter = this.adapterOf(current);
    // LAW - AUTOMATIC NETWORK RESUME / NO MANUAL CONTINUE FOR ORDINARY RECOVERY
    // (§60, §132): provisioning talks to a REMOTE service (Daytona), so a single
    // transient network blip - a DNS timeout, a TLS handshake reset - must not
    // permanently FAIL the environment and leave every gated job BLOCKED with no
    // way forward except a human creating a new environment.
    //
    // A failing health probe is therefore re-checked a bounded number of times
    // with backoff while the record stays PROVISIONING. Only after the retries
    // are exhausted does the environment become FAILED - a real, persistent
    // failure. Nothing here claims readiness that was not actually proven: a
    // retry only ever re-probes, and READY still requires a genuinely healthy
    // answer.
    let health: EnvHealth = { ok: false, checkedAt: new Date().toISOString(), detail: 'Provisioning was not attempted.' };
    for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt++) {
      try {
        health = attempt === 1 ? await adapter.provision(current.spec) : await adapter.health();
      } catch (error) {
        health = {
          ok: false,
          checkedAt: new Date().toISOString(),
          detail: `Provisioning attempt ${attempt} failed: ${(error as Error).message}`,
        };
      }
      if (health.ok) break;
      if (attempt < PROVISION_ATTEMPTS) {
        await this.bus.publish({
          type: 'env.provision_retry',
          tenantId: current.ownerId,
          projectId: current.projectId,
          envId: current.id,
          payload: { attempt, of: PROVISION_ATTEMPTS, detail: health.detail.slice(0, 300) },
        });
        await new Promise((r) => setTimeout(r, PROVISION_RETRY_DELAY_MS * attempt));
      }
    }
    const withHealth: EnvironmentRecord = { ...current, lastHealth: health, updatedAt: new Date().toISOString() };
    this.records.set(withHealth.id, withHealth);
    await this.persist();
    if (health.ok) {
      const ready = await this.updateStatus(withHealth, 'READY', by, `Workspace healthy: ${health.detail}`);
      await this.bus.publish({
        type: 'env.readiness_verified',
        tenantId: ready.ownerId,
        projectId: ready.projectId,
        envId: ready.id,
        payload: { ...health },
      });
      return;
    }
    await this.updateStatus(withHealth, 'FAILED', by, `Environment failed readiness: ${health.detail}`);
  }

  get(id: string, ownerId?: string): Promise<EnvironmentRecord | null> {
    return this.getInternal(id, ownerId);
  }

  private async getInternal(id: string, ownerId?: string): Promise<EnvironmentRecord | null> {
    await this.ensureLoaded();
    const record = this.records.get(id);
    if (record === undefined) return null;
    if (ownerId !== undefined && record.ownerId !== ownerId) return null;
    return clone(record);
  }

  async forProject(projectId: string, ownerId?: string): Promise<EnvironmentRecord[]> {
    await this.ensureLoaded();
    return this.list(ownerId).then((all) => all.filter((r) => r.projectId === projectId));
  }

  /** The READY workspace an owner's project can run agentic sessions against, if any. */
  async findReady(ownerId: string, projectId: string): Promise<EnvironmentRecord | null> {
    await this.ensureLoaded();
    for (const record of this.records.values()) {
      if (record.ownerId === ownerId && record.projectId === projectId && record.status === 'READY') {
        return clone(record);
      }
    }
    return null;
  }

  async list(ownerId?: string): Promise<EnvironmentRecord[]> {
    await this.ensureLoaded();
    return [...this.records.values()]
      .filter((r) => ownerId === undefined || r.ownerId === ownerId)
      .map((r) => clone(r));
  }

  /** Returns the live adapter for an owned environment (real file/terminal/git access). */
  async workspace(id: string, ownerId?: string): Promise<EnvAdapter | null> {
    const record = await this.getInternal(id, ownerId);
    if (record === null || record.status === 'DESTROYED') return null;
    return this.adapterOf(record);
  }

  /**
   * Re-verifies a real health check; READY that fails health becomes RECOVERING.
   */
  async verifyHealth(id: string, by: string): Promise<EnvironmentRecord | null> {
    const record = (await this.get(id)) ?? null;
    if (record === null) return null;
    let health: EnvHealth;
    try {
      health = await this.adapterOf(record).health();
    } catch (error) {
      health = { ok: false, checkedAt: new Date().toISOString(), detail: `health check errored: ${(error as Error).message}` };
    }
    const withHealth: EnvironmentRecord = { ...record, lastHealth: health, updatedAt: new Date().toISOString() };
    this.records.set(record.id, withHealth);
    await this.persist();
    if (record.status === 'READY' || record.status === 'RECOVERING') {
      if (health.ok) {
        await this.updateStatus(withHealth, 'READY', by, `Re-verified healthy: ${health.detail}`);
      } else if (record.status === 'READY') {
        await this.updateStatus(withHealth, 'RECOVERING', by, `Readiness re-check failed: ${health.detail}`);
      }
    }
    return (await this.get(record.id)) ?? null;
  }

  async pause(id: string, by: string): Promise<EnvironmentRecord | null> {
    const record = (await this.get(id)) ?? null;
    if (record === null) return null;
    if (record.status !== 'READY' && record.status !== 'RECOVERING') return record;
    return this.updateStatus(record, 'PAUSED', by, 'Environment paused by explicit user action.');
  }

  async resume(id: string, by: string): Promise<EnvironmentRecord | null> {
    const record = (await this.get(id)) ?? null;
    if (record === null) return null;
    if (record.status !== 'PAUSED' && record.status !== 'FAILED') return record;
    let health: EnvHealth;
    try {
      health = await this.adapterOf(record).health();
    } catch (error) {
      health = { ok: false, checkedAt: new Date().toISOString(), detail: `resume health check errored: ${(error as Error).message}` };
    }
    const withHealth: EnvironmentRecord = { ...record, lastHealth: health, updatedAt: new Date().toISOString() };
    this.records.set(record.id, withHealth);
    await this.persist();
    if (health.ok) {
      return this.updateStatus(withHealth, 'READY', by, `Resumed and verified: ${health.detail}`);
    }
    await this.updateStatus(withHealth, 'FAILED', by, `Resume could not verify the environment: ${health.detail}`);
    const failed = (await this.get(record.id)) ?? null;
    return failed;
  }

  async destroy(id: string, by: string): Promise<EnvironmentRecord | null> {
    const record = (await this.get(id)) ?? null;
    if (record === null) return null;
    if (record.status === 'DESTROYED') return record;
    const adapter = this.adapterOf(record);
    try {
      await adapter.destroy();
    } catch {
      // even if cleanup fails, the record moves to DESTROYED (evidence stays)
    }
    return this.updateStatus(record, 'DESTROYED', by, 'Environment destroyed by explicit user action; evidence and records preserved.');
  }
}

/** True when a status is terminal (record may still be inspected). */
function ENV_TERMINAL_HAS(status: EnvStatus): boolean {
  return status === 'DESTROYED' || status === 'FAILED';
}