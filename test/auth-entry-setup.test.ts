/**
 * TWO DEDICATED ENTRY POINTS, MANDATORY FIRST-TIME SETUP, AND RECOVERY QUESTIONS
 *
 * These tests drive the REAL HTTP API end to end and prove every requirement:
 *   1. Separate owner and user entry points (separate signup endpoints/roles).
 *   2. First-time owner setup and first-time user setup, both of which must
 *      complete recovery questions then the authenticator before the dashboard.
 *   3. Recovery questions/answers are mandatory, secure, and never leak.
 *   4. The setup cannot be bypassed (server-side 403 on every product route).
 *   5. Normal login is username+password then a 6-digit authenticator code.
 *   6. Forgot password, change password and change authenticator all require the
 *      recovery answers.
 *   7. Wrong recovery answers and wrong authenticator codes are refused.
 *   8. A normal user cannot reach owner functionality by any URL.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildWorkingServer, workingTempDataDir as tempDataDir } from './working-harness.ts';
import { authHeaders, TEST_RECOVERY_ANSWERS } from './helpers.ts';
import { totpNow } from '../src/account/totp.ts';
import { RECOVERY_QUESTION_CATALOG } from '../src/account/accounts.ts';

interface Harness {
  url: string;
  dir: string;
  close: () => Promise<void>;
}

async function call(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; json: any; cookie?: string }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function harness(): Promise<Harness> {
  const dir = await tempDataDir();
  const s = await buildWorkingServer(dir);
  return { url: s.url, dir, close: s.close };
}

/** Runs the full mandatory first-time setup and returns the TOTP secret. */
async function finishSetup(url: string, cookie: string): Promise<string> {
  const recovery = await call(url, 'POST', '/api/account/recovery', { answers: TEST_RECOVERY_ANSWERS }, cookie);
  assert.equal(recovery.status, 200, `recovery setup failed: ${JSON.stringify(recovery.json)}`);
  assert.equal(recovery.json.account.setupStage, 'authenticator', 'must move to the authenticator stage');
  const setup = await call(url, 'POST', '/api/account/authenticator/setup', {}, cookie);
  assert.equal(setup.status, 200, `authenticator setup failed: ${JSON.stringify(setup.json)}`);
  const secret = setup.json.secret as string;
  const enabled = await call(url, 'POST', '/api/account/authenticator/enable', { code: totpNow(secret) }, cookie);
  assert.equal(enabled.status, 200, `authenticator enable failed: ${JSON.stringify(enabled.json)}`);
  return secret;
}

/** Signs in fully: password, then the 6-digit authenticator code. */
async function fullLogin(url: string, username: string, password: string, secret: string): Promise<string> {
  const first = await call(url, 'POST', '/api/auth/login', { username, password });
  assert.equal(first.status, 200);
  assert.equal(first.json.requiresAuthenticator, true, 'login must require the authenticator code');
  const verify = await call(
    url,
    'POST',
    '/api/auth/login/verify',
    { challengeId: first.json.challengeId, code: totpNow(secret) },
    first.cookie,
  );
  assert.equal(verify.status, 200, `login verify failed: ${JSON.stringify(verify.json)}`);
  return verify.cookie!;
}

