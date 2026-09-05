/**
 * Account, authentication, and session layer (expansion §11).
 *
 * Provides a first-class account registry where users authenticate with a
 * username + password (hashed with node:crypto scrypt and a per-user random
 * salt), receive opaque session tokens, and resolve to the platform's existing
 * `Actor` identity model. Sessions are short-lived by default and validated on
 * every authenticated operation by the isolation layer (isolation.ts).
 *
 * This layer is intentionally storage-light and in-memory to match the current
 * single-node JSON persistence; a durable account store can be added behind the
 * same surface later without touching callers.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Actor } from '../core/artifact.ts';
import { BlueprintError } from '../core/errors.ts';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.ts';

/** Platform roles that gate what an account may do (coarse-grained RBAC). */
export type AccountRole = 'admin' | 'developer' | 'viewer';

export const ACCOUNT_ROLES: readonly AccountRole[] = ['admin', 'developer', 'viewer'];

export interface AccountRecord {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  createdAt: string;
  passwordHash: string;
  passwordSalt: string;
  /** Per-account UI/behavior preferences (theme, density, ...). */
  preferences?: Record<string, string | number | boolean>;
  /** TOTP authenticator. Present only after setup; `enabled` gates enforcement. */
  authenticator?: { secret: string; enabled: boolean };
  /** Hashed one-time recovery codes, issued when the authenticator is enabled. */
  recoveryCodes?: RecoveryCodeRecord[];
}

