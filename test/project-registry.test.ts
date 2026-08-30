/** Project foundation: identity + mode + scoping + persistence (expansion §6). */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';
import { JsonFileArtifactStore } from '../src/core/json-file-store.ts';
import { createArtifact } from '../src/core/artifact.ts';
import { PROJECT_MODE_LIFECYCLE_COMPLETE } from '../src/project/types.ts';
import { ProjectRegistry, stageInScope } from '../src/project/registry.ts';

import { makeServices } from './helpers/test-services.ts';
import type { CoreServices } from '../src/core/services.ts';

const ACTOR = { kind: 'system', id: 'project-registry' } as const;
const OWNER = { userId: 'product-owner-01', label: 'Demo Product Owner' };

function buildRegistry(
  overrides: Partial<Pick<CoreServices, 'store' | 'allocator' | 'graph' | 'evidence'>> = {},
): { registry: ProjectRegistry; services: CoreServices } {
  const services = makeServices();
  const merged: CoreServices = {
    store: overrides.store ?? services.store,
    allocator: overrides.allocator ?? services.allocator,
    graph: overrides.graph ?? services.graph,
    evidence: overrides.evidence ?? services.evidence,
    router: services.router,
    logger: services.logger,
  };
  return { registry: new ProjectRegistry(merged), services: merged };
}

