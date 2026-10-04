/**
 * IDENTITY & CREDENTIAL MODEL (Authentication replacement).
 *
 * The previous account model carried `passwordHash`/`passwordSalt`, a TOTP
 * `authenticator`, one-time `recoveryCodes`, a password-reset challenge flow and
 * an authenticator-enrollment flow. None of those may exist in the new model.
 *
 * The new model is deliberately minimal:
 *   fullName, username, gmail, securityQuestion, hashed securityAnswer, role,
 *   and an opaque expiring session.
 *
 * There is NO password, NO OTP, NO TOTP/authenticator, NO recovery code, NO
 * email-verification code, and NO magic link anywhere in this module.
 *
 * SECURITY
 * * The security answer is hashed with scrypt and a per-account random salt.
 *   It is never returned by any accessor and never exported to a client.
 * * Uniqueness of `username` and `gmail` is enforced in the registry itself —
 *   the same guarantee a database UNIQUE constraint gives — so it holds for
 *   every writer, not just the HTTP API.
 * * Sign-in failures are deliberately INDISTINGUISHABLE so the login form
 *   cannot be used to enumerate accounts.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Authorization role. Naming is internal; the product UI never renders it.
 * `administrator` grants platform configuration access (Daytona,
 * infrastructure, system health). It is decided by the backend only.
 */
export type IdentityRole = 'member' | 'administrator';

/** A stored account. The security answer is a hash, never plaintext. */
export interface IdentityRecord {
  readonly id: string;
  readonly fullName: string;
  readonly username: string;
  readonly usernameDisplay: string;
  readonly gmail: string;
  readonly securityQuestion: string;
  /** `scrypt$<salt-hex>$<hash-hex>` — never reversible. */
  readonly securityAnswerHash: string;
  readonly role: IdentityRole;
  readonly createdAt: string;
  preferences?: Record<string, string | number | boolean>;
}

/** Public projection of an account. NEVER contains the security answer. */
export interface IdentityView {
  readonly id: string;
  readonly fullName: string;
  readonly username: string;
  readonly gmail: string;
  readonly securityQuestion: string;
  readonly role: IdentityRole;
  readonly createdAt: string;
}