// â”€â”€ 1. Two separate entry points â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('the owner and the user have SEPARATE entry endpoints, and only the owner endpoint grants the owner role', async () => {
  const h = await harness();
  try {
    // The owner entry point creates the owner.
    const owner = await call(h.url, 'POST', '/api/owner/signup', {
      username: 'owner_one',
      password: 'owner-password-1',
      displayName: 'Owner One',
    });
    assert.equal(owner.status, 201, JSON.stringify(owner.json));
    assert.equal(owner.json.account.role, 'admin', 'the owner entry point must create the owner');
    const ownerCookie = owner.cookie!;
    await finishSetup(h.url, ownerCookie);

    // The user entry point creates a normal user, never an owner.
    const user = await call(h.url, 'POST', '/api/user/signup', {
      username: 'user_one',
      password: 'user-password-1',
      displayName: 'User One',
    });
    assert.equal(user.status, 201, JSON.stringify(user.json));
    assert.notEqual(user.json.account.role, 'admin', 'the user entry point must never create an owner');
    const userCookie = user.cookie!;
    // Fully set up, so any refusal below is about the ROLE, not about setup.
    await finishSetup(h.url, userCookie);

    // A second owner is refused: the owner is singular.
    const second = await call(h.url, 'POST', '/api/owner/signup', {
      username: 'owner_two',
      password: 'owner-password-2',
    });
    assert.equal(second.status, 401, 'a second Platform Owner must be refused');
    assert.match(String(second.json.error), /already exists/i);

    // A client-supplied role is ignored on the user path.
    const escalate = await call(h.url, 'POST', '/api/user/signup', {
      username: 'user_escalate',
      password: 'user-password-9',
      role: 'admin',
    });
    assert.equal(escalate.status, 201);
    assert.notEqual(escalate.json.account.role, 'admin', 'a client-supplied role must be ignored');

    // The owner-only area is enforced by the BACKEND, not the UI.
    const denied = await call(h.url, 'GET', '/api/owner/daytona', undefined, userCookie);
    assert.equal(denied.status, 403, 'a normal user must not reach owner infrastructure by any URL');
    assert.match(String(denied.json.error), /owner-only/i);
    const allowed = await call(h.url, 'GET', '/api/owner/daytona', undefined, ownerCookie);
    assert.equal(allowed.status, 200, 'the owner must reach the owner area');

    // The legacy alias can never mint an owner.
    const alias = await call(h.url, 'POST', '/api/auth/signup', {
      username: 'alias_user',
      password: 'alias-password-1',
    });
    assert.equal(alias.status, 201);
    assert.notEqual(alias.json.account.role, 'admin');
    void escalate;
  } finally {
    await h.close();
  }
});

// â”€â”€ 2. Mandatory first-time setup cannot be bypassed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('a new account CANNOT reach the product until recovery questions AND the authenticator are complete', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'setup_user',
      password: 'setup-password-1',
    });
    assert.equal(created.status, 201);
    const cookie = created.cookie!;
    const account = created.json.account;
    assert.equal(account.setupStage, 'recovery', 'a new account starts at the recovery stage');
    assert.equal(account.setupComplete, false);
    assert.equal(account.recoveryRequired, true);

    // A session alone is not enough: every product route is refused.
    for (const path of ['/api/system/foundation', '/api/projects', '/api/activity', '/api/artifacts']) {
      const blocked = await call(h.url, 'GET', path, undefined, cookie);
      assert.equal(blocked.status, 403, `${path} must be refused during first-time setup`);
      assert.equal(blocked.json.code, 'recovery_setup_required');
    }

    // The authenticator alone is NOT a bypass: it is still refused until
    // recovery is configured, because recovery is step 1.
    const setupOnly = await call(h.url, 'POST', '/api/account/authenticator/setup', {}, cookie);
    assert.equal(setupOnly.status, 200, 'authenticator setup is reachable inside the wizard');
    const secret = setupOnly.json.secret as string;
    const enabled = await call(h.url, 'POST', '/api/account/authenticator/enable', { code: totpNow(secret) }, cookie);
    assert.equal(enabled.status, 200);
    const stillBlocked = await call(h.url, 'GET', '/api/system/foundation', undefined, cookie);
    assert.equal(stillBlocked.status, 403, 'enabling the authenticator must not skip recovery');
    assert.equal(stillBlocked.json.code, 'recovery_setup_required');

    // Now complete recovery: the account becomes usable.
    const recovery = await call(h.url, 'POST', '/api/account/recovery', { answers: TEST_RECOVERY_ANSWERS }, cookie);
    assert.equal(recovery.status, 200);
    assert.equal(recovery.json.account.setupComplete, true);
    const allowed = await call(h.url, 'GET', '/api/system/foundation', undefined, cookie);
    assert.equal(allowed.status, 200, 'a fully set-up account must reach the product');
  } finally {
    await h.close();
  }
});

