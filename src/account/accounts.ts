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

export interface AccountRegistryOptions {
  /** Session lifetime in milliseconds (default 1 hour). */
  sessionTtlMs?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

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
