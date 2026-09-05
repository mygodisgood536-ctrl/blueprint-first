/**
 * HTTP authentication + account-security API (Phase 1 of the Nexona product).
 *
 * Routes (all JSON):
 *   POST /api/auth/signup     { username, password, displayName? } -> 201 { account }
 *   POST /api/auth/login      { username, password }               -> 200 { account }
 *   POST /api/auth/logout     (session cookie)                     -> 204, session revoked
 *   GET  /api/auth/session                                         -> 200 { account | null }
 *   POST /api/auth/forgot     { username }                         -> 200 (honest local reset)
 *   POST /api/auth/reset      { token, password }                  -> 200 { account }
 *   POST /api/account/password   { currentPassword, newPassword }  -> 200 { account }
 *   GET  /api/account/sessions                                   -> 200 { sessions } (redacted)
 *   POST /api/account/sessions/revoke-others                     -> 200 { revoked }
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
  AuthenticatorError,
  DuplicateAccountError,
  type AccountView,
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
    if (error instanceof AuthenticatorError) return 400;
    if (error instanceof AuthenticationError) return 401;
    return 400;
  };

  // ── signup ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/signup', async (req, res) => {
    const body = req.body as { username?: unknown; password?: unknown; displayName?: unknown };
    const input = validateRegistration(body);
    if ('error' in input) {
      res.status(400).json({ error: input.error });
      return;
    }
    try {
      const view = await accounts.createAccount({
        username: input.username,
        password: input.password,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      });
      const session = await accounts.authenticate(input.username, input.password);
      setSessionCookie(res, session.token);
      await accounts.recordSecurityEvent(view.id, 'account.created');
      res.status(201).json({ account: view });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : 'signup failed',
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
    } catch {
      limiter.recordFailure(key);
      // Uniform message: no user enumeration.
      res.status(401).json({ error: 'Unknown username or invalid password.' });
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

  // ── forgot password (authenticator-gated, honest about the deployment) ─────
  app.post('/api/auth/forgot', async (req, res) => {
    const username = normalizeUsername((req.body as { username?: unknown }).username);
    if (username.length === 0) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    // Accounts with an enabled authenticator recover ONLY through it (no OTP, no email).
    const challenge = await accounts.beginRecoveryChallenge(username);
    if (challenge !== null) {
      res.json({ mode: 'authenticator', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt });
      return;
    }
    const token = await accounts.requestPasswordReset(username);
    if (token === null) {
      // No promise of email: the local deployment cannot send mail, so the
      // caller is told exactly what is (and is not) possible.
      res.status(404).json({
        error: 'No account with that username exists.',
        notice:
          'This NEXORA deployment has no email service. Recovery requires the exact username; accounts protected by the authenticator recover through it.',
      });
      return;
    }
    res.json({
      mode: 'local-token',
      resetToken: token,
      notice:
        'This NEXORA deployment has no email service, so the one-time reset token is shown here instead of being emailed. It expires in 15 minutes and can be used once.',
    });
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

  // ── account security: password change ───────────────────────────────────────
  app.post('/api/account/password', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      res.status(400).json({ error: 'currentPassword and newPassword are required' });
      return;
    }
    if (body.newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    try {
      const view = await accounts.changePassword(
        req.account.id,
        body.currentPassword,
        body.newPassword,
      );
      await accounts.recordSecurityEvent(req.account.id, 'password.changed');
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

  app.post('/api/account/authenticator/setup', async (req, res) => {
    if (req.account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const body = req.body as { currentPassword?: unknown };
    if (typeof body.currentPassword !== 'string' || !accounts.verifyPassword(req.account.id, body.currentPassword)) {
      res.status(403).json({ error: 'Current password is required to change authenticator settings.' });
      return;
    }
    try {
      const { secret, otpauth } = await accounts.setupAuthenticator(req.account.id);
      // The secret is shown exactly once for manual enrollment; it is never
      // returned again by any read route.
      res.json({ secret, otpauth });
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
