/**
 * OWNER / USER SEPARATION and the real Daytona credential flow
 * (ARCHITECTURE 3.3 Â§69-Â§70, Â§75, Â§81, Â§121, Â§123).
 *
 * Daytona is PLATFORM infrastructure: configured once by the owner, then used by
 * every project. These tests prove the separation is enforced by the BACKEND
 * (not merely hidden in the UI), that the credential never leaks to a user or
 * back to a client, and that a genuine verification failure never activates.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { reconcileHostPath } from '../src/runtime/host-path.ts';
import { buildWorkingServer, workingTempDataDir as tempDataDir } from './working-harness.ts';
import { signUp, signUpOwner } from './account-api-helper.ts';

reconcileHostPath();

/** Signs up the Platform Owner or an ordinary user through its own entry point. */
async function sessionFor(url: string, username: string, role: 'admin' | 'developer'): Promise<string> {
  return role === 'admin' ? signUpOwner(url, username) : signUp(url, username);
}

test('owner-only Daytona routes are refused for ordinary users and served for the owner', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const owner = await sessionFor(s.url, 'owner-user', 'admin');
    const member = await sessionFor(s.url, 'member-user', 'developer');

    // Anonymous is refused outright.
    assert.equal((await fetch(`${s.url}/api/owner/daytona`)).status, 401);

    // An ordinary user is refused by the BACKEND, not just hidden in the UI.
    const denied = await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: member } });
    assert.equal(denied.status, 403, 'an ordinary account must not reach owner infrastructure');
    const deniedBody = (await denied.json()) as { error: string };
    assert.match(deniedBody.error, /owner-only/i);

    // Writing infrastructure is equally refused.
    const deniedWrite = await fetch(`${s.url}/api/owner/daytona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: member },
      body: JSON.stringify({ apiKey: 'dtn_should_never_be_accepted' }),
    });
    assert.equal(deniedWrite.status, 403);
    const deniedDelete = await fetch(`${s.url}/api/owner/daytona`, { method: 'DELETE', headers: { cookie: member } });
    assert.equal(deniedDelete.status, 403);

    // The owner reaches it and sees the real, unconfigured state.
    const ok = await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: owner } });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as {
      daytona: { status: string; detail: string; credentialId: string | null; capabilities: string[] };
      activeBackend: string;
      daytonaConfigured: boolean;
      signupUrl: string;
    };
    assert.equal(body.daytona.status, 'unconfigured');
    assert.equal(body.daytonaConfigured, false);
    assert.equal(body.activeBackend === 'daytona' || body.activeBackend === 'local-workspace', true);
    assert.ok(body.signupUrl.includes('daytona.io'), 'the owner is given the real Daytona signup path');
  } finally {
    await s.close();
  }
});

test('an invalid Daytona credential is verified against the real Daytona API, fails honestly, and never activates', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const owner = await sessionFor(s.url, 'owner-verify', 'admin');
    const badKey = 'dtn_this_is_not_a_real_key_000000000';

    const before = (await (await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: owner } })).json()) as { activeBackend: string };
    const backendBefore = before.activeBackend;

    const res = await fetch(`${s.url}/api/owner/daytona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ apiKey: badKey }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      daytona: { status: string; detail: string };
      daytonaConfigured: boolean;
      activeBackend: string;
    };

    // The real Daytona API rejects the key, so the platform must NOT be connected.
    assert.equal(body.daytona.status, 'failed');
    assert.equal(body.daytonaConfigured, false, 'an invalid credential must never become the active configuration');
    assert.ok(body.daytona.detail.length > 0, 'the owner must get useful failure information');
    // Useful, actionable, and with no secret material in it.
    assert.doesNotMatch(body.daytona.detail, new RegExp(badKey));
    assert.doesNotMatch(body.daytona.detail, /dtn_this_is_not_a_real_key/);

    // The execution backend was not switched on a failed verification.
    assert.equal(body.activeBackend, backendBefore);

    // A read-back must never disclose the key.
    const readBack = await (await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: owner } })).text();
    assert.ok(!readBack.includes(badKey), 'the API key must never be returned to any client');
  } finally {
    await s.close();
  }
});

test('an empty Daytona key is refused before any verification is attempted', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const owner = await sessionFor(s.url, 'owner-empty', 'admin');
    const res = await fetch(`${s.url}/api/owner/daytona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ apiKey: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /API key is required/i);
    // The configuration is still unconfigured - an empty submission changed nothing.
    const after = (await (await fetch(`${s.url}/api/owner/daytona`, { headers: { cookie: owner } })).json()) as {
      daytona: { status: string };
      daytonaConfigured: boolean;
    };
    assert.equal(after.daytona.status, 'unconfigured');
    assert.equal(after.daytonaConfigured, false);
  } finally {
    await s.close();
  }
});

test('the Daytona API key never appears in the durable log, events or evidence', async () => {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  try {
    const owner = await sessionFor(s.url, 'owner-leak', 'admin');
    const secretish = 'dtn_leak_probe_key_1234567890';
    await fetch(`${s.url}/api/owner/daytona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ apiKey: secretish }),
    });

    // Nothing user-visible may contain the credential.
    for (const path of ['/api/system/foundation', '/api/activity', '/api/evidence', '/api/working/supervisor', '/api/owner/daytona']) {
      const res = await fetch(`${s.url}${path}`, { headers: { cookie: owner } });
      const text = await res.text();
      assert.ok(!text.includes(secretish), `${path} must not contain the Daytona API key`);
    }
  } finally {
    await s.close();
  }
});

