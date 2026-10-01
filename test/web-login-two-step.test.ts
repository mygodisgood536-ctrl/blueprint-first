/**
 * Web-layer two-step sign-in: TOTP-enforced login over HTTP.
 *
 * Proves the instruction requirement that a password alone NEVER yields a
 * dashboard session for authenticator-protected accounts: password login
 * returns a server-side challenge, and the session cookie is issued only after
 * `/api/auth/login/verify` completes with a valid TOTP or recovery code.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import { join } from 'node:path';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { buildServer } from '../src/web/server.ts';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import type { DemoResult } from '../src/demo/main.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { ProjectRegistry } from '../src/project/registry.ts';
import { AiRouter } from '../src/ai/router.ts';
import { ScriptedProvider } from '../src/ai/scripted-provider.ts';
import type { CoreServices } from '../src/core/services.ts';
import { totpNow } from '../src/account/totp.ts';
import { tempDataDir } from './helpers.ts';

interface ServerHandle {
  app: Express;
  close: () => Promise<void>;
  url: string;
}

async function buildServerHandle(dataDir: string): Promise<ServerHandle> {
  const allocator = new ArtifactIdAllocator();
  const store = new JsonFileArtifactStore({ filePath: join(dataDir, 'artifacts.json'), allocator });
  await store.init();
  const graph = new KnowledgeGraph();
  const evidence = new MemoryEvidenceLog();
  const router = new AiRouter();
  router.register(new ScriptedProvider({ rules: [] })).setDefaultProvider('scripted');
  const services: CoreServices = { store, allocator, graph, evidence, router };
  const registry = new ProjectRegistry(services);
  const result = {
    baseline: { projectId: 'demo-project', totalArtifacts: 0 },
    registry,
    services,
    evidence,
    store,
    projectMode: 'full-product',
  } as unknown as DemoResult;

  const { app } = await buildServer({ result, providerManager: new ProviderManager(), dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function j(url: string, method: string, path: string, cookie?: string | null, body?: unknown) {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json as Record<string, unknown>, setCookie };
}

describe('web two-step sign-in (TOTP enforced login)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexora-web-signin-'));

  it('a password never grants a session for an authenticator-protected account', async () => {
    const server = await buildServerHandle(dir);
    try {
      const signedUp = await j(server.url, 'POST', '/api/auth/signup', null, {
        username: 'ada',
        password: 'correct horse battery',
      });
      assert.equal(signedUp.status, 201);
      const sessionCookie = signedUp.setCookie!.split(';')[0]!;

      // A fresh session can still read its own profile before logout (existing session).
      const me = await j(server.url, 'GET', '/api/auth/session', sessionCookie);
      assert.equal((me.body.account as { username?: string }).username, 'ada');

      // Enable the authenticator (setup + enable).
      const setup = await j(server.url, 'POST', '/api/account/authenticator/setup', sessionCookie, {
        currentPassword: 'correct horse battery',
      });
      assert.equal(setup.status, 200);
      const secret = (setup.body as { secret: string }).secret;
      const enabled = await j(server.url, 'POST', '/api/account/authenticator/enable', sessionCookie, {
        code: totpNow(secret),
      });
      assert.equal(enabled.status, 200);
      const recoveryCodes = (enabled.body as { recoveryCodes: string[] }).recoveryCodes;
      assert.equal(recoveryCodes.length, 8);

      // Log out so the next sign-in must pass the full challenge.
      await j(server.url, 'POST', '/api/auth/logout', sessionCookie);
      const afterLogout = await j(server.url, 'GET', '/api/auth/session', sessionCookie);
      assert.equal(afterLogout.body.account, null);

      // 1) Wrong password: 401, no cookie, no challenge leak.
      const badPassword = await j(server.url, 'POST', '/api/auth/login', null, {
        username: 'ada',
        password: 'wrong-password-1',
      });
      assert.equal(badPassword.status, 401);
      assert.equal(badPassword.setCookie, null);

      // 2) Correct password: challenge returned, NO session cookie issued.
      const challenged = await j(server.url, 'POST', '/api/auth/login', null, {
        username: 'ada',
        password: 'correct horse battery',
      });
      assert.equal(challenged.status, 200);
      assert.equal(challenged.body.requiresAuthenticator, true);
      assert.equal(challenged.body.username, 'ada');
      assert.match(challenged.body.challengeId as string, /^[0-9a-f]{48}$/);
      assert.equal(challenged.setCookie, null);

      // Still not signed in anywhere without the code.
      const stillAnonymous = await j(server.url, 'GET', '/api/auth/session');
      assert.equal(stillAnonymous.body.account, null);

      // 3) Wrong code: 400, still no session.
      const badCode = await j(server.url, 'POST', '/api/auth/login/verify', null, {
        challengeId: challenged.body.challengeId,
        code: '000000',
      });
      assert.equal(badCode.status, 400);
      assert.notEqual(badCode, null);

      // 4) Correct TOTP code: session issued.
      const verified = await j(server.url, 'POST', '/api/auth/login/verify', null, {
        challengeId: challenged.body.challengeId,
        code: totpNow(secret),
      });
      assert.equal(verified.status, 200);
      assert.equal((verified.body.account as { username?: string }).username, 'ada');
      assert.ok(verified.setCookie!.includes('nexona_session='));
      const verifiedCookie = verified.setCookie!.split(';')[0]!;

      const authenticated = await j(server.url, 'GET', '/api/auth/session', verifiedCookie);
      assert.equal((authenticated.body.account as { username?: string }).username, 'ada');

      // The completed challenge is single-use (replay is rejected).
      const replayed = await j(server.url, 'POST', '/api/auth/login/verify', null, {
        challengeId: challenged.body.challengeId,
        code: totpNow(secret),
      });
      assert.equal(replayed.status, 401);
    } finally {
      await server.close();
    }
  });

  it('a recovery code completes sign-in and is single-use', async () => {
    const server = await buildServerHandle(dir);
    try {
      await j(server.url, 'POST', '/api/auth/signup', null, {
        username: 'bob',
        password: 'initial password 1',
      });
      // grab a fresh cookie for the recovery flow; bob has no TOTP yet, so sign-up handed one out
      const login1 = await j(server.url, 'POST', '/api/auth/login', null, {
        username: 'bob',
        password: 'initial password 1',
      });
      const sessionCookie = login1.setCookie!.split(';')[0]!;

      const setup = await j(server.url, 'POST', '/api/account/authenticator/setup', sessionCookie, {
        currentPassword: 'initial password 1',
      });
      const secret = (setup.body as { secret: string }).secret;
      const enabled = await j(server.url, 'POST', '/api/account/authenticator/enable', sessionCookie, {
        code: totpNow(secret),
      });
      const recoveryCodes = (enabled.body as { recoveryCodes: string[] }).recoveryCodes;
      await j(server.url, 'POST', '/api/auth/logout', sessionCookie);

      const challenged = await j(server.url, 'POST', '/api/auth/login', null, {
        username: 'bob',
        password: 'initial password 1',
      });
      const withCode = await j(server.url, 'POST', '/api/auth/login/verify', null, {
        challengeId: challenged.body.challengeId,
        code: recoveryCodes[0],
      });
      assert.equal(withCode.status, 200);
      assert.ok(withCode.setCookie!.includes('nexona_session='));
      await j(server.url, 'POST', '/api/auth/logout', withCode.setCookie!.split(';')[0]!);

      // Same recovery code is consumed and must not sign in a second time.
      const challengedAgain = await j(server.url, 'POST', '/api/auth/login', null, {
        username: 'bob',
        password: 'initial password 1',
      });
      const reuse = await j(server.url, 'POST', '/api/auth/login/verify', null, {
        challengeId: challengedAgain.body.challengeId,
        code: recoveryCodes[0],
      });
      assert.notEqual(reuse.status, 200);
    } finally {
      await server.close();
    }
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});