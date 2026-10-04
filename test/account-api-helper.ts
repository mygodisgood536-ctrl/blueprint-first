/**
 * Account helpers for tests that need both the platform administrator and an
 * ordinary member.
 *
 * PHASE 2 MIGRATION
 * ------------------
 * This file used to create the administrator through a dedicated
 * `/api/owner/signup` entry point and an ordinary user through `/api/user/signup`.
 * Both routes are gone: there is exactly ONE signup route and ONE login route.
 *
 * In the replacement model:
 *   - an ordinary member is created through `/api/auth/signup` and signs in;
 *   - the privileged account is NOT creatable by a client. It is provisioned
 *     server-side from `BF_BOOTSTRAP_SECURITY_ANSWER` at first boot, and is
 *     reached through the very same login route as everybody else.
 *
 * So `signUpOwner` now means "obtain a session for the server-provisioned
 * privileged account". It cannot take a username: there is exactly one, and
 * claiming it through signup is refused.
 */
import { signupEnrolledCookie, loginCookieForPrivileged, provisionPrivilegedAccountForTests } from './helpers.ts';

/**
 * The privileged account is provisioned from the environment before any server
 * is built. Call this at module scope, before the first `buildWorkingServer()`.
 */
provisionPrivilegedAccountForTests();

/**
 * Creates an ordinary (non-administrator) member through the one signup route
 * and returns a signed-in session.
 */
export async function signUp(url: string, username: string, _role?: 'admin' | 'developer'): Promise<string> {
  return signupEnrolledCookie(url, username);
}

/**
 * Returns a session for the server-provisioned privileged account.
 *
 * There is no owner signup any more: the account exists because the server
 * bootstrapped it, and it authenticates through the same `/api/auth/login` route
 * as every other account. The `_username` argument is retained for call-site
 * compatibility and deliberately ignored - a client cannot choose or create
 * the privileged identity.
 */
export async function signUpOwner(url: string, _username?: string): Promise<string> {
  return loginCookieForPrivileged(url);
}