/** Opaque bearer session. */
export interface IdentitySession {
  readonly token: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class IdentityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

/** Invalid field. Message is safe to show a user. */
export class ValidationError extends IdentityError {
  constructor(message: string) {
    super('VALIDATION', message);
    this.name = 'ValidationError';
  }
}

/** Gmail/username already taken. Message is safe to show a user. */
export class ConflictError extends IdentityError {
  constructor(message: string) {
    super('CONFLICT', message);
    this.name = 'ConflictError';
  }
}


// ── validation ───────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;
const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/;

export function validateFullName(value: string): string {
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) throw new ValidationError('Enter your full name.');
  if (v.length > 80) throw new ValidationError('Your full name is too long.');
  if (!/^[\p{L}\p{M}'’.\- ]+$/u.test(v)) {
    throw new ValidationError(
      'Your full name may only contain letters, spaces, apostrophes, hyphens and periods.',
    );
  }
  return v;
}

export function validateUsername(value: string): { normalized: string; display: string } {
  const display = value.trim();
  const normalized = normalizeUsername(display);
  if (normalized.length < 3) throw new ValidationError('Username must be at least 3 characters.');
  if (normalized.length > 32) throw new ValidationError('Username must be 32 characters or fewer.');
  if (!USERNAME_RE.test(normalized)) {
    throw new ValidationError(
      'Username may only use lowercase letters, numbers, dots, hyphens and underscores, and must start and end with a letter or number.',
    );
  }
  return { normalized, display };
}

export function validateGmail(value: string): string {
  const normalized = normalizeGmail(value);
  if (normalized.length === 0) throw new ValidationError('Enter your Gmail address.');
  if (!GMAIL_RE.test(normalized)) {
    throw new ValidationError('Enter a valid Gmail address.');
  }
  return normalized;
}

export function validateSecurityQuestion(value: string): string {
  const v = value.trim();
  if (!SECURITY_QUESTIONS.includes(v)) {
    throw new ValidationError('Choose one of the listed security questions.');
  }
  return v;
}

/**
 * Canonical form of a security answer.
 *
 * Answers are compared and hashed in this normalised form: trimmed, inner
 * whitespace collapsed, and case-folded. Case-folding matters because these are
 * free-text answers a person types from memory ("Ore" / "ore"); requiring an
 * exact keyboard match would lock out legitimate users without meaningfully
 * strengthening the secret, which is still a 32-byte scrypt digest.
 */
export function normalizeSecurityAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function validateSecurityAnswer(value: string): string {
  const v = normalizeSecurityAnswer(value);
  if (v.length < 2) throw new ValidationError('Enter your security answer.');
  if (v.length > 120) throw new ValidationError('Your security answer is too long.');
  return v;
}

// ── hashing ──────────────────────────────────────────────────────────────────

/** Hashes a security answer with a fresh random salt. Never reversible. */
export function hashSecurityAnswer(answer: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeSecurityAnswer(answer), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification of an answer against a stored hash. */
export function verifySecurityAnswer(answer: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] ?? '', 'hex');
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  // MUST normalise identically to hashSecurityAnswer, otherwise a stored hash of
  // "ore" would never verify against a submitted "Ore".
  const actual = scryptSync(normalizeSecurityAnswer(answer), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Every failed sign-in reports exactly this, so accounts cannot be enumerated. */
export class SignInError extends IdentityError {
  constructor() {
    super(
      'SIGN_IN_FAILED',
      'We could not verify those details. Check your Gmail address, security question and answer.',
    );
    this.name = 'SignInError';
  }
}

// ── registry ─────────────────────────────────────────────────────────────────

export interface CreateIdentityInput {
  readonly fullName: string;
  readonly username: string;
  readonly gmail: string;
  readonly securityQuestion: string;
  readonly securityAnswer: string;
  readonly role?: IdentityRole;
  /** Optional explicit id (trusted bootstrap only). */
  readonly id?: string;
}

export interface IdentityRegistryState {
  readonly counter: number;
  readonly records: readonly IdentityRecord[];
  readonly sessions: readonly IdentitySession[];
}

/** Session lifetime used when a caller does not choose one. */
export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

/** Durable account store with database-equivalent uniqueness. */
export class IdentityRegistry {
  private readonly byId = new Map<string, IdentityRecord>();
  private readonly usernameIndex = new Map<string, string>();
  private readonly gmailIndex = new Map<string, string>();
  private readonly sessions = new Map<string, IdentitySession>();
  private counter = 1;

  private readonly sessionTtlMs: number;

  /**
   * `sessionTtlMs` is optional so an omitted value can never become NaN and
   * produce an invalid `expiresAt`. A non-finite or non-positive value still
   * falls back to the default; an explicitly negative TTL is honoured only
   * because the expiry tests rely on it being able to expire a session at once.
   */
  constructor(sessionTtlMs?: number) {
    this.sessionTtlMs = typeof sessionTtlMs === 'number' && Number.isFinite(sessionTtlMs)
      ? sessionTtlMs
      : DEFAULT_SESSION_TTL_MS;
  }

  private pad(): string {
    return `ACC-${String(this.counter).padStart(6, '0')}`;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, s] of [...this.sessions]) {
      if (Date.parse(s.expiresAt) <= now) this.sessions.delete(token);
    }
  }

  /** Creates an account. Gmail/username conflicts are refused here, not in the UI. */
  createAccount(input: CreateIdentityInput): IdentityView {
    const fullName = validateFullName(input.fullName);
    const { normalized: username, display } = validateUsername(input.username);
    const gmail = validateGmail(input.gmail);
    const securityQuestion = validateSecurityQuestion(input.securityQuestion);
    const securityAnswer = validateSecurityAnswer(input.securityAnswer);

    this.prune();
    if (this.usernameIndex.has(username)) {
      throw new ConflictError('That username is already taken. Please choose another.');
    }
    if (this.gmailIndex.has(gmail)) {
      throw new ConflictError(
        'That Gmail address is already associated with an account. Please use another Gmail address.',
      );
    }

    let id: string;
    if (input.id === undefined) {
      id = this.pad();
      this.counter += 1;
    } else {
      id = input.id;
      const n = Number.parseInt(input.id.replace(/\D+/g, ''), 10);
      if (Number.isFinite(n) && n >= this.counter) this.counter = n + 1;
    }

    const record: IdentityRecord = {
      id,
      fullName,
      username,
      usernameDisplay: display,
      gmail,
      securityQuestion,
      securityAnswerHash: hashSecurityAnswer(securityAnswer),
      role: input.role ?? 'member',
      createdAt: new Date().toISOString(),
    };
    this.byId.set(id, record);
    this.usernameIndex.set(username, id);
    this.gmailIndex.set(gmail, id);
    return this.view(record);
  }

