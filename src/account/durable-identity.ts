/**
 * DURABLE identity registry for the replacement authentication model.
 *
 * Wraps `IdentityRegistry` with the same atomic JSON-file persistence the
 * previous account registry used (temp + rename, Windows-safe), so accounts and
 * sessions survive restarts.
 *
 * On load the Gmail/username uniqueness indexes are REBUILT from the persisted
 * records and any duplicate is resolved deterministically (earliest record
 * wins). Uniqueness is therefore enforced at the PERSISTENCE layer too, not only
 * by the in-memory writer — a hand-edited or corrupted store can never resurrect
 * two accounts sharing one Gmail.
 *
 * The stored file contains the scrypt hash of a security answer, never the
 * plaintext. The privileged bootstrap answer is read from the environment and
 * is never written here.
 */
import { promises as fs } from 'node:fs';
import { atomicWriteText } from '../core/json-file-store.ts';
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

const FILE_SCHEMA_VERSION = 1;

interface PersistedEnvelope {
  readonly schemaVersion: number;
  readonly value: IdentityRegistryState;
}

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
  readonly filePath: string;

  private constructor(inner: IdentityRegistry, filePath: string) {
    this.inner = inner;
    this.filePath = filePath;
  }

  static async load(filePath: string, sessionTtlMs: number): Promise<DurableIdentityRegistry> {
    const inner = new IdentityRegistry(sessionTtlMs);
    let raw: string | null = null;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch {
      raw = null; // first run
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Identity store ${filePath} is not valid JSON.`);
      }
      const envelope = parsed as PersistedEnvelope;
      const state =
        typeof envelope === 'object' && envelope !== null && 'value' in envelope
          ? envelope.value
          : (parsed as IdentityRegistryState);
      inner.restoreState(state);
      reassertUniqueness(inner);
    }
    const registry = new DurableIdentityRegistry(inner, filePath);
    await registry.persist();
    return registry;
  }

  private async persist(): Promise<void> {
    const envelope: PersistedEnvelope = {
      schemaVersion: FILE_SCHEMA_VERSION,
      value: this.inner.exportState(),
    };
    await atomicWriteText(this.filePath, JSON.stringify(envelope, null, 2));
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
    const view = this.inner.createAccount(input);
    await this.persist();
    return view;
  }

  async signIn(
    gmail: string,
    securityQuestion: string,
    securityAnswer: string,
  ): Promise<{ account: IdentityView; session: IdentitySession }> {
    const out = this.inner.signIn(gmail, securityQuestion, securityAnswer);
    await this.persist();
    return out;
  }

  async logout(token: string): Promise<boolean> {
    const ok = this.inner.logout(token);
    if (ok) await this.persist();
    return ok;
  }

  async setFullName(id: string, fullName: string): Promise<boolean> {
    const ok = this.inner.setFullName(id, fullName);
    if (ok) await this.persist();
    return ok;
  }

  async setPreferences(id: string, prefs: Record<string, string | number | boolean>): Promise<boolean> {
    const ok = this.inner.setPreferences(id, prefs);
    if (ok) await this.persist();
    return ok;
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
    const { accountId } = ensurePrivilegedAccount(this.inner, config);
    await this.persist();
    return this.inner.get(accountId);
  }
}