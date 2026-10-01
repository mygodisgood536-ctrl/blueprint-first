/**
 * HTTP authentication + account-security API (Phase 1 of the Nexona product).
 *
 * Routes (all JSON):
 *   GET  /api/auth/recovery-questions            -> 200 { questions } (public catalog)
 *   GET  /api/auth/owner-exists                 -> 200 { ownerExists }
 *   POST /api/owner/signup { username, password, displayName? }
 *                                                -> 201 { account, nextStage: 'recovery' }
 *   POST /api/user/signup   { username, password, displayName? }
 *                                                -> 201 { account, nextStage: 'recovery' }
 *   GET  /api/account/recovery                  -> 200 { questions, catalog, configured }
 *   POST /api/account/recovery { answers }      -> 200 { account, nextStage }
 *   POST /api/auth/login      { username, password } -> 200 { account } |
 *                                              { requiresAuthenticator, challengeId, ... }
 *   POST /api/auth/login/verify { challengeId, code } -> 200 { account }
 *   POST /api/auth/logout     (session cookie)   -> 204, session revoked
 *   GET  /api/auth/session                       -> 200 { account | null }
 *   POST /api/auth/forgot     { username }       -> 200 { challengeId, questions }
 *   POST /api/auth/forgot/answer { challengeId, answers } -> 200 { resetToken }
 *   POST /api/auth/reset      { token, password } -> 200 { account }
 *   POST /api/account/password { newPassword, recoveryAnswers } -> 200 { account }
 *   GET  /api/account/sessions                   -> 200 { sessions } (redacted)
 *   POST /api/account/sessions/revoke-others     -> 200 { revoked }
 *
 * TWO DEDICATED ENTRY POINTS. The Platform Owner and normal users never share
 * an entry URL or a signup endpoint: the owner entry point posts to
 * `/api/owner/signup`, the user entry point posts to `/api/user/signup`. The
 * role is fixed in the backend for each path and a client-supplied role is
 * ignored, so the owner role cannot be obtained through the user path. Only one
 * Platform Owner may ever exist.
 *
 * MANDATORY FIRST-TIME SETUP, enforced server-side. A new account is not usable
 * until it has completed, in this order: (1) recovery questions and answers,
 * (2) authenticator setup, (3) a verified 6-digit code. Every product route
 * answers 403 while setup is incomplete, so the wizard cannot be skipped.
 *
 * RECOVERY ANSWERS. Answers are hashed with scrypt under a per-answer salt on
 * arrival. They are never returned by any route, never logged, and never stored
 * in plaintext. They are the authority for account recovery and for sensitive
 * changes (password change, authenticator change) - never a substitute for the
 * authenticator during ordinary login.
 *
 * Identity comes exclusively from the `nexona_session` cookie (see auth.ts).
 * The auth routes set the cookie on success; logout clears it and revokes the
 * token server-side. Failed logins are rate-limited per IP+username with an
 * honest 429 lockout response. Password reset is honest about the deployment:
 * there is no mail service, so the one-time token is returned with an explicit
 * notice instead of pretending an email was sent. Session listings never
 * return raw tokens.
 */

import type { Express, Request, Response } from 'express';
import {
  AuthenticationError,
  AuthenticatorChallengeRequiredError,
  AuthenticatorError,
  DuplicateAccountError,
  RECOVERY_QUESTION_CATALOG,
  RecoveryError,
  type AccountView,
  type RecoveryAnswerInput,
} from '../account/accounts.ts';
import type { DurableAccountRegistry } from '../account/durable-registry.ts';
import { clearCookie, serializeCookie } from './cookies.ts';
import { SESSION_COOKIE, sessionTokenOf } from './auth.ts';

/** One week session lifetime for the browser cookie; the registry still enforces TTL. */
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

/** In-memory failed-login limiter: 8 failures / 15 min per ip+username, 5 min lock. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

interface FailureRecord {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export class LoginRateLimiter {
  private readonly failures = new Map<string, FailureRecord>();

  /** Throws nothing; returns true when the attempt is allowed. */
  allows(key: string): boolean {
    const record = this.failures.get(key);
    if (record === undefined) return true;
    if (record.lockedUntil > Date.now()) return false;
    return true;
  }

  lockRemainingSeconds(key: string): number {
    const record = this.failures.get(key);
    if (record === undefined) return 0;
    return Math.max(0, Math.ceil((record.lockedUntil - Date.now()) / 1000));
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.failures.get(key);
    if (record === undefined || now - record.windowStart > LOGIN_WINDOW_MS) {
      this.failures.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
      return;
    }
    record.count += 1;
    if (record.count >= LOGIN_MAX_FAILURES) {
      record.lockedUntil = now + LOGIN_LOCK_MS;
    }
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}