test('an incorrect authenticator code during setup is refused and does not complete setup', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'badcode_user',
      password: 'badcode-password-1',
    });
    const cookie = created.cookie!;
    await call(h.url, 'POST', '/api/account/recovery', { answers: TEST_RECOVERY_ANSWERS }, cookie);
    const setup = await call(h.url, 'POST', '/api/account/authenticator/setup', {}, cookie);
    const wrong = await call(h.url, 'POST', '/api/account/authenticator/enable', { code: '000000' }, cookie);
    assert.equal(wrong.status, 400, 'a wrong 6-digit code must be refused');
    const stillBlocked = await call(h.url, 'GET', '/api/system/foundation', undefined, cookie);
    assert.equal(stillBlocked.status, 403, 'a wrong code must not complete setup');
    assert.equal(stillBlocked.json.code, 'authenticator_setup_required');
    // The real code then works.
    const ok = await call(
      h.url,
      'POST',
      '/api/account/authenticator/enable',
      { code: totpNow(setup.json.secret) },
      cookie,
    );
    assert.equal(ok.status, 200);
    assert.equal((await call(h.url, 'GET', '/api/system/foundation', undefined, cookie)).status, 200);
  } finally {
    await h.close();
  }
});

// â”€â”€ 3. Recovery answers are secure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('recovery answers are stored hashed, never returned by any API, and never in plaintext', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'secure_user',
      password: 'secure-password-1',
    });
    const cookie = created.cookie!;
    await call(h.url, 'POST', '/api/account/recovery', { answers: TEST_RECOVERY_ANSWERS }, cookie);
    await finishSetup(h.url, cookie);

    // The read route returns the questions and never an answer.
    const info = await call(h.url, 'GET', '/api/account/recovery', undefined, cookie);
    assert.equal(info.status, 200);
    assert.equal(info.json.questions.length, TEST_RECOVERY_ANSWERS.length);
    const serialized = JSON.stringify(info.json);
    for (const { answer } of TEST_RECOVERY_ANSWERS) {
      assert.ok(!serialized.includes(answer), 'an answer must never be returned by any API');
    }
    for (const key of ['answerHash', 'answerSalt', 'answer']) {
      assert.ok(!serialized.includes(key), `the API must never expose "${key}"`);
    }

    // The durable file stores hashes, not the answers.
    const raw = await readFile(join(h.dir, 'accounts.json'), 'utf8');
    for (const { answer } of TEST_RECOVERY_ANSWERS) {
      assert.ok(!raw.includes(answer), 'a recovery answer must never be stored in plaintext');
    }
    assert.ok(raw.includes('answerHash'), 'the stored form must be a hash');
    // A real scrypt hash, not the answer.
    const stored = JSON.parse(raw) as { accounts: Array<{ username: string; recoveryQuestions?: Array<{ answerHash: string; answerSalt: string }> }> };
    const rec = stored.accounts.find((a) => a.username === 'secure_user');
    assert.ok(rec?.recoveryQuestions?.length === 2);
    for (const q of rec?.recoveryQuestions ?? []) {
      assert.ok(q.answerHash.length === 128, 'the answer must be a 64-byte scrypt hash');
      assert.ok(q.answerSalt.length === 32, 'each answer must have its own salt');
    }
  } finally {
    await h.close();
  }
});

test('recovery setup rejects invalid question sets and the catalog is served', async () => {
  const h = await harness();
  try {
    const catalog = await call(h.url, 'GET', '/api/auth/recovery-questions');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json.questions.length, RECOVERY_QUESTION_CATALOG.length);

    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'validate_user',
      password: 'validate-password-1',
    });
    const cookie = created.cookie!;

    // No answers at all.
    const empty = await call(h.url, 'POST', '/api/account/recovery', { answers: [] }, cookie);
    assert.equal(empty.status, 403);
    // A question that is not in the catalog.
    const unknown = await call(
      h.url,
      'POST',
      '/api/account/recovery',
      { answers: [{ questionId: 'not_a_real_question', answer: 'whatever' }] },
      cookie,
    );
    assert.equal(unknown.status, 403);
    // The same question twice.
    const dupe = await call(
      h.url,
      'POST',
      '/api/account/recovery',
      { answers: [{ questionId: 'first_school', answer: 'A' }, { questionId: 'first_school', answer: 'B' }] },
      cookie,
    );
    assert.equal(dupe.status, 403);
    // An answer that is too short.
    const short = await call(
      h.url,
      'POST',
      '/api/account/recovery',
      { answers: [{ questionId: 'first_school', answer: 'a' }] },
      cookie,
    );
    assert.equal(short.status, 403);
    // Still gated: nothing was accepted.
    assert.equal((await call(h.url, 'GET', '/api/system/foundation', undefined, cookie)).status, 403);
  } finally {
    await h.close();
  }
});

