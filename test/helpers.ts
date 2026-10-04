/**
 * Shared test helpers for the Nexona product-layer API tests.
 *
 * The web layer authenticates via the `bf_session` cookie only, resolved
 * server-side from the opaque session token. These helpers create real accounts
 * through the ONE signup route and sign in through the ONE login route, then
 * hand back the session cookie header value.
 *
 * There is no password, no OTP, no authenticator and no recovery flow in any
 * helper, because none of those exists in the active authentication system.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECURITY_QUESTIONS } from '../src/account/identity.ts';

/** Creates a fresh, isolated data directory for one server instance. */
export async function tempDataDir(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), 'nexona-test-'));
}

/** The security question every helper uses unless told otherwise. */
export const TEST_SECURITY_QUESTION = SECURITY_QUESTIONS[0]!;
/** The answer every helper uses unless told otherwise. Synthetic, test-only. */
export const TEST_SECURITY_ANSWER = 'Greenwood Primary';

/**
 * Derives a plausible full name from a username.
 *
 * Usernames are lower-case with underscores (`gate_alice`, `e2e-owner`), but a
 * full name may only contain letters, spaces, apostrophes, hyphens and periods.
 * Transforming rather than reusing the raw username keeps every existing caller
 * working without weakening name validation.
 */
function fullNameFor(username: string): string {
  return username
    .split(/[^A-Za-z'-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Test Account';
}

export interface AccountSpec {
  fullName?: string;
  username: string;
  gmail?: string;
  securityQuestion?: string;
  securityAnswer?: string;
}

/**
 * Creates an account through the one public signup route and returns the Cookie
 * header value for a signed-in session.
 *
 * Sign-up deliberately issues no session of its own (that is the Phase 2
 * contract, and `signupSessionCookie()` asserts it), so this helper signs in
 * afterwards and returns that session. Callers therefore keep the single
 * "give me an authenticated caller" meaning they always had.
 */
export async function signupCookie(url: string, username: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: fullNameFor(username),
      username,
      gmail: `${username.toLowerCase()}@gmail.com`,
      securityQuestion: TEST_SECURITY_QUESTION,
      securityAnswer: TEST_SECURITY_ANSWER,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed for "${username}": ${res.status} ${await res.text()}`);
  }
  // Sign-up must NOT issue a session. If one arrives that is a regression, so
  // this helper fails loudly instead of quietly using it.
  if (res.headers.get('set-cookie') !== null) {
    throw new Error('signup must not issue a session cookie');
  }
  // Sign-up is not authentication, so the session is obtained explicitly.
  return await loginCookie(url, username);
}

/**
 * Returns whatever Set-Cookie signup produced, including null.
 *
 * Sign-up deliberately issues NO session, so this normally returns null. Tests
 * that assert the absence of automatic authentication use this; everything
 * else uses signupCookie, which fails loudly if a cookie ever appears.
 */
export async function signupSessionCookie(url: string, username: string): Promise<string | null> {
  const res = await fetch(`${url}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: fullNameFor(username),
      username,
      gmail: `${username.toLowerCase()}@gmail.com`,
      securityQuestion: TEST_SECURITY_QUESTION,
      securityAnswer: TEST_SECURITY_ANSWER,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed for "${username}": ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  return setCookie === null ? null : setCookie.split(';')[0]!;
}

/** Signs an existing account in and returns the Cookie header value. */
export async function loginCookie(
  url: string,
  username: string,
  securityAnswer: string = TEST_SECURITY_ANSWER,
): Promise<string> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gmail: `${username.toLowerCase()}@gmail.com`,
      securityQuestion: TEST_SECURITY_QUESTION,
      securityAnswer,
    }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed for "${username}": ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) {
    throw new Error(`no session cookie issued for "${username}"`);
  }
  return setCookie.split(';')[0]!;
}

/**
 * Creates an account and immediately signs in, returning a usable Cookie header.
 * This is the standard way a product-layer test obtains an authenticated caller.
 */
export async function signupAndLoginCookie(url: string, username: string): Promise<string> {
  return await signupCookie(url, username);
}