/** Opaque bearer session issued after successful authentication. */
export interface Session {
  token: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AccountCreateInput {
  username: string;
  password: string;
  displayName?: string;
  role?: AccountRole;
  /** Optional explicit account id (used when seeding accounts tied to owners). */
  id?: string;
}

export interface AccountView {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  createdAt: string;
}

export class AuthenticationError extends BlueprintError {
  constructor(message: string) {
    super('AUTHENTICATION_FAILED', message);
  }
}

export class SessionExpiredError extends BlueprintError {
  constructor() {
    super('SESSION_EXPIRED', 'Session is invalid or expired; re-authenticate.');
  }
}

export class DuplicateAccountError extends BlueprintError {
  constructor(username: string) {
    super('DUPLICATE_ACCOUNT', `An account for "${username}" already exists.`);
  }
}

export class AuthenticatorError extends BlueprintError {
  constructor(code: 'AUTHENTICATOR_REQUIRED' | 'AUTHENTICATOR_ALREADY_ENABLED' | 'INVALID_CODE', message: string) {
    super(code, message);
  }
}

/** One hashed single-use recovery code for authenticator-loss recovery. */
export interface RecoveryCodeRecord {
  hash: string;
  usedAt: string | null;
}

/** Short-lived challenge issued when starting authenticator-based recovery. */
export interface RecoveryChallenge {
  accountId: string;
  expiresAt: string;
}

/** Append-only account security event (login, logout, password, authenticator...). */
export interface SecurityEventRecord {
  accountId: string;
  kind: string;
  at: string;
  detail?: string;
}

/** How many recovery codes are issued when the authenticator is enabled. */
export const RECOVERY_CODE_COUNT = 8;
/** Maximum retained security events per account. */
export const SECURITY_EVENT_LIMIT = 200;

export interface AccountRegistryOptions {
  /** Session lifetime in milliseconds (default 1 hour). */
  sessionTtlMs?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // password reset tokens live 15 minutes

interface ResetTokenRecord {
  accountId: string;
  expiresAt: string;
}

/** Durable snapshot of the full registry (accounts, sessions, reset tokens). */
export interface AccountRegistryState {
  counter: number;
  accounts: AccountRecord[];
  sessions: Session[];
  resetTokens: { hash: string; accountId: string; expiresAt: string }[];
  /** In-flight authenticator recovery challenges (persisted so restarts don't break recovery). */
  recoveryChallenges?: { id: string; challenge: RecoveryChallenge }[];
  /** Append-only security events, capped at SECURITY_EVENT_LIMIT per account. */
  securityEvents?: SecurityEventRecord[];
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function verifyPassword(password: string, saltHex: string, expectedHashHex: string): boolean {
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export class AccountRegistry {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly byUsername = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly resetTokens = new Map<string, ResetTokenRecord>();
  private readonly sessionTtlMs: number;
  private counter = 0;

  constructor(options?: AccountRegistryOptions) {
    this.sessionTtlMs = options?.sessionTtlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Registers a new account, hashing the password with a freshly generated
   * per-user salt. Returns a hash-free view suitable for display.
   */
  createAccount(input: AccountCreateInput): AccountView {
    const username = input.username.trim();
    if (username.length === 0) throw new AuthenticationError('Username must be non-empty.');
    if (this.byUsername.has(username)) {
      throw new DuplicateAccountError(username);
    }
    if (input.password.length < 8) {
      throw new AuthenticationError('Password must be at least 8 characters.');
    }
    const role: AccountRole = input.role ?? 'developer';
    if (!ACCOUNT_ROLES.includes(role)) {
      throw new AuthenticationError(`Unknown role "${role}".`);
    }
    this.counter += 1;
    const id = input.id?.trim() && input.id.trim().length > 0
      ? input.id.trim()
      : `ACCT-${String(this.counter).padStart(6, '0')}`;
    if (this.accounts.has(id)) {
      throw new DuplicateAccountError(`An account with id "${id}" already exists.`);
    }
    const saltHex = randomBytes(16).toString('hex');
    const record: AccountRecord = {
      id,
      username,
      displayName: input.displayName?.trim() || username,
      role,
      createdAt: new Date().toISOString(),
      passwordSalt: saltHex,
      passwordHash: hashPassword(input.password, saltHex),
    };
    this.accounts.set(id, record);
    this.byUsername.set(username, id);
    return this.view(record);
  }

  /** Authenticates a username/password and returns a fresh opaque session. */
  authenticate(username: string, password: string): Session {
    const id = this.byUsername.get(username.trim());
    if (id === undefined) {
      throw new AuthenticationError('Unknown username or invalid password.');
    }
    const record = this.accounts.get(id)!;
    if (!verifyPassword(password, record.passwordSalt, record.passwordHash)) {
      throw new AuthenticationError('Unknown username or invalid password.');
    }
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    const session: Session = {
      token,
      accountId: record.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlMs).toISOString(),
    };
    this.sessions.set(token, session);
    return session;
  }

  /** Resolves a session token to its account, rejecting expired/invalid tokens. */
  verifySession(token: string): AccountRecord {
    const session = this.sessions.get(token);
    if (session === undefined) throw new SessionExpiredError();
    if (Date.now() > Date.parse(session.expiresAt)) {
      this.sessions.delete(token);
      throw new SessionExpiredError();
    }
    const account = this.accounts.get(session.accountId);
    if (account === undefined) throw new SessionExpiredError();
    return account;
  }

  revokeSession(token: string): void {
    this.sessions.delete(token);
  }

  /** Lists every active (non-expired) session for an account, newest first. */
  listSessions(accountId: string): Session[] {
    const now = Date.now();
    return [...this.sessions.values()]
      .filter((s) => s.accountId === accountId && now <= Date.parse(s.expiresAt))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Revokes every session of the account except `keepToken`. Returns count revoked. */
  revokeAllOtherSessions(accountId: string, keepToken: string): number {
    let revoked = 0;
    for (const [token, session] of this.sessions) {
      if (token !== keepToken && session.accountId === accountId) {
        this.sessions.delete(token);
        revoked += 1;
      }
    }
    return revoked;
  }

  /** Updates the account's display name. */
  updateProfile(accountId: string, patch: { displayName?: string }): AccountView {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      if (name.length === 0 || name.length > 80) {
        throw new AuthenticationError('Display name must be 1-80 characters.');
      }
      record.displayName = name;
    }
    return this.view(record);
  }

  /**
   * Merges validated preferences into the account record. Unknown keys and
   * non-scalar values are rejected so preference state stays inspectable.
   */
  updatePreferences(
    accountId: string,
    patch: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    for (const [key, value] of Object.entries(patch)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(key)) {
        throw new Error(`Invalid preference key "${key}".`);
      }
      const type = typeof value;
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        throw new Error(`Preference "${key}" must be a scalar value.`);
      }
      if (type === 'string' && (value as string).length > 200) {
        throw new Error(`Preference "${key}" is too long.`);
      }
    }
    record.preferences = { ...(record.preferences ?? {}), ...patch };
    return { ...record.preferences };
  }