// â”€â”€ 4. Ordinary login requires the authenticator, never the recovery answer â”€â”€

test('ordinary login is password then 6-digit code, and the recovery answer is never accepted for it', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'login_user',
      password: 'login-password-1',
    });
    const cookie = created.cookie!;
    const secret = await finishSetup(h.url, cookie);

    // A wrong password gets nothing.
    const badPassword = await call(h.url, 'POST', '/api/auth/login', {
      username: 'login_user',
      password: 'wrong-password',
    });
    assert.equal(badPassword.status, 401);

    // A correct password yields a CHALLENGE, not a session.
    const step1 = await call(h.url, 'POST', '/api/auth/login', {
      username: 'login_user',
      password: 'login-password-1',
    });
    assert.equal(step1.status, 200);
    assert.equal(step1.json.requiresAuthenticator, true);
    assert.equal(step1.json.account, undefined, 'no account is issued before the code is verified');

    // The recovery ANSWER must not work as a login code.
    const wrongCode = await call(
      h.url,
      'POST',
      '/api/auth/login/verify',
      { challengeId: step1.json.challengeId, code: TEST_RECOVERY_ANSWERS[0]!.answer },
      step1.cookie,
    );
    assert.notEqual(wrongCode.status, 200, 'a recovery answer must never substitute for the authenticator');

    // A correct 6-digit code completes the sign-in.
    const cookie2 = await fullLogin(h.url, 'login_user', 'login-password-1', secret);
    const me = await call(h.url, 'GET', '/api/me', undefined, cookie2);
    assert.equal(me.status, 200);
    assert.equal(me.json.account.username, 'login_user');
    assert.equal(me.json.account.setupComplete, true);
  } finally {
    await h.close();
  }
});

// â”€â”€ 5. Forgot password via recovery questions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('FORGOT PASSWORD: username then recovery answers then a new password, and a wrong answer is refused', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'forgot_user',
      password: 'forgot-password-1',
    });
    const secret = await finishSetup(h.url, created.cookie!);

    // Step 1: identify the account. The exact questions come back with the challenge.
    const step1 = await call(h.url, 'POST', '/api/auth/forgot', { username: 'forgot_user' });
    assert.equal(step1.status, 200);
    assert.equal(step1.json.mode, 'recovery-questions');
    assert.equal(step1.json.questions.length, TEST_RECOVERY_ANSWERS.length);
    const challengeId = step1.json.challengeId as string;

    // A wrong answer is refused and issues no reset token.
    const wrong = await call(
      h.url,
      'POST',
      '/api/auth/forgot/answer',
      { challengeId, answers: TEST_RECOVERY_ANSWERS.map((a) => ({ ...a, answer: 'totally wrong' })) },
    );
    assert.equal(wrong.status, 403, 'a wrong recovery answer must be refused');
    assert.equal(wrong.json.resetToken, undefined, 'no reset token may be issued on a wrong answer');

    // The correct answers issue a one-time reset token.
    const answered = await call(h.url, 'POST', '/api/auth/forgot/answer', {
      challengeId,
      answers: TEST_RECOVERY_ANSWERS,
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    assert.ok(typeof answered.json.resetToken === 'string' && answered.json.resetToken.length > 0);

    // Set the new password.
    const reset = await call(h.url, 'POST', '/api/auth/reset', {
      token: answered.json.resetToken,
      password: 'brand-new-password-9',
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));

    // The old password is gone, the new one works, and the authenticator is still required.
    const oldPassword = await call(h.url, 'POST', '/api/auth/login', {
      username: 'forgot_user',
      password: 'forgot-password-1',
    });
    assert.equal(oldPassword.status, 401);
    const cookie2 = await fullLogin(h.url, 'forgot_user', 'brand-new-password-9', secret);
    assert.equal((await call(h.url, 'GET', '/api/me', undefined, cookie2)).status, 200);

    // The challenge is single-use.
    const replay = await call(h.url, 'POST', '/api/auth/forgot/answer', {
      challengeId,
      answers: TEST_RECOVERY_ANSWERS,
    });
    assert.notEqual(replay.status, 200, 'a recovery challenge must be single-use');
  } finally {
    await h.close();
  }
});

