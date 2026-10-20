/**
 * REAL BUILD CAPTURE.
 *
 * The Build department's -IMPL artifacts must correspond to code that actually
 * exists. These tests drive the capture against a REAL temporary filesystem
 * through the real `EnvAdapter` port, so what is asserted is what is on disk -
 * not a fixture describing what someone hoped would be on disk.
 *
 * The two failure modes this exists to prevent:
 *   1. An artifact claiming an implementation with no file behind it.
 *   2. An inventory that reports expected files rather than observed ones.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { LocalWorkspaceEnvAdapter } from '../src/env/local-workspace.ts';
import {
  captureRealImplementation,
  classifyRealFile,
  hasRealSource,
  realFilesForPage,
} from '../src/build/implementation-capture.ts';

async function realWorkspace(): Promise<{ adapter: LocalWorkspaceEnvAdapter; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bf-capture-'));
  const adapter = new LocalWorkspaceEnvAdapter(root);
  return { adapter, root };
}

async function capture(adapter: LocalWorkspaceEnvAdapter, root: string) {
  return captureRealImplementation(adapter, { environmentId: 'ENV-TEST', workspaceRoot: root });
}

describe('real implementation capture reads actual disk state', () => {
  test('reports an empty inventory honestly for an empty workspace', async () => {
    const { adapter, root } = await realWorkspace();
    const implementation = await capture(adapter, root);

    assert.deepEqual(implementation.files, []);
    assert.equal(hasRealSource(implementation), false);
    assert.equal(implementation.environmentId, 'ENV-TEST');
    assert.equal(implementation.adapterKind, 'local-workspace');
  });

  test('finds the real file that was actually written, with its real hash and size', async () => {
    const { adapter, root } = await realWorkspace();
    await writeFile(join(root, 'app.ts'), 'export const app = 1;\n', 'utf8');

    const implementation = await capture(adapter, root);

    assert.equal(implementation.files.length, 1);
    const file = implementation.files[0]!;
    assert.equal(file.path, 'app.ts');
    assert.equal(file.bytes, Buffer.byteLength('export const app = 1;\n'));
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(hasRealSource(implementation), true);
  });

  test('the inventory hash tracks real content changes', async () => {
    const { adapter, root } = await realWorkspace();
    await writeFile(join(root, 'a.ts'), 'one', 'utf8');
    const first = await capture(adapter, root);

    await writeFile(join(root, 'a.ts'), 'two', 'utf8');
    const second = await capture(adapter, root);

    assert.notEqual(first.inventoryHash, second.inventoryHash, 'a real change must change the inventory hash');

    // Writing the SAME content back is not a change.
    await writeFile(join(root, 'a.ts'), 'two', 'utf8');
    const third = await capture(adapter, root);
    assert.equal(second.inventoryHash, third.inventoryHash);
  });

  test('walks real nested directories', async () => {
    const { adapter, root } = await realWorkspace();
    await mkdir(join(root, 'src', 'pages'), { recursive: true });
    await writeFile(join(root, 'src', 'pages', 'dashboard.tsx'), 'export default 1;\n', 'utf8');

    const implementation = await capture(adapter, root);

    assert.deepEqual(implementation.files.map((f) => f.path), ['src/pages/dashboard.tsx']);
  });

  test('excludes dependency and build directories instead of hashing the toolchain', async () => {
    const { adapter, root } = await realWorkspace();
    await writeFile(join(root, 'app.ts'), 'real\n', 'utf8');
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n', 'utf8');
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

    const implementation = await capture(adapter, root);

    assert.deepEqual(implementation.files.map((f) => f.path), ['app.ts']);
    assert.equal(
      implementation.skipped.some((s) => s.path.includes('node_modules') && s.reason === 'not product source'),
      true,
    );
  });

  test('reports an unreadable file as skipped rather than silently dropping it', async () => {
    const { adapter, root } = await realWorkspace();
    await writeFile(join(root, 'big.ts'), 'x'.repeat(3 * 1024 * 1024), 'utf8');

    const implementation = await capture(adapter, root);

    assert.equal(implementation.files.length, 0, 'a file over the hash limit is not captured as source');
    assert.equal(
      implementation.skipped.some((s) => s.path === 'big.ts' && /exceeds/.test(s.reason)),
      true,
      'and the reason is reported, not hidden',
    );
  });

  test('reads real git state when the workspace has a repository', async () => {
    const { adapter, root } = await realWorkspace();
    await adapter.provision({ label: 'capture', gitEnabled: true });
    await writeFile(join(root, 'tracked.ts'), 'export const t = 1;\n', 'utf8');
    await adapter.gitCommit('initial import');

    const implementation = await capture(adapter, root);

    assert.notEqual(implementation.git, null, 'a real repository must report real git state');
    assert.equal(implementation.git!.branch.length > 0, true);
  });

  test('reports no git state for a workspace without a repository, without failing', async () => {
    const { adapter, root } = await realWorkspace();
    const implementation = await capture(adapter, root);
    assert.equal(implementation.git, null);
  });

  test('an absent file is reported as absent - never as an expected file', async () => {
    const { adapter, root } = await realWorkspace();
    await writeFile(join(root, 'present.ts'), 'x\n', 'utf8');

    const implementation = await capture(adapter, root);
    const paths = implementation.files.map((f) => f.path);

    assert.equal(paths.includes('present.ts'), true);
    assert.equal(paths.includes('absent.ts'), false);
  });
});

describe('real file classification drives artifact binding', () => {
  test('classifies the file kinds the build department cares about', () => {
    assert.equal(classifyRealFile('src/app/page.tsx'), 'route');
    assert.equal(classifyRealFile('src/components/UserCard.tsx'), 'component');
    assert.equal(classifyRealFile('src/lib/format.ts'), 'module');
    assert.equal(classifyRealFile('src/app.css'), 'style');
    assert.equal(classifyRealFile('db/schema.prisma'), 'schema');
    assert.equal(classifyRealFile('package.json'), 'config');
    assert.equal(classifyRealFile('src/app/page.test.ts'), 'test');
    assert.equal(classifyRealFile('docs/architecture.md'), 'doc');
  });

  test('binds a certified page route to the real file that serves it', async () => {
    const { adapter, root } = await realWorkspace();
    await mkdir(join(root, 'src', 'app', 'dashboard'), { recursive: true });
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await writeFile(join(root, 'src', 'app', 'dashboard', 'page.tsx'), 'export default 1;\n', 'utf8');
    await writeFile(join(root, 'src', 'lib', 'unrelated.ts'), 'export const u = 1;\n', 'utf8');

    const implementation = await capture(adapter, root);
    const matched = realFilesForPage(implementation, '/dashboard');

    assert.deepEqual(matched.map((f) => f.path), ['src/app/dashboard/page.tsx']);
  });

  test('a route with no real file matches nothing, so no -IMPL artifact is written', async () => {
    const { adapter, root } = await realWorkspace();
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await writeFile(join(root, 'src', 'lib', 'unrelated.ts'), 'export const u = 1;\n', 'utf8');

    const implementation = await capture(adapter, root);

    assert.deepEqual(realFilesForPage(implementation, '/billing'), []);
  });
});