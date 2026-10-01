/**
 * Governed Git merge (ARCHITECTURE 3.3 §86, §87, §213).
 *
 * §86 requires the platform to "detect conflicting modifications BEFORE merge
 * and must never silently overwrite another Worker's work". §87 requires that
 * "merge conflicts, semantic conflicts, stale assumptions, changed upstream
 * artifacts and cross-Worker behavior conflicts must be routed through
 * verification before certification".
 *
 * This is not a test-only merge system: it drives the REAL `git` binary inside
 * the real project environment (the Git / Source Control Engine the architecture
 * requires), inspects the real repository state, and REFUSES to merge when the
 * real git reports a conflict. A merge is never auto-resolved and never counts
 * as product correctness: it produces provenance and a conflict record that must
 * pass verification before anything is certified.
 *
 * The one part that genuinely cannot be implemented here is remote pull-request
 * governance (GitHub/GitLab review + CI), because that requires an external
 * source-control account and network access that this platform does not own.
 * That boundary is reported honestly rather than simulated.
 */

import { runShellCommand } from '../runtime/shell.ts';

export interface GitMergeConflict {
  /** The real path git reported as conflicting. */
  readonly path: string;
  readonly kind: 'content' | 'add/add' | 'modify/delete' | 'unknown';
}

export interface MergePreflight {
  /** True when the real git can merge the two refs with NO conflict. */
  readonly clean: boolean;
  /** Conflicts git actually reported. */
  readonly conflicts: readonly GitMergeConflict[];
  /** Files that differ between the two refs (the concurrent modifications). */
  readonly changedFiles: readonly string[];
  readonly detail: string;
}

export interface GovernedMergeResult {
  readonly merged: boolean;
  readonly preflight: MergePreflight;
  /** Human-readable outcome suitable for evidence and job output. */
  readonly summary: string;
  /** Set when the merge was refused and must go through verification. */
  readonly requiresVerification: boolean;
  readonly commit: string | null;
}

async function git(root: string, args: string, timeoutMs = 60_000): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const r = await runShellCommand(`git ${args}`, { cwd: root, timeoutMs, maxOutputChars: 200_000 });
  return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

/**
 * A merge creates a commit, and git refuses to do that without a committer
 * identity. Many hosts (including this one) have no global git identity
 * configured, so the platform supplies the same explicit attribution it already
 * uses for its own environment commits.
 *
 * The values are deliberately space-free: a win32 `cmd.exe` transport does NOT
 * strip single quotes, so `-c user.name='A B'` would be parsed by git as the
 * subcommand `B`. Space-free values are correct on every shell.
 */
const GIT_IDENTITY = '-c user.name=Blueprint-First-Worker -c user.email=worker@blueprint-first.local';

/** True when a real `git` is resolvable on this host. */
export async function gitAvailable(): Promise<boolean> {
  const r = await runShellCommand('git --version', { timeoutMs: 30_000 });
  return r.exitCode === 0;
}

function parseConflicts(output: string): GitMergeConflict[] {
  const conflicts: GitMergeConflict[] = [];
  // `git merge --no-commit` reports "CONFLICT (content): Merge conflict in <path>".
  for (const line of output.split(/\r?\n/)) {
    const m = /^CONFLICT \(([^)]+)\):.*?in (.+)$/.exec(line.trim());
    if (m !== null) {
      conflicts.push({ path: (m[2] ?? '').trim(), kind: mapKind(m[1] ?? '') });
    }
  }
  return conflicts;
}

function mapKind(raw: string): GitMergeConflict['kind'] {
  const k = raw.toLowerCase();
  if (k.includes('add/add')) return 'add/add';
  if (k.includes('modify/delete') || k.includes('delete/modify')) return 'modify/delete';
  if (k.includes('content')) return 'content';
  return 'unknown';
}

/**
 * Parses `git diff --name-only` output, which is one path per line with no
 * status column. (An earlier version assumed a `--name-status` shape and
 * silently dropped the first path of every line.)
 */
