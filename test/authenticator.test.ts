/**
 * TOTP authenticator + recovery tests (RFC 6238 vector + registry lifecycle).
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AccountRegistry,
  AuthenticationError,
  AuthenticatorChallengeRequiredError,
  AuthenticatorError,
  LOGIN_CHALLENGE_MAX_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  RecoveryError,
} from '../src/account/accounts.ts';
import { base32Decode, base32Encode, otpauthUrl, totpNow, verifyTotp } from '../src/account/totp.ts';
import { DurableAccountRegistry } from '../src/account/durable-registry.ts';

describe('totp', () => {
  it('base32 round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 77, 200]);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  });

  it('matches the RFC 6238 SHA-1 test vector (t=59s -> 287082, 6 digits)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    assert.equal(totpNow(secret, 59_000), '287082');
    assert.equal(verifyTotp(secret, '287082', 59_000), true);
  });

  it('accepts the +-1 step window and rejects other codes', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    assert.equal(verifyTotp(secret, '287082', 89_000), true);
    assert.equal(verifyTotp(secret, '287082', 29_000), true);
    assert.equal(verifyTotp(secret, '000000', 59_000), false);
    assert.equal(verifyTotp(secret, '28708', 59_000), false);
    assert.equal(verifyTotp('!!not-base32!!', '287082', 59_000), false);
  });

  it('builds a provisioning URI for authenticator apps', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'ada', 'NEXORA');
    assert.match(url, /^otpauth:\/\/totp\/NEXORA:ada\?/);
    assert.match(url, /secret=JBSWY3DPEHPK3PXP/);
    assert.match(url, /issuer=NEXORA/);
  });
});

function newRegistry(): AccountRegistry {
  return new AccountRegistry({ sessionTtlMs: 60 * 60 * 1000 });
}

function enabledAccount(reg: AccountRegistry): { accountId: string; secret: string } {
  const view = reg.createAccount({ username: 'ada', password: 'correct horse battery' });
  const { secret } = reg.setupAuthenticator(view.id);
  reg.enableAuthenticator(view.id, totpNow(secret)!);
  return { accountId: view.id, secret };
}

/** Runs a password login and returns the challenge thrown for TOTP accounts. */
function challengeFor(reg: AccountRegistry, username: string, password: string): AuthenticatorChallengeRequiredError {
  try {
    reg.authenticate(username, password);
  } catch (error) {
    if (error instanceof AuthenticatorChallengeRequiredError) return error;
    throw error;
  }
  throw new Error(`expected an authenticator challenge for "${username}"`);
}

describe('authenticator lifecycle', () => {
  it('setup -> enable issues one-time recovery codes and flips status', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'ada', password: 'correct horse battery' });
    const { secret, otpauth } = reg.setupAuthenticator(view.id);
    assert.match(otpauth, /^otpauth:\/\/totp\/NEXORA:ada\?secret=/);
    assert.equal(reg.hasAuthenticatorEnabled(view.id), false);
    const { recoveryCodes } = reg.enableAuthenticator(view.id, totpNow(secret)!);
    assert.equal(recoveryCodes.length, RECOVERY_CODE_COUNT);
    assert.equal(reg.hasAuthenticatorEnabled(view.id), true);
    assert.equal(reg.remainingRecoveryCodes(view.id), RECOVERY_CODE_COUNT);
  });

  it('rejects enabling with a wrong code', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'ada', password: 'correct horse battery' });
    reg.setupAuthenticator(view.id);
    assert.throws(() => reg.enableAuthenticator(view.id, '000000'), AuthenticatorError);
    assert.equal(reg.hasAuthenticatorEnabled(view.id), false);
  });

  it('refuses a second enrollment while enabled, and requires the recovery answers to replace it', async () => {
    const reg = new AccountRegistry();
    const { accountId } = await enabledAccount(reg);
    // Replacing an ACTIVE authenticator is a sensitive change, so the direct
    // path is refused: the caller must go through setupAuthenticatorWithRecovery
    // with the account's recovery answers.
    assert.throws(() => reg.setupAuthenticator(accountId), RecoveryError);
    // Even then, without the correct recovery answers nothing changes.
    assert.throws(
      () => reg.setupAuthenticatorWithRecovery(accountId, [{ questionId: 'first_school', answer: 'wrong' }]),
      RecoveryError,
    );
  });

  it('disable requires a valid current code', async () => {
    const reg = newRegistry();
    const { accountId, secret } = await enabledAccount(reg);
    assert.throws(() => reg.disableAuthenticator(accountId, '000000'), AuthenticatorError);
    reg.disableAuthenticator(accountId, totpNow(secret)!);
    assert.equal(reg.hasAuthenticatorEnabled(accountId), false);
    assert.equal(reg.remainingRecoveryCodes(accountId), 0);
  });

  it('verifyPassword works without creating a session', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'grace', password: 'electromagnetism' });
    assert.equal(reg.verifyPassword(view.id, 'electromagnetism'), true);
    assert.equal(reg.verifyPassword(view.id, 'wrong'), false);
    assert.equal(reg.listSessions(view.id).length, 0);
  });

  it('records security events for the authenticator lifecycle', async () => {
    const reg = newRegistry();
    const { accountId } = await enabledAccount(reg);
    const kinds = reg.securityEventsOf(accountId).map((e) => e.kind);
    assert.ok(kinds.includes('authenticator.setup_started'));
    assert.ok(kinds.includes('authenticator.enabled'));
  });
});

