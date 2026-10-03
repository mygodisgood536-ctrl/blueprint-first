/**
 * Phase 2 (part 1) — the DURABLE layer for the replacement identity model.
 *
 * Proves the persistence-layer guarantees the cutover depends on: accounts and
 * sessions survive a restart, uniqueness is re-asserted from the stored file
 * itself (not only by the writer), the privileged bootstrap is idempotent
 * across boots and reads its answer from the environment, and no plaintext
 * answer ever reaches disk.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableIdentityRegistry, reassertUniqueness } from '../src/account/durable-identity.ts';
import {
  IdentityRegistry,
  SECURITY_QUESTIONS,
  hashSecurityAnswer,
  normalizeGmail,
  normalizeUsername,
} from '../src/account/identity.ts';

const Q = SECURITY_QUESTIONS[0]!;
const ENV = { BF_BOOTSTRAP_SECURITY_ANSWER: 'Ore' } as NodeJS.ProcessEnv;

async function storePath(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'bf-ident-'));
  return join(dir, 'identity.json');
}

describe('durable identity — restart survival', () => {
  it('accounts and sessions survive a restart', async () => {
    const file = await storePath();
    const first = await DurableIdentityRegistry.load(file, 60_000_000);
    await first.createAccount({
      fullName: 'Ada Lovelace', username: 'ada', gmail: 'ada@gmail.com',
      securityQuestion: Q, securityAnswer: 'analytical',
    });
    const { session } = await first.signIn('ada@gmail.com', Q, 'analytical');

    const reopened = await DurableIdentityRegistry.load(file, 60_000_000);
    assert.equal(reopened.count(), 1);
    assert.equal(reopened.byGmail('ada@gmail.com')?.username, 'ada');
    assert.notEqual(reopened.accountForToken(session.token), null, 'the session must survive');

    // Logging out really invalidates it, across the restart boundary too.
    assert.equal(await reopened.logout(session.token), true);
    assert.equal(reopened.accountForToken(session.token), null);
  });

  it('never writes the security answer to disk', async () => {
    const file = await storePath();
    const r = await DurableIdentityRegistry.load(file, 60_000_000);
    await r.createAccount({
      fullName: 'Ada Lovelace', username: 'ada', gmail: 'ada@gmail.com',
      securityQuestion: Q, securityAnswer: 'analytical',
    });
    const raw = await fs.readFile(file, 'utf8');
    assert.ok(raw.includes('scrypt$'), 'the hash is what is persisted');
    assert.equal(raw.includes('analytical'), false, 'the plaintext answer must never be written');
  });
});

describe('durable identity — uniqueness at the persistence layer', () => {
  it('re-asserts uniqueness from the stored records, dropping duplicates', async () => {
    const file = await storePath();
    const r = await DurableIdentityRegistry.load(file, 60_000_000);
    await r.createAccount({
      fullName: 'First', username: 'first', gmail: 'dup@gmail.com',
      securityQuestion: Q, securityAnswer: 'x1',
    });

    // Hand-corrupt the store the way a bad migration or merge could.
    const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
    envelope.value.records.push({
      id: 'ACC-999999',
      fullName: 'Second',
      username: 'second',
      usernameDisplay: 'second',
      gmail: 'DUP@Gmail.com', // same Gmail, different case
      securityQuestion: Q,
      securityAnswerHash: hashSecurityAnswer('x2'),
      role: 'member',
      createdAt: new Date().toISOString(),
    });
    await fs.writeFile(file, JSON.stringify(envelope), 'utf8');

    const reopened = await DurableIdentityRegistry.load(file, 60_000_000);
    assert.equal(reopened.count(), 1, 'the duplicate must be dropped on load');
    assert.equal(reopened.byGmail('dup@gmail.com')?.username, 'first', 'the earliest record wins');
  });

  it('reassertUniqueness is deterministic and case-insensitive on both keys', () => {
    const r = new IdentityRegistry(1000);
    r.createAccount({
      fullName: 'A B', username: 'abc', gmail: 'x@gmail.com',
      securityQuestion: Q, securityAnswer: 'aa',
    });
    const state = r.exportState();
    const dup = {
      ...state.records[0]!, id: 'ACC-DUP',
      username: 'other', usernameDisplay: 'other', gmail: 'X@GMAIL.COM',
    };
    r.restoreState({ ...state, records: [...state.records, dup] });
    assert.equal(r.count(), 2);
    reassertUniqueness(r);
    assert.equal(r.count(), 1);
    assert.equal(normalizeGmail('X@GMAIL.COM'), normalizeGmail('x@gmail.com'));
    assert.equal(normalizeUsername('ABC'), normalizeUsername('abc'));
  });
});

describe('durable identity — privileged bootstrap', () => {
  it('provisions once and stays idempotent across restarts', async () => {
    const file = await storePath();
    const first = await DurableIdentityRegistry.load(file, 60_000_000);
    const a = await first.ensurePrivilegedAccount(ENV);
    assert.notEqual(a, null);
    assert.equal(first.isAdministrator(a!.id), true);

    for (let i = 0; i < 2; i++) {
      const again = await DurableIdentityRegistry.load(file, 60_000_000);
      const b = await again.ensurePrivilegedAccount(ENV);
      assert.equal(b?.id, a!.id, 'restarts must reuse the same account');
      assert.equal(again.count(), 1, 'no duplicate may ever be created');
    }
  });

  it('provisions nothing when no bootstrap answer is configured', async () => {
    const file = await storePath();
    const r = await DurableIdentityRegistry.load(file, 60_000_000);
    assert.equal(await r.ensurePrivilegedAccount({} as NodeJS.ProcessEnv), null);
    assert.equal(r.count(), 0);
  });

  it('the privileged Gmail and username cannot be claimed by another account', async () => {
    const file = await storePath();
    const r = await DurableIdentityRegistry.load(file, 60_000_000);
    const priv = await r.ensurePrivilegedAccount(ENV);
    assert.notEqual(priv, null);
    await assert.rejects(
      r.createAccount({
        fullName: 'Impostor', username: 'other',
        gmail: 'corneliusadedejivictor@gmail.com',
        securityQuestion: Q, securityAnswer: 'impostor1',
      }),
      /already associated/,
    );
    await assert.rejects(
      r.createAccount({
        fullName: 'Impostor', username: 'oluwasegun',
        gmail: 'other@gmail.com', securityQuestion: Q, securityAnswer: 'impostor2',
      }),
      /already taken/,
    );
  });
});