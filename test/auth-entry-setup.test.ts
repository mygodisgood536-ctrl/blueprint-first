/**
 * THE FIRST-TIME SETUP FLOW HAS BEEN RETIRED
 *
 * This file used to be the 647-line setup-wizard suite: it walked a brand-new
 * account through recovery questions, then authenticator enrollment, then
 * verified the product answered 403 until BOTH were finished, and that neither
 * step could be skipped.
 *
 * That wizard has intentionally ceased to exist. The account's only credential
 * is its security question + answer, supplied once at sign-up, so there is no
 * recovery step, no authenticator step, and nothing to complete afterwards.
 *
 * The surviving tests carry the security meaning that still applies:
 *   - the former setup routes are genuinely unavailable (404), not merely unused
 *   - a new account reaches the product straight after ONE login step, because
 *     the old wizard gate no longer exists as a bypassable hole
 *   - the retired answers never appear on disk or in any response
 */
import assert from 'node:assert/strict';
import test, { describe, before, after } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { SESSION_COOKIE } from '../src/web/identity-api.ts';
import { parseCookies } from '../src/web/cookies.ts';
import { DurableIdentityRegistry } from '../src/account/durable-identity.ts';
import { registerIdentityApi } from '../src/web/identity-api.ts';
import { registerAccountApi } from '../src/web/account-api.ts';

const Q = 'What city did my parents meet?';
const ANSWER = 'Greenwood Primary';

let url = '';
let close: () => Promise<void>;
let identityFile = '';

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-setup-'));
  identityFile = join(dir, 'identity.json');
  const identities = await DurableIdentityRegistry.load(identityFile, 60 * 60 * 1000);
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
  // A product route, to show there is no setup gate in front of it any more.
  app.get('/api/product', (req, res) => {
    const token = (req as unknown as { sessionToken?: string }).sessionToken;
    const account = token === undefined ? null : identities.accountForToken(token);
    if (account === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    res.json({ ok: true });
  });
  registerIdentityApi(app, {
    identities,
    sessionTtlMs: 60 * 60 * 1000,
    limits: { signupPerMinute: 500, loginPerMinute: 500 },
  });
  registerAccountApi(app, { identities });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  url = `http://127.0.0.1:${port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
});

after(async () => { await close(); });
describe('the first-time setup flow is retired', () => {
  test('every former setup and recovery route is unavailable', async () => {
    for (const path of [
      '/api/account/recovery',
      '/api/auth/recovery-questions',
      '/api/account/authenticator',
      '/api/account/authenticator/setup',
      '/api/account/authenticator/enable',
      '/api/account/authenticator/disable',
      '/api/account/password',
      '/api/owner/signup',
      '/api/user/signup',
      '/api/auth/owner-exists',
    ]) {
      for (const method of ['GET', 'POST']) {
        const res = await fetch(`${url}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : JSON.stringify({ answers: [], code: '000000' }),
        });
        assert.equal(res.status, 404, `${method} ${path} must be unavailable (got ${res.status})`);
      }
    }
  });

  test('a brand-new account reaches the product with no setup step at all', async () => {
    const created = await fetch(`${url}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Grace Hopper', username: 'grace', gmail: 'grace@gmail.com',
        securityQuestion: Q, securityAnswer: ANSWER,
      }),
    });
    assert.equal(created.status, 201, 'five fields are the whole of signup');
    // No session from signup, so the product is refused...
    assert.equal(created.headers.get('set-cookie'), null, 'signup issues no session');
    assert.equal((await fetch(`${url}/api/product`)).status, 401, 'anonymous is refused');

    // ...and after ONE login step it is served, with nothing else to complete.
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gmail: 'grace@gmail.com', securityQuestion: Q, securityAnswer: ANSWER }),
    });
    assert.equal(res.status, 200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const product = await fetch(`${url}/api/product`, { headers: { cookie } });
    assert.equal(product.status, 200, 'no setup gate stands between a new account and the product');
  });

  test('the security answer is never stored in plaintext', async () => {
    const raw = await readFile(identityFile, 'utf8');
    assert.ok(!raw.includes(ANSWER), 'the answer must never appear on disk');
    assert.match(raw, /scrypt|salt2/i, 'the answer must be stored as a salted hash');
  });

  test('the retired answers are not recoverable from any response', async () => {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gmail: 'grace@gmail.com', securityQuestion: Q, securityAnswer: ANSWER }),
    });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const text = await (await fetch(`${url}/api/auth/session`, { headers: { cookie } })).text();
    assert.doesNotMatch(text, /securityAnswerHash|salt2|scrypt/i, 'no hash may be echoed to a client');
    assert.doesNotMatch(text, new RegExp(ANSWER), 'the answer must never be echoed to a client');
  });
});