describe('two-step sign-in (password + authenticator)', () => {
  it('issues NO session on password alone; a valid TOTP completes sign-in', () => {
    const reg = newRegistry();
    const { accountId, secret } = enabledAccount(reg);
    const challenge = challengeFor(reg, 'ada', 'correct horse battery');
    assert.match(challenge.challengeId, /^[0-9a-f]{48}$/);
    assert.equal(reg.listSessions(accountId).length, 0);

    assert.throws(() => reg.completeLoginChallenge(challenge.challengeId, '000000'), AuthenticatorError);
    assert.equal(reg.listSessions(accountId).length, 0);

    const session = reg.completeLoginChallenge(challenge.challengeId, totpNow(secret)!);
    assert.ok(session.token.length >= 32);
    assert.equal(reg.listSessions(accountId).length, 1);

    // the challenge is single-use
    assert.throws(() => reg.completeLoginChallenge(challenge.challengeId, totpNow(secret)!), AuthenticationError);
  });

  it('accepts a recovery code for sign-in and honors single-use', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'bob', password: 'initial password 1' });
    const secret = reg.setupAuthenticator(view.id).secret;
    const { recoveryCodes } = reg.enableAuthenticator(view.id, totpNow(secret)!);

    const first = reg.completeLoginChallenge(challengeFor(reg, 'bob', 'initial password 1').challengeId, recoveryCodes[0]!);
    assert.ok(first.token.length >= 32);
    assert.equal(reg.remainingRecoveryCodes(view.id), RECOVERY_CODE_COUNT - 1);

    const second = challengeFor(reg, 'bob', 'initial password 1');
    assert.throws(
      () => reg.completeLoginChallenge(second.challengeId, recoveryCodes[0]!),
      AuthenticatorError,
    );
  });

  it('destroys the challenge after repeated bad codes', () => {
    const reg = newRegistry();
    enabledAccount(reg);
    const challenge = challengeFor(reg, 'ada', 'correct horse battery');
    for (let i = 0; i < LOGIN_CHALLENGE_MAX_ATTEMPTS - 1; i++) {
      assert.throws(() => reg.completeLoginChallenge(challenge.challengeId, '000000'), AuthenticatorError);
    }
    assert.throws(() => reg.completeLoginChallenge(challenge.challengeId, '000000'), AuthenticationError);
    assert.throws(() => reg.completeLoginChallenge(challenge.challengeId, '000000'), AuthenticationError);
  });

  it('accounts without an authenticator still sign in directly', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'plain', password: 'no authenticator 1' });
    const session = reg.authenticate('plain', 'no authenticator 1');
    assert.ok(session.token.length >= 32);
    assert.equal(reg.listSessions(view.id).length, 1);
  });
});