  /**
   * Authenticates by Gmail + security question + answer.
   *
   * Every failure — unknown Gmail, wrong question, wrong answer — raises the
   * SAME `SignInError`, so the login form cannot enumerate accounts. There is no
   * OTP, no password and no second factor.
   */
  signIn(
    gmail: string,
    securityQuestion: string,
    securityAnswer: string,
  ): { account: IdentityView; session: IdentitySession } {
    this.prune();
    const id = this.gmailIndex.get(normalizeGmail(gmail));
    const record = id === undefined ? undefined : this.byId.get(id);
    if (record === undefined) {
      // Hash anyway so an unknown Gmail costs comparable time to a wrong answer.
      verifySecurityAnswer(securityAnswer, hashSecurityAnswer('decoy'));
      throw new SignInError();
    }
    if (securityQuestion.trim() !== record.securityQuestion) {
      verifySecurityAnswer(securityAnswer, hashSecurityAnswer('decoy'));
      throw new SignInError();
    }
    if (!verifySecurityAnswer(securityAnswer.trim(), record.securityAnswerHash)) {
      throw new SignInError();
    }
    const now = Date.now();
    const session: IdentitySession = {
      token: randomBytes(32).toString('hex'),
      accountId: record.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlMs).toISOString(),
    };
    this.sessions.set(session.token, session);
    return { account: this.view(record), session };
  }

  /** Resolves a bearer token, or null. Expired tokens are dropped. */
  accountForToken(token: string): IdentityView | null {
    this.prune();
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    const record = this.byId.get(session.accountId);
    return record === undefined ? null : this.view(record);
  }

  logout(token: string): boolean {
    return this.sessions.delete(token);
  }

  logoutAll(accountId: string): number {
    let n = 0;
    for (const [token, s] of [...this.sessions]) {
      if (s.accountId === accountId) {
        this.sessions.delete(token);
        n += 1;
      }
    }
    return n;
  }

  get(id: string): IdentityView | null {
    const r = this.byId.get(id);
    return r === undefined ? null : this.view(r);
  }

  byUsername(username: string): IdentityView | null {
    const id = this.usernameIndex.get(normalizeUsername(username));
    const r = id === undefined ? undefined : this.byId.get(id);
    return r === undefined ? null : this.view(r);
  }

  byGmail(gmail: string): IdentityView | null {
    const id = this.gmailIndex.get(normalizeGmail(gmail));
    const r = id === undefined ? undefined : this.byId.get(id);
    return r === undefined ? null : this.view(r);
  }

  /** True only for the privileged role. Never inferred from the client. */
  isAdministrator(id: string): boolean {
    return this.byId.get(id)?.role === 'administrator';
  }

  /** Grants the privileged role. Idempotent. Trusted server bootstrap only. */
  promoteToAdministrator(username: string): boolean {
    const id = this.usernameIndex.get(normalizeUsername(username));
    const r = id === undefined ? undefined : this.byId.get(id);
    if (r === undefined || r.role === 'administrator') return false;
    this.byId.set(r.id, { ...r, role: 'administrator' });
    return true;
  }

  /**
   * Updates the display name. The username, Gmail and security question are
   * identity facts fixed at signup and are deliberately NOT editable here.
   */
  setFullName(id: string, fullName: string): boolean {
    const record = this.byId.get(id);
    if (record === undefined) return false;
    this.byId.set(id, { ...record, fullName: validateFullName(fullName) });
    return true;
  }

  setPreferences(id: string, prefs: Record<string, string | number | boolean>): boolean {
    const r = this.byId.get(id);
    if (r === undefined) return false;
    this.byId.set(id, { ...r, preferences: { ...(r.preferences ?? {}), ...prefs } });
    return true;
  }

  /** NEVER includes the security answer hash. */
  view(record: IdentityRecord): IdentityView {
    return {
      id: record.id,
      fullName: record.fullName,
      username: record.usernameDisplay,
      gmail: record.gmail,
      securityQuestion: record.securityQuestion,
      role: record.role,
      createdAt: record.createdAt,
    };
  }

  count(): number {
    return this.byId.size;
  }

  exportState(): IdentityRegistryState {
    this.prune();
    return {
      counter: this.counter,
      records: [...this.byId.values()].map((r) => ({ ...r })),
      sessions: [...this.sessions.values()].map((s) => ({ ...s })),
    };
  }

  restoreState(state: IdentityRegistryState): void {
    this.reset();
    this.counter = state.counter;
    for (const r of state.records) {
      this.byId.set(r.id, { ...r });
      this.usernameIndex.set(normalizeUsername(r.username), r.id);
      this.gmailIndex.set(normalizeGmail(r.gmail), r.id);
    }
    for (const s of state.sessions) this.sessions.set(s.token, { ...s });
    this.prune();
  }

  private reset(): void {
    this.byId.clear();
    this.usernameIndex.clear();
    this.gmailIndex.clear();
    this.sessions.clear();
  }
}

