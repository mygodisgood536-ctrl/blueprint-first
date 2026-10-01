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
  /** True when the platform REQUIRES an enabled authenticator before product use. */
  authenticatorRequired?: boolean;
  /** TOTP authenticator. Present only after setup; `enabled` gates enforcement. */
  authenticator?: { secret: string; enabled: boolean };
  /**
   * Recovery question/answers. Present only after first-time setup stores them.
   * Answers are scrypt hashes and can never be read back.
   */
  recoveryQuestions?: RecoveryQuestionRecord[];
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
  /** Mandatory-enrollment policy: true forces authenticator setup before product use. */
  authenticatorRequired?: boolean;
}

export interface AccountView {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  createdAt: string;
  /** True while the account must still enable its authenticator (product access gated). */
  authenticatorRequired: boolean;
  /**
   * True while the account has not yet stored recovery question/answers.
   * Product access stays gated until this is false.
   */
  recoveryRequired: boolean;
  /** Where the account stands in the mandatory first-time setup. */
  setupStage: AccountSetupStage;
  /** True only when BOTH recovery questions and the authenticator are complete. */
  setupComplete: boolean;
}

export class AuthenticationError extends BlueprintError {
  constructor(message: string) {
    super('AUTHENTICATION_FAILED', message);
  }
}

/**
 * Raised when recovery questions/answers are missing, malformed, or answered
 * incorrectly. Callers present a uniform message so a wrong answer never
 * reveals whether a question or the account exists.
 */