describe('ProjectRegistry - project foundation', () => {
  it('creates a PROJECT artifact through the existing artifact system (no duplicate ID system)', async () => {
    const { registry, services } = buildRegistry();
    const p = await registry.createProject({
      title: '  TeamTask  ',
      description: 'A lightweight task tracker.',
      mode: 'full-product',
      owner: OWNER,
      actor: ACTOR,
      scope: ['TeamTask', 'billing'],
    });

    assert.equal(p.type, 'PROJECT');
    assert.equal(p.title, 'TeamTask'); // trimmed
    assert.equal(p.status, 'DRAFT'); // created in the existing legal DRAFT state
    assert.equal(p.attributes['mode'], 'full-product');
    assert.deepEqual(p.attributes['scope'], ['TeamTask', 'billing'].sort());
    assert.equal(
      p.attributes['lifecycleComplete'],
      PROJECT_MODE_LIFECYCLE_COMPLETE['full-product'],
    );

    // Persisted in the same store/tag as every other artifact — no second store.
    const fromStore = await services.store.require(p.id);
    assert.equal(fromStore.attributes['mode'], 'full-product');
    assert.ok(fromStore.tags.includes('project'));

    // First artifact at PROJECT-0001 in a fresh allocator.
    assert.equal(p.id, 'PROJECT-0001');

    // Evidence recorded.
    const ev = await services.evidence.forArtifact(p.id);
    assert.ok(ev.some((e) => /created.*mode=full-product/.test(e.summary)));

    const list = await registry.listProjects();
    assert.deepEqual(
      list.map((x) => x.id),
      [p.id],
    );
  });

  it('rejects malformed creation input fail-closed (bad mode / empty title / empty owner)', async () => {
    const { registry } = buildRegistry();
    await assert.rejects(
      registry.createProject({ title: 'X', mode: 'hack-mode' as never, owner: OWNER, actor: ACTOR }),
      /Unknown project mode/,
    );
    await assert.rejects(
      registry.createProject({ title: '   ', mode: 'full-product', owner: OWNER, actor: ACTOR }),
      /Project title must be a non-empty string\./,
    );
    await assert.rejects(
      registry.createProject({
        title: 'X',
        mode: 'full-product',
        owner: { userId: '  ' },
        actor: ACTOR,
      }),
      /owner\.userId must be a non-empty string/,
    );
  });

  it('confirms ownership/scoping without performing any illegal DoC transition', async () => {
    const { registry, services } = buildRegistry();
    const p = await registry.createProject({
      title: 'TeamTask',
      mode: 'design-only',
      owner: OWNER,
      actor: ACTOR,
    });
    assert.equal(p.status, 'DRAFT'); // legal initial state

    // Confirmation validates identity/ownership/scope but leaves the DoC
    // status legally unchanged (DRAFT) - never an illegal IN_REVIEW -> DRAFT.
    const confirmed = await registry.confirmProject(p.id, ACTOR);
    assert.equal(confirmed.id, p.id);
    assert.equal(confirmed.status, 'DRAFT');

    const ev = await services.evidence.forArtifact(p.id);
    assert.ok(ev.some((e) => /ownership\/scope confirmed/.test(e.summary)));

    // A project without a valid owner cannot be confirmed (fail closed).
    const noOwner = await registry.createProject({
      title: 'NoOwner',
      mode: 'full-product',
      owner: { userId: 'someone' },
      actor: ACTOR,
    });
    const stripped = await services.store.update(noOwner.id, noOwner.version, (draft) => {
      const attributes = { ...draft.attributes };
      delete attributes['owner'];
      return { ...draft, attributes };
    });
    void stripped;
    await assert.rejects(
      registry.confirmProject(noOwner.id, ACTOR),
      /no valid owner/,
    );
  });

  it('exposes get/require/list and getMode/lifecycleComplete', async () => {
    const { registry } = buildRegistry();
    const p = await registry.createProject({
      title: 'TeamTask',
      mode: 'design-plus-code',
      owner: OWNER,
      actor: ACTOR,
    });
    assert.equal((await registry.getProject(p.id))?.id, p.id);
    assert.equal(await registry.getProject('PROJECT-9999'), null);
    await assert.rejects(registry.requireProject('PROJECT-9999'), /does not exist/);
    assert.equal(await registry.getMode(p.id), 'design-plus-code');
    assert.equal(
      await registry.lifecycleComplete(p.id),
      PROJECT_MODE_LIFECYCLE_COMPLETE['design-plus-code'],
    );
  });

  it('declares stage scope per mode and never falsely completes out-of-scope stages', () => {
    // design-only stops before implementation.
    assert.equal(stageInScope('design-only', 'design-verification'), true);
    assert.equal(stageInScope('design-only', 'design'), true);
    assert.equal(stageInScope('design-only', 'blueprint'), false);
    assert.equal(stageInScope('design-only', 'implementation'), false);
    assert.equal(stageInScope('design-only', 'continuous-improvement'), false);

    // design-plus-code stops before deployment.
    assert.equal(stageInScope('design-plus-code', 'verification'), true);
    assert.equal(stageInScope('design-plus-code', 'deployment'), false);

    // full-product keeps everything in scope.
    assert.equal(stageInScope('full-product', 'deployment'), true);
    assert.equal(stageInScope('full-product', 'continuous-improvement'), true);
  });

  it('isStageInScope reads scope from the stored project mode', async () => {
    const { registry } = buildRegistry();
    const p = await registry.createProject({
      title: 'TeamTask',
      mode: 'design-only',
      owner: OWNER,
      actor: ACTOR,
    });
    assert.equal(await registry.isStageInScope(p.id, 'design'), true);
    assert.equal(await registry.isStageInScope(p.id, 'implementation'), false);
    assert.equal(await registry.isStageInScope(p.id, 'deployment'), false);
  });

  it('adopts an existing PROJECT artifact (e.g. from discovery) without duplicating it', async () => {
    const { registry, services } = buildRegistry();
    // Simulate discovery materializing a PROJECT artifact first.
    const existing = await (async () => {
      const id = services.allocator.nextId('PROJECT');
      const a = createArtifact({
        id,
        type: 'PROJECT',
        title: 'Discovery-made project',
        description: '',
        actor: { kind: 'system', id: 'discovery' },
      });
      await services.store.append(a);
      return a;
    })();

    const adopted = await registry.adoptProject({
      projectId: existing.id,
      title: existing.title,
      mode: 'design-only',
      owner: OWNER,
      actor: ACTOR,
      scope: ['TeamTask'],
    });

    // Same artifact id — no duplicate PROJECT created.
    assert.equal(adopted.id, existing.id);
    assert.equal(adopted.attributes['mode'], 'design-only');
    assert.deepEqual(adopted.attributes['scope'], ['TeamTask']);
    assert.equal(adopted.attributes['lifecycleComplete'], 'design-verification');
    assert.ok(adopted.tags.includes('project'));

    // Idempotent when the mode matches.
    const again = await registry.adoptProject({
      projectId: existing.id,
      title: 'ignored title',
      mode: 'design-only',
      owner: OWNER,
      actor: ACTOR,
    });
    assert.equal(again.id, existing.id);

    // Refuses to override an existing different mode.
    await assert.rejects(
      registry.adoptProject({
        projectId: existing.id,
        title: 't',
        mode: 'full-product',
        owner: OWNER,
        actor: ACTOR,
      }),
      /refusing to override/,
    );
  });

  it('links artifacts to a project via CONTAINS and resolves projectOfArtifact', async () => {
    const { registry, services } = buildRegistry();
    const p = await registry.createProject({
      title: 'TeamTask',
      mode: 'full-product',
      owner: OWNER,
      actor: ACTOR,
    });
    const child = createArtifact({
      id: services.allocator.nextId('PAGE'),
      type: 'PAGE',
      title: 'Task Board',
      description: '',
      actor: ACTOR,
    });
    await services.store.append(child);

    assert.equal(await registry.projectOfArtifact(child.id), null);
    await registry.linkArtifact(p.id, child.id);
    assert.equal((await registry.projectOfArtifact(child.id))?.id, p.id);
    assert.equal(services.graph.hasEdge(p.id, 'CONTAINS', child.id), true);

    // Linking fails if either endpoint is missing.
    await assert.rejects(registry.linkArtifact(p.id, 'PAGE-9999'), /does not exist|Not found/);
  });

  it('persists project identity and mode through JsonFileArtifactStore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-project-'));
    const store1 = new JsonFileArtifactStore({ filePath: join(dir, 'store.json') });
    const allocator1 = new ArtifactIdAllocator();
    const registry1 = new ProjectRegistry({
      store: store1,
      allocator: allocator1,
      graph: new KnowledgeGraph(),
      evidence: new MemoryEvidenceLog(),
    } as unknown as CoreServices);
    const p = await registry1.createProject({
      title: 'PersistedProject',
      mode: 'design-plus-code',
      owner: OWNER,
      actor: ACTOR,
    });

    // Reload from disk and confirm the PROJECT artifact + mode round-trips.
    const store2 = new JsonFileArtifactStore({ filePath: join(dir, 'store.json') });
    const allocator2 = new ArtifactIdAllocator();
    const registry2 = new ProjectRegistry({
      store: store2,
      allocator: allocator2,
      graph: new KnowledgeGraph(),
      evidence: new MemoryEvidenceLog(),
    } as unknown as CoreServices);
    const loaded = await registry2.requireProject(p.id);
    assert.equal(loaded.id, p.id);
    assert.equal(await registry2.getMode(p.id), 'design-plus-code');
    assert.equal(await registry2.isStageInScope(p.id, 'design'), true);
    assert.equal(await registry2.isStageInScope(p.id, 'deployment'), false);

    rmSync(dir, { recursive: true, force: true });
  });
});
