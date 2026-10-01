/**
 * TEMPORARY AUDIT MODE - NOT PART OF THE FINAL ARCHITECTURE.
 *
 * Purpose: allow the platform's backend and execution architecture to be
 * exercised and audited independently of authentication, which is being
 * deliberately set aside for a separate redesign phase.
 *
 * What this does:
 *  - Enabled ONLY by the environment variable `BF_AUDIT_NO_AUTH=1`.
 *  - Injects a synthetic audit identity for every request that does not present
 *    a real session, so the whole governed execution surface is reachable.
 *  - Leaves `/api/me` reporting "no account", so the frontend keeps behaving
 *    exactly like a signed-out visitor and the splash/welcome experience is
 *    preserved untouched.
 *  - Reports its own state at `/api/audit-mode` so the frontend can route
 *    "Get started" straight into the workspace instead of a sign-in form.
 *
 * What this deliberately does NOT do:
 *  - It does not remove, weaken or replace any authentication code. Every
 *    authentication route, gate and check remains in place and still executes.
 *  - It does not decide a product role from a URL. The audit identity is a fixed
 *    development identity; the real role model is unchanged and still
 *    server-side.
 *  - It is a development/audit switch, never the final entry architecture. The
 *    final product uses ONE application URL for every user, with authentication
 *    determining identity, role and permissions.
 *
 * Turning it off (unset / `0`) restores the full authentication behaviour.
 */

import type { Request } from 'express';
import type { AccountRecord } from '../account/accounts.ts';

/** True when the audit switch is on. Read once from the environment. */
export function auditNoAuthEnabled(): boolean {
  const raw = process.env['BF_AUDIT_NO_AUTH']?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** The synthetic identity used while auditing. Not a real account. */
export const AUDIT_ACCOUNT_ID = 'AUDIT-DEVELOPER';

/**
 * A synthetic, fully set-up development identity. It is never persisted and
 * never created through the account system; it exists only in request scope so
 * the governed execution path can be exercised.
 */
export function auditIdentity(): AccountRecord {
  return {
    id: AUDIT_ACCOUNT_ID,
    username: 'audit',
    displayName: 'Audit Session',
    // A non-administrator development identity: owner-only areas stay refused,
    // so the real role boundary is still exercised rather than bypassed.
    role: 'developer',
    createdAt: new Date(0).toISOString(),
    passwordHash: '',
    passwordSalt: '',
    // Fully set up, so the audit session is not blocked by authentication setup
    // gates that this phase is deliberately setting aside.
    authenticatorRequired: false,
    recoveryQuestions: [{ id: 'audit', question: 'audit', answerHash: '', answerSalt: '', createdAt: new Date(0).toISOString() }],
  };
}

/**
 * Attaches the synthetic audit identity to any request that has no real
 * session, so the platform's execution surface is reachable for auditing.
 */
export function applyAuditIdentity(req: Request): void {
  if (req.account !== undefined) return;
  req.account = auditIdentity();
}

/** The identity that owns data written during an audit session. */
export function auditOwnerId(): string {
  return AUDIT_ACCOUNT_ID;
}
