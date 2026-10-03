/**
 * PHASE 1 GATE — the replacement authentication model.
 *
 * Covers the Phase 1 checklist: field validation, Gmail/username uniqueness
 * enforced in the BACKEND, security-answer hashing, sign-in via Gmail +
 * security question + answer, identical failure handling, session lifecycle,
 * server-side authorization, and the privileged bootstrap.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError,
  IdentityRegistry,
  SECURITY_QUESTIONS,
  SignInError,
  ValidationError,
  ensurePrivilegedAccount,
  hashSecurityAnswer,
  readBootstrapConfig,
  validateFullName,
  validateGmail,
  validateSecurityAnswer,
  validateSecurityQuestion,
  validateUsername,
  verifySecurityAnswer,
} from '../src/account/identity.ts';

const Q = SECURITY_QUESTIONS[0]!;

function reg(): IdentityRegistry {
  return new IdentityRegistry(60 * 60 * 1000);
}

function signup(r: IdentityRegistry, over: Partial<Record<string, string>> = {}) {
  return r.createAccount({
    fullName: over.fullName ?? 'Ada Lovelace',
    username: over.username ?? 'ada',
    gmail: over.gmail ?? 'ada@gmail.com',
    securityQuestion: over.securityQuestion ?? Q,
    securityAnswer: over.securityAnswer ?? 'ore',
  });
}

describe('Phase 1 — field validation', () => {
  it('rejects invalid full names and keeps valid ones', () => {
    assert.throws(() => validateFullName('A'), ValidationError);
    assert.throws(() => validateFullName('123'), ValidationError);
    assert.equal(validateFullName('  Cornelius   Adedeji Victor '), 'Cornelius Adedeji Victor');
  });

  it('rejects invalid usernames and normalises valid ones', () => {
    assert.throws(() => validateUsername('ab'), ValidationError);
    assert.throws(() => validateUsername('-bad-'), ValidationError);
    assert.throws(() => validateUsername('has space'), ValidationError);
    assert.equal(validateUsername('  Oluwasegun ').normalized, 'oluwasegun');
  });

  it('requires a real Gmail address', () => {
    assert.throws(() => validateGmail('a@yahoo.com'), ValidationError);
    assert.throws(() => validateGmail('not-an-email'), ValidationError);
    assert.equal(validateGmail('  Ada@Gmail.COM '), 'ada@gmail.com');
  });

  it('only accepts a listed security question and a real answer', () => {
    assert.throws(() => validateSecurityQuestion('made up?'), ValidationError);
    assert.throws(() => validateSecurityAnswer('x'), ValidationError);
    assert.equal(validateSecurityQuestion(Q), Q);
  });
});

describe('Phase 1 — uniqueness is enforced in the BACKEND', () => {
  it('rejects a duplicate Gmail (including different casing)', () => {
    const r = reg();
    signup(r);
    assert.throws(() => signup(r, { username: 'other', gmail: 'ADA@GMAIL.COM' }), ConflictError);
    assert.equal(r.count(), 1, 'the duplicate must not create a second account');
  });

  it('rejects a duplicate username', () => {
    const r = reg();
    signup(r);
    assert.throws(() => signup(r, { username: 'ADA', gmail: 'other@gmail.com' }), ConflictError);
    assert.equal(r.count(), 1);
  });
});

describe('Phase 1 — the security answer is never stored in plaintext', () => {
  it('hashes with a salt and verifies only the correct answer', () => {
    const h = hashSecurityAnswer('ore');
    assert.ok(!h.includes('ore'), 'the hash must not contain the answer');
    assert.ok(h.startsWith('scrypt$'));
    assert.equal(verifySecurityAnswer('ore', h), true);
    assert.equal(verifySecurityAnswer('Ore', h), true);
    assert.equal(verifySecurityAnswer('wrong', h), false);
  });

  it('never exposes the answer through any public projection or exported state', () => {
    const r = reg();
    const view = signup(r, { securityAnswer: 'ore' });
    assert.equal(Object.keys(view).includes('securityAnswerHash'), false);
    assert.equal(JSON.stringify(view).includes('ore'), false);
    const state = JSON.stringify(r.exportState());
    assert.ok(state.includes('scrypt$'), 'the durable record stores the hash');
    assert.equal(/"securityAnswer"\s*:/.test(state), false, 'no plaintext answer field exists');
  });
});

describe('Phase 1 — sign-in with Gmail + security question + answer', () => {
  it('authenticates the right credentials and issues a session', () => {
    const r = reg();
    signup(r);
    const { account, session } = r.signIn('ada@gmail.com', Q, 'ore');
    assert.equal(account.gmail, 'ada@gmail.com');
    assert.ok(session.token.length >= 32);
    assert.equal(r.accountForToken(session.token)?.id, account.id);
  });

  it('rejects a wrong answer, a wrong question and an unknown Gmail IDENTICALLY', () => {
    const r = reg();
    signup(r);
    const msgs: string[] = [];
    for (const attempt of [
      () => r.signIn('ada@gmail.com', Q, 'wrong'),
      () => r.signIn('ada@gmail.com', SECURITY_QUESTIONS[1]!, 'ore'),
      () => r.signIn('nobody@gmail.com', Q, 'ore'),
    ]) {
      assert.throws(attempt, SignInError);
      try { attempt(); } catch (e) { msgs.push((e as Error).message); }
    }
    assert.equal(new Set(msgs).size, 1, 'failures must be indistinguishable (no account enumeration)');
  });

  it('logs out and invalidates the session', () => {
    const r = reg();
    signup(r);
    const { session } = r.signIn('ada@gmail.com', Q, 'ore');
    assert.equal(r.logout(session.token), true);
    assert.equal(r.accountForToken(session.token), null);
describe('Phase 1 — privileged account bootstrap', () => {
  const cfg = {
    fullName: 'Cornelius Adedeji Victor',
    username: 'Oluwasegun',
    gmail: 'corneliusadedejivictor@gmail.com',
    securityQuestion: 'What city did my parents meet?',
    securityAnswer: 'Ore',
  };

  it('provisions once and is idempotent across boots', () => {
    const r = reg();
    const first = ensurePrivilegedAccount(r, cfg);
    assert.equal(first.created, true);
    assert.equal(r.count(), 1);
    for (let i = 0; i < 3; i++) {
      const again = ensurePrivilegedAccount(r, cfg);
      assert.equal(again.created, false);
      assert.equal(again.accountId, first.accountId);
    }
    assert.equal(r.count(), 1, 'repeated boots must never create a duplicate');
  });

  it('grants the privileged role and signs in through the same screen', () => {
    const r = reg();
    const { accountId } = ensurePrivilegedAccount(r, cfg);
    assert.equal(r.isAdministrator(accountId), true);
    const { account } = r.signIn(cfg.gmail, cfg.securityQuestion, 'Ore');
    assert.equal(account.id, accountId);
  });

  it('cannot be recreated or claimed through public signup', () => {
    const r = reg();
    ensurePrivilegedAccount(r, cfg);
    assert.throws(
      () => signup(r, { username: 'someone', gmail: cfg.gmail }),
      ConflictError,
      'the Gmail must stay reserved',
    );
    assert.throws(
      () => signup(r, { username: cfg.username, gmail: 'other@gmail.com' }),
      ConflictError,
      'the username must stay reserved',
    );
    assert.equal(r.count(), 1);
  });

  it('reads bootstrap values from the environment and never hard-codes them', () => {
    const cfgFromEnv = readBootstrapConfig({
      BF_BOOTSTRAP_SECURITY_ANSWER: 's3cret',
      BF_BOOTSTRAP_USERNAME: 'envuser',
    } as NodeJS.ProcessEnv);
    assert.equal(cfgFromEnv?.username, 'envuser');
    assert.equal(cfgFromEnv?.securityAnswer, 's3cret');
    // Without an answer there is nothing safe to provision.
    assert.equal(readBootstrapConfig({} as NodeJS.ProcessEnv), null);
  });
});

describe('Phase 1 — NO obsolete authentication mechanism exists', () => {
  it('the account record exposes no password, OTP, TOTP or recovery-code field', () => {
    const r = reg();
    signup(r);
    const serialized = JSON.stringify(r.exportState());
    for (const forbidden of ['passwordHash', 'passwordSalt', 'totpSecret', 'authenticator', 'recoveryCodes']) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must not exist`);
    }
  });

  it('the public surface of the module declares no password/OTP API', async () => {
    const mod = await import('../src/account/identity.ts');
    for (const name of Object.keys(mod)) {
      assert.equal(
        /password|otp|totp|authenticator|recoverycode|magiclink/i.test(name),
        false,
        `module must not export ${name}`,
      );
    }
  });
});
  });
});

describe('Phase 1 — authorization is decided server-side', () => {
  it('a normal account is not an administrator', () => {
    const r = reg();
    const v = signup(r);
    assert.equal(v.role, 'member');
    assert.equal(r.isAdministrator(v.id), false);
  });

  it('an unknown token resolves to nothing', () => {
    assert.equal(reg().accountForToken('not-a-real-token'), null);
  });
});