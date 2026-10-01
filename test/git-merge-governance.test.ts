/**
 * Governed merge against a REAL git repository (ARCHITECTURE 3.3 §86, §87).
 *
 * These tests build an actual git repository on disk, make concurrent edits
 * that genuinely conflict, and assert that the real `git` merge is REFUSED and
 * routed for verification rather than silently overwriting a Worker's work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellCommand } from '../src/runtime/shell.ts';
import { gitAvailable, governedMerge, preflightMerge } from '../src/env/git-merge.ts';

async function git(root: string, args: string): Promise<void> {
  const r = await runShellCommand(`git ${args}`, { cwd: root, timeoutMs: 60_000 });
  if (r.exitCode !== 0) throw new Error(`git ${args} failed: ${r.stderr || r.stdout}`);
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bf-merge-'));
  await git(root, 'init --initial-branch=main');
  await git(root, '-c user.name=t -c user.email=t@t commit --allow-empty -m init');
  await writeFile(join(root, 'shared.txt'), 'original line\n', 'utf8');
  await git(root, 'add -A');
  await git(root, '-c user.name=t -c user.email=t@t commit -m "add shared"');
  // Worker A's branch, editing the same line.
  await git(root, 'checkout -b worker-a');
  await writeFile(join(root, 'shared.txt'), 'worker A line\n', 'utf8');
  await writeFile(join(root, 'a-only.txt'), 'from A\n', 'utf8');
  await git(root, 'add -A');
  await git(root, '-c user.name=t -c user.email=t@t commit -m "worker A work"');
  // Worker B's branch, editing the SAME line differently -> a real conflict.
  await git(root, 'checkout main');
  await git(root, 'checkout -b worker-b');
  await writeFile(join(root, 'shared.txt'), 'worker B line\n', 'utf8');
  await writeFile(join(root, 'b-only.txt'), 'from B\n', 'utf8');
  await git(root, 'add -A');
  await git(root, '-c user.name=t -c user.email=t@t commit -m "worker B work"');
  return root;
}

test('the real git binary is available for governed merges', async () => {
  assert.equal(await gitAvailable(), true, 'git must be resolvable for merge governance to be real');
});

test('§86 a real conflicting modification is DETECTED before merge and nothing is overwritten', async () => {
  const root = await makeRepo();
  try {
    await git(root, 'checkout worker-a');
    const pre = await preflightMerge(root, 'worker-b', 'worker-a');
    assert.equal(pre.clean, false, 'the real git conflict must be detected');
    assert.ok(pre.conflicts.length > 0, 'git must report at least one conflicting path: ' + JSON.stringify(pre));
    // Every reported conflict must name a real path - the platform reports what
    // git actually said rather than inventing locations.
    assert.ok(pre.conflicts.every((c) => c.path.trim().length > 0));
    assert.ok(pre.changedFiles.length > 0, 'the concurrent modifications must be identified');

    // The merge itself is REFUSED and must go through verification (§87).
    const result = await governedMerge(root, 'worker-b', 'worker-a', { message: 'should not happen' });
    assert.equal(result.merged, false);
    assert.equal(result.requiresVerification, true);
    assert.equal(result.commit, null);
    assert.match(result.summary, /conflict|conflicting/i);

    // The target branch content is untouched: no Worker silently lost work.
    const head = await runShellCommand('git rev-parse --abbrev-ref HEAD', { cwd: root, timeoutMs: 30_000 });
    assert.equal(head.stdout.trim(), 'worker-a');
    const show = await runShellCommand('git show worker-a:shared.txt', { cwd: root, timeoutMs: 30_000 });
    assert.equal(show.stdout.trim(), 'worker A line', "worker A's work must not be overwritten");
    const showB = await runShellCommand('git show worker-b:shared.txt', { cwd: root, timeoutMs: 30_000 });
    assert.equal(showB.stdout.trim(), 'worker B line', "worker B's work must still exist on its own branch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('§87 a NON-conflicting merge is performed, and is explicitly not treated as product correctness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bf-merge-ok-'));
  try {
    await git(root, 'init --initial-branch=main');
    await git(root, '-c user.name=t -c user.email=t@t commit --allow-empty -m init');
    await writeFile(join(root, 'base.txt'), 'base\n', 'utf8');
    await git(root, 'add -A');
    await git(root, '-c user.name=t -c user.email=t@t commit -m base');
    await git(root, 'checkout -b feature');
    await writeFile(join(root, 'feature.txt'), 'feature\n', 'utf8');
    await git(root, 'add -A');
    await git(root, '-c user.name=t -c user.email=t@t commit -m feature');
    await git(root, 'checkout main');
    await writeFile(join(root, 'main-only.txt'), 'main\n', 'utf8');
    await git(root, 'add -A');
    await git(root, '-c user.name=t -c user.email=t@t commit -m mainwork');

    await git(root, 'checkout main');
    const pre = await preflightMerge(root, 'feature', 'main');
    assert.equal(pre.clean, true, pre.detail);

    const result = await governedMerge(root, 'feature', 'main', { message: 'governed merge of feature' });
    assert.equal(result.merged, true, result.summary);
    assert.ok(result.commit !== null);
    // §87: a successful git merge is not product correctness.
    assert.equal(result.requiresVerification, true);
    assert.match(result.summary, /not product correctness/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a non-repository is reported honestly instead of pretending a merge happened', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bf-norepo-'));
  await rm(root, { recursive: true, force: true });
  const again = await mkdtemp(join(tmpdir(), 'bf-norepo-'));
  try {
    const pre = await preflightMerge(again, 'a', 'b');
    assert.equal(pre.clean, false);
    assert.match(pre.detail, /not a real git repository/i);
    const result = await governedMerge(again, 'a', 'b');
    assert.equal(result.merged, false);
  } finally {
    await rm(again, { recursive: true, force: true });
  }
});

test('a merge to a non-existent reference is refused without touching the repository', async () => {
  const root = await makeRepo();
  try {
    await git(root, 'checkout worker-a');
    const result = await governedMerge(root, 'does-not-exist', 'worker-a');
    assert.equal(result.merged, false);
    assert.match(result.summary, /does-not-exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