  /** Changes the password after verifying the current one; revokes all sessions. */
  changePassword(accountId: string, currentPassword: string, newPassword: string): AccountView {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (!verifyPassword(currentPassword, record.passwordSalt, record.passwordHash)) {
      throw new AuthenticationError('Current password is incorrect.');
    }
    if (newPassword.length < 8) {
      throw new AuthenticationError('New password must be at least 8 characters.');
    }
    const saltHex = randomBytes(16).toString('hex');
    record.passwordSalt = saltHex;
    record.passwordHash = hashPassword(newPassword, saltHex);
    this.revokeAllOtherSessions(accountId, '');
    return this.view(record);
  }

  /**
   * Issues a single-use password-reset token for an existing account.
   * Returns null for unknown usernames (callers decide enumeration posture).
   * The token is stored hashed with a short TTL; no email is involved.
   */
  requestPasswordReset(username: string): string | null {
    const id = this.byUsername.get(username.trim());
    if (id === undefined) return null;
    const token = randomBytes(24).toString('hex');
    this.resetTokens.set(createHash('sha256').update(token).digest('hex'), {
      accountId: id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    });
    return token;
  }

  /** Consumes a reset token and sets a new password. Single use, TTL-enforced. */
  resetPassword(token: string, newPassword: string): AccountView {
    if (newPassword.length < 8) {
      throw new AuthenticationError('New password must be at least 8 characters.');
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const entry = this.resetTokens.get(hash);
    if (entry === undefined) {
      throw new AuthenticationError('Reset token is invalid or was already used.');
    }
    if (Date.now() > Date.parse(entry.expiresAt)) {
      this.resetTokens.delete(hash);
      throw new AuthenticationError('Reset token has expired; request a new one.');
    }
    this.resetTokens.delete(hash); // single use
    const record = this.accounts.get(entry.accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    const saltHex = randomBytes(16).toString('hex');
    record.passwordSalt = saltHex;
    record.passwordHash = hashPassword(newPassword, saltHex);
    this.revokeAllOtherSessions(record.id, '');
    return this.view(record);
  }

  // ── Authenticator (TOTP), recovery, and security events ────────────────────

  private readonly recoveryChallenges = new Map<string, RecoveryChallenge>();
  private securityEvents: SecurityEventRecord[] = [];

  /** Records an account security event, capped per account (newest first). */
  recordSecurityEvent(accountId: string, kind: string, detail?: string): void {
    this.securityEvents.unshift({ accountId, kind, at: new Date().toISOString(), detail });
    let seen = 0;
    const kept: SecurityEventRecord[] = [];
    for (const event of this.securityEvents) {
      if (event.accountId !== accountId) {
        kept.push(event);
        continue;
      }
      seen += 1;
      if (seen <= SECURITY_EVENT_LIMIT) kept.push(event);
    }
    this.securityEvents = kept;
  }

  /** Returns the account's security events, newest first. */
  securityEventsOf(accountId: string): SecurityEventRecord[] {
    return this.securityEvents.filter((event) => event.accountId === accountId);
  }

  /** Returns the stored preferences for an account (empty object when unset). */
  getPreferences(accountId: string): Record<string, string | number | boolean> {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    return { ...(record.preferences ?? {}) };
  }

  /** Verifies an account password without creating a session. */
  verifyPassword(accountId: string, password: string): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined) return false;
    const expected = Buffer.from(record.passwordHash, 'hex');
    const actual = scryptSync(password, Buffer.from(record.passwordSalt, 'hex'), 64);
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }

