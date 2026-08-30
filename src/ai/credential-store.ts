/**
 * Per-user provider credential store (expansion §16-17, §26).
 *
 * API keys never touch the browser: the web layer accepts a credential once,
 * hands it to this store, and from then on only an opaque credential id is
 * ever echoed back. Storage keeps a SHA-256 hash for verification/status
 * display while the key itself is held in memory only — a process restart
 * clears it and the user simply re-enters it. This is honest about its
 * guarantees: it prevents casual exposure (screenshots, logs, browser
 * memory, other users of the same running process), not a committed attacker
 * on the host machine, which would also control the process itself.
 *
 * Isolation is enforced structurally: every method takes a userId, and a
 * credential is visible ONLY through the id that owns it. There is no method
 * that lists one user's credentials to another user.
 *
 * The in-memory map is keyed per CredentialStore instance; production wires
 * one store per server process, so state is shared across requests while
 * remaining process-local (no secrets are persisted to disk by this module).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConfigurationError } from '../core/errors.ts';

/** Opaque, non-secret credential reference safe to expose to any client. */
export interface CredentialReference {
  readonly id: string;
  readonly providerId: string;
  readonly userId: string;
  readonly createdAt: string;
  /** True only after verifyCredential() has succeeded for this credential. */
  readonly verified: boolean;
  readonly lastError: string | null;
}

export class CredentialNotFoundError extends ConfigurationError {
  constructor(credentialId: string) {
    super(`Credential "${credentialId}" does not exist (or belongs to a different user).`);
  }
}

export class CredentialOwnerError extends ConfigurationError {
  constructor(credentialId: string, userId: string) {
    super(`Credential "${credentialId}" is not owned by user "${userId}".`);
  }
}

export class DuplicateCredentialError extends ConfigurationError {
  constructor(providerId: string, userId: string) {
    super(`User "${userId}" already has a credential for provider "${providerId}". Remove it first or use replaceCredential().`);
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison; does not leak match position. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function newCredentialId(): string {
  return `cred_${randomBytes(12).toString('hex')}`;
}

interface StoredCredential {
  id: string;
  providerId: string;
  userId: string;
  createdAt: string;
  hash: string;
  secret: string;
  verified: boolean;
  lastError: string | null;
}

export class CredentialStore {
  private readonly byId = new Map<string, StoredCredential>();

  /**
   * Adds a credential. The secret is accepted once here and never returned
   * by any method of this class afterwards.
   */
  addCredential(userId: string, providerId: string, secret: string): CredentialReference {
    if (userId.trim().length === 0) {
      throw new ConfigurationError('Credential userId must be a non-empty string.');
    }
    if (providerId.trim().length === 0) {
      throw new ConfigurationError('Credential providerId must be a non-empty string.');
    }
    if (secret.trim().length === 0) {
      throw new ConfigurationError('Credential secret must be a non-empty string.');
    }
    const existing = this.findByUserAndProvider(userId, providerId);
    if (existing !== null) {
      throw new DuplicateCredentialError(providerId, userId);
    }
    const id = newCredentialId();
    const record: StoredCredential = {
      id,
      providerId,
      userId,
      createdAt: new Date().toISOString(),
      hash: sha256(secret),
      secret,
      verified: false,
      lastError: null,
    };
    this.byId.set(id, record);
    return toReference(record);
  }

  findByUserAndProvider(userId: string, providerId: string): CredentialReference | null {
    for (const record of this.byId.values()) {
      if (record.userId === userId && record.providerId === providerId) {
        return toReference(record);
      }
    }
    return null;
  }

  /** Lists only the caller's own credentials, as opaque references. */
  listCredentials(userId: string): CredentialReference[] {
    return [...this.byId.values()]
      .filter((r) => r.userId === userId)
    .map(toReference);
  }

  getReference(userId: string, credentialId: string): CredentialReference {
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) {
      throw new CredentialNotFoundError(credentialId);
    }
    return toReference(record);
  }

  /** The secret itself. NEVER serialized to responses or logs; verified use only. */
  resolveSecret(userId: string, credentialId: string): string {
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) {
      throw new CredentialNotFoundError(credentialId);
    }
    return record.secret;
  }

  resolveUserId(credentialId: string): string | null {
    return this.byId.get(credentialId)?.userId ?? null;
  }

  removeCredential(userId: string, credentialId: string): void {
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) {
      throw new CredentialNotFoundError(credentialId);
    }
    this.byId.delete(credentialId);
  }

  replaceCredential(userId: string, credentialId: string, nextSecret: string): CredentialReference {
    if (nextSecret.trim().length === 0) {
      throw new ConfigurationError('Credential secret must be a non-empty string.');
    }
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) {
      throw new CredentialNotFoundError(credentialId);
    }
    record.hash = sha256(nextSecret);
    record.secret = nextSecret;
    record.verified = false;
    record.lastError = null;
    return toReference(record);
  }

  markVerified(userId: string, credentialId: string, verified: boolean, errorMessage?: string): CredentialReference {
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) {
      throw new CredentialNotFoundError(credentialId);
    }
    record.verified = verified;
    record.lastError = verified ? null : (errorMessage ?? 'Connection verification failed.');
    return toReference(record);
  }

  /** True when the provided secret matches the stored credential's hash. */
  verifyHash(userId: string, credentialId: string, secret: string): boolean {
    const record = this.byId.get(credentialId);
    if (record === undefined || record.userId !== userId) return false;
    return safeEqual(record.hash, sha256(secret));
  }

  /** Number of credentials owned by the given user (isolation sanity check). */
  countForUser(userId: string): number {
    return [...this.byId.values()].filter((r) => r.userId === userId).length;
  }
}

function toReference(record: StoredCredential): CredentialReference {
  return {
    id: record.id,
    providerId: record.providerId,
    userId: record.userId,
    createdAt: record.createdAt,
    verified: record.verified,
    lastError: record.lastError,
  };
}

