/**
 * Phase 2 (2/3) — REAL HTTP tests for the replacement authentication surface.
 *
 * These drive the actual Express app over real HTTP with real cookies: no
 * mocked registry, no stubbed responses. They prove the contract the cutover
 * depends on, including that authorization is decided server-side.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { registerIdentityApi } from '../src/web/identity-api.ts';
import { DurableIdentityRegistry } from '../src/account/durable-identity.ts';
import { parseCookies } from '../src/web/cookies.ts';

const Q = 'What city did my parents meet?';
const BOOTSTRAP_ENV = { BF_BOOTSTRAP_SECURITY_ANSWER: 'Ore' } as NodeJS.ProcessEnv;

let server: ReturnType<express.Express['listen']>;
let url: string;
let identities: DurableIdentityRegistry;

/** Mirrors the production middleware: resolve the account from the cookie only. */
function attachIdentity(a: express.Express): void {
  a.use((req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['bf_session'];
    if (token !== undefined) (req as unknown as { sessionToken?: string }).sessionToken = token;
    next();
  });
}

before(async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'bf-http-auth-'));
  identities = await DurableIdentityRegistry.load(join(dir, 'identity.json'), 60 * 60 * 1000);
  await identities.ensurePrivilegedAccount(BOOTSTRAP_ENV);
  const app = express();
  app.use(express.json());
  attachIdentity(app);
  registerIdentityApi(app, {
    identities,
    sessionTtlMs: 60 * 60 * 1000,
    // The suite performs many credential attempts by design; the limiter itself
    // is still exercised (see the dedicated rate-limit test).
    limits: { signupPerMinute: 500, loginPerMinute: 500 },
  });
  // A privileged resource, enforced ONLY server-side.
  app.get('/api/platform/config', (req, res) => {
    const token = (req as unknown as { sessionToken?: string }).sessionToken;
    const account = token === undefined ? null : identities.accountForToken(token);
    if (account === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!identities.isAdministrator(account.id)) {
      res.status(403).json({ error: 'This account is not authorized for platform configuration.' });
      return;
    }
    res.status(200).json({ ok: true, for: account.username });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

function cookieFrom(res: globalThis.Response): string {
  const raw = res.headers.get('set-cookie');
  assert.ok(raw !== null, 'expected a session cookie');
  return raw.split(';')[0]!;
}

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, json: (text.length > 0 ? JSON.parse(text) : null) as Record<string, any>, text };
}

async function getJson(path: string, cookie?: string): Promise<Record<string, any>> {
  const res = await fetch(`${url}${path}`, { headers: cookie ? { cookie } : {} });
  return (await res.json()) as Record<string, any>;
}

const signup = (over: Record<string, string> = {}) =>
  post('/api/auth/signup', {
    fullName: 'Ada Lovelace',
    username: 'ada',
    gmail: 'ada@gmail.com',
    securityQuestion: Q,
    securityAnswer: 'analytical',
    ...over,
  });

const login = (over: Record<string, string> = {}) =>
  post('/api/auth/login', {
    gmail: 'ada@gmail.com',
    securityQuestion: Q,
    securityAnswer: 'analytical',
    ...over,
  });