  /** True when the account has a verified, enabled TOTP authenticator. */
  hasAuthenticatorEnabled(accountId: string): boolean {
    return this.accounts.get(accountId)?.authenticator?.enabled === true;
  }

  /**
   * Starts authenticator enrollment: generates the secret and provisioning URI.
   * Stays disabled until `enableAuthenticator` verifies a live code.
   */
  setupAuthenticator(accountId: string): { secret: string; otpauth: string } {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (record.authenticator?.enabled === true) {
      throw new AuthenticatorError(
        'AUTHENTICATOR_ALREADY_ENABLED',
        'Disable the current authenticator before enrolling a new one.',
      );
    }
    const secret = generateTotpSecret();
    record.authenticator = { secret, enabled: false };
    record.recoveryCodes = [];
    this.recordSecurityEvent(accountId, 'authenticator.setup_started');
    return { secret, otpauth: otpauthUrl(secret, record.username) };
  }

  /** Verifies a code and enables the authenticator, issuing one-time recovery codes. */
  enableAuthenticator(accountId: string, code: string): { recoveryCodes: string[] } {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (record.authenticator === undefined || record.authenticator.enabled) {
      throw new AuthenticatorError('AUTHENTICATOR_REQUIRED', 'Start authenticator setup before enabling it.');
    }
    if (!verifyTotp(record.authenticator.secret, code)) {
      throw new AuthenticatorError('INVALID_CODE', 'That code is not valid. Check your authenticator app and try again.');
    }
    record.authenticator.enabled = true;
    const recoveryCodes: string[] = [];
    const hashed: RecoveryCodeRecord[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const codeValue = randomBytes(5).toString('hex');
      recoveryCodes.push(codeValue);
      hashed.push({ hash: createHash('sha256').update(codeValue).digest('hex'), usedAt: null });
    }
    record.recoveryCodes = hashed;
    this.recordSecurityEvent(accountId, 'authenticator.enabled');
    return { recoveryCodes };
  }

  /** Disables the authenticator (requires a current valid code). */
  disableAuthenticator(accountId: string, code: string): void {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (record.authenticator === undefined) {
      throw new AuthenticatorError('AUTHENTICATOR_REQUIRED', 'No authenticator is configured for this account.');
    }
    if (!this.verifyAuthenticator(accountId, code)) {
      throw new AuthenticatorError('INVALID_CODE', 'That code is not valid.');
    }
    record.authenticator = undefined;
    record.recoveryCodes = [];
    this.recordSecurityEvent(accountId, 'authenticator.disabled');
  }

  /**
   * Verifies a TOTP code or consumes a single-use recovery code.
   * Recovery codes are only accepted when the authenticator is enabled.
   */
  verifyAuthenticator(accountId: string, code: string): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined || record.authenticator === undefined) return false;
    const supplied = (code ?? '').replace(/\s/g, '').toLowerCase();
    if (verifyTotp(record.authenticator.secret, supplied)) return true;
    if (!record.authenticator.enabled) return false;
    for (const entry of record.recoveryCodes ?? []) {
      if (entry.usedAt !== null) continue;
      const expected = Buffer.from(entry.hash, 'hex');
      const actual = createHash('sha256').update(supplied).digest();
      if (expected.length === actual.length && timingSafeEqual(actual, expected)) {
        entry.usedAt = new Date().toISOString();
        this.recordSecurityEvent(accountId, 'authenticator.recovery_code_used');
        return true;
      }
    }
    return false;
  }

  /** Remaining (unused) recovery-code count, for status display only. */
  remainingRecoveryCodes(accountId: string): number {
    const record = this.accounts.get(accountId);
    if (record === undefined) return 0;
    return (record.recoveryCodes ?? []).filter((entry) => entry.usedAt === null).length;
  }

