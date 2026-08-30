/**
 * Per-account isolation (expansion §11).
 *
 * Enforces that an authenticated account may only read or write artifacts that
 * belong to projects it is permitted to access. Access is derived from the
 * PROJECT artifact's declared owner (`owner.userId`), which the account layer
 * sets to the account's Actor id. Admins bypass project-scoped restrictions;
 * developer/viewer accounts are confined to their own projects.
 *
 * `isolate()` returns a CoreServices view whose store is wrapped so that every
 * read is scoped and every write is gated, keeping the isolation contract
 * enforced uniformly regardless of which engine calls it.
 */
import type { AccountRecord } from './accounts.ts';
import type { CoreServices } from '../core/services.ts';
import type { ArtifactFilter, ArtifactStore } from '../core/store.ts';
import type { Artifact } from '../core/artifact.ts';
import { BlueprintError } from '../core/errors.ts';

export class AccessDeniedError extends BlueprintError {
  constructor(message: string) {
    super('ACCESS_DENIED', message);
  }
}

export type { AccountRecord };

export class AccountIsolation {
  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    this.services = services;
  }

  /** The project ids this account may access (admins: all projects). */
  async accessibleProjectIds(account: AccountRecord): Promise<string[]> {
    const projects = await this.services.store.list({ types: ['PROJECT'] });
    if (account.role === 'admin') {
      return projects.map((p) => p.id).sort();
    }
    return projects
      .filter((p) => this.projectOwnerId(p) === account.id)
      .map((p) => p.id)
      .sort();
  }

  async canAccessProject(account: AccountRecord, projectId: string): Promise<boolean> {
    const project = await this.services.store.get(projectId);
    if (project === null || project.type !== 'PROJECT') return false;
    return account.role === 'admin' || this.projectOwnerId(project) === account.id;
  }

  async assertProjectAccess(account: AccountRecord, projectId: string): Promise<void> {
    if (await this.canAccessProject(account, projectId)) return;
    throw new AccessDeniedError(
      `Account ${account.id} does not have access to project ${projectId}.`,
    );
  }

  /** All artifact ids under projects this account can access. */
  async accessibleArtifactIds(account: AccountRecord): Promise<Set<string>> {
    const projectIds = new Set(await this.accessibleProjectIds(account));
    const result = new Set<string>();
    for (const artifact of await this.services.store.list()) {
      if (artifact.type === 'PROJECT') {
        if (projectIds.has(artifact.id)) result.add(artifact.id);
      } else if (artifact.projectId !== null && projectIds.has(artifact.projectId)) {
        result.add(artifact.id);
      }
    }
    return result;
  }

  private canAccessArtifact(account: AccountRecord, artifact: Artifact): boolean {
    if (account.role === 'admin') return true;
    if (artifact.type === 'PROJECT') return this.projectOwnerId(artifact) === account.id;
    if (artifact.projectId === null) return false;
    return this.accessCache.get(account.id)?.has(artifact.projectId) ?? false;
  }

  private async accessCacheOf(account: AccountRecord): Promise<void> {
    if (!this.accessCache.has(account.id)) {
      const ids = new Set(await this.accessibleProjectIds(account));
      this.accessCache.set(account.id, ids);
    }
  }

  private readonly accessCache = new Map<string, Set<string>>();

  /**
   * Returns a CoreServices view isolated to the given account: the artifact
   * store is wrapped so reads are scoped and writes are gated, while the graph,
   * evidence, allocator, and router remain shared infrastructure.
   */
  async isolate(account: AccountRecord): Promise<CoreServices> {
    await this.accessCacheOf(account);
    const scoped = new ScopedArtifactStore(
      this.services.store,
      this.services,
      account,
      (artifact) => this.canAccessArtifact(account, artifact),
    );
    return {
      store: scoped,
      allocator: this.services.allocator,
      graph: this.services.graph,
      evidence: this.services.evidence,
      router: this.services.router,
      logger: this.services.logger,
      projects: this.services.projects,
    };
  }

  private projectOwnerId(project: Artifact): string {
    const owner = project.attributes['owner'] as { userId?: string } | undefined;
    return owner?.userId ?? '';
  }
}

/** Decorates an ArtifactStore to scope reads and gate writes by access. */
class ScopedArtifactStore implements ArtifactStore {
  readonly kind: string;
  private readonly inner: ArtifactStore;
  private readonly account: AccountRecord;
  private readonly canAccess: (artifact: Artifact) => boolean;
  private readonly cache = new Map<string, boolean>();

  constructor(
    inner: ArtifactStore,
    _services: CoreServices,
    account: AccountRecord,
    canAccess: (artifact: Artifact) => boolean,
  ) {
    this.inner = inner;
    this.account = account;
    this.canAccess = canAccess;
    this.kind = `${inner.kind}@scoped:${account.id}`;
  }

  private async idAllowed(id: string): Promise<boolean> {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    const artifact = await this.inner.get(id);
    const allowed = artifact === null ? false : this.canAccess(artifact);
    this.cache.set(id, allowed);
    return allowed;
  }

  async append(artifact: Artifact): Promise<void> {
    if (!this.canAccess(artifact)) {
      throw new AccessDeniedError(
        `Account ${this.account.id} is not allowed to create artifact ${artifact.id}.`,
      );
    }
    return this.inner.append(artifact);
  }

  async get(id: string): Promise<Artifact | null> {
    const artifact = await this.inner.get(id);
    if (artifact === null) return null;
    return this.canAccess(artifact) ? artifact : null;
  }

  async require(id: string): Promise<Artifact> {
    const artifact = await this.get(id);
    if (artifact === null) {
      throw new AccessDeniedError(
        `Account ${this.account.id} cannot access artifact ${id}.`,
      );
    }
    return artifact;
  }

  async update(
    id: string,
    expectedVersion: number,
    mutate: (draft: Artifact) => Artifact,
  ): Promise<Artifact> {
    if (!(await this.idAllowed(id))) {
      throw new AccessDeniedError(
        `Account ${this.account.id} cannot update artifact ${id}.`,
      );
    }
    return this.inner.update(id, expectedVersion, mutate);
  }

  async list(filter?: ArtifactFilter): Promise<Artifact[]> {
    const all = await this.inner.list(filter);
    return all.filter((a) => this.canAccess(a));
  }

  async countByType(): Promise<Record<string, number>> {
    const all = await this.inner.list();
    const counts: Record<string, number> = {};
    for (const artifact of all) {
      if (!this.canAccess(artifact)) continue;
      counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
    }
    return counts;
  }
}
