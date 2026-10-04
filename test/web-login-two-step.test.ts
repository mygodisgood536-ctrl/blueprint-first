/**
 * THE SINGLE LOGIN CONTRACT
 *
 * This file used to be the two-step login suite: password, then a challenge,
 * then an authenticator or recovery code - three round trips and two secrets.
 *
 * That model was replaced by ONE login route and ONE secret: Gmail + security
 * question + security answer. Two-step login has intentionally ceased to exist,
 * so these tests now pin the properties that make the single-step model safe and
 * prove the second step is genuinely gone.
 *
 * Preserved from the original intent:
 *   - a wrong credential never yields a session
 *   - a correct credential yields exactly one HttpOnly session cookie
 *   - the cookie alone authorises; no client-supplied identity is trusted
 *   - logging out invalidates the session server-side
 *   - the privileged account uses this same route
 */
import assert from 'node:assert/strict';
import test, { describe, before, after } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { SESSION_COOKIE } from '../src/web/identity-api.ts';
import { parseCookies } from '../src/web/cookies.ts';
import { DurableIdentityRegistry } from '../src/account/durable-identity.ts';
import { registerIdentityApi } from '../src/web/identity-api.ts';

const Q = 'What city did my parents meet?';
const BOOTSTRAP_ENV = { BF_BOOTSTRAP_SECURITY_ANSWER: 's3cret-answer' } as NodeJS.ProcessEnv;

let url = '';
let close: () => Promise<void>;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-login-'));
  const identities = await DurableIdentityRegistry.load(join(dir, 'identity.json'), 60 * 60 * 1000);
  await identities.ensurePrivilegedAccount(BOOTSTRAP_ENV);
  const app = express();
  app.use(express.json());
  // The same session-cookie resolution the real server installs, so these
  // tests exercise a genuine server-resolved identity.
  app.use((req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token !== undefined) (req as unknown as { sessionToken?: string }).sessionToken = token;
    next();
  });
  // A guarded resource, so we can prove the cookie alone is the authority.
  app.get('/api/private', (req, res) => {
    const token = (req as unknown as { sessionToken?: string }).sessionToken;
    const account = token === undefined ? null : identities.accountForToken(token);
    if (account === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ username: account.username });
  });
  registerIdentityApi(app, {
    identities,
    sessionTtlMs: 60 * 60 * 1000,
    limits: { signupPerMinute: 500, loginPerMinute: 500 },
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  url = `http://127.0.0.1:${port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
});

after(async () => { await close(); });

async function createAccount(username: string, gmail: string): Promise<void> {
  const res = await fetch(`${url}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: username.toUpperCase(), username, gmail, securityQuestion: Q, securityAnswer: 'London',
    }),
  });
  assert.equal(res.status, 201, `signup failed: ${await res.text()}`);
}

async function login(gmail: string, answer: string, question = Q): Promise<Response> {
  return await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gmail, securityQuestion: question, securityAnswer: answer }),
  });
}
describe('login is a single step and issues exactly one session', () => {
  test('three correct fields authenticate, with no second step', async () => {
    await createAccount('ada', 'ada@gmail.com');
    const res = await login('ada@gmail.com', 'London');
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /bf_session=/, 'a session cookie is issued');
    assert.match(cookie, /HttpOnly/i, 'the cookie is HttpOnly');
    assert.match(cookie, /SameSite=Lax/i, 'the cookie is SameSite=Lax');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['challengeId'], undefined, 'there is no second step to complete');
  });

  test('the cookie alone authorises; a forged identity header does not', async () => {
    const res = await login('ada@gmail.com', 'London');
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const anon = await fetch(`${url}/api/private`, { headers: { 'x-bf-user': 'ada' } });
    assert.equal(anon.status, 401, 'a self-asserted header must not authenticate anyone');
    const ok = await fetch(`${url}/api/private`, { headers: { cookie, 'x-bf-user': 'someoneelse' } });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { username: string }).username, 'ada', 'identity comes from the cookie');
  });

  test('every failure mode is indistinguishable and never yields a session', async () => {
    await createAccount('grace', 'grace@gmail.com');
    const wrongAnswer = await login('grace@gmail.com', 'Nowhere');
    const wrongQuestion = await login('grace@gmail.com', 'London', 'What is your favourite colour?');
    const unknownGmail = await login('nobody@gmail.com', 'London');
    const bodies: unknown[] = [];
    for (const res of [wrongAnswer, wrongQuestion, unknownGmail]) {
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('set-cookie'), null, 'a failed login must not set a cookie');
      bodies.push(await res.json());
    }
    // Wrong answer, wrong question and unknown Gmail must be byte-identical, so
    // the login form cannot be used to discover which accounts exist.
    assert.deepEqual(bodies[0], bodies[1], 'a wrong question must fail exactly like a wrong answer');
    assert.deepEqual(bodies[0], bodies[2], 'an unknown Gmail must fail exactly like a wrong answer');
  });

  test('logging out invalidates the session server-side', async () => {
    const res = await login('ada@gmail.com', 'London');
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    assert.equal((await fetch(`${url}/api/private`, { headers: { cookie } })).status, 200);
    const out = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie') ?? '', /bf_session=;/, 'the cookie is cleared');
    const after = await fetch(`${url}/api/private`, { headers: { cookie } });
    assert.equal(after.status, 401, 'a revoked token must be refused');
  });

  test('the privileged account signs in through the SAME route', async () => {
    const res = await login('corneliusadedejivictor@gmail.com', 's3cret-answer');
    assert.equal(res.status, 200, 'the privileged account uses the one login route');
    const body = (await res.json()) as { canManagePlatform: boolean };
    assert.equal(body.canManagePlatform, true, 'and is authorised by the server');
  });

  test('there is no second-step verification or recovery route to call', async () => {
    for (const path of ['/api/auth/login/verify', '/api/auth/forgot', '/api/auth/reset']) {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: 'x', code: '000000' }),
      });
      assert.equal(res.status, 404, `${path} must not exist (got ${res.status})`);
    }
  });
});
