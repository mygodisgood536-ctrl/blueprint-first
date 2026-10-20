/**
 * Fail-closed persistence (Decision D2).
 *
 * The control plane runs on Vercel, which has no durable disk. A build that
 * boots onto the filesystem stores every project, identity and evidence trail
 * in memory-backed storage that is gone on the next cold start, so a
 * misconfigured production deploy would silently lose work while reporting
 * itself as healthy.
 *
 * `BF_REQUIRE_DATABASE=1` removes that fallback. The check has to live in
 * `resolveBackend` as well as `initStorage`: a guard that only ran at boot
 * would be decorative, because any later resolution of the backend would fall
 * back quietly.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  closeStorage,
  initStorage,
  resolveBackend,
  setDataRoot,
  setBackend,
} from '../src/storage/index.ts';

const MANAGED_KEYS = ['BF_REQUIRE_DATABASE', 'DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL', 'PGDATABASE_URL'] as const;
const originalEnv = new Map(MANAGED_KEYS.map((key) => [key, process.env[key]]));

beforeEach(async () => {
  for (const key of MANAGED_KEYS) delete process.env[key];
  setBackend(null);
  await closeStorage();
});

afterEach(async () => {
  for (const key of MANAGED_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setBackend(null);
  await closeStorage();
});

describe('BF_REQUIRE_DATABASE', () => {
  it('refuses to boot when a database is required and none is configured', async () => {
    process.env['BF_REQUIRE_DATABASE'] = '1';
    setDataRoot(await mkdtemp(join(tmpdir(), 'bf-required-')));

    await assert.rejects(
      () => initStorage(),
      /BF_REQUIRE_DATABASE=1 but no database connection string is configured/,
      'initStorage must refuse the filesystem fallback, not report it as unready',
    );
  });

  it('refuses a later backend resolution too, so the guard is not boot-only', async () => {
    process.env['BF_REQUIRE_DATABASE'] = '1';
    setDataRoot(await mkdtemp(join(tmpdir(), 'bf-required-')));

    assert.throws(
      () => resolveBackend(),
      /BF_REQUIRE_DATABASE=1 but no database connection string is configured/,
      'resolveBackend must refuse as well, or the flag could be bypassed after boot',
    );
  });

  it('names the Neon aliases an operator would set, so the failure is actionable', async () => {
    process.env['BF_REQUIRE_DATABASE'] = '1';

    await assert.rejects(() => initStorage(), /DATABASE_URL/);
    await assert.rejects(() => initStorage(), /Neon/);
  });

  it('still boots on the filesystem when the flag is absent, for development', async () => {
    setDataRoot(await mkdtemp(join(tmpdir(), 'bf-dev-')));

    const result = await initStorage();

    assert.equal(result.kind, 'json-file');
    assert.equal(result.ok, true);
    assert.match(result.detail, /filesystem durable snapshots at/);
    assert.equal(resolveBackend().kind, 'json-file');
  });

  it('reports readiness for the real backend through the boot surface', async () => {
    setDataRoot(await mkdtemp(join(tmpdir(), 'bf-ready-')));

    const result = await initStorage();

    assert.equal(result.ok, true);
    assert.equal(result.migrations.length, 0);
  });
});