export class RecoveryError extends BlueprintError {
  constructor(message: string) {
    super('RECOVERY_FAILED', message);
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

/**
 * Thrown by `authenticate` when the password is correct but the account has an
 * enabled authenticator, so a password alone must NEVER issue a session. The
 * error carries the server-side sign-in challenge that the caller completes
 * with a TOTP or recovery code via `completeLoginChallenge`.
 */
export class AuthenticatorChallengeRequiredError extends BlueprintError {
  readonly challengeId: string;
  readonly expiresAt: string;
  constructor(challengeId: string, expiresAt: string) {
    super('AUTHENTICATOR_CHALLENGE_REQUIRED', 'An authenticator code is required to complete sign-in.');
    this.challengeId = challengeId;
    this.expiresAt = expiresAt;
  }
}

/**
 * Server-side two-step sign-in state created when a password succeeds but the
 * account requires its authenticator. Bound to the already-verified account,
 * single-use, and capacity-limited against brute force.
 */
export interface LoginChallenge {
  accountId: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
}

/** How long a two-step sign-in challenge stays usable. */
export const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Bad-code attempts allowed on one sign-in challenge before it is destroyed. */
export const LOGIN_CHALLENGE_MAX_ATTEMPTS = 5;

/** One hashed single-use recovery code for authenticator-loss recovery. */
export interface RecoveryCodeRecord {
  hash: string;
  usedAt: string | null;
}

/** Short-lived challenge issued when starting authenticator-based recovery. */
export interface RecoveryChallenge {
  accountId: string;
  expiresAt: string;
  /**
   * True once the recovery questions have been answered correctly. A challenge
   * is only usable for password reset after this flips, so the answer step
   * cannot be skipped.
   */
  answered: boolean;
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

/**
 * RECOVERY QUESTIONS AND ANSWERS
 *
 * A recovery question/answer pair is the account-recovery and
 * sensitive-change proof. It is deliberately NOT a login credential: the
 * authenticator remains the mandatory second factor for ordinary sign-in, and a
 * recovery answer can never produce a session.
 *
 * Answers are NEVER stored in plaintext and are never returned by any read
 * path. Each answer is hashed with scrypt under its own random salt, exactly
 * like a password, so a stolen `accounts.json` yields nothing usable.
 */
export interface RecoveryQuestionCatalogEntry {
  id: string;
  question: string;
}

/** Fixed catalog offered at first-time setup. The text is not secret. */
export const RECOVERY_QUESTION_CATALOG: readonly RecoveryQuestionCatalogEntry[] = [
  { id: 'first_school', question: 'What was the name of the first school you attended?' },
  { id: 'childhood_nickname', question: 'What was your childhood nickname?' },
  { id: 'first_pet', question: 'What was the name of your first pet?' },
  { id: 'mother_maiden', question: "What is your mother's maiden name?" },
  { id: 'favourite_teacher', question: 'What was the name of your favourite teacher?' },
  { id: 'first_car', question: 'What was the make of your first car?' },
  { id: 'favourite_movie', question: 'What is the title of your favourite movie?' },
  { id: 'birth_city', question: 'In what city were you born?' },
  { id: 'favourite_book', question: 'What is the title of your favourite book?' },
  { id: 'childhood_street', question: 'What was the name of the street you grew up on?' },
] as const;

/** Minimum number of distinct recovery questions an account must configure. */
export const MIN_RECOVERY_QUESTIONS = 1;
/** Maximum number of recovery questions an account may configure. */
export const MAX_RECOVERY_QUESTIONS = 3;

export interface RecoveryQuestionRecord {
  id: string;
  question: string;
  /** scrypt hash of the normalized answer. Never reversible. */
  answerHash: string;
  /** Per-answer random salt. */
  answerSalt: string;
  createdAt: string;
}

export interface RecoveryAnswerInput {
  questionId: string;
  answer: string;
}

/** Where an account currently stands in the mandatory first-time setup. */
export type AccountSetupStage = 'recovery' | 'authenticator' | 'complete';

function normalizeRecoveryAnswer(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

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
  /** In-flight two-step (password + authenticator) sign-in challenges. */
  loginChallenges?: { id: string; challenge: LoginChallenge }[];
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
   *
   * PLATFORM OWNER BOOTSTRAP: when the registry holds no accounts at all, the
   * FIRST account created becomes the platform owner (`admin`). Every later
   * signup is a plain `developer`. This is decided in the BACKEND from durable
   * state, never from a client-supplied role, so signup can never be used for
   * privilege escalation - and the owner-only infrastructure area is reachable
   * on a genuinely fresh installation.
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
    const isFirstAccount = this.accounts.size === 0;
    const role: AccountRole = input.role ?? (isFirstAccount ? 'admin' : 'developer');
    if (!ACCOUNT_ROLES.includes(role)) {
      throw new AuthenticationError(`Unknown role "${role}".`);
    }
    // A platform owner is singular. Once one exists, nothing may create another
    // through any path, so the role boundary cannot be widened by signup.
    if (role === 'admin' && this.platformOwnerId() !== null) {
      throw new AuthenticationError(
        'A Platform Owner already exists. Only one Platform Owner account is permitted.',
      );
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
      authenticatorRequired: input.authenticatorRequired ?? false,
    };
    this.accounts.set(id, record);
    this.byUsername.set(username, id);
    return this.view(record);
  }

  /** The id of the platform owner, or null when no owner exists yet. */
  platformOwnerId(): string | null {
    for (const record of this.accounts.values()) {
      if (record.role === 'admin') return record.id;
    }
    return null;
  }

  /** True when a Platform Owner account has already been created. */
  hasPlatformOwner(): boolean {
    return this.platformOwnerId() !== null;
  }

  /**
   * FIRST-TIME PLATFORM OWNER SETUP.
   *
   * Creates the single Platform Owner account from the dedicated owner entry
   * point. The role is fixed to `admin` here in the backend and can never be
   * supplied by the client. It is refused once an owner already exists, so the
   * owner entry point cannot be used to mint a second owner or to escalate a
   * normal account.
   *
   * The returned account is NOT usable yet: `authenticatorRequired` is forced
   * on, so the account is gated out of the product until it has created its
   * recovery question/answers and enabled its authenticator.
   */
  createPlatformOwner(input: Omit<AccountCreateInput, 'role'>): AccountView {
    if (this.hasPlatformOwner()) {
      throw new AuthenticationError(
        'A Platform Owner already exists. Sign in with the existing owner account instead of creating another.',
      );
    }
    const view = this.createAccount({ ...input, role: 'admin', authenticatorRequired: true });
    this.recordSecurityEvent(view.id, 'platform_owner.created', 'via owner entry point');
    return view;
  }

  /**
   * FIRST-TIME NORMAL USER SETUP.
   *
   * Creates a normal user account from the dedicated user entry point. The role
   * is fixed to `developer` in the backend; a normal user can never become the
   * owner through this path, whatever the client sends. Like the owner, the
   * account is gated out of the product until recovery questions and the
   * authenticator are complete.
   */
  createNormalUser(input: Omit<AccountCreateInput, 'role'>): AccountView {
    const view = this.createAccount({ ...input, role: 'developer', authenticatorRequired: true });
    this.recordSecurityEvent(view.id, 'account.created', 'via user entry point');
    return view;
  }

  /**
   * Authenticates a username/password. When the account has NO enabled
   * authenticator a session is returned directly. When an authenticator IS
   * enabled, a session is never created: `authenticate` raises
   * AuthenticatorChallengeRequiredError carrying a server-side challenge that
   * must be completed with a TOTP or recovery code.
   */
  authenticate(username: string, password: string): Session {
    const id = this.byUsername.get(username.trim());
    if (id === undefined) {
      throw new AuthenticationError('Unknown username or invalid password.');
    }
    const record = this.accounts.get(id)!;
    if (!verifyPassword(password, record.passwordSalt, record.passwordHash)) {
      throw new AuthenticationError('Unknown username or invalid password.');
    }
    if (record.authenticator?.enabled === true) {
      const now = Date.now();
      const challengeId = randomBytes(24).toString('hex');
      const expiresAt = new Date(now + LOGIN_CHALLENGE_TTL_MS).toISOString();
      this.loginChallenges.set(challengeId, {
        accountId: record.id,
        createdAt: new Date(now).toISOString(),
        expiresAt,
        attempts: 0,
      });
      throw new AuthenticatorChallengeRequiredError(challengeId, expiresAt);
    }
    return this.issueSession(record.id);
  }

  /**
   * Completes a two-step sign-in by verifying a TOTP or recovery code against
   * the pending challenge. Adds nothing to the session store until verified;
   * the challenge is single-use and expires after LOGIN_CHALLENGE_TTL_MS.
   */
  completeLoginChallenge(challengeId: string, code: string): Session {
    const challenge = this.loginChallenges.get(challengeId);
    if (challenge === undefined || Date.now() > Date.parse(challenge.expiresAt)) {
      this.loginChallenges.delete(challengeId);
      throw new AuthenticationError('Sign-in challenge is invalid or has expired. Sign in again.');
    }
    if (!this.verifyAuthenticator(challenge.accountId, code)) {
      challenge.attempts += 1;
      if (challenge.attempts >= LOGIN_CHALLENGE_MAX_ATTEMPTS) {
        this.loginChallenges.delete(challengeId);
        this.recordSecurityEvent(
          challenge.accountId,
          'session.login_failed',
          'Too many authenticator attempts.',
        );
        throw new AuthenticationError('Too many failed verification attempts. Sign in again.');
      }
      throw new AuthenticatorError('INVALID_CODE', 'That code is not valid. Try again.');
    }
    this.loginChallenges.delete(challengeId);
    return this.issueSession(challenge.accountId);
  }

  private issueSession(accountId: string): Session {
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    const session: Session = {
      token,
      accountId,
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
   * CHANGE PASSWORD, recovery-authorized.
   *
   * Changes the password of an authenticated account after the account has
   * correctly answered its recovery questions. The recovery answers are the
   * authority for this sensitive change, so the current password is not
   * required. Fails closed: a wrong or incomplete answer set changes nothing.
   */
  changePasswordWithRecovery(
    accountId: string,
    answers: RecoveryAnswerInput[],
    newPassword: string,
  ): AccountView {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (newPassword.length < 8) {
      throw new AuthenticationError('New password must be at least 8 characters.');
    }
    if (!this.verifyRecoveryAnswers(accountId, answers)) {
      this.recordSecurityEvent(accountId, 'password.change_rejected', 'recovery answers incorrect');
      throw new RecoveryError('The recovery answers are not correct.');
    }
    const saltHex = randomBytes(16).toString('hex');
    record.passwordSalt = saltHex;
    record.passwordHash = hashPassword(newPassword, saltHex);
    this.revokeAllOtherSessions(accountId, '');
    this.recordSecurityEvent(accountId, 'password.changed', 'authorized by recovery answers');
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
  private readonly loginChallenges = new Map<string, LoginChallenge>();
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
   * Operator-controlled platform-owner designation.
   *
   * The first account on a fresh installation becomes the owner, but "first
   * account" is only reachable while the registry is empty. Once durable state
   * exists (an upgraded install, restored backup, or a data directory that
   * already holds accounts) the owner-only infrastructure area would otherwise
   * be unreachable, with no supported way to recover it.
   *
   * This is the supported recovery path: the platform operator sets
   * `BF_PLATFORM_OWNER` to a username and the BACKEND promotes that account at
   * boot. It is decided in the backend from the operator's environment, never
   * from a client request, so it cannot be used for privilege escalation. The
   * promotion is durable and is recorded as a security event.
   */
  promoteToPlatformOwner(username: string): AccountView | null {
    const wanted = username.trim();
    if (wanted.length === 0) return null;
    const record = this.accounts.get(wanted);
    if (record === undefined) return null;
    if (record.role === 'admin') return this.view(record);
    record.role = 'admin';
    this.recordSecurityEvent(record.id, 'platform_owner_promoted', 'designated via BF_PLATFORM_OWNER');
    return this.view(record);
  }

  /**
   * True while the platform still requires this account to enroll its
   * authenticator. The web layer answers 403 with `authenticator_setup_required`
   * for every product route while this holds, so access cannot be bypassed by
   * the SPA or direct API calls.
   */
  needsAuthenticatorSetup(accountId: string): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined) return false;
    return record.authenticatorRequired === true && record.authenticator?.enabled !== true;
  }

  /**
   * Starts authenticator enrollment: generates the secret and provisioning URI.
   * Stays disabled until `enableAuthenticator` verifies a live code.
   *
   * Two callers exist and both are legitimate:
   *  - FIRST-TIME SETUP: the account has no ENABLED authenticator yet, so it is
   *    still inside its own setup wizard and the session is the authority. This
   *    holds both before and after the recovery questions are created, because
   *    recovery is an earlier step of the same wizard.
   *  - CHANGE / RESET: the account already has an active authenticator, so
   *    replacing it is a sensitive change and MUST be authorized by the
   *    account's recovery answers (`setupAuthenticatorWithRecovery`).
   * A direct call for an account with an active authenticator is refused, so
   * the recovery-answer requirement cannot be skipped by calling the
   * underlying method.
   */
  setupAuthenticator(accountId: string): { secret: string; otpauth: string } {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (record.authenticator?.enabled === true) {
      throw new RecoveryError(
        'Changing your authenticator requires answering your recovery questions.',
      );
    }
    return this.beginAuthenticatorSetup(record);
  }

  /**
   * CHANGE / RESET AUTHENTICATOR, recovery-authorized.
   *
   * Starts a new authenticator enrollment for a fully set-up account after it
   * correctly answers its recovery questions. The new authenticator only
   * becomes active once `enableAuthenticator` verifies a live 6-digit code, so
   * a mistyped code cannot lock the account out.
   */
  setupAuthenticatorWithRecovery(
    accountId: string,
    answers: RecoveryAnswerInput[],
  ): { secret: string; otpauth: string } {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (!this.verifyRecoveryAnswers(accountId, answers)) {
      this.recordSecurityEvent(accountId, 'authenticator.change_rejected', 'recovery answers incorrect');
      throw new RecoveryError('The recovery answers are not correct.');
    }
    return this.beginAuthenticatorSetup(record);
  }

  private beginAuthenticatorSetup(record: AccountRecord): { secret: string; otpauth: string } {
    if (record.authenticator?.enabled === true) {
      record.authenticator = undefined;
      this.recordSecurityEvent(record.id, 'authenticator.replaced', 'previous authenticator deactivated');
    }
    const secret = generateTotpSecret();
    record.authenticator = { secret, enabled: false };
    record.recoveryCodes = [];
    this.recordSecurityEvent(record.id, 'authenticator.setup_started');
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
    this.recoveryChallenges.set(challengeId, { accountId: record.id, expiresAt, answered: false });
    this.recordSecurityEvent(record.id, 'authenticator.recovery_started');
    return { challengeId, expiresAt };
  }

  /**
   * FORGOT PASSWORD, step 1: identifies the account and opens a recovery
   * challenge. Returns a challenge for any real account that has recovery
   * questions configured, and null for an unknown username. The caller must
   * present a uniform response either way so the endpoint cannot be used to
   * enumerate accounts.
   */
  beginPasswordRecovery(username: string): {
    challengeId: string;
    expiresAt: string;
    questions: Array<{ id: string; question: string }>;
  } | null {
    const id = this.byUsername.get(username.trim().toLowerCase());
    if (id === undefined) return null;
    const record = this.accounts.get(id);
    if (record === undefined) return null;
    if ((record.recoveryQuestions ?? []).length < MIN_RECOVERY_QUESTIONS) return null;
    const challengeId = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    this.recoveryChallenges.set(challengeId, { accountId: record.id, expiresAt, answered: false });
    this.recordSecurityEvent(record.id, 'password.recovery_started');
    // The questions are a public catalog entry, not a secret, so they can be
    // returned with the unguessable challenge. The ANSWERS never leave the server.
    return { challengeId, expiresAt, questions: this.recoveryQuestionsOf(record.id) };
  }

  /**
   * FORGOT PASSWORD, step 2: verifies the recovery answers for the challenge's
   * account. On success the challenge is marked answered and a one-time reset
   * token is issued, which is the only thing `resetPassword` will accept. A
   * wrong answer leaves the challenge unanswered and issues nothing.
   */
  answerRecoveryChallenge(
    challengeId: string,
    answers: RecoveryAnswerInput[],
  ): { resetToken: string; expiresAt: string } {
    const challenge = this.recoveryChallenges.get(challengeId);
    if (challenge === undefined || Date.now() > Date.parse(challenge.expiresAt)) {
      this.recoveryChallenges.delete(challengeId);
      throw new RecoveryError('This recovery request is invalid or has expired. Start again.');
    }
    if (challenge.answered) {
      throw new RecoveryError('This recovery request has already been completed. Start again.');
    }
    if (!this.verifyRecoveryAnswers(challenge.accountId, answers)) {
      this.recordSecurityEvent(challenge.accountId, 'password.recovery_answer_rejected');
      // Uniform: never say whether the question or the answer was wrong.
      throw new RecoveryError('The recovery answers are not correct.');
    }
    challenge.answered = true;
    const token = this.requestPasswordReset(this.accounts.get(challenge.accountId)!.username);
    if (token === null) throw new RecoveryError('Recovery failed. Start again.');
    this.recordSecurityEvent(challenge.accountId, 'password.recovery_answers_accepted');
    return { resetToken: token, expiresAt: challenge.expiresAt };
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
    for (const [id, challenge] of this.loginChallenges) {
      if (now > Date.parse(challenge.expiresAt)) this.loginChallenges.delete(id);
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
      loginChallenges: [...this.loginChallenges.entries()].map(([id, challenge]) => ({ id, challenge })),
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
      record.authenticatorRequired = record.authenticatorRequired === true;
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
    this.loginChallenges.clear();
    for (const { id, challenge } of state.loginChallenges ?? []) {
      if (Date.now() <= Date.parse(challenge.expiresAt)) this.loginChallenges.set(id, challenge);
    }
    this.securityEvents = [...(state.securityEvents ?? [])];
  }

  /** Maps an account to the platform's human Actor identity. */
  actor(account: { id: string }): Actor {
    return { kind: 'human', id: account.id };
  }

  /** Returns the account view for a record. */
  view(record: AccountRecord): AccountView {
    const stage = this.setupStageOf(record);
    return {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      role: record.role,
      createdAt: record.createdAt,
      authenticatorRequired: record.authenticatorRequired === true,
      recoveryRequired: stage !== 'complete' && stage === 'recovery',
      setupStage: stage,
      setupComplete: stage === 'complete',
    };
  }

  /**
   * Where the account stands in the mandatory first-time setup. The order is
   * fixed and enforced: recovery questions first, then the authenticator. An
   * account is only `complete` - and therefore only allowed into the product -
   * when BOTH are done.
   */
  private setupStageOf(record: AccountRecord): AccountSetupStage {
    if ((record.recoveryQuestions ?? []).length < MIN_RECOVERY_QUESTIONS) return 'recovery';
    if (record.authenticatorRequired === true && record.authenticator?.enabled !== true) {
      return 'authenticator';
    }
    return 'complete';
  }

  /** True while the account must still create its recovery question/answers. */
  needsRecoverySetup(accountId: string): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined) return false;
    return (record.recoveryQuestions ?? []).length < MIN_RECOVERY_QUESTIONS;
  }

  /** True until recovery questions AND the authenticator are both complete. */
  needsSetup(accountId: string): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined) return false;
    return this.setupStageOf(record) !== 'complete';
  }