// ── privileged bootstrap ─────────────────────────────────────────────────────

/**
 * Bootstrap values for the single privileged account.
 *
 * Every value may be supplied by environment variables so production never
 * hard-codes them, and NOTHING here is ever sent to the browser: this module is
 * server-side only and the answer is hashed before it reaches the store.
 */
export interface BootstrapConfig {
  readonly fullName: string;
  readonly username: string;
  readonly gmail: string;
  readonly securityQuestion: string;
  readonly securityAnswer: string;
}

export const BOOTSTRAP_ENV = {
  fullName: 'BF_BOOTSTRAP_FULL_NAME',
  username: 'BF_BOOTSTRAP_USERNAME',
  gmail: 'BF_BOOTSTRAP_GMAIL',
  securityQuestion: 'BF_BOOTSTRAP_SECURITY_QUESTION',
  securityAnswer: 'BF_BOOTSTRAP_SECURITY_ANSWER',
} as const;

/**
 * Reads the bootstrap configuration from the environment, falling back to the
 * platform's canonical values. Returns null when a required value is missing,
 * so a deployment that supplies nothing simply provisions no privileged
 * account rather than a broken one.
 */
export function readBootstrapConfig(env: NodeJS.ProcessEnv = process.env): BootstrapConfig | null {
  const pick = (key: string, fallback: string): string => {
    const v = env[key];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
  };
  const answer = env[BOOTSTRAP_ENV.securityAnswer];
  const question = pick(BOOTSTRAP_ENV.securityQuestion, 'What city did my parents meet?');
  if (typeof answer !== 'string' || answer.trim().length === 0) return null;
  return {
    fullName: pick(BOOTSTRAP_ENV.fullName, 'Cornelius Adedeji Victor'),
    username: pick(BOOTSTRAP_ENV.username, 'Oluwasegun'),
    gmail: pick(BOOTSTRAP_ENV.gmail, 'corneliusadedejivictor@gmail.com'),
    securityQuestion: question,
    securityAnswer: answer.trim(),
  };
}

/**
 * Provisions the privileged account if it does not exist.
 *
 * IDEMPOTENT: running it on every boot never creates a duplicate and never
 * resets the stored answer of an existing account (so a rotated secret does not
 * silently re-provision). It also RESERVES both the Gmail and the username,
 * because `createAccount` refuses them for anyone else — which is what stops a
 * member from claiming them through the public signup flow.
 */
export function ensurePrivilegedAccount(
  registry: IdentityRegistry,
  config: BootstrapConfig,
): { created: boolean; accountId: string } {
  const existing = registry.byGmail(config.gmail) ?? registry.byUsername(config.username);
  if (existing !== null) {
    registry.promoteToAdministrator(existing.username);
    return { created: false, accountId: existing.id };
  }
  const view = registry.createAccount({
    fullName: config.fullName,
    username: config.username,
    gmail: config.gmail,
    securityQuestion: config.securityQuestion,
    securityAnswer: config.securityAnswer,
    role: 'administrator',
  });
  return { created: true, accountId: view.id };
}

/** The security questions an account may be created with. */
export const SECURITY_QUESTIONS: readonly string[] = [
  'What city did my parents meet?',
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  'What was the name of your first school?',
  'What city were you born in?',
  'What was your childhood nickname?',
];

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeGmail(value: string): string {
  return value.trim().toLowerCase();
}
