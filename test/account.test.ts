/**
 * Accounts, authentication, and isolation (expansion §11).
 *
 * The first suite used to drive `AccountRegistry.authenticate(username,
 * password)` — a password credential that the product has deliberately retired.
 * It now drives the active `IdentityRegistry` (Gmail + security question +
 * answer), preserving the three properties that still matter: a correct
 * credential authenticates and issues an opaque session, a wrong credential is
 * refused, and an expired session is refused.
 *
 * The second suite is EXECUTION FOUNDATION, not authentication. It proves
 * `AccountIsolation` confines a developer to their own projects. That is why
 * `src/account/accounts.ts` still exists, and it is left byte-for-byte as it was
 * — it is the last legitimate consumer of the legacy account record.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { makeServices } from './helpers/test-services.ts';
import { AccountRegistry } from '../src/account/accounts.ts';
import { IdentityRegistry } from '../src/account/identity.ts';
import { AccountIsolation, AccessDeniedError } from '../src/account/isolation.ts';
import { ProjectRegistry } from '../src/project/registry.ts';

const QUESTION = 'What city did my parents meet?';

describe('Account & authentication', () => {
  it('registers an account and authenticates with correct credentials', () => {
    const identities = new IdentityRegistry();
    const view = identities.createAccount({
      fullName: 'Alice',
      username: 'alice',
      gmail: 'alice@gmail.com',
      securityQuestion: QUESTION,
      securityAnswer: 'correct horse battery',
    });
    assert.equal(view.username, 'alice');

    const { account, session } = identities.signIn('alice@gmail.com', QUESTION, 'correct horse battery');
    assert.ok(session.token.length >= 32, 'the session token must be long and opaque');
    // The token must not embed the account or any credential in it.
    assert.ok(!session.token.includes('alice'), 'the token must not contain the username');
    assert.equal(account.id, view.id);

    const resolved = identities.accountForToken(session.token);
    assert.equal(resolved?.id, view.id);
  });

  it('rejects a wrong security answer, identically to an unknown account', () => {
    const identities = new IdentityRegistry();
    identities.createAccount({
      fullName: 'Bob', username: 'bob', gmail: 'bob@gmail.com',
      securityQuestion: QUESTION, securityAnswer: 'correct horse battery',
    });

    // Every failure mode is the same error, so the login form cannot be used to
    // discover which Gmail addresses exist.
    const messageOf = (fn: () => unknown): string => {
      try {
        fn();
        throw new Error('expected the call to fail');
      } catch (error) {
        return (error as Error).message;
      }
    };
    const wrongAnswer = messageOf(() => identities.signIn('bob@gmail.com', QUESTION, 'not-the-answer'));
    const wrongQuestion = messageOf(() => identities.signIn('bob@gmail.com', 'What is your name?', 'correct horse battery'));
    const unknownGmail = messageOf(() => identities.signIn('nobody@gmail.com', QUESTION, 'correct horse battery'));
    assert.equal(wrongAnswer, wrongQuestion);
    assert.equal(wrongAnswer, unknownGmail);
  });

  it('never returns the security answer through any public projection', () => {
    const identities = new IdentityRegistry();
    identities.createAccount({
      fullName: 'Carol', username: 'carol', gmail: 'carol@gmail.com',
      securityQuestion: QUESTION, securityAnswer: 'correct horse battery',
    });
    const { session } = identities.signIn('carol@gmail.com', QUESTION, 'correct horse battery');
    const account = identities.accountForToken(session.token);
    assert.ok(account !== null);
    assert.equal((account as unknown as Record<string, unknown>)['securityAnswer'], undefined);
    assert.doesNotMatch(JSON.stringify(identities.exportState()), /correct horse battery/);
  });

  it('refuses an expired session', () => {
    // A negative TTL makes every session expire the instant it is issued.
    const identities = new IdentityRegistry(-1);
    identities.createAccount({
      fullName: 'Dave', username: 'dave', gmail: 'dave@gmail.com',
      securityQuestion: QUESTION, securityAnswer: 'correct horse battery',
    });
    const { session } = identities.signIn('dave@gmail.com', QUESTION, 'correct horse battery');
    assert.equal(identities.accountForToken(session.token), null, 'an expired token resolves to nothing');
  });

  it('refuses an unknown or revoked session token', () => {
    const identities = new IdentityRegistry();
    identities.createAccount({
      fullName: 'Erin', username: 'erin', gmail: 'erin@gmail.com',
      securityQuestion: QUESTION, securityAnswer: 'correct horse battery',
    });
    const { session } = identities.signIn('erin@gmail.com', QUESTION, 'correct horse battery');
    assert.equal(identities.accountForToken('not-a-real-token'), null, 'an unknown token resolves to nothing');

    assert.equal(identities.logout(session.token), true, 'logout revokes the token');
    assert.equal(identities.accountForToken(session.token), null, 'a revoked token resolves to nothing');
  });
});

describe('Per-account isolation', () => {
  it('confines a developer to their own projects', async () => {
    const accounts = new AccountRegistry();
    const alice = accounts.createAccount({ username: 'alice', password: 'password-123', role: 'developer' });
    const bob = accounts.createAccount({ username: 'bob', password: 'password-123', role: 'viewer' });

    const { services, projects, aliceProjectId, bobProjectId } = await makeSharedEnv(alice.id, bob.id);

    const isolation = new AccountIsolation(services);
    const scoped = await isolation.isolate(
      accounts.verifySession(accounts.authenticate('alice', 'password-123').token),
    );

    const aliceProjects = await scoped.store.list({ types: ['PROJECT'] });
    assert.equal(aliceProjects.length, 1);
    const first = aliceProjects[0];
    assert.ok(first);
    assert.equal(first.id, aliceProjectId);

    // Alice can read her own project artifact directly.
    const own = await scoped.store.require(aliceProjectId);
    assert.equal(own.id, aliceProjectId);
    void projects;

    // Alice cannot read Bob's project.
    await assert.rejects(scoped.store.require(bobProjectId), AccessDeniedError);
  });

  it('lets an admin access other owners projects', async () => {
    const accounts = new AccountRegistry();
    const bob = accounts.createAccount({ username: 'bob', password: 'password-123', role: 'viewer' });
    const admin = accounts.createAccount({ username: 'root', password: 'password-123', role: 'admin' });

    const { services, bobProjectId } = await makeSharedEnv('ACCT-NONE', bob.id);
    const adminIsolation = new AccountIsolation(services);
    const scoped = await adminIsolation.isolate(
      accounts.verifySession(accounts.authenticate('root', 'password-123').token),
    );

    const projects = await scoped.store.list({ types: ['PROJECT'] });
    assert.equal(projects.length, 2);
    assert.ok(projects.some((p) => p.id === bobProjectId));
  });
});

async function makeSharedEnv(
  aliceUserId: string,
  bobUserId: string,
): Promise<{
  services: ReturnType<typeof makeServices>;
  projects: ProjectRegistry;
  aliceProjectId: string;
  bobProjectId: string;
}> {
  const services = makeServices();
  const projects = new ProjectRegistry(services);
  const aliceArtifact = await projects.createProject({
    title: 'Alice project',
    mode: 'full-product',
    owner: { userId: aliceUserId },
    actor: { kind: 'human', id: aliceUserId },
  });
  const bobArtifact = await projects.createProject({
    title: 'Bob project',
    mode: 'full-product',
    owner: { userId: bobUserId },
    actor: { kind: 'human', id: bobUserId },
  });
  return {
    services,
    projects,
    aliceProjectId: aliceArtifact.id,
    bobProjectId: bobArtifact.id,
  };
}