/** Convenience: a JSON/Cookie header map for authenticated requests. */
export function authHeaders(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', cookie, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY SHIMS
//
// Roughly eighteen product-layer and execution-foundation tests reach for the
// helpers below. They used to drive a two-step mandatory setup; there is no
// setup any more, so these now mean "create the account and sign in".
//
// They are kept (rather than forcing ~18 unrelated test files to be edited
// during an authentication migration) so that execution-foundation tests stay
// untouched. Each is deliberately trivial and asserts nothing of its own.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an account and returns an authenticated cookie.
 *
 * Historically this also configured recovery questions and enrolled an
 * authenticator, because the product gated every route behind that setup. No
 * setup exists now, so signing in is the whole job.
 */
export async function signupEnrolledCookie(url: string, username: string): Promise<string> {
  return await signupCookie(url, username);
}

/** @deprecated The privileged account is provisioned server-side, never here. */
export async function ownerSignupEnrolledCookie(url: string, username: string): Promise<string> {
  return await signupEnrolledCookie(url, username);
}

/**
 * @deprecated There is no first-time setup step any more, so there is nothing
 * to complete. Kept so callers keep compiling; performs no HTTP call.
 */
export async function completeSetup(_url: string, _cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  return { secret: '', recoveryCodes: [] };
}

/** @deprecated Recovery questions are not a mechanism any more. */
export async function configureRecovery(_url: string, _cookie: string): Promise<void> {}

/**
 * The privileged account's bootstrap answer, for tests that need a real
 * administrator session.
 *
 * Synthetic and test-only. It is only ever placed in the environment of a test
 * process; it is never a production value and is never committed.
 */
export const TEST_BOOTSTRAP_SECURITY_ANSWER = 'Ore';

/**
 * Makes the server provision its privileged account at first boot.
 *
 * The privileged identity cannot be created through any client route - that is
 * the point. A server built while this is set bootstraps exactly one
 * administrator from `BF_BOOTSTRAP_SECURITY_ANSWER`, reserving its Gmail and
 * username so nobody can claim them.
 *
 * Call this BEFORE the first server is built; provisioning happens at boot.
 */
export function provisionPrivilegedAccountForTests(): void {
  process.env['BF_BOOTSTRAP_SECURITY_ANSWER'] = TEST_BOOTSTRAP_SECURITY_ANSWER;
}

/**
 * Signs in as the server-provisioned privileged account, through the ONE login
 * route that every account uses.
 *
 * The privileged defaults are the documented ones from `src/account/identity.ts`
 * and match the bootstrap answer above. It fails loudly if the account was never
 * provisioned, because silently returning an ordinary session would let an
 * authorization test pass for the wrong reason.
 */
export async function loginCookieForPrivileged(url: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gmail: 'corneliusadedejivictor@gmail.com',
      securityQuestion: TEST_SECURITY_QUESTION,
      securityAnswer: TEST_BOOTSTRAP_SECURITY_ANSWER,
    }),
  });
  if (res.status !== 200) {
    throw new Error(
      `privileged sign-in failed: ${res.status} ${await res.text()}` +
        ' (was provisionPrivilegedAccountForTests() called before building the server?)',
    );
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) {
    throw new Error('no session cookie issued for the privileged account');
  }
  const body = (await res.json()) as { canManagePlatform?: boolean };
  if (body.canManagePlatform !== true) {
    throw new Error('the privileged account must be authorised by the server');
  }
  return setCookie.split(';')[0]!;
}

/** @deprecated There is no authenticator to enroll. */
export async function enrollAuthenticator(): Promise<{ secret: string; recoveryCodes: string[] }> {
  return { secret: '', recoveryCodes: [] };
}

/**
 * @deprecated Login is a single step. This is now exactly `loginCookie`; the
 * trailing argument is ignored so two-step callers keep working.
 */
export async function loginTOTPCookie(
  url: string,
  username: string,
  _securityAnswer: string = TEST_SECURITY_ANSWER,
  _formerSecondFactor?: string,
): Promise<string> {
  return await loginCookie(url, username, _securityAnswer);
}