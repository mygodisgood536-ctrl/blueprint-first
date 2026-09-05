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