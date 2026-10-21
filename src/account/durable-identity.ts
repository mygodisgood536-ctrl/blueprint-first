/**
 * DURABLE identity registry for the replacement authentication model.
 *
 * Wraps `IdentityRegistry` with durable persistence through the platform's
 * storage port, so accounts and sessions survive restarts AND are stored in
 * Neon in production, where the function filesystem is read-only. The file path
 * passed to `load()` names a durable SLOT, not a write location: the backend
 * owns the real persistence (Decision D2).
 *
 * Every mutation is a serialized read-modify-write, so two concurrent
 * serverless instances cannot both accept the same Gmail: the uniqueness
 * decision and the write happen inside one transaction.
 *
 * On load the Gmail/username uniqueness indexes are REBUILT from the persisted
 * records and any duplicate is resolved deterministically (earliest record
 * wins). Uniqueness is therefore enforced at the PERSISTENCE layer too, not only
 * by the in-memory writer — a hand-edited or corrupted store can never resurrect
 * two accounts sharing one Gmail.
 *
 * The stored record contains the scrypt hash of a security answer, never the
 * plaintext. The privileged bootstrap answer is read from the environment and
 * is never written here.
 */
import {
  IdentityRegistry,
  ensurePrivilegedAccount,
  readBootstrapConfig,
  normalizeGmail,
  normalizeUsername,
  type BootstrapConfig,
  type CreateIdentityInput,
  type IdentityRegistryState,
  type IdentitySession,
  type IdentityView,
} from './identity.ts';
import { JsonFileStore } from '../storage/snapshot-store.ts';

const FILE_SCHEMA_VERSION = 1;

/** Rebuilds uniqueness indexes from persisted records, earliest record wins. */
export function reassertUniqueness(registry: IdentityRegistry): void {
  const state = registry.exportState();
  const seenGmail = new Set<string>();
  const seenUsername = new Set<string>();
  const survivors = state.records.filter((r) => {
    const g = normalizeGmail(r.gmail);
    const u = normalizeUsername(r.username);
    if (seenGmail.has(g) || seenUsername.has(u)) return false;
    seenGmail.add(g);
    seenUsername.add(u);
    return true;
  });
  registry.restoreState({ ...state, records: survivors });
}

export class DurableIdentityRegistry {
  private readonly inner: IdentityRegistry;
  private readonly store: JsonFileStore<IdentityRegistryState>;
  readonly filePath: string;

  private constructor(inner: IdentityRegistry, store: JsonFileStore<IdentityRegistryState>, filePath: string) {
    this.inner = inner;
    this.store = store;
    this.filePath = filePath;
  }

  static async load(filePath: string, sessionTtlMs: number): Promise<DurableIdentityRegistry> {
    const inner = new IdentityRegistry(sessionTtlMs);
    const store = new JsonFileStore<IdentityRegistryState>({
      filePath,
      schemaVersion: FILE_SCHEMA_VERSION,
    });
    const state = await store.load();
    if (state !== null) {
      inner.restoreState(state);
      reassertUniqueness(inner);
    }
    const registry = new DurableIdentityRegistry(inner, store, filePath);
    await registry.persist();
    return registry;
  }

  /**
   * Where this registry's durable state actually lives right now, or null when
   * the live backend has no file (PostgreSQL in production). The path passed to
   * `load()` names a SLOT, not a file: the backend owns the on-disk naming, so
   * this is the only reliable way to learn it.
   */
  location(): string | null {
    return this.store.location();
  }

  private async persist(): Promise<void> {
    await this.store.save(this.inner.exportState());
  }

  /**
   * Applies a mutation to the durable state atomically.
   *
   * The in-memory registry is refreshed from the durable state first, so the
   * decision is always made against the CURRENT durable state (including a
   * write made by another instance), and the result is written back in the same
   * transaction. Uniqueness therefore holds across concurrent instances.
   */
  private async mutate<R>(apply: () => R): Promise<R> {
    return await this.store.update((current) => {
      if (current !== null) {
        this.inner.restoreState(current);
        reassertUniqueness(this.inner);
      }
      const result = apply();
      return { value: this.inner.exportState(), result };
    });
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  accountForToken(token: string): IdentityView | null {
    return this.inner.accountForToken(token);
  }

  get(id: string): IdentityView | null {
    return this.inner.get(id);
  }

  byUsername(username: string): IdentityView | null {
    return this.inner.byUsername(username);
  }

  byGmail(gmail: string): IdentityView | null {
    return this.inner.byGmail(gmail);
  }

  /** Server-side authorization decision. Never inferred from a client field. */
  isAdministrator(accountId: string): boolean {
    return this.inner.isAdministrator(accountId);
  }

  count(): number {
    return this.inner.count();
  }

  // ── mutations ──────────────────────────────────────────────────────────────

  async createAccount(input: CreateIdentityInput): Promise<IdentityView> {
    return await this.mutate(() => this.inner.createAccount(input));
  }

  async signIn(
    gmail: string,
    securityQuestion: string,
    securityAnswer: string,
  ): Promise<{ account: IdentityView; session: IdentitySession }> {
    return await this.mutate(() => this.inner.signIn(gmail, securityQuestion, securityAnswer));
  }

  async logout(token: string): Promise<boolean> {
    return await this.mutate(() => {
      const ok = this.inner.logout(token);
      return ok;
    });
  }

  async setFullName(id: string, fullName: string): Promise<boolean> {
    return await this.mutate(() => this.inner.setFullName(id, fullName));
  }

  async setPreferences(id: string, prefs: Record<string, string | number | boolean>): Promise<boolean> {
    return await this.mutate(() => this.inner.setPreferences(id, prefs));
  }

  /**
   * Provisions the privileged account from the environment. Idempotent, so it is
   * safe to call on every boot. Returns null when no bootstrap answer is
   * configured — the platform then has no privileged account rather than one
   * with a guessable credential.
   */
  async ensurePrivilegedAccount(env: NodeJS.ProcessEnv = process.env): Promise<IdentityView | null> {
    const config: BootstrapConfig | null = readBootstrapConfig(env);
    if (config === null) return null;
    return await this.mutate(() => {
      const { accountId } = ensurePrivilegedAccount(this.inner, config);
      return this.inner.get(accountId);
    });
  }
}