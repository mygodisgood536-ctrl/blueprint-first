/**
 * Shared test helpers for the Nexona product-layer API tests.
 *
 * The web layer authenticates via the `nexona_session` cookie only (the legacy
 * self-asserted x-bf-user header is gone). These helpers sign up real accounts
 * through the auth API and hand back the session cookie header value, plus an
 * isolated temp data dir so server instances never touch the real data/ dir.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totpNow } from '../src/account/totp.ts';

/** Creates a fresh, isolated data directory for one server instance. */
export async function tempDataDir(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), 'nexona-test-'));
}

/** Signs up a user against the given base URL and returns the Cookie header value. */
export async function signupCookie(
  url: string,
  username: string,
  password = 'test-password-1',
): Promise<string> {
  const res = await fetch(`${url}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed for "${username}": ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) {
    throw new Error(`no session cookie issued for "${username}"`);
  }
  // The header value is "nexona_session=<token>; Max-Age=...; ..." — cut at ';'.
  return setCookie.split(';')[0]!;
}

/** Logs an existing user in and returns the Cookie header value. */
export async function loginCookie(
  url: string,
  username: string,
  password = 'test-password-1',
): Promise<string> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

/** Convenience: a JSON/Cookie header map for authenticated requests. */
export function authHeaders(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', cookie, ...extra };
}

/** Recovery question/answers used by tests. Real answers, real hashing. */
export const TEST_RECOVERY_ANSWERS = [
  { questionId: 'first_school', answer: 'Greenwood Primary' },
  { questionId: 'first_pet', answer: 'Rex' },
];

/**
 * Configures the account's mandatory recovery questions. Answers are hashed by
 * the backend exactly as they are in production.
 */
export async function configureRecovery(url: string, cookie: string): Promise<void> {
  const res = await fetch(`${url}/api/account/recovery`, {
    method: 'POST',
    headers: authHeaders(cookie),
    body: JSON.stringify({ answers: TEST_RECOVERY_ANSWERS }),
  });
  if (res.status !== 200) {
    throw new Error(`recovery setup failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Enrolls the account's mandatory TOTP authenticator so the session can reach
 * product-gated routes (a session alone is not enough — see the server's
 * `recovery_setup_required` / `authenticator_setup_required` gate). Returns the
 * TOTP secret and the issued recovery codes so callers can later re-authenticate
 * (e.g. after a restart).
 */
export async function enrollAuthenticator(
  url: string,
  cookie: string,
  _password = 'test-password-1',
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await fetch(`${url}/api/account/authenticator/setup`, {
    method: 'POST',
    headers: authHeaders(cookie),
    body: JSON.stringify({}),
  });
  if (setup.status !== 200) {
    throw new Error(`authenticator setup failed for "${cookie.slice(0, 12)}": ${setup.status} ${await setup.text()}`);
  }
  const secret = ((await setup.json()) as { secret: string }).secret;
  const enabled = await fetch(`${url}/api/account/authenticator/enable`, {
    method: 'POST',
    headers: authHeaders(cookie),
    body: JSON.stringify({ code: totpNow(secret) }),
  });
  if (enabled.status !== 200) {
    throw new Error(`authenticator enable failed: ${enabled.status} ${await enabled.text()}`);
  }
  const body = (await enabled.json()) as { recoveryCodes: string[] };
  return { secret, recoveryCodes: body.recoveryCodes };
}

/**
 * Completes the FULL mandatory first-time setup: recovery questions first, then
 * the authenticator, in the same order the product enforces.
 */
export async function completeSetup(
  url: string,
  cookie: string,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  await configureRecovery(url, cookie);
  return await enrollAuthenticator(url, cookie);
}

/** Signs up a NORMAL user through the dedicated user entry point and completes setup. */
export async function signupEnrolledCookie(url: string, username: string, password = 'test-password-1'): Promise<string> {
  const cookie = await signupCookie(url, username, password);
  await completeSetup(url, cookie);
  return cookie;
}

/** Signs up the PLATFORM OWNER through the dedicated owner entry point and completes setup. */
export async function ownerSignupEnrolledCookie(url: string, username: string, password = 'test-password-1'): Promise<string> {
  const res = await fetch(`${url}/api/owner/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 201) {
    throw new Error(`owner signup failed for "${username}": ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) throw new Error(`no session cookie issued for "${username}"`);
  const cookie = setCookie.split(';')[0]!;
  await completeSetup(url, cookie);
  return cookie;
}

/**
 * Two-step login for an account that has TOTP enabled. Returns the session
 * cookie only after a valid code or recovery code completes the challenge.
 */
export async function loginTOTPCookie(
  url: string,
  username: string,
  password = 'test-password-1',
  code: string,
): Promise<string> {
  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (login.status !== 200) {
    throw new Error(`login failed for "${username}": ${login.status} ${await login.text()}`);
  }
  const challengeId = ((await login.json()) as { challengeId: string }).challengeId;
  const verify = await fetch(`${url}/api/auth/login/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, code }),
  });
  if (verify.status !== 200) {
    throw new Error(`login/verify failed for "${username}": ${verify.status} ${await verify.text()}`);
  }
  const setCookie = verify.headers.get('set-cookie');
  if (setCookie === null) {
    throw new Error(`no session cookie issued for "${username}"`);
  }
  return setCookie.split(';')[0]!;
}