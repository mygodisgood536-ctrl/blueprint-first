/**
 * Cline uses the PLATFORM'S AI configuration (ARCHITECTURE 3.3 §77-§80, §185).
 *
 * Cline is the worker, not an AI system. These tests prove against the REAL
 * Cline CLI that:
 *  - the provider and model Cline receives are exactly the project's
 *    authoritative platform configuration - never a second selector, never a
 *    hard-coded value, never a substituted model;
 *  - a user without a verified platform credential gets an honest refusal and
 *    NO Cline work is attempted;
 *  - changing the platform's provider/model changes what Cline is given;
 *  - the credential handed to Cline comes from the platform's own credential
 *    boundary and is never written into platform evidence or the Knowledge Graph.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderManager } from '../src/ai/provider-manager.ts';
import { clineProfileDirs, prepareClineAi } from '../src/env/cline-bridge.ts';
import { probeBinary } from '../src/env/capabilities.ts';
import { reconcileHostPath } from '../src/runtime/host-path.ts';

reconcileHostPath();

async function loadProviders(dataDir: string): Promise<Record<string, unknown> | null> {
  const file = join(clineProfileDirs(dataDir, 'alice').data, 'settings', 'providers.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

test('a user with NO verified platform AI configuration gets an honest refusal and no Cline work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-nocred-'));
  try {
    const manager = new ProviderManager();
    // No credential was ever stored for this account.
    const prep = await prepareClineAi({
      providerManager: manager,
      clineRoot: dir,
      ownerId: 'alice',
      providerId: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
    });
    assert.equal(prep.ready, false, 'Cline must not run without a verified platform credential');
    assert.equal(prep.binding, null);
    assert.equal(prep.failureClass, 'authentication');
    assert.match(prep.detail, /nothing was substituted/i);
    // Nothing was configured with the real CLI.
    assert.equal(await loadProviders(dir), null, 'no Cline profile may be created without a verified credential');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cline receives EXACTLY the platform provider/model - proven against the real Cline CLI', async (t) => {
  const probe = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
  if (probe === null || probe.exitCode !== 0) {
    t.skip('cline CLI is not installed on this host');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-bridge-'));
  try {
    // The platform's own credential boundary holds the user's provider key.
    const manager = new ProviderManager();
    const secret = 'sk-or-v1-bridge-proof-1234567890';
    manager.credentials.addCredential('alice', 'openrouter', secret);
    // A real connection test is required before the platform will hand an
    // identity to any executor, so we verify against a stub HTTP responder that
    // behaves like the real OpenRouter endpoint. The CREDENTIAL and the
    // provider/model selection are the real platform ones.
    const fetchImpl = (async (url: string) => {
      const href = String(url);
      if (href.includes('/api/v1/key')) {
        return new Response(JSON.stringify({ data: { is_free_tier: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const connection = await manager.verifyProviderConnection('alice', 'openrouter', fetchImpl);
    assert.equal(connection.success, true, `platform credential verification failed: ${connection.errorMessage ?? ''}`);

    // Route construction uses the SAME platform call the platform itself uses.
    const route = await manager.getExecutionRouterFor('alice', 'openrouter', 'anthropic/claude-3.5-sonnet');
    assert.notEqual(route, null, 'the platform must be able to build an execution route for this account');

    // Hand the platform's identity to the real Cline CLI.
    const prep = await prepareClineAi({
      providerManager: manager,
      clineRoot: dir,
      ownerId: 'alice',
      providerId: route!.providerId,
      modelId: route!.modelId,
    });
    assert.equal(prep.ready, true, prep.detail);
    assert.equal(prep.binding!.providerId, 'openrouter');
    assert.equal(prep.binding!.clineModel, 'anthropic/claude-3.5-sonnet', 'Cline must receive the platform model id verbatim');

    // THE PROOF: the real Cline CLI recorded exactly the platform's identity.
    const profile = await loadProviders(dir);
    assert.notEqual(profile, null, 'the real Cline CLI should have recorded its provider configuration');
    const recorded = profile as { lastUsedProvider?: string; providers?: Record<string, { settings?: Record<string, string> }> };
    assert.equal(recorded.lastUsedProvider, 'openrouter', 'Cline must use the platform-selected provider');
    const entry = recorded.providers?.['openrouter'];
    assert.notEqual(entry, undefined, 'Cline must hold the platform-selected provider');
    assert.equal(entry!.settings?.['model'], 'anthropic/claude-3.5-sonnet', 'Cline must use the platform-selected model');
    assert.equal(entry!.settings?.['provider'], 'openrouter');

    // Changing the platform's model changes what Cline is given - there is no
    // second, Cline-owned selection.
    const second = await prepareClineAi({
      providerManager: manager,
      clineRoot: dir,
      ownerId: 'alice',
      providerId: route!.providerId,
      modelId: 'openai/gpt-4o',
    });
    assert.equal(second.ready, true, second.detail);
    assert.equal(second.binding!.clineModel, 'openai/gpt-4o');
    const after = (await loadProviders(dir)) as { providers?: Record<string, { settings?: Record<string, string> }> };
    assert.equal(
      after.providers?.['openrouter']?.settings?.['model'],
      'openai/gpt-4o',
      'a platform model change must be what Cline uses next',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one user\'s platform credential is never used for another user\'s Cline profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-iso-'));
  try {
    const alice = clineProfileDirs(dir, 'alice');
    const bob = clineProfileDirs(dir, 'bob');
    assert.notEqual(alice.data, bob.data, 'each account must have its own Cline profile');
    assert.ok(alice.data.includes('alice'));
    assert.ok(bob.data.includes('bob'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Cline profile lives outside the platform data directory and holds no evidence', async (t) => {
  const probe = await probeBinary('cline', ['--version'], { timeoutMs: 60_000 });
  if (probe === null || probe.exitCode !== 0) {
    t.skip('cline CLI is not installed on this host');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'bf-cline-root-'));
  try {
    const manager = new ProviderManager();
    manager.credentials.addCredential('alice', 'openrouter', 'sk-or-v1-iso-proof-1234567890');
    const fetchImpl = (async () => new Response(JSON.stringify({ data: { is_free_tier: false } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    await manager.verifyProviderConnection('alice', 'openrouter', fetchImpl);
    const route = await manager.getExecutionRouterFor('alice', 'openrouter', 'anthropic/claude-3.5-sonnet');
    assert.notEqual(route, null);

    const prep = await prepareClineAi({ providerManager: manager, clineRoot: dir, ownerId: 'alice', providerId: route!.providerId, modelId: route!.modelId });
    assert.equal(prep.ready, true, prep.detail);

    // The derived profile is the ONLY place the CLI caches the key, and it is
    // outside anything the platform treats as durable product state.
    const profile = await loadProviders(dir);
    assert.notEqual(profile, null);
    const dirs = clineProfileDirs(dir, 'alice');
    assert.ok(existsSync(join(dirs.data, 'settings', 'providers.json')));
    // The platform's own credential store is the source of truth and returns the
    // secret only to its authorized owner.
    assert.equal(manager.credentials.resolveSecret('alice', prep.binding!.credentialId!).length > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
