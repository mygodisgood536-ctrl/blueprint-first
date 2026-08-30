/** Account, authentication, and isolation (expansion §11). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { makeServices } from './helpers/test-services.ts';
import { AccountRegistry, AuthenticationError, SessionExpiredError } from '../src/account/accounts.ts';
import { AccountIsolation, AccessDeniedError } from '../src/account/isolation.ts';
import { ProjectRegistry } from '../src/project/registry.ts';

describe('Account & authentication', () => {
  it('registers an account and authenticates with correct credentials', () => {
    const accounts = new AccountRegistry();
    const view = accounts.createAccount({
      username: 'alice',
      password: 'correct-horse-battery',
      displayName: 'Alice',
      role: 'developer',
    });
    assert.equal(view.username, 'alice');
    assert.match(view.id, /^ACCT-\d{6}$/);

    const session = accounts.authenticate('alice', 'correct-horse-battery');
    assert.ok(session.token.length >= 32);

    const resolved = accounts.verifySession(session.token);
    assert.equal(resolved.id, view.id);
  });

  it('rejects a wrong password', () => {
    const accounts = new AccountRegistry();
    accounts.createAccount({ username: 'bob', password: 'correct-horse-battery' });
    assert.throws(() => accounts.authenticate('bob', 'not-the-password'), AuthenticationError);
  });

  it('rejects an expired session', () => {
    const accounts = new AccountRegistry({ sessionTtlMs: -1 });
    const view = accounts.createAccount({ username: 'carol', password: 'correct-horse-battery' });
    const session = accounts.authenticate('carol', 'correct-horse-battery');
    assert.throws(() => accounts.verifySession(session.token), SessionExpiredError);
    assert.equal(view.username, 'carol');
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