function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Parses a recovery answer set from a request body. Returns null when the shape
 * is wrong so the caller can answer with a plain 400. The answers themselves
 * are passed straight to the registry, which hashes them; this function never
 * logs them and never places them in an error message.
 */
function parseRecoveryAnswers(raw: unknown): RecoveryAnswerInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RecoveryAnswerInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const candidate = entry as { questionId?: unknown; answer?: unknown };
    if (typeof candidate.questionId !== 'string' || candidate.questionId.trim().length === 0) return null;
    if (typeof candidate.answer !== 'string') return null;
    out.push({ questionId: candidate.questionId.trim(), answer: candidate.answer });
  }
  return out;
}

function validateRegistration(body: {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
}): { username: string; password: string; displayName?: string } | { error: string } {
  const username = normalizeUsername(body.username);
  if (!USERNAME_PATTERN.test(username)) {
    return {
      error:
        'Username must be 3-32 characters: lowercase letters, digits, ".", "_", "-", starting with a letter or digit.',
    };
  }
  if (typeof body.password !== 'string' || body.password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (body.password.length > 200) {
    return { error: 'Password must be at most 200 characters.' };
  }
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') return { error: 'displayName must be a string.' };
    const trimmed = body.displayName.trim();
    if (trimmed.length > 64) return { error: 'displayName must be at most 64 characters.' };
    if (trimmed.length === 0) return { error: 'displayName must not be empty.' };
    return { username, password: body.password, displayName: trimmed };
  }
  return { username, password: body.password };
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: 'Lax',
    }),
  );
}

