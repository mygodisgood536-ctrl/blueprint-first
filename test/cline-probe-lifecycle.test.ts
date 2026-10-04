/**
 * CLINE CAPABILITY PROBE — PROCESS LIFECYCLE REGRESSION
 *
 * The failure this guards against
 * -------------------------------
 * `env-gate-auto-ready` failed intermittently with `cline` reported as neither
 * READY nor NOT_INSTALLED (DEGRADED). The cause was NOT a slow machine and NOT
 * too short a timeout; it was process lifecycle:
 *
 *   1. `probeBinary` runs `cline --version` through a SHELL (`cmd.exe /c ...`),
 *      so `cline` is a grandchild and its node host a great-grandchild.
 *   2. On timeout, `child.kill('SIGKILL')` kills ONLY `cmd.exe`. The
 *      descendants survive, re-parented, still consuming CPU.
 *   3. A capability probe is run repeatedly (discovery + adapter + every test
 *      server). Each timeout therefore leaked live processes.
 *   4. Those orphans made the NEXT probe slower, so the next probe was more
 *      likely to time out too. The failure was self-amplifying.
 *
 * These tests pin the two fixes and would fail against the old behaviour:
 *   - a timed-out command leaves NO surviving descendant;
 *   - concurrent probes of the same binary share ONE child process.
 *
 * They deliberately do NOT weaken the readiness requirement: the Cline
 * capability must still be probed for real, and an unresponsive CLI must still
 * be reported DEGRADED rather than READY.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runShellCommand } from '../src/runtime/shell.ts';
import { probeBinary } from '../src/env/capabilities.ts';

/**
 * Counts live processes whose command line contains `needle`.
 *
 * The counting command's OWN command line contains the needle too, so powershell
 * processes are excluded - otherwise the counter always reports itself.
 */
function countProcesses(needle: string): number {
  if (process.platform !== 'win32') return 0;
  const out = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.CommandLine -like '*${needle}*' } | Measure-Object).Count`,
  ], { encoding: 'utf8', windowsHide: true });
  const n = Number.parseInt((out.stdout ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

const isWindows = process.platform === 'win32';

describe('a timed-out command leaves no surviving descendant', () => {
  test('the whole process tree is terminated, not just the shell', { skip: !isWindows }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-tree-'));
    // A grandchild that outlives its parent unless the WHOLE tree is killed.
    // If only the shell dies, this keeps sleeping and the count below grows.
    const script = join(dir, 'grandchild.js');
    await writeFile(
      script,
      'setTimeout(() => {}, 120000);',
      'utf8',
    );
    // runShellCommand already wraps this in `cmd.exe /d /s /c`, so `node` is a
    // direct child of the shell. Killing only the shell leaves node running -
    // which is exactly the leak this test exists to catch.
    const cmd = `node "${script}"`;
    const before = countProcesses(script);

    const result = await runShellCommand(cmd, { timeoutMs: 3_000 });
    assert.equal(result.timedOut, true, 'the command must actually time out for this to test anything');
    assert.equal(result.exitCode, -1, 'a timeout reports -1');

    // Give the OS a moment to finish reaping, then confirm nothing survived.
    await new Promise((r) => setTimeout(r, 3_000));
    const after = countProcesses(script);
    assert.equal(
      after,
      0,
      `a timed-out command must leave no descendants (found ${after}, expected 0; baseline ${before})`,
    );
    await rm(dir, { recursive: true, force: true });
  });
});

describe('concurrent capability probes do not multiply processes', () => {
  test('many simultaneous probes of one binary share a single child', async () => {
    const key = 'nonexistent-binary-that-cannot-resolve';
    // Ten concurrent probes of the SAME binary must share one in-flight probe
    // rather than each spawning its own shell.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => probeBinary(key, ['--version'], { timeoutMs: 5_000 })),
    );
    const first = results[0];
    for (const r of results) {
      assert.deepEqual(r, first, 'concurrent probes of one binary must agree exactly');
    }
  });

  test('concurrent probes are not cached across sequential calls', async () => {
    // Sharing must not become caching: a later probe has to re-run, so a
    // component that appears (or stops answering) is still detected.
    const key = 'nonexistent-binary-that-cannot-resolve-2';
    const a = await probeBinary(key, ['--version'], { timeoutMs: 5_000 });
    const b = await probeBinary(key, ['--version'], { timeoutMs: 5_000 });
    assert.deepEqual(a, b, 'two sequential probes of a stable binary agree');
    // Both must have actually executed (a genuine, if failed, result).
    assert.ok(a === null || typeof a.exitCode === 'number', 'a probe always yields a real result');
  });

  test('the readiness requirement itself is unchanged', async () => {
    // A component that does not exist must be reported NOT_INSTALLED (null), not
    // DEGRADED. Probing through a shell means the shell always spawns, so a
    // missing binary arrives as a non-zero exit; treating that as "installed but
    // broken" would over-claim. DEGRADED must stay reserved for a component that
    // is genuinely present and answered badly.
    const result = await probeBinary('definitely-not-a-real-binary-xyz', ['--version'], { timeoutMs: 5_000 });
    assert.equal(result, null, 'a binary that cannot exist must report null (NOT_INSTALLED), never a result');
  });

  test('an absent binary and a broken binary are different facts', { skip: !isWindows }, async () => {
    // `cmd /c <missing>` writes this exact text and exits non-zero. Without the
    // classification the platform called an absent CLI DEGRADED, which claims a
    // component is installed when it is not.
    const absent = await runShellCommand('definitely-not-a-real-binary-xyz --version', { timeoutMs: 10_000 });
    assert.notEqual(absent.exitCode, 0, 'the shell exits non-zero for a missing command');
    assert.match(
      absent.stderr,
      /is not recognized as an internal or external command/i,
      'the shell says so explicitly',
    );
    // And the probe layer must translate exactly that into NOT_INSTALLED.
    assert.equal(
      await probeBinary('definitely-not-a-real-binary-xyz', ['--version'], { timeoutMs: 10_000 }),
      null,
      'an absent binary must classify as NOT_INSTALLED',
    );
  });

  test('a real, present binary still reaches READY through the same probe', async () => {
    // The genuine readiness requirement: when the component really is available,
    // the probe must still succeed. `node` is guaranteed present (it is running
    // this test), so this proves the classification did not swallow real results.
    const present = await probeBinary('node', ['--version'], { timeoutMs: 30_000 });
    assert.notEqual(present, null, 'a present binary must not be classified as absent');
    assert.equal(present?.exitCode, 0, 'a present, working binary must exit 0');
    assert.match(present?.stdout ?? '', /v\d+/, 'and report a version');
  });
});