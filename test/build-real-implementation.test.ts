/**
 * THE BUILD STAGE MAY NOT FABRICATE AN IMPLEMENTATION.
 *
 * The vision's governing rule is reality over declaration. Before this work the
 * Build stage wrote `-IMPL` artifacts directly from DESIGN documents, which
 * asserted implementations that had never been observed anywhere. That is the
 * specific failure mode the architecture forbids: "a mechanism that marks work
 * complete without satisfying its required evidence and verification gates is
 * itself a platform defect."
 *
 * These tests pin the corrected behaviour against a REAL execution environment:
 *   - no environment  -> the stage refuses, creating nothing
 *   - empty workspace -> the stage refuses, creating nothing
 *   - real files      -> -IMPL artifacts are written from those real files
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { LocalWorkspaceEnvAdapter } from '../src/env/local-workspace.ts';
import { captureRealImplementation } from '../src/build/implementation-capture.ts';
import { materializeRealImplementation } from '../src/build/materialize-real.ts';
import type { CoreServices } from '../src/core/services.ts';
import { composeArtifactStore, initArtifactStore } from '../src/storage/compose.ts';
import { ArtifactIdAllocator } from '../src/core/id-allocator.ts';
import { KnowledgeGraph } from '../src/core/graph.ts';
import { MemoryEvidenceLog } from '../src/verification/evidence.ts';

async function services(): Promise<CoreServices> {
  const dir = await mkdtemp(join(tmpdir(), 'bf-build-real-'));
  const allocator = new ArtifactIdAllocator();
  const composed = composeArtifactStore({ filePath: join(dir, 'store.json'), allocator });
  await initArtifactStore(composed.store);
  return {
    store: composed.store,
    allocator,
    graph: new KnowledgeGraph(),
    evidence: new MemoryEvidenceLog(),
    router: {} as never,
    projects: {} as never,
  };
}

const PAGE_DESIGN = {
  pageArtifactId: 'PAGE-0001',
  pageKey: 'dashboard',
  title: 'Dashboard',
  purpose: 'Show project health',
  moduleId: 'MODULE-0001',
  navigation: { inMainNav: true, route: '/dashboard', label: 'Dashboard' },
  layout: [],
  interactions: [],
  stateHandling: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  dataNotes: '',
  designTokens: undefined,
  accessibility: undefined,
  responsive: undefined,
} as never;

async function workspaceWith(files: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(tmpdir(), 'bf-ws-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  const adapter = new LocalWorkspaceEnvAdapter(root);
  return { root, adapter, implementation: await captureRealImplementation(adapter, { environmentId: 'ENV-1', workspaceRoot: root }) };
}

describe('build artifacts are derived from real code, never from a design document', () => {
  test('an empty workspace produces no page or feature -IMPL artifact', async () => {
    const core = await services();
    const { implementation } = await workspaceWith({});

    const result = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation,
      pageDesigns: [PAGE_DESIGN],
      featureDesignIds: [],
      featureTitles: {},
      producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    assert.deepEqual(result.pageImplIds, []);
    assert.deepEqual(result.featureImplIds, []);
    assert.deepEqual(result.fileImplIds, []);
    assert.equal(result.totalRealFiles, 0);
  });

  test('a certified design with no real file behind it is reported as unimplemented', async () => {
    const core = await services();
    const { implementation } = await workspaceWith({ 'src/lib/unrelated.ts': 'export const u = 1;\n' });

    const result = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation,
      pageDesigns: [PAGE_DESIGN],
      featureDesignIds: [],
      featureTitles: {},
      producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    assert.deepEqual(result.pageImplIds, [], 'no real dashboard file means no dashboard -IMPL');
    assert.deepEqual(result.unimplementedDesignIds, ['PAGE-0001-DESIGN'], 'and the gap is named, not hidden');
  });

  test('a real file behind the certified route produces a page -IMPL bound to the design', async () => {
    const core = await services();
    const { implementation } = await workspaceWith({
      'src/app/dashboard/page.tsx': 'export default function Dashboard() { return null; }\n',
    });

    const result = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation,
      pageDesigns: [PAGE_DESIGN],
      featureDesignIds: [],
      featureTitles: {},
      producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    assert.deepEqual(result.pageImplIds, ['PAGE-0001-IMPL']);
    const impl = await core.store.require('PAGE-0001-IMPL');
    assert.deepEqual(impl.dependencies, ['PAGE-0001-DESIGN'], 'the -IMPL must trace to its certified design');

    const realFiles = impl.attributes['realFiles'] as { path: string; sha256: string; bytes: number }[];
    assert.equal(realFiles.length, 1);
    assert.equal(realFiles[0]!.path, 'src/app/dashboard/page.tsx');
    assert.match(realFiles[0]!.sha256, /^[0-9a-f]{64}$/);
    assert.equal(impl.attributes['observedFrom'], 'execution-environment');
  });

  test('every real file is individually recorded and hashable', async () => {
    const core = await services();
    const { implementation } = await workspaceWith({
      'src/app/dashboard/page.tsx': 'export default 1;\n',
      'src/lib/format.ts': 'export const f = 1;\n',
    });

    const result = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation,
      pageDesigns: [],
      featureDesignIds: [],
      featureTitles: {},
      producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    assert.equal(result.fileImplIds.length, 2);
    for (const id of result.fileImplIds) {
      const artifact = await core.store.require(id);
      const real = artifact.attributes['realFile'] as { path: string; sha256: string };
      assert.equal(real.path.length > 0, true);
      assert.match(real.sha256, /^[0-9a-f]{64}$/);
    }
  });

  test('the recorded hash is the hash of the real content on disk', async () => {
    const core = await services();
    const content = 'export const exact = 42;\n';
    const { implementation } = await workspaceWith({ 'src/lib/exact.ts': content });
    const { createHash } = await import('node:crypto');

    const result = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation,
      pageDesigns: [],
      featureDesignIds: [],
      featureTitles: {},
      producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    const artifact = await core.store.require(result.fileImplIds[0]!);
    const real = artifact.attributes['realFile'] as { sha256: string; bytes: number };
    assert.equal(real.sha256, createHash('sha256').update(content, 'utf8').digest('hex'));
    assert.equal(real.bytes, Buffer.byteLength(content));
  });

  test('a changed workspace changes what is recorded - the artifact cannot go stale', async () => {
    const core = await services();
    const root = await mkdtemp(join(tmpdir(), 'bf-ws-'));
    const adapter = new LocalWorkspaceEnvAdapter(root);
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await writeFile(join(root, 'src', 'lib', 'v.ts'), 'v1', 'utf8');
    const first = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation: await captureRealImplementation(adapter, { environmentId: 'ENV-1', workspaceRoot: root }),
      pageDesigns: [], featureDesignIds: [], featureTitles: {}, producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    await writeFile(join(root, 'src', 'lib', 'v.ts'), 'v2', 'utf8');
    const second = await materializeRealImplementation(core, {
      projectId: 'PROJ-1',
      implementation: await captureRealImplementation(adapter, { environmentId: 'ENV-1', workspaceRoot: root }),
      pageDesigns: [], featureDesignIds: [], featureTitles: {}, producer: { kind: "system", id: "test" },
      verifier: { kind: "verifier", id: "build-boss-01" },
    });

    const a = await core.store.require(first.fileImplIds[0]!);
    const b = await core.store.require(second.fileImplIds[0]!);
    assert.notEqual(
      (a.attributes['realFile'] as { sha256: string }).sha256,
      (b.attributes['realFile'] as { sha256: string }).sha256,
      'a real content change must produce a different recorded hash',
    );
  });
});