describe('authenticator recovery', () => {
  it('recovers with a TOTP code: password changes, old sessions die, new password still needs the code', () => {
    const reg = newRegistry();
    const { secret } = enabledAccount(reg);
    const oldChallenged = challengeFor(reg, 'ada', 'correct horse battery');
    const oldSession = reg.completeLoginChallenge(oldChallenged.challengeId, totpNow(secret)!);
    const challenge = reg.beginRecoveryChallenge('ada');
    assert.notEqual(challenge, null);
    const view = reg.completeRecovery(challenge!.challengeId, totpNow(secret)!, 'new secure password 42');
    assert.equal(view.username, 'ada');
    assert.throws(() => reg.verifySession(oldSession.token));
    assert.throws(() => reg.authenticate('ada', 'correct horse battery'), AuthenticationError);
    const fresh = reg.completeLoginChallenge(
      challengeFor(reg, 'ada', 'new secure password 42').challengeId,
      totpNow(secret)!,
    );
    assert.ok(fresh.token.length >= 32);
  });

  it('recovers with a recovery code; codes are single-use', () => {
    const reg = newRegistry();
    const view = reg.createAccount({ username: 'bob', password: 'initial password 1' });
    const secret = reg.setupAuthenticator(view.id).secret;
    const { recoveryCodes } = reg.enableAuthenticator(view.id, totpNow(secret)!);
    const challenge = reg.beginRecoveryChallenge('bob');
    const first = reg.completeRecovery(challenge!.challengeId, recoveryCodes[0]!, 'brand new password 7');
    assert.equal(first.username, 'bob');
    const challenge2 = reg.beginRecoveryChallenge('bob');
    assert.throws(
      () => reg2Complete(reg, challenge2!.challengeId, recoveryCodes[0]!),
      AuthenticatorError,
    );
    assert.equal(reg.remainingRecoveryCodes(view.id), RECOVERY_CODE_COUNT - 1);
    function reg2Complete(r: AccountRegistry, id: string, code: string): unknown {
      return r.completeRecovery(id, code, 'another password 8');
    }
  });

  it('beginRecoveryChallenge returns null for unknown users and unprotected accounts', () => {
    const reg = newRegistry();
    assert.equal(reg.beginRecoveryChallenge('nobody'), null);
    reg.createAccount({ username: 'plain', password: 'no authenticator 1' });
    assert.equal(reg.beginRecoveryChallenge('plain'), null);
  });

  it('completeRecovery fails closed: bad code leaves the password unchanged', () => {
    const reg = newRegistry();
    const { secret } = enabledAccount(reg);
    const challenge = reg.beginRecoveryChallenge('ada');
    assert.throws(() => reg.completeRecovery(challenge!.challengeId, '000000', 'whatever password 9'));
    // unchanged password still requires the authenticator and still works with it
    const login = reg.completeLoginChallenge(
      challengeFor(reg, 'ada', 'correct horse battery').challengeId,
      totpNow(secret)!,
    );
    assert.ok(login.token.length >= 32);
  });
});

describe('durable authenticator persistence', () => {
  const dir = join(tmpdir(), `nexora-auth-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const file = join(dir, 'accounts.json');

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('authenticator state, recovery codes, and events survive a restart', async () => {
    const reg1 = await DurableAccountRegistry.load(file, 60 * 60 * 1000);
    const view = await reg1.createAccount({ username: 'ada', password: 'durable password 1' });
    const { secret } = await reg1.setupAuthenticator(view.id);
    const { recoveryCodes } = await reg1.enableAuthenticator(view.id, totpNow(secret)!);
    await reg1.recordSecurityEvent(view.id, 'test.event');

    const reg2 = await DurableAccountRegistry.load(file, 60 * 60 * 1000);
    assert.equal(reg2.hasAuthenticatorEnabled(view.id), true);
    assert.equal(reg2.remainingRecoveryCodes(view.id), RECOVERY_CODE_COUNT);
    assert.ok(reg2.securityEventsOf(view.id).some((e) => e.kind === 'test.event'));
    const challenge = await reg2.beginRecoveryChallenge('ada');
    const recovered = await reg2.completeRecovery(challenge!.challengeId, recoveryCodes[0]!, 'post restart pw 3');
    assert.equal(recovered.username, 'ada');
  });
});

describe('durable two-step sign-in persistence', () => {
  const dir = join(tmpdir(), `nexora-loginchallenge-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const file = join(dir, 'accounts.json');

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('completing sign-in after restart uses the persisted challenge', async () => {
    const reg1 = await DurableAccountRegistry.load(file, 60 * 60 * 1000);
    const view = await reg1.createAccount({ username: 'ryu', password: 'shoryuken 42' });
    const { secret } = await reg1.setupAuthenticator(view.id);
    await reg1.enableAuthenticator(view.id, totpNow(secret)!);
    const challengeError = await challengeForAsync(reg1, 'ryu', 'shoryuken 42');

    const reg2 = await DurableAccountRegistry.load(file, 60 * 60 * 1000);
    const session = await reg2.completeLoginChallenge(challengeError.challengeId, totpNow(secret)!);
    assert.ok(session.token.length >= 32);

    async function challengeForAsync(
      r: DurableAccountRegistry,
      username: string,
      password: string,
    ): Promise<AuthenticatorChallengeRequiredError> {
      try {
        await r.authenticate(username, password);
      } catch (error) {
        if (error instanceof AuthenticatorChallengeRequiredError) return error;
        throw error;
      }
      throw new Error(`expected an authenticator challenge for "${username}"`);
    }
  });
});