describe('HTTP — signup', () => {
  it('creates an account with exactly the five fields and no session', async () => {
    const { res, json } = await signup();
    assert.equal(res.status, 201);
    assert.equal(json.account.username, 'ada');
    assert.equal(json.account.gmail, 'ada@gmail.com');
    assert.equal(json.next, 'login');
    assert.equal(res.headers.get('set-cookie'), null, 'signup must not authenticate');
    assert.equal(JSON.stringify(json).includes('analytical'), false, 'the answer must never be echoed');
    assert.equal(JSON.stringify(json).includes('scrypt'), false, 'the hash must never be echoed');
  });

  it('rejects a duplicate Gmail with an actionable 409', async () => {
    const { res, json } = await signup({ username: 'other', gmail: 'ADA@GMAIL.COM' });
    assert.equal(res.status, 409);
    assert.match(json.error, /already associated/i);
  });

  it('rejects a duplicate username with an actionable 409', async () => {
    const { res, json } = await signup({ username: 'ADA', gmail: 'fresh@gmail.com' });
    assert.equal(res.status, 409);
    assert.match(json.error, /already taken/i);
  });

  it('rejects invalid fields with 400', async () => {
    assert.equal((await signup({ gmail: 'nope@yahoo.com' })).res.status, 400);
    assert.equal((await signup({ username: 'a' })).res.status, 400);
    assert.equal((await signup({ fullName: 'A' })).res.status, 400);
    assert.equal((await signup({ securityQuestion: 'made up?' })).res.status, 400);
    assert.equal((await signup({ securityAnswer: 'x' })).res.status, 400);
  });

  it('cannot claim the privileged account Gmail or username', async () => {

describe('HTTP — login and session', () => {
  it('authenticates with Gmail + question + answer and sets a session cookie', async () => {
    const { res, json } = await login();
    assert.equal(res.status, 200);
    assert.equal(json.account.gmail, 'ada@gmail.com');
    const cookie = cookieFrom(res);
    assert.match(cookie, /^bf_session=/);
    assert.match(res.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(res.headers.get('set-cookie') ?? '', /SameSite=Lax/i);

    const session = await getJson('/api/auth/session', cookie);
    assert.equal(session.account.username, 'ada');
    assert.equal(session.canManagePlatform, false, 'a normal account is not an administrator');
  });

  it('resolves the session server-side and answers null without a cookie', async () => {
    const none = await getJson('/api/auth/session');
    assert.equal(none.account, null);
  });

  it('rejects an unknown Gmail, a wrong question and a wrong answer IDENTICALLY', async () => {
    const a = await login({ gmail: 'nobody@gmail.com' });
    const b = await login({ securityQuestion: 'What city were you born in?' });
    const c = await login({ securityAnswer: 'wrong' });
    for (const r of [a, b, c]) assert.equal(r.res.status, 401);
    assert.equal(new Set([a.text, b.text, c.text]).size, 1, 'failures must be indistinguishable');
  });

  it('accepts the answer case-insensitively', async () => {
    // Uses the privileged account ("Ore") so the check is against the real
    // mixed-case credential rather than an all-lowercase fixture.
    for (const answer of ['ORE', 'ore', 'Ore', '  ore  ']) {
      const { res } = await login({
        gmail: 'corneliusadedejivictor@gmail.com',
        securityQuestion: Q,
        securityAnswer: answer,
      });
      assert.equal(res.status, 200, `"${answer}" must be accepted`);
    }
  });

  it('logout invalidates the session server-side', async () => {
    const { res } = await login();
    const cookie = cookieFrom(res);
    const out = await post('/api/auth/logout', {}, cookie);
    assert.equal(out.res.status, 204);
    const after = await getJson('/api/auth/session', cookie);
    assert.equal(after.account, null, 'the token must no longer resolve');
  });
});

describe('HTTP — authorization is enforced server-side', () => {
  it('a normal account is refused a privileged resource', async () => {
    const { res } = await login();
    const cookie = cookieFrom(res);
    const denied = await fetch(`${url}/api/platform/config`, { headers: { cookie } });
    assert.equal(denied.status, 403, 'hiding a button is not the boundary');
  });

  it('an anonymous caller is refused entirely', async () => {
    assert.equal((await fetch(`${url}/api/platform/config`)).status, 401);
  });

  it('the privileged account authenticates through the SAME login route and is authorized', async () => {
    const { res, json } = await login({
      gmail: 'corneliusadedejivictor@gmail.com',
      securityQuestion: Q,
      securityAnswer: 'Ore',
    });
    assert.equal(res.status, 200, 'no special login path may exist');
    assert.equal(json.account.username, 'Oluwasegun');
    const cookie = cookieFrom(res);
    const session = await getJson('/api/auth/session', cookie);
    assert.equal(session.canManagePlatform, true);
    assert.equal((await fetch(`${url}/api/platform/config`, { headers: { cookie } })).status, 200);
  });
});

describe('HTTP — obsolete authentication surfaces are gone', () => {
  it('no password, OTP, TOTP, recovery-code or owner/user endpoint is registered', async () => {
    const obsolete = [
      '/api/owner/signup',
      '/api/user/signup',
      '/api/auth/forgot',
      '/api/auth/reset',
      '/api/account/password',
      '/api/account/authenticator/setup',
      '/api/account/authenticator/enable',
      '/api/account/recovery',
      '/api/auth/login/verify',
    ];
    for (const path of obsolete) {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      // Express answers 404 for a genuinely unregistered route. Any 2xx would
      // mean an obsolete authentication path is still live.
      assert.equal(res.status, 404, `${path} must not be registered`);
    }
  });

  it('the public security-question catalog is served', async () => {
    const res = await fetch(`${url}/api/auth/security-questions`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { questions: string[] };
    assert.ok(Array.isArray(body.questions) && body.questions.length > 0);
  });
});
    assert.equal((await signup({ username: 'impostor', gmail: 'corneliusadedejivictor@gmail.com' })).res.status, 409);
    assert.equal((await signup({ username: 'oluwasegun', gmail: 'impostor@gmail.com' })).res.status, 409);
  });
});