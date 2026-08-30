/** Project configuration + initialization (expansion §5). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ProjectRegistry } from '../src/project/registry.ts';
import {
  defaultProjectConfiguration,
  normalizeProjectConfiguration,
} from '../src/project/config.ts';
import type { ProjectMode } from '../src/project/types.ts';
import type { AppConfig } from '../src/core/config.ts';
import { makeServices } from './helpers/test-services.ts';
import type { CoreServices } from '../src/core/services.ts';

const ACTOR = { kind: 'system', id: 'project-registry' } as const;
const OWNER = { userId: 'product-owner-01' } as const;

function buildRegistry(): { registry: ProjectRegistry; services: CoreServices } {
  const base = makeServices();
  const services: CoreServices = {
    store: base.store,
    allocator: base.allocator,
    graph: base.graph,
    evidence: base.evidence,
    router: base.router,
    logger: base.logger,
  };
  return { registry: new ProjectRegistry(services), services };
}

async function createProject(
  registry: ProjectRegistry,
  mode: ProjectMode = 'full-product',
) {
  return registry.createProject({
    title: 'TeamTask',
    mode,
    owner: OWNER,
    actor: ACTOR,
  });
}

const APP: AppConfig = {
  envName: 'development',
  logLevel: 'info',
  dataDir: './data',
  ai: {
    defaultProvider: 'scripted',
    routing: {},
    openaiCompatible: {
      baseUrlEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
      modelEnvVar: 'OPENAI_COMPATIBLE_MODEL',
      apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
      timeoutMs: 120_000,
    },
  },
};

describe('project configuration + initialization', () => {
  it('normalizeProjectConfiguration validates and coerces a free-form payload', () => {
    const fallback = defaultProjectConfiguration('full-product', { dataDir: './data', logLevel: 'info' });
    const cfg = normalizeProjectConfiguration(
      {
        mode: 'design-plus-code',
        providers: { DISCOVERY: { providerId: 'openrouter', model: 'x' } },
        qualityGates: { requireCouncilEndorsement: false },
        runtime: { dataDir: './pfx', logLevel: 'debug', sampleSize: 3 },
      },
      fallback,
    );
    assert.equal(cfg.mode, 'design-plus-code');
    assert.equal(cfg.providers['DISCOVERY']?.providerId, 'openrouter');
    assert.equal(cfg.providers['DISCOVERY']?.model, 'x');
    assert.equal(cfg.qualityGates.requireCouncilEndorsement, false);
    assert.equal(cfg.qualityGates.requireMasterPass, true); // inherited
    assert.deepEqual(cfg.runtime, { dataDir: './pfx', logLevel: 'debug', sampleSize: 3 });
  });

  it('fails closed on invalid configuration (bad mode/task/log level/sampleSize)', () => {
    const fallback = defaultProjectConfiguration('full-product', { dataDir: './data', logLevel: 'info' });
    assert.throws(() => normalizeProjectConfiguration({ mode: 'nope' }, fallback), /Invalid project mode/);
    assert.throws(
      () => normalizeProjectConfiguration({ providers: { BOGUS: { providerId: 'x' } } }, fallback),
      /unknown AI task/,
    );
    assert.throws(
      () => normalizeProjectConfiguration({ providers: { DISCOVERY: {} } }, fallback),
      /requires a non-empty providerId/,
    );
    assert.throws(
      () => normalizeProjectConfiguration({ runtime: { logLevel: 'loud' } }, fallback),
      /Invalid log level/,
    );
    assert.throws(
      () => normalizeProjectConfiguration({ runtime: { sampleSize: 0 } }, fallback),
      /positive integer/,
    );
  });

  it('initializes a project with a default derived from the app config', async () => {
    const { registry } = buildRegistry();
    const p = await createProject(registry, 'design-only');
    const cfg = await registry.initializeProject(p.id, APP);
    assert.equal(cfg.mode, 'design-only');
    assert.equal(cfg.runtime.dataDir, './data');
    // Out-of-scope features default OFF for a design-only project.
    assert.equal(cfg.features.recursionDiscovery, false);
    assert.equal(cfg.features.permanentEngineeringOrg, false);

    // Initialization is idempotent: a second call keeps the stored config.
    const cfg2 = await registry.initializeProject(p.id, APP);
    assert.deepEqual(cfg2, cfg);
  });

  it('configures a project and persists the validated configuration', async () => {
    const { registry, services } = buildRegistry();
    const p = await createProject(registry);
    const cfg = await registry.configureProject(
      p.id,
      {
        mode: 'full-product',
        providers: { DESIGN: { providerId: 'openrouter', model: 'gpt-4o' } },
        features: { safeChange: false },
        runtime: { dataDir: './custom', sampleSize: 2 },
      },
      APP,
    );
    assert.equal(cfg.providers['DESIGN']?.model, 'gpt-4o');
    assert.equal(cfg.features.safeChange, false);

    // Persisted on the artifact attributes (readable back).
    const stored = await services.store.require(p.id);
    const projectConfig = stored.attributes['projectConfig'] as { normalized?: boolean; providers?: unknown };
    assert.equal(projectConfig['normalized'], true);

    // Reading it back round-trips the full validated config.
    const readBack = await registry.getConfiguration(p.id, APP);
    assert.deepEqual(readBack, cfg);
  });

  it('rejects invalid configureProject input without mutating the stored project', async () => {
    const { registry, services } = buildRegistry();
    const p = await createProject(registry);
    await assert.rejects(
      registry.configureProject(p.id, { mode: 'bogus' }, APP),
      /Invalid project mode/,
    );
    const stored = await services.store.require(p.id);
    assert.equal(stored.attributes['mode'], 'full-product'); // unchanged
  });

  it('sets a single per-task provider preference additively', async () => {
    const { registry } = buildRegistry();
    const p = await createProject(registry);
    await registry.setProviderPreference(p.id, 'BUILD', { providerId: 'local', model: 'qwen' }, APP);
    await registry.setProviderPreference(p.id, 'DESIGN', { providerId: 'openrouter' }, APP);
    const cfg = await registry.getConfiguration(p.id, APP);
    assert.equal(cfg.providers['BUILD']?.model, 'qwen');
    assert.equal(cfg.providers['DESIGN']?.providerId, 'openrouter');
    assert.equal(cfg.providers['DISCOVERY'], undefined);
  });
});