// â”€â”€ 6. Change password requires recovery answers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('CHANGE PASSWORD requires the recovery answers, and a wrong answer changes nothing', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'changepw_user',
      password: 'changepw-password-1',
    });
    const cookie = created.cookie!;
    const secret = await finishSetup(h.url, cookie);

    // No recovery answers at all: refused.
    const noAnswers = await call(
      h.url,
      'POST',
      '/api/account/password',
      { newPassword: 'attempted-password-9' },
      cookie,
    );
    assert.equal(noAnswers.status, 400, 'a password change without recovery answers must be refused');

    // Wrong recovery answers: refused.
    const wrong = await call(
      h.url,
      'POST',
      '/api/account/password',
      {
        newPassword: 'attempted-password-9',
        recoveryAnswers: TEST_RECOVERY_ANSWERS.map((a) => ({ ...a, answer: 'nope' })),
      },
      cookie,
    );
    assert.equal(wrong.status, 403);

    // The password was NOT changed.
    const stillOld = await call(h.url, 'POST', '/api/auth/login', {
      username: 'changepw_user',
      password: 'changepw-password-1',
    });
    assert.equal(stillOld.status, 200);

    // Correct recovery answers: the change goes through.
    const ok = await call(
      h.url,
      'POST',
      '/api/account/password',
      { newPassword: 'changed-password-77', recoveryAnswers: TEST_RECOVERY_ANSWERS },
      cookie,
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.json));

    // A password change revokes other sessions, so log in again with the new one.
    const cookie2 = await fullLogin(h.url, 'changepw_user', 'changed-password-77', secret);
    assert.equal((await call(h.url, 'GET', '/api/me', undefined, cookie2)).status, 200);
  } finally {
    await h.close();
  }
});

// â”€â”€ 7. Change authenticator requires recovery answers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('CHANGE AUTHENTICATOR requires recovery answers, then a new verified 6-digit code', async () => {
  const h = await harness();
  try {
    const created = await call(h.url, 'POST', '/api/user/signup', {
      username: 'changeauth_user',
      password: 'changeauth-password-1',
    });
    const cookie = created.cookie!;
    const originalSecret = await finishSetup(h.url, cookie);

    // No recovery answers: refused.
    const noAnswers = await call(h.url, 'POST', '/api/account/authenticator/setup', {}, cookie);
    assert.equal(noAnswers.status, 403, 'changing an authenticator must require the recovery answers');

    // Wrong recovery answers: refused.
    const wrong = await call(
      h.url,
      'POST',
      '/api/account/authenticator/setup',
      { recoveryAnswers: TEST_RECOVERY_ANSWERS.map((a) => ({ ...a, answer: 'wrong' })) },
      cookie,
    );
    assert.equal(wrong.status, 403);

    // Correct recovery answers start a new enrollment.
    const started = await call(
      h.url,
      'POST',
      '/api/account/authenticator/setup',
      { recoveryAnswers: TEST_RECOVERY_ANSWERS },
      cookie,
    );
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const newSecret = started.json.secret as string;
    assert.notEqual(newSecret, originalSecret, 'a new secret must be issued');

    // A wrong 6-digit code does not make it active.
    const badCode = await call(h.url, 'POST', '/api/account/authenticator/enable', { code: '000000' }, cookie);
    assert.equal(badCode.status, 400);

    // The new code works and becomes the active authenticator.
    const good = await call(
      h.url,
      'POST',
      '/api/account/authenticator/enable',
      { code: totpNow(newSecret) },
      cookie,
    );
    assert.equal(good.status, 200, JSON.stringify(good.json));

    // Future logins use the NEW authenticator, not the old one.
    const step1 = await call(h.url, 'POST', '/api/auth/login', {
      username: 'changeauth_user',
      password: 'changeauth-password-1',
    });
    const withOld = await call(
      h.url,
      'POST',
      '/api/auth/login/verify',
      { challengeId: step1.json.challengeId, code: totpNow(originalSecret) },
      step1.cookie,
    );
    assert.notEqual(withOld.status, 200, 'the replaced authenticator must stop working');
    const cookie2 = await fullLogin(h.url, 'changeauth_user', 'changeauth-password-1', newSecret);
    assert.equal((await call(h.url, 'GET', '/api/me', undefined, cookie2)).status, 200);
  } finally {
    await h.close();
  }
});

