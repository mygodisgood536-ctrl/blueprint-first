/**
 * REPLACEMENT authentication API (Phase 2 cutover).
 *
 * This is the ONLY authentication surface. There is no password, no OTP, no
 * TOTP/authenticator, no recovery code, no email-verification code and no magic
 * link — and there are no separate owner/user entry points: ONE public signup
 * route and ONE login route serve everyone, and the backend session decides what
 * an account may do afterwards.
 *
 * Routes (all JSON):
 *   GET  /api/auth/security-questions   -> 200 { questions }   (public catalog)
 *   POST /api/auth/signup   { fullName, username, gmail,
 *                             securityQuestion, securityAnswer } -> 201 { account }
 *   POST /api/auth/login     { gmail, securityQuestion, securityAnswer }
 *                                          -> 200 { account } (sets session cookie)
 *   POST /api/auth/logout                  -> 204 (revokes the token server-side)
 *   GET  /api/auth/session                 -> 200 { account | null }
 *
 * SECURITY
 * * Identity comes exclusively from the session cookie. The server resolves the
 *   account from the token on every request; the client never asserts who it is.
 * * Authorization is decided server-side from the stored role.
 * * Sign-up and sign-in failures are rate limited per IP.
 * * Gmail/username conflicts return a 409 with an actionable message; every other
 *   sign-in failure returns one identical 401 so accounts cannot be enumerated.
 * * Responses never contain the security answer or its hash.
 */
import type { Express, Request, Response } from 'express';
import { serializeCookie } from './cookies.ts';
import { DurableIdentityRegistry } from '../account/durable-identity.ts';
import {
  ConflictError,
  SECURITY_QUESTIONS,
  SignInError,
  ValidationError,
  type IdentityView,
} from '../account/identity.ts';

export const SESSION_COOKIE = 'bf_session';

/** Per-IP sliding window limiter for the credential endpoints. */
class AuthRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (entry === undefined || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      const err = new Error(`Too many attempts. Try again in ${retryAfter} seconds.`) as Error & {
        status?: number;
      };
      err.status = 429;
      throw err;
    }
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: maxAgeSeconds, httpOnly: true, sameSite: 'Lax' });
}

function clearedCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' });
}

/** The client-facing account shape. No role, no hash, no answer. */
function accountResponse(view: IdentityView): Record<string, unknown> {
  return {
    id: view.id,
    fullName: view.fullName,
    username: view.username,
    gmail: view.gmail,
    securityQuestion: view.securityQuestion,
    createdAt: view.createdAt,
  };
}

function fail(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof ConflictError) {
    res.status(409).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof SignInError) {
    // Deliberately identical for unknown Gmail, wrong question and wrong answer.
    res.status(401).json({ error: error.message, code: error.code });
    return;
  }
  const status = (error as { status?: number }).status;
  if (status !== undefined) {
    res.status(status).json({ error: (error as Error).message, code: 'RATE_LIMITED' });
    return;
  }
  res.status(400).json({ error: 'That request could not be completed.', code: 'BAD_REQUEST' });
}

export interface IdentityApiOptions {
  readonly identities: DurableIdentityRegistry;
  readonly sessionTtlMs: number;
  /** Credential-attempt limits per IP per minute. Tunable so a test suite that
   *  legitimately performs many signups is not throttled by its own setup. */
  readonly limits?: { readonly signupPerMinute?: number; readonly loginPerMinute?: number };
}

export function registerIdentityApi(app: Express, options: IdentityApiOptions): void {
  const identities = options.identities;
  const maxAgeSeconds = Math.floor(options.sessionTtlMs / 1000);
  const signupLimiter = new AuthRateLimiter(options.limits?.signupPerMinute ?? 10, 60_000);
  const loginLimiter = new AuthRateLimiter(options.limits?.loginPerMinute ?? 20, 60_000);

  /** The security questions an account may be created with. Public by design. */
  app.get('/api/auth/security-questions', (_req, res) => {
    res.json({ questions: SECURITY_QUESTIONS });
  });

  /**
   * The single public sign-up route. Serves every account; there is no separate
   * owner endpoint, so the privileged account can never be recreated here (its
   * Gmail and username are already reserved by the bootstrap).
   */
  app.post('/api/auth/signup', async (req, res) => {
    try {
      signupLimiter.check(clientIp(req));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const account = await identities.createAccount({
        fullName: String(body['fullName'] ?? ''),
        username: String(body['username'] ?? ''),
        gmail: String(body['gmail'] ?? ''),
        securityQuestion: String(body['securityQuestion'] ?? ''),
        securityAnswer: String(body['securityAnswer'] ?? ''),
      });
      // No session is issued here: the user is sent to the login screen.
      res.status(201).json({ account: accountResponse(account), next: 'login' });
    } catch (error) {
      fail(res, error);
    }
  });

  /** The single login route for every account, privileged or not. */
  app.post('/api/auth/login', async (req, res) => {
    try {
      loginLimiter.check(clientIp(req));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { account, session } = await identities.signIn(
        String(body['gmail'] ?? ''),
        String(body['securityQuestion'] ?? ''),
        String(body['securityAnswer'] ?? ''),
      );
      res.setHeader('set-cookie', sessionCookie(session.token, maxAgeSeconds));
      res.status(200).json({
        account: accountResponse(account),
        // Advisory only, and returned here as well as on /api/auth/session so the
        // client does not have to re-fetch the session straight after signing in.
        // The backend independently enforces every privileged route.
        canManagePlatform: identities.isAdministrator(account.id),
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = (req as Request & { sessionToken?: string }).sessionToken;
      if (token !== undefined) await identities.logout(token);
      res.setHeader('set-cookie', clearedCookie());
      res.status(204).end();
    } catch {
      // Logout is idempotent; a failure here must still clear the browser cookie.
      res.setHeader('set-cookie', clearedCookie());
      res.status(204).end();
    }
  });

  /** Resolved server-side from the session cookie; never from a client field. */
  app.get('/api/auth/session', (req, res) => {
    const token = (req as Request & { sessionToken?: string }).sessionToken;
    if (token === undefined) {
      res.json({ account: null });
      return;
    }
    const account = identities.accountForToken(token);
    if (account === null) {
      res.json({ account: null });
      return;
    }
    res.json({
      account: accountResponse(account),
      // Advisory only: the backend independently enforces every privileged route.
      canManagePlatform: identities.isAdministrator(account.id),
    });
  });
}