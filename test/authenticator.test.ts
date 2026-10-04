/**
 * THE AUTHENTICATOR IS NOT PART OF THE ACTIVE AUTHENTICATION SYSTEM
 *
 * This file used to be the TOTP suite: enrollment, the 30-second window, replay
 * rejection, clock drift, recovery codes, and that a TOTP-less account could not
 * sign in. All of that described a second factor the product has deliberately
 * retired.
 *
 * Those behaviours have intentionally ceased to exist, so tests asserting them
 * would assert a fiction. They are replaced by the guarantee that actually
 * matters now: the authenticator is UNREACHABLE - not merely unused, but not
 * registered, so a caller cannot enroll, enable, disable or bypass one.
 *
 * The TOTP primitives still exist in `src/account/totp.ts` because
 * `src/account/accounts.ts` (retained for execution-foundation project
 * isolation) imports them. What must be proven is that nothing in the active
 * HTTP, session or frontend graph can reach them.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { DurableIdentityRegistry } from '../src/account/durable-identity.ts';
import { registerIdentityApi } from '../src/web/identity-api.ts';

const REPO = process.cwd();
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** A server holding only the ACTIVE authentication surface. */
async function activeApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'bf-noauth-'));
  const identities = await DurableIdentityRegistry.load(join(dir, 'identity.json'), 60 * 60 * 1000);
  const app = express();
  app.use(express.json());
  registerIdentityApi(app, { identities, sessionTtlMs: 60 * 60 * 1000 });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const Q = 'What city did my parents meet?';

describe('the authenticator is not part of the active authentication system', () => {
  test('no authenticator route is registered on the active HTTP surface', async () => {
    const { url, close } = await activeApp();
    try {
      for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
        for (const path of [
          '/api/account/authenticator',
          '/api/account/authenticator/setup',
          '/api/account/authenticator/enable',
          '/api/account/authenticator/disable',
          '/api/auth/login/verify',
        ]) {
          const res = await fetch(`${url}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: method === 'GET' ? undefined : JSON.stringify({ code: '000000' }),
          });
          assert.equal(res.status, 404, `${method} ${path} must not exist (got ${res.status})`);
        }
      }
    } finally {
      await close();
    }
  });
test('signing in needs no second factor at all', async () => {
    const { url, close } = await activeApp();
    try {
      // Create an account, then sign in with exactly three fields. No code, no
      // challenge, no second round trip.
      const created = await fetch(`${url}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Ada Lovelace', username: 'ada', gmail: 'ada@gmail.com',
          securityQuestion: Q, securityAnswer: 'London',
        }),
      });
      assert.equal(created.status, 201);

      const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gmail: 'ada@gmail.com', securityQuestion: Q, securityAnswer: 'London' }),
      });
      assert.equal(res.status, 200, 'three fields must be enough to sign in');
      const cookie = res.headers.get('set-cookie') ?? '';
      assert.match(cookie, /bf_session=/, 'the session is issued immediately');
      assert.doesNotMatch(cookie, /challenge/i, 'no challenge may be issued');
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['challengeId'], undefined, 'no challengeId may be returned');
    } finally {
      await close();
    }
  });

  test('the web layer cannot reach the TOTP primitives at all', () => {
    // The reachability proof for the retired second factor: no file in the
    // active HTTP/session graph may import the TOTP module, import the legacy
    // accounts registry, or call an authenticator/recovery method.
    const webGraph = [
      'src/web/server.ts',
      'src/web/auth.ts',
      'src/web/identity-api.ts',
      'src/web/account-api.ts',
      'src/account/identity.ts',
      'src/account/durable-identity.ts',
    ];
    const legacyMethods = [
      'enableAuthenticator', 'disableAuthenticator', 'beginPasswordRecovery',
      'completeRecovery', 'resetPassword', 'verifyPassword', 'beginLoginChallenge',
    ];
    for (const rel of webGraph) {
      const path = join(REPO, rel);
      assert.ok(existsSync(path), `${rel} must exist`);
      const src = readFileSync(path, 'utf8');
      assert.ok(!/from ['"][^'"]*totp\.ts['"]/.test(src), `${rel} must not import totp.ts`);
      assert.ok(!/from ['"][^'"]*accounts\.ts['"]/.test(src), `${rel} must not import accounts.ts`);
      for (const method of legacyMethods) {
        assert.ok(!src.includes(`${method}(`), `${rel} must not call ${method}()`);
      }
    }
  });

  test('the retired web authentication modules are gone from the repository', () => {
    for (const gone of ['src/web/auth-api.ts', 'src/web/audit-mode.ts']) {
      assert.equal(existsSync(join(REPO, gone)), false, `${gone} must be deleted`);
    }
  });

  test('no active route ever mentions a recovery code', async () => {
    const { url, close } = await activeApp();
    try {
      const created = await fetch(`${url}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Ada Lovelace', username: 'ada2', gmail: 'ada2@gmail.com',
          securityQuestion: Q, securityAnswer: 'London',
        }),
      });
      assert.equal(created.status, 201);
      const login = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gmail: 'ada2@gmail.com', securityQuestion: Q, securityAnswer: 'London' }),
      });
      assert.equal(login.status, 200);
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
      for (const path of ['/api/auth/session', '/api/auth/security-questions']) {
        const res = await fetch(`${url}${path}`, { headers: { cookie } });
        const text = await res.text();
        assert.doesNotMatch(text, /recoveryCode|recovery_code/i, `${path} must not mention recovery codes`);
      }
      // And the sign-up payload itself must not echo one back.
      assert.doesNotMatch(await created.text(), /recoveryCode|recovery_code/i);
    } finally {
      await close();
    }
  });
});