  /** The stage an account is currently in, for driving the setup wizard. */
  setupStageOfAccount(accountId: string): AccountSetupStage {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    return this.setupStageOf(record);
  }

  /**
   * The recovery questions this account has configured. Only the question text
   * is returned - never an answer, hash, or salt. Used to render the answer
   * prompts during account recovery and sensitive changes.
   */
  recoveryQuestionsOf(accountId: string): Array<{ id: string; question: string }> {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    return (record.recoveryQuestions ?? []).map((entry) => ({ id: entry.id, question: entry.question }));
  }

  /**
   * Stores the account's recovery question/answers. Answers are normalized and
   * hashed with scrypt under a fresh per-answer salt; the plaintext answer is
   * never stored, logged, or returned. Re-running this replaces the previous
   * set, which is how an account may rotate its recovery questions.
   */
  configureRecoveryQuestions(accountId: string, answers: RecoveryAnswerInput[]): AccountView {
    const record = this.accounts.get(accountId);
    if (record === undefined) throw new AuthenticationError('Unknown account.');
    if (answers.length < MIN_RECOVERY_QUESTIONS) {
      throw new RecoveryError(
        `Choose at least ${MIN_RECOVERY_QUESTIONS} recovery question and answer it.`,
      );
    }
    if (answers.length > MAX_RECOVERY_QUESTIONS) {
      throw new RecoveryError(`Choose at most ${MAX_RECOVERY_QUESTIONS} recovery questions.`);
    }
    const byId = new Map(RECOVERY_QUESTION_CATALOG.map((entry) => [entry.id, entry]));
    const seen = new Set<string>();
    const stored: RecoveryQuestionRecord[] = [];
    for (const entry of answers) {
      const catalog = byId.get(entry.questionId);
      if (catalog === undefined) {
        throw new RecoveryError('That recovery question is not offered by the platform.');
      }
      if (seen.has(entry.questionId)) {
        throw new RecoveryError('Each recovery question may only be chosen once.');
      }
      seen.add(entry.questionId);
      const answer = normalizeRecoveryAnswer(entry.answer ?? '');
      if (answer.length < 3) {
        throw new RecoveryError('Each recovery answer must be at least 3 characters.');
      }
      if (answer.length > 200) {
        throw new RecoveryError('Each recovery answer must be 200 characters or fewer.');
      }
      const saltHex = randomBytes(16).toString('hex');
      stored.push({
        id: catalog.id,
        question: catalog.question,
        answerHash: hashPassword(answer, saltHex),
        answerSalt: saltHex,
        createdAt: new Date().toISOString(),
      });
    }
    record.recoveryQuestions = stored;
    // Detail is deliberately a count, never the question text or any answer.
    this.recordSecurityEvent(record.id, 'recovery.questions_configured', `${stored.length} question(s)`);
    return this.view(record);
  }