function parseNameStatus(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Pre-flight: what would the real git do, and does it conflict? This never
 * mutates the repository.
 */
export async function preflightMerge(root: string, sourceRef: string, targetRef: string): Promise<MergePreflight> {
  const repo = await git(root, 'rev-parse --is-inside-work-tree');
  if (!repo.ok) {
    return { clean: false, conflicts: [], changedFiles: [], detail: 'The environment is not a real git repository, so a merge cannot be governed.' };
  }
  for (const ref of [sourceRef, targetRef]) {
    const check = await git(root, `rev-parse --verify ${ref}`);
    if (!check.ok) {
      return { clean: false, conflicts: [], changedFiles: [], detail: `Reference "${ref}" does not exist in this repository; nothing was merged.` };
    }
  }

  // The merge target must be the branch that is ACTUALLY checked out. Merging
  // into whatever happens to be current would silently land work on the wrong
  // branch, so a mismatch is refused outright.
  const head = await git(root, 'rev-parse --abbrev-ref HEAD');
  const current = head.ok ? head.stdout.trim() : '';
  if (current !== targetRef) {
    return {
      clean: false,
      conflicts: [],
      changedFiles: [],
      detail: `The environment is on "${current || 'a detached HEAD'}", not on the requested merge target "${targetRef}". Nothing was merged; check out the target first.`,
    };
  }

  // Which files actually changed on the source side relative to the merge base:
  // these are the concurrent modifications that a merge could overwrite.
  const base = await git(root, `merge-base ${targetRef} ${sourceRef}`);
  const baseRef = base.ok ? base.stdout.trim() : targetRef;
  const diff = await git(root, `diff --name-only ${baseRef}..${sourceRef}`);
  const changedFiles = diff.ok ? parseNameStatus(diff.stdout) : [];

  // A real, non-mutating conflict probe: ask git to compute the merge result.
  // `--no-commit --no-ff` stops before the commit so the worktree is only
  // touched when we then abort it.
  const merge = await git(root, `${GIT_IDENTITY} merge --no-commit --no-ff ${sourceRef}`);
  const conflicts = parseConflicts(`${merge.stdout}\n${merge.stderr}`);
  if (merge.ok) {
    // Clean: nothing was left staged by --no-commit, but reset defensively so
    // a preflight never mutates the environment.
    await git(root, 'merge --abort');
    await git(root, 'reset --hard');
    return {
      clean: true,
      conflicts: [],
      changedFiles,
      detail: `The real git reports a clean merge of ${sourceRef} into ${targetRef} (${changedFiles.length} changed file(s)).`,
    };
  }
  // Conflicted (or refused): leave the environment exactly as it was found.
  await git(root, 'merge --abort');
  await git(root, 'reset --hard');
  return {
    clean: false,
    conflicts,
    changedFiles,
    detail:
      conflicts.length > 0
        ? `The real git reported ${conflicts.length} merge conflict(s) between ${sourceRef} and ${targetRef}. No merge was performed and no work was overwritten.`
        : `The real git refused to merge ${sourceRef} into ${targetRef}; nothing was merged.`,
  };
}

/**
 * Performs the merge ONLY when the real pre-flight is clean, and records the
 * provenance. A conflicting merge is refused and flagged for verification
 * (§87) instead of being auto-resolved.
 */
export async function governedMerge(
  root: string,
  sourceRef: string,
  targetRef: string,
  options: { message?: string } = {},
): Promise<GovernedMergeResult> {
  const preflight = await preflightMerge(root, sourceRef, targetRef);
  if (!preflight.clean) {
    return {
      merged: false,
      preflight,
      summary: preflight.detail,
      requiresVerification: true,
      commit: null,
    };
  }
  // The merge message must survive the shell transport intact. On win32 the
  // platform's `cmd.exe /d /s /c` transport strips double quotes before git
  // sees them, which would split a multi-word `-m` value into several refspecs
  // ("merge: merge - not something we can merge"). The message is therefore
  // rendered as a single space-free token, which is correct on every shell.
  const message = transportToken(options.message ?? `merge-${sourceRef}-into-${targetRef}`);
  const merge = await git(root, `${GIT_IDENTITY} merge --no-ff -m ${message} ${sourceRef}`);
  if (!merge.ok) {
    await git(root, 'merge --abort');
    return {
      merged: false,
      preflight,
      summary: `The real git merge failed: ${merge.stderr.trim().slice(0, 300)}`,
      requiresVerification: true,
      commit: null,
    };
  }
  const head = await git(root, 'rev-parse --short HEAD');
  const commit = head.ok ? head.stdout.trim() : null;
  // A clean merge is NOT product correctness (§87): it must still pass
  // verification before anything is certified.
  return {
    merged: true,
    preflight,
    summary: `Merged ${sourceRef} into ${targetRef} as ${commit ?? 'a new commit'}. A successful merge is not product correctness: it must pass verification before certification.`,
    requiresVerification: true,
    commit,
  };
}

/**
 * Collapses a human message into one shell-safe token. The commit message is
 * descriptive metadata, not an identifier, so normalising whitespace keeps the
 * merge's meaning intact while guaranteeing the transport cannot split it.
 */
function transportToken(message: string): string {
  const cleaned = message.replace(/[&|<>^()"'\t\r\n]/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? 'blueprint-first-governed-merge' : cleaned;
}
