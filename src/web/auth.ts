/**
 * HTTP authentication middleware.
 *
 * Identity comes EXCLUSIVELY from the opaque session cookie, which resolves
 * through the durable AccountRegistry. The legacy self-asserted x-bf-user
 * header is gone: a client cannot claim an identity, only present a token the
 * server issued. Requests without a valid session are anonymous; protected
 * routes use requireAuth.
 */

import type { NextFunction, Request, Response } from 'express';
import type { AccountRecord } from '../account/accounts.ts';
import { parseCookies } from './cookies.ts';

export const SESSION_COOKIE = 'nexona_session';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by attachAuth when the session cookie resolves; undefined otherwise. */
    account?: AccountRecord;
  }
}

/** Minimal structural surface attachAuth needs (DurableAccountRegistry satisfies it). */
export interface SessionVerifier {
  verifySession(token: string): AccountRecord;
}

/** Populates req.account for every request (null when anonymous). */
export function attachAuth(accounts: SessionVerifier): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token !== undefined) {
      try {
        req.account = accounts.verifySession(token);
      } catch {
        req.account = undefined; // expired/invalid token -> anonymous
      }
    }
    next();
  };
}

/** Guards a route: 401 unless the request carries a valid session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.account !== undefined) {
    next();
    return;
  }
  res.status(401).json({ error: 'authentication required' });
}

/** The session token carried by this request, if any (used for logout/revoke). */
export function sessionTokenOf(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

/**
 * CSRF defense for cookie-based auth: state-changing requests whose Origin
 * header is present must match the request host. Browsers always send Origin
 * on cross-site POSTs; non-browser clients and same-origin fetches match or
 * omit it. Combined with SameSite=Lax this blocks forged cross-site writes.
 */
export function assertSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin === undefined) {
    next();
    return;
  }
  try {
    if (new URL(origin).host === req.headers.host) {
      next();
      return;
    }
  } catch {
    // malformed origin -> rejected below
  }
  res.status(403).json({ error: 'cross-origin request rejected' });
}