  /**
   * Verifies a full set of recovery answers against the stored hashes in
   * constant time per answer. Returns false - never throws - on any mismatch,
   * a missing question, an unknown question id, or an account with no recovery
   * questions configured. A wrong answer is indistinguishable from an unknown
   * account to the caller.
   */
  verifyRecoveryAnswers(accountId: string, answers: RecoveryAnswerInput[]): boolean {
    const record = this.accounts.get(accountId);
    if (record === undefined) return false;
    const stored = record.recoveryQuestions ?? [];
    if (stored.length === 0) return false;
    if (answers.length !== stored.length) return false;
    let allMatched = true;
    for (const expected of stored) {
      const supplied = answers.find((a) => a.questionId === expected.id);
      if (supplied === undefined) {
        allMatched = false;
        continue;
      }
      const actual = scryptSync(
        normalizeRecoveryAnswer(supplied.answer ?? ''),
        Buffer.from(expected.answerSalt, 'hex'),
        64,
      );
      const wanted = Buffer.from(expected.answerHash, 'hex');
      if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) allMatched = false;
    }
    return allMatched;
  }
}

/** Stable fingerprint of the scrypt hash scheme (for audit/logging). */
export function passwordFingerprint(hash: string): string {
  return createHash('sha256').update(hash).digest('hex').slice(0, 12);
}
