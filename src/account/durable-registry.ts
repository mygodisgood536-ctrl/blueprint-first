/**
 * Durable account registry.
 *
 * Wraps the in-memory AccountRegistry with atomic JSON-file persistence so
 * accounts, sessions, and reset tokens survive restarts. The file is rewritten
 * atomically (temp + rename, Windows-safe fallback) after every mutation via
 * the same primitive the artifact store uses. Loading prunes expired sessions
 * and reset tokens before first use.
 */

import { promises as fs } from 'node:fs';
import { atomicWriteText } from '../core/json-file-store.ts';
import {
  AccountRegistry,
  type AccountCreateInput,
  type AccountRecord,
  type AccountRegistryState,
  type AccountView,
  type SecurityEventRecord,
  type Session,
} from './accounts.ts';
import type { Actor } from '../core/artifact.ts';

export class DurableAccountRegistry {
    private readonly inner: AccountRegistry;
  readonly filePath: string;

     private constructor(inner: AccountRegistry, filePath: string) {
    this.inner = inner;
    this.filePath = filePath;
  }

  /** Loads (or initializes) the durable registry from `filePath`. */
  static async load(filePath: string, sessionTtlMs: number): Promise<DurableAccountRegistry> {
    const inner = new AccountRegistry({ sessionTtlMs });
    let raw: string | null = null;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch {
      raw = null; // first run - no account store yet
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Account store ${filePath} is not valid JSON.`);
      }
      inner.restoreState(parsed as AccountRegistryState);
    }
    inner.pruneExpired();
    const registry = new DurableAccountRegistry(inner, filePath);
    await registry.persist();
    return registry;
  }

  private async persist(): Promise<void> {
    await atomicWriteText(this.filePath, JSON.stringify(this.inner.exportState(), null, 2));
  }

  // ── Reads (no persistence needed) ─────────────────────────────────────────

  verifySession(token: string): AccountRecord {
    return this.inner.verifySession(token);
  }

  listSessions(accountId: string): Session[] {
    return this.inner.listSessions(accountId);
  }

  view(record: AccountRecord): AccountView {
    return this.inner.view(record);
  }

  actor(record: { id: string }): Actor {
    return this.inner.actor(record);
  }

  // ── Mutations (persisted) ─────────────────────────────────────────────────

  async createAccount(input: AccountCreateInput): Promise<AccountView> {
    const view = this.inner.createAccount(input);
    await this.persist();
    return view;
  }

  /** Authenticates and persists the new session. */
  async authenticate(username: string, password: string): Promise<Session> {
    const session = this.inner.authenticate(username, password);
    await this.persist();
    return session;
  }

  async revokeSession(token: string): Promise<void> {
    this.inner.revokeSession(token);
    await this.persist();
  }

  async revokeAllOtherSessions(accountId: string, keepToken: string): Promise<number> {
    const revoked = this.inner.revokeAllOtherSessions(accountId, keepToken);
    await this.persist();
    return revoked;
  }

  async updateProfile(accountId: string, patch: { displayName?: string }): Promise<AccountView> {
    const view = this.inner.updateProfile(accountId, patch);
    await this.persist();
    return view;
  }

  async updatePreferences(
    accountId: string,
    patch: Record<string, string | number | boolean>,
  ): Promise<Record<string, string | number | boolean>> {
    const prefs = this.inner.updatePreferences(accountId, patch);
    await this.persist();
    return prefs;
  }

  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AccountView> {
    const view = this.inner.changePassword(accountId, currentPassword, newPassword);
    await this.persist();
    return view;
  }

  /** Returns the one-time reset token, or null when the username is unknown. */
  async requestPasswordReset(username: string): Promise<string | null> {
    const token = this.inner.requestPasswordReset(username);
    await this.persist();
    return token;
  }

  async resetPassword(token: string, newPassword: string): Promise<AccountView> {
    const view = this.inner.resetPassword(token, newPassword);
    await this.persist();
    return view;
  }

  // ── Authenticator, recovery, and security events ───────────────────────────

  getPreferences(accountId: string): Record<string, string | number | boolean> {
    return this.inner.getPreferences(accountId);
  }

  hasAuthenticatorEnabled(accountId: string): boolean {
    return this.inner.hasAuthenticatorEnabled(accountId);
  }

  remainingRecoveryCodes(accountId: string): number {
    return this.inner.remainingRecoveryCodes(accountId);
  }

  securityEventsOf(accountId: string): SecurityEventRecord[] {
    return this.inner.securityEventsOf(accountId);
  }

  verifyPassword(accountId: string, password: string): boolean {
    return this.inner.verifyPassword(accountId, password);
  }

  async recordSecurityEvent(accountId: string, kind: string, detail?: string): Promise<void> {
    this.inner.recordSecurityEvent(accountId, kind, detail);
    await this.persist();
  }

  async setupAuthenticator(accountId: string): Promise<{ secret: string; otpauth: string }> {
    const result = this.inner.setupAuthenticator(accountId);
    await this.persist();
    return result;
  }

  async enableAuthenticator(accountId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const result = this.inner.enableAuthenticator(accountId, code);
    await this.persist();
    return result;
  }

  async disableAuthenticator(accountId: string, code: string): Promise<void> {
    this.inner.disableAuthenticator(accountId, code);
    await this.persist();
  }

  /** Consumes a recovery code on match, so this is treated as a mutation. */
  async verifyAuthenticator(accountId: string, code: string): Promise<boolean> {
    const ok = this.inner.verifyAuthenticator(accountId, code);
    if (ok) await this.persist();
    return ok;
  }

  async beginRecoveryChallenge(
    username: string,
  ): Promise<{ challengeId: string; expiresAt: string } | null> {
    const challenge = this.inner.beginRecoveryChallenge(username);
    if (challenge !== null) await this.persist();
    return challenge;
  }

  async completeRecovery(challengeId: string, code: string, newPassword: string): Promise<AccountView> {
    const view = this.inner.completeRecovery(challengeId, code, newPassword);
    await this.persist();
    return view;
  }
}