// â”€â”€ 8. The complete owner flow, end to end â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('FIRST-TIME OWNER: create, recovery questions, authenticator, verified code, then the owner dashboard', async () => {
  const h = await harness();
  try {
    // A fresh platform offers first-time owner setup.
    const status = await call(h.url, 'GET', '/api/auth/owner-exists');
    assert.equal(status.status, 200);
    assert.equal(status.json.ownerExists, false, 'a fresh platform has no owner yet');

    const created = await call(h.url, 'POST', '/api/owner/signup', {
      username: 'founder_owner',
      password: 'founder-password-1',
      displayName: 'Founder',
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.account.role, 'admin');
    assert.equal(created.json.nextStage, 'recovery');
    const cookie = created.cookie!;

    // Blocked from the product until setup is complete.
    assert.equal((await call(h.url, 'GET', '/api/system/foundation', undefined, cookie)).status, 403);
    // The owner area is not reachable yet either.
    assert.equal((await call(h.url, 'GET', '/api/owner/daytona', undefined, cookie)).status, 403);

    // Step 1: recovery questions.
    const recovery = await call(h.url, 'POST', '/api/account/recovery', { answers: TEST_RECOVERY_ANSWERS }, cookie);
    assert.equal(recovery.status, 200);
    assert.equal(recovery.json.nextStage, 'authenticator');

    // Step 2: authenticator, then a verified 6-digit code.
    const setupRes = await call(h.url, 'POST', '/api/account/authenticator/setup', {}, cookie);
    const secret = setupRes.json.secret as string;
    const enabled = await call(h.url, 'POST', '/api/account/authenticator/enable', { code: totpNow(secret) }, cookie);
    assert.equal(enabled.status, 200, JSON.stringify(enabled.json));

    // The owner now reaches both the product and the owner-only area.
    assert.equal((await call(h.url, 'GET', '/api/system/foundation', undefined, cookie)).status, 200);
    const ownerArea = await call(h.url, 'GET', '/api/owner/daytona', undefined, cookie);
    assert.equal(ownerArea.status, 200, 'the owner must reach the owner-only area after setup');
    assert.equal(ownerArea.json.daytona.status, 'unconfigured');

    // Subsequent owner login: password then code.
    const cookie2 = await fullLogin(h.url, 'founder_owner', 'founder-password-1', secret);
    assert.equal((await call(h.url, 'GET', '/api/owner/daytona', undefined, cookie2)).status, 200);

    // The owner entry point now reports that setup is done.
    assert.equal((await call(h.url, 'GET', '/api/auth/owner-exists')).json.ownerExists, true);
  } finally {
    await h.close();
  }
});

test('FIRST-TIME USER: a user created on the user entry point can never reach owner functionality', async () => {
  const h = await harness();
  try {
    await call(h.url, 'POST', '/api/owner/signup', { username: 'the_owner', password: 'owner-password-1' });
    const user = await call(h.url, 'POST', '/api/user/signup', {
      username: 'the_user',
      password: 'user-password-1',
    });
    assert.equal(user.status, 201);
    const cookie = user.cookie!;
    const secret = await finishSetup(h.url, cookie);

    // The user is fully set up and can use the product.
    assert.equal((await call(h.url, 'GET', '/api/system/foundation', undefined, cookie)).status, 200);
    // But owner functionality is refused for GET, PUT and DELETE.
    assert.equal((await call(h.url, 'GET', '/api/owner/daytona', undefined, cookie)).status, 403);
    assert.equal(
      (await call(h.url, 'PUT', '/api/owner/daytona', { apiKey: 'x' }, cookie)).status,
      403,
    );
    assert.equal((await call(h.url, 'DELETE', '/api/owner/daytona', undefined, cookie)).status, 403);
    // And it stays refused after a fresh login.
    const cookie2 = await fullLogin(h.url, 'the_user', 'user-password-1', secret);
    assert.equal((await call(h.url, 'GET', '/api/owner/daytona', undefined, cookie2)).status, 403);
  } finally {
    await h.close();
  }
});

