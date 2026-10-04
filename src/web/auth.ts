/**
 * HTTP session middleware for the identity system.
 *
 * Identity comes EXCLUSIVELY from the opaque session cookie, which the server
 * resolves against the DurableIdentityRegistry on every request. A client cannot
 * claim an identity, only present a token the server issued. There is no
 * self-asserted header, no audit bypass and no legacy fallback.
 */

import type { NextFunction, Request, Response } from 'express';
import type { IdentityView } from '../account/identity.ts';
import { SESSION_COOKIE } from './identity-api.ts';
import { parseCookies } from './cookies.ts';

export { SESSION_COOKIE };

declare module 'express-serve-static-core' {
  interface Request {
    /** Set when the session cookie resolves to a live account; undefined otherwise. */
    identity?: IdentityView;
  }
}

/** Minimal structural surface attachIdentity needs (DurableIdentityRegistry satisfies it). */
export interface SessionResolver {
  accountForToken(token: string): IdentityView | null;
}

/**
 * Populates req.identity for every request.
 *
 * An unknown, expired or revoked token resolves to anonymous — it is never an
 * error, and never falls back to any other identity.
 */
export function attachIdentity(identities: SessionResolver): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token !== undefined) {
      const account = identities.accountForToken(token);
      if (account !== null) req.identity = account;
    }
    next();
  };
}

/** Guards a route: 401 unless the request carries a valid session. */
export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  if (req.identity !== undefined) {
    next();
    return;
  }
  res.status(401).json({ error: 'authentication required' });
}

/** The session token carried by this request, if any. */
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