  /**
   * Starts authenticator-based password recovery. Returns null when the
   * username is unknown or the account has no enabled authenticator; the
   * caller decides the honest response for each case.
   */
  beginRecoveryChallenge(username: string): { challengeId: string; expiresAt: string } | null {
    const id = this.byUsername.get(username.trim().toLowerCase());
    if (id === undefined) return null;
    const record = this.accounts.get(id);
    if (record === undefined || record.authenticator?.enabled !== true) return null;
    const challengeId = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    this.recoveryChallenges.set(challengeId, { accountId: record.id, expiresAt });
    this.recordSecurityEvent(record.id, 'authenticator.recovery_started');
    return { challengeId, expiresAt };
  }

  /**
   * Completes recovery: verifies the code against the single-use challenge,
   * sets the new password, revokes other sessions. Fail-closed on every step.
   */
  completeRecovery(challengeId: string, code: string, newPassword: string): AccountView {
    const challenge = this.recoveryChallenges.get(challengeId);
    if (challenge === undefined || Date.now() > Date.parse(challenge.expiresAt)) {
      this.recoveryChallenges.delete(challengeId);
      throw new AuthenticationError('Recovery request is invalid or has expired. Start again.');
    }
    this.recoveryChallenges.delete(challengeId);
    if (!this.verifyAuthenticator(challenge.accountId, code)) {
      throw new AuthenticatorError('INVALID_CODE', 'That code is not valid.');
    }
    const record = this.accounts.get(challenge.accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    const token = this.requestPasswordReset(record.username);
    if (token === null) throw new AuthenticationError('Recovery failed; start again.');
    const view = this.resetPassword(token, newPassword);
    this.recordSecurityEvent(record.id, 'password.recovered');
    return view;
  }

  /** Drops expired sessions and reset tokens (used before persisting state). */
  pruneExpired(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now > Date.parse(session.expiresAt)) this.sessions.delete(token);
    }
    for (const [hash, entry] of this.resetTokens) {
      if (now > Date.parse(entry.expiresAt)) this.resetTokens.delete(hash);
    }
  }

  /** Exports full registry state for durable persistence (hashes included). */
  exportState(): AccountRegistryState {
    return {
      counter: this.counter,
      accounts: [...this.accounts.values()],
      sessions: [...this.sessions.values()],
      resetTokens: [...this.resetTokens.entries()].map(([hash, entry]) => ({ hash, ...entry })),
      recoveryChallenges: [...this.recoveryChallenges.entries()].map(([id, challenge]) => ({ id, challenge })),
      securityEvents: [...this.securityEvents],
    };
  }

  /** Replaces in-memory state from a durable snapshot. */
  restoreState(state: AccountRegistryState): void {
    this.accounts.clear();
    this.byUsername.clear();
    this.sessions.clear();
    this.resetTokens.clear();
    this.counter = state.counter ?? 0;
    for (const record of state.accounts) {
      this.accounts.set(record.id, record);
      this.byUsername.set(record.username, record.id);
    }
    for (const session of state.sessions) {
      if (Date.now() <= Date.parse(session.expiresAt)) this.sessions.set(session.token, session);
    }
    for (const entry of state.resetTokens ?? []) {
      if (Date.now() <= Date.parse(entry.expiresAt)) this.resetTokens.set(entry.hash, entry);
    }
    this.recoveryChallenges.clear();
    for (const { id, challenge } of state.recoveryChallenges ?? []) {
      if (Date.now() <= Date.parse(challenge.expiresAt)) this.recoveryChallenges.set(id, challenge);
    }
    this.securityEvents = [...(state.securityEvents ?? [])];
  }

  /** Maps an account to the platform's human Actor identity. */
  actor(account: { id: string }): Actor {
    return { kind: 'human', id: account.id };
  }

  /** Returns the account view for a record. */
  view(record: AccountRecord): AccountView {
    return {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      role: record.role,
      createdAt: record.createdAt,
    };
  }
}

/** Stable fingerprint of the scrypt hash scheme (for audit/logging). */
export function passwordFingerprint(hash: string): string {
  return createHash('sha256').update(hash).digest('hex').slice(0, 12);
}