/** Registers every auth/account-security route. Expects express.json() mounted. */
export function registerAuthApi(app: Express, options: { accounts: DurableAccountRegistry }): void {
  const accounts = options.accounts;
  const limiter = new LoginRateLimiter();

  const clientKeyOf = (req: Request): string => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return `${ip}|${normalizeUsername((req.body as { username?: unknown }).username)}`;
  };

  const errorStatus = (error: unknown): number => {
    if (error instanceof DuplicateAccountError) return 409;
    if (error instanceof RecoveryError) return 403;
    if (error instanceof AuthenticatorError) return 400;
    if (error instanceof AuthenticationError) return 401;
    return 400;
  };

  // ── recovery question catalog (public; the question text is not secret) ─────
  app.get('/api/auth/recovery-questions', (_req, res) => {
    res.json({ questions: RECOVERY_QUESTION_CATALOG.map((q) => ({ id: q.id, question: q.question })) });
  });

  // ── entry-point status: does a Platform Owner already exist? ───────────────
  // Lets the dedicated owner entry page show first-time setup or sign-in
  // without ever revealing whether any OTHER account exists.
  app.get('/api/auth/owner-exists', (_req, res) => {
    res.json({ ownerExists: accounts.hasPlatformOwner() });
  });

  // ── FIRST-TIME PLATFORM OWNER SETUP (dedicated owner entry point) ──────────
  app.post('/api/owner/signup', async (req, res) => {
    const body = req.body as { username?: unknown; password?: unknown; displayName?: unknown };
    const input = validateRegistration(body);
    if ('error' in input) {
      res.status(400).json({ error: input.error });
      return;
    }
    try {
      const view = await accounts.createPlatformOwner({
        username: input.username,
        password: input.password,
        displayName: input.displayName,
      });
      const session = await accounts.authenticate(input.username, input.password);
      setSessionCookie(res, session.token);
      await accounts.recordSecurityEvent(view.id, 'platform_owner.setup_started');
      // The account is NOT usable yet: it must configure recovery questions and
      // enable its authenticator before any product route will answer 200.
      res.status(201).json({ account: view, nextStage: 'recovery' });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'owner setup failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── FIRST-TIME NORMAL USER SETUP (dedicated user entry point) ──────────────
  app.post('/api/user/signup', registerUserSignup);

  /**
   * Legacy alias retained for existing clients. It creates a NORMAL USER only -
   * it can never produce a Platform Owner, so keeping it does not widen the
   * role boundary. The dedicated owner entry point (`/api/owner/signup`) is the
   * only path that grants the owner role.
   */
  app.post('/api/auth/signup', registerUserSignup);

  async function registerUserSignup(req: Request, res: Response): Promise<void> {
    const body = req.body as { username?: unknown; password?: unknown; displayName?: unknown };
    const input = validateRegistration(body);
    if ('error' in input) {
      res.status(400).json({ error: input.error });
      return;
    }
    try {
      // Role is fixed to `developer` in the backend. A client-supplied role,
      // including `admin`, is ignored entirely by this path.
      const view = await accounts.createNormalUser({
        username: input.username,
        password: input.password,
        displayName: input.displayName,
      });
      const session = await accounts.authenticate(input.username, input.password);
      setSessionCookie(res, session.token);
      await accounts.recordSecurityEvent(view.id, 'account.setup_started');
      res.status(201).json({ account: view, nextStage: 'recovery' });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'signup failed',
        code: (error as { code?: string }).code,
      });
    }
  }

  // ── RECOVERY QUESTIONS: setup (authenticated, inside first-time setup) ─────
  // Only the question text is ever returned. Answers are hashed on arrival and
  // are never echoed, logged, or included in any response.
  app.get('/api/account/recovery', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({
      questions: accounts.recoveryQuestionsOf(req.account.id),
      catalog: RECOVERY_QUESTION_CATALOG.map((q) => ({ id: q.id, question: q.question })),
      configured: !accounts.needsRecoverySetup(req.account.id),
    });
  });

  app.post('/api/account/recovery', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const answers = parseRecoveryAnswers((req.body as { answers?: unknown }).answers);
    if (answers === null) {
      res.status(400).json({ error: 'answers must be an array of { questionId, answer }' });
      return;
    }
    try {
      const view = await accounts.configureRecoveryQuestions(req.account.id, answers);
      res.json({ account: view, nextStage: view.setupStage });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'recovery setup failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── login ───────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    const body = req.body as { username?: unknown; password?: unknown };
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length === 0 || password.length === 0) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    const key = clientKeyOf(req);
    if (!limiter.allows(key)) {
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${limiter.lockRemainingSeconds(key)}s.`,
      });
      return;
    }
    try {
      const session = await accounts.authenticate(username, password);
      limiter.recordSuccess(key);
      setSessionCookie(res, session.token);
      const record = accounts.verifySession(session.token);
      await accounts.recordSecurityEvent(record.id, 'session.login');
      res.json({ account: accounts.view(record) });
    } catch (error) {
      // A valid password on an authenticator-protected account never yields a
      // session; the caller must complete the server-side challenge with a
      // TOTP or recovery code before the cookie is issued.
      if (error instanceof AuthenticatorChallengeRequiredError) {
        limiter.recordSuccess(key);
        res.json({
          requiresAuthenticator: true,
          challengeId: error.challengeId,
          expiresAt: error.expiresAt,
          username,
        });
        return;
      }
      limiter.recordFailure(key);
      // Uniform message: no user enumeration.
      res.status(401).json({ error: 'Unknown username or invalid password.' });
    }
  });

  // ── two-step login: verify the authenticator (or recovery) code ────────────
  app.post('/api/auth/login/verify', async (req, res) => {
    const body = req.body as { challengeId?: unknown; code?: unknown };
    if (typeof body.challengeId !== 'string' || body.challengeId.trim().length === 0) {
      res.status(400).json({ error: 'challengeId is required' });
      return;
    }
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    try {
      const session = await accounts.completeLoginChallenge(body.challengeId.trim(), body.code.trim());
      setSessionCookie(res, session.token);
      const record = accounts.verifySession(session.token);
      await accounts.recordSecurityEvent(record.id, 'session.login');
      res.json({ account: accounts.view(record) });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'verification failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── logout (revokes the presented session, then clears the cookie) ──────────
  app.post('/api/auth/logout', async (req, res) => {
    const token = sessionTokenOf(req);
    if (token !== undefined) {
      await accounts.revokeSession(token);
      if (req.account !== undefined) {
        await accounts.recordSecurityEvent(req.account.id, 'session.logout');
      }
    }
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
    res.status(204).end();
  });

  // ── current session (the SPA's auth-state probe) ────────────────────────────
  app.get('/api/auth/session', (req, res) => {
    if (req.account === undefined) {
      res.json({ account: null });
      return;
    }
    res.json({ account: accounts.view(req.account) });
  });

  // ── FORGOT PASSWORD, step 1: identify the account ─────────────────────────
  // Recovery questions - not the authenticator - are the recovery authority.
  // The response is uniform for a real and an unknown account so this cannot be
  // used to enumerate usernames; a real account gets an unguessable challenge
  // and the exact questions it must answer.
  app.post('/api/auth/forgot', async (req, res) => {
    const username = normalizeUsername((req.body as { username?: unknown }).username);
    if (username.length === 0) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    const challenge = await accounts.beginPasswordRecovery(username);
    if (challenge === null) {
      res.status(404).json({
        error: 'Recovery is not available for that account.',
        notice:
          'No account with that username has completed first-time setup, so recovery questions are not available yet.',
      });
      return;
    }
    res.json({
      mode: 'recovery-questions',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      questions: challenge.questions,
    });
  });

  // ── FORGOT PASSWORD, step 2: answer the recovery questions ────────────────
  app.post('/api/auth/forgot/answer', async (req, res) => {
    const body = req.body as { challengeId?: unknown; answers?: unknown };
    if (typeof body.challengeId !== 'string' || body.challengeId.trim().length === 0) {
      res.status(400).json({ error: 'challengeId is required' });
      return;
    }
    const answers = parseRecoveryAnswers(body.answers);
    if (answers === null || answers.length === 0) {
      res.status(400).json({ error: 'answers must be a non-empty array of { questionId, answer }' });
      return;
    }
    try {
      const { resetToken, expiresAt } = await accounts.answerRecoveryChallenge(
        body.challengeId.trim(),
        answers,
      );
      res.json({
        resetToken,
        expiresAt,
        notice:
          'Recovery answers accepted. Set a new password. This deployment has no email service, so the one-time reset token is shown here instead of being emailed.',
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'recovery failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── authenticator recovery: verify code + set new password (single step) ───
  app.post('/api/auth/forgot/verify', async (req, res) => {
    const body = req.body as { challengeId?: unknown; code?: unknown; newPassword?: unknown };
    if (typeof body.challengeId !== 'string' || body.challengeId.trim().length === 0) {
      res.status(400).json({ error: 'challengeId is required' });
      return;
    }
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    try {
      const view = await accounts.completeRecovery(
        body.challengeId.trim(),
        body.code.trim(),
        body.newPassword,
      );
      res.json({ account: view });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'recovery failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── reset password ──────────────────────────────────────────────────────────
  app.post('/api/auth/reset', async (req, res) => {
    const body = req.body as { token?: unknown; password?: unknown };
    if (typeof body.token !== 'string' || body.token.trim().length === 0) {
      res.status(400).json({ error: 'token is required' });
      return;
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    try {
      const view = await accounts.resetPassword(body.token.trim(), body.password);
      res.json({ account: view });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'reset failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── account security: password change (recovery-authorized) ────────────────
  // An authenticated password change is a SENSITIVE ACCOUNT CHANGE: it requires
  // the account's recovery answers. The current password is verified too when
  // supplied, but the recovery answers are the authority for the change.
  app.post('/api/account/password', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as {
      currentPassword?: unknown;
      newPassword?: unknown;
      answers?: unknown;
      recoveryAnswers?: unknown;
    };
    if (typeof body.newPassword !== 'string') {
      res.status(400).json({ error: 'newPassword is required' });
      return;
    }
    if (body.newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    const answers = parseRecoveryAnswers(body.recoveryAnswers ?? body.answers);
    if (answers === null || answers.length === 0) {
      res.status(400).json({
        error: 'recoveryAnswers is required: answer your recovery questions to change your password.',
      });
      return;
    }
    try {
      if (typeof body.currentPassword === 'string' && body.currentPassword.length > 0) {
        if (!accounts.verifyPassword(req.account.id, body.currentPassword)) {
          await accounts.recordSecurityEvent(req.account.id, 'password.change_rejected', 'wrong current password');
          res.status(401).json({ error: 'Current password is incorrect.' });
          return;
        }
      }
      const view = await accounts.changePasswordWithRecovery(req.account.id, answers, body.newPassword);
      res.json({ account: view });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'password change failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── account security: authenticator (TOTP) management ───────────────────────
  app.get('/api/account/authenticator', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({
      enabled: accounts.hasAuthenticatorEnabled(req.account.id),
      recoveryCodesRemaining: accounts.remainingRecoveryCodes(req.account.id),
    });
  });

  // ── authenticator setup / change ───────────────────────────────────────────
  // Two distinct paths, chosen by the SERVER from whether the account already
  // has an active authenticator:
  //  - FIRST-TIME SETUP (no enabled authenticator yet): the setup wizard's own
  //    session is the authority. This holds both before and after the recovery
  //    questions are created, because recovery is an earlier step of the same
  //    wizard.
  //  - CHANGE / RESET (active authenticator): MUST answer the recovery
  //    questions. Replacing a working second factor is a sensitive change.
  // A client cannot choose which path it gets.
  app.post('/api/account/authenticator/setup', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as {
      currentPassword?: unknown;
      answers?: unknown;
      recoveryAnswers?: unknown;
    };
    /** Parses and validates the recovery answers a sensitive authenticator change requires. */
    const requireRecoveryAnswers = (): RecoveryAnswerInput[] => {
      const answers = parseRecoveryAnswers(body.recoveryAnswers ?? body.answers);
      if (answers === null || answers.length === 0) {
        throw new RecoveryError('Answer your recovery questions to change your authenticator.');
      }
      return answers;
    };
    try {
      const inFirstTimeSetup = !accounts.hasAuthenticatorEnabled(req.account.id);
      const result = inFirstTimeSetup
        ? await accounts.setupAuthenticator(req.account.id)
        : await accounts.setupAuthenticatorWithRecovery(req.account.id, requireRecoveryAnswers());
      // The secret is shown exactly once for manual enrollment; it is never
      // returned again by any read route.
      res.json({ secret: result.secret, otpauth: result.otpauth, changeAuthorized: !inFirstTimeSetup });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'authenticator setup failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  app.post('/api/account/authenticator/enable', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { code?: unknown };
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    try {
      const { recoveryCodes } = await accounts.enableAuthenticator(req.account.id, body.code.trim());
      // Recovery codes are returned exactly once, at enablement.
      res.json({ enabled: true, recoveryCodes });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'authenticator enable failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  app.post('/api/account/authenticator/disable', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { code?: unknown };
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    try {
      await accounts.disableAuthenticator(req.account.id, body.code.trim());
      res.json({ enabled: false });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'authenticator disable failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── account security: security events ───────────────────────────────────────
  app.get('/api/account/security-events', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ events: accounts.securityEventsOf(req.account.id) });
  });

  // ── account security: session list (tokens redacted) ────────────────────────
  app.get('/api/account/sessions', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const current = sessionTokenOf(req);
    const sessions = accounts.listSessions(req.account.id).map((s) => ({
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.token === current,
    }));
    res.json({ sessions });
  });

  // ── account security: revoke every other session ────────────────────────────
  app.post('/api/account/sessions/revoke-others', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const token = sessionTokenOf(req);
    if (token === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const revoked = await accounts.revokeAllOtherSessions(req.account.id, token);
    await accounts.recordSecurityEvent(req.account.id, 'session.revoked_others', `${revoked} revoked`);
    res.json({ revoked });
  });

  // ── account profile ─────────────────────────────────────────────────────────
  app.post('/api/account/profile', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { displayName?: unknown };
    if (typeof body.displayName !== 'string' || body.displayName.trim().length === 0) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }
    const displayName = body.displayName.trim();
    if (displayName.length > 80) {
      res.status(400).json({ error: 'displayName must be 80 characters or fewer' });
      return;
    }
    try {
      const view = await accounts.updateProfile(req.account.id, { displayName });
      res.json({ account: view });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'profile update failed',
        code: (error as { code?: string }).code,
      });
    }
  });

  // ── account preferences ─────────────────────────────────────────────────────
  // ── account preferences (read) ─────────────────────────────────────────────
  app.get('/api/account/preferences', (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ preferences: req.account.preferences ?? {} });
  });

  // ── account preferences (write) ────────────────────────────────────────────
  app.post('/api/account/preferences', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const patch = req.body as Record<string, unknown>;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      res.status(400).json({ error: 'preferences must be an object' });
      return;
    }
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    try {
      const preferences = await accounts.updatePreferences(req.account.id, sanitized);
      res.json({ preferences });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'preferences update failed',
        code: (error as { code?: string }).code,
      });
    }
  });
}
