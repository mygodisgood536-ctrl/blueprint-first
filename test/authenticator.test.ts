/**
 * TOTP authenticator + recovery tests (RFC 6238 vector + registry lifecycle).
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountRegistry, AuthenticatorError, RECOVERY_CODE_COUNT } from '../src/account/accounts.ts';
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

async function enabledAccount(reg: AccountRegistry): Promise<{ accountId: string; secret: string }> {
  const view = reg.createAccount({ username: 'ada', password: 'correct horse battery' });
  const { secret } = reg.setupAuthenticator(view.id);
  reg.enableAuthenticator(view.id, totpNow(secret)!);
  return { accountId: view.id, secret };
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

  it('refuses a second enrollment while enabled', async () => {
    const reg = newRegistry();
    const { accountId } = await enabledAccount(reg);
    assert.throws(() => reg.setupAuthenticator(accountId), AuthenticatorError);
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

describe('authenticator recovery', () => {
  it('recovers with a TOTP code: password changes, old sessions die, new password logs in', async () => {
    const reg = newRegistry();
    const { secret } = await enabledAccount(reg);
    const oldSession = reg.authenticate('ada', 'correct horse battery');
    const challenge = reg.beginRecoveryChallenge('ada');
    assert.notEqual(challenge, null);
    const view = reg.completeRecovery(challenge!.challengeId, totpNow(secret)!, 'new secure password 42');
    assert.equal(view.username, 'ada');
    assert.throws(() => reg.verifySession(oldSession.token));
    reg.authenticate('ada', 'new secure password 42');
    assert.throws(() => reg.authenticate('ada', 'correct horse battery'));
  });

  it('recovers with a recovery code; codes are single-use', async () => {
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

  it('completeRecovery fails closed: bad code leaves the password unchanged', async () => {
    const reg = newRegistry();
    const { secret } = await enabledAccount(reg);
    void secret;
    const challenge = reg.beginRecoveryChallenge('ada');
    assert.throws(() => reg.completeRecovery(challenge!.challengeId, '000000', 'whatever password 9'));
    reg.authenticate('ada', 'correct horse battery');
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