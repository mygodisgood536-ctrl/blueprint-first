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
  AuthenticatorChallengeRequiredError,
  type AccountCreateInput,
  type AccountRecord,
  type AccountRegistryState,
  type AccountSetupStage,
  type AccountView,
  type RecoveryAnswerInput,
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

  // â”€â”€ Reads (no persistence needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Mutations (persisted) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async createAccount(input: AccountCreateInput): Promise<AccountView> {
    const view = this.inner.createAccount(input);
    await this.persist();
    return view;
  }

  // â”€â”€ Role-separated entry points â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** First-time Platform Owner setup from the dedicated owner entry point. */
  async createPlatformOwner(input: Omit<AccountCreateInput, 'role'>): Promise<AccountView> {
    const view = this.inner.createPlatformOwner(input);
    await this.persist();
    return view;
  }

  /** First-time normal-user setup from the dedicated user entry point. */
  async createNormalUser(input: Omit<AccountCreateInput, 'role'>): Promise<AccountView> {
    const view = this.inner.createNormalUser(input);
    await this.persist();
    return view;
  }

  hasPlatformOwner(): boolean {
    return this.inner.hasPlatformOwner();
  }

  // â”€â”€ Recovery questions and answers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  needsRecoverySetup(accountId: string): boolean {
    return this.inner.needsRecoverySetup(accountId);
  }

  needsSetup(accountId: string): boolean {
    return this.inner.needsSetup(accountId);
  }

  setupStageOfAccount(accountId: string): AccountSetupStage {
    return this.inner.setupStageOfAccount(accountId);
  }

  recoveryQuestionsOf(accountId: string): Array<{ id: string; question: string }> {
    return this.inner.recoveryQuestionsOf(accountId);
  }

  /** Stores hashed recovery answers. Never returns or logs the plaintext. */
  async configureRecoveryQuestions(
    accountId: string,
    answers: RecoveryAnswerInput[],
  ): Promise<AccountView> {
    const view = this.inner.configureRecoveryQuestions(accountId, answers);
    await this.persist();
    return view;
  }

  verifyRecoveryAnswers(accountId: string, answers: RecoveryAnswerInput[]): boolean {
    return this.inner.verifyRecoveryAnswers(accountId, answers);
  }

  /** Recovery-authorized password change for an authenticated account. */
  async changePasswordWithRecovery(
    accountId: string,
    answers: RecoveryAnswerInput[],
    newPassword: string,
  ): Promise<AccountView> {
    const view = this.inner.changePasswordWithRecovery(accountId, answers, newPassword);
    await this.persist();
    return view;
  }

  /** CHANGE/RESET authenticator authorized by the account's recovery answers. */
  async setupAuthenticatorWithRecovery(
    accountId: string,
    answers: RecoveryAnswerInput[],
  ): Promise<{ secret: string; otpauth: string }> {
    const result = this.inner.setupAuthenticatorWithRecovery(accountId, answers);
    await this.persist();
    return result;
  }

  /** Forgot password step 1: identify the account and open a challenge. */
  async beginPasswordRecovery(username: string): Promise<
    { challengeId: string; expiresAt: string; questions: Array<{ id: string; question: string }> } | null
  > {
    const challenge = this.inner.beginPasswordRecovery(username);
    if (challenge !== null) await this.persist();
    return challenge;
  }

  /** Forgot password step 2: verify the recovery answers, then issue a reset token. */
  async answerRecoveryChallenge(
    challengeId: string,
    answers: RecoveryAnswerInput[],
  ): Promise<{ resetToken: string; expiresAt: string }> {
    const result = this.inner.answerRecoveryChallenge(challengeId, answers);
    await this.persist();
    return result;
  }

  /** Authenticates and persists the new session (or the pending sign-in challenge for TOTP accounts). */
  async authenticate(username: string, password: string): Promise<Session> {
    try {
      const session = this.inner.authenticate(username, password);
      await this.persist();
      return session;
    } catch (error) {
      if (error instanceof AuthenticatorChallengeRequiredError) {
        await this.persist();
      }
      throw error;
    }
  }

  async completeLoginChallenge(challengeId: string, code: string): Promise<Session> {
    const session = this.inner.completeLoginChallenge(challengeId, code);
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

  /**
   * Designates an existing account as the platform owner and persists the role.
   * Used by the backend at boot when the operator sets `BF_PLATFORM_OWNER`.
   */
  async promoteToPlatformOwner(username: string): Promise<AccountView | null> {
    const view = this.inner.promoteToPlatformOwner(username);
    if (view !== null) await this.persist();
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

  // â”€â”€ Authenticator, recovery, and security events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getPreferences(accountId: string): Record<string, string | number | boolean> {
    return this.inner.getPreferences(accountId);
  }

  hasAuthenticatorEnabled(accountId: string): boolean {
    return this.inner.hasAuthenticatorEnabled(accountId);
  }

  needsAuthenticatorSetup(accountId: string): boolean {
    return this.inner.needsAuthenticatorSetup(accountId);
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
