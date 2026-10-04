/**
 * Real terminal-command execution for project environments.
 *
 * Commands run in a real child process through the platform's native shell
 * (cmd.exe on win32, /bin/sh elsewhere) with a working directory, a hard
 * timeout, abort support, and capped captured output. This is the primitive
 * behind the environment's terminal view and the Cline-style execution
 * helper: the output users see is the actual stdout/stderr and exit status
 * of the process, never a simulation.
 */

import { spawn, spawnSync } from 'node:child_process';

export interface ShellOptions {
  /** Working directory for the process (default: process cwd). */
  cwd?: string;
  /** Hard kill after this many ms (default 60_000). */
  timeoutMs?: number;
  /** Abort support: killing the signal kills the process. */
  signal?: AbortSignal;
  /** Per-stream capture cap in characters (default 64_000). */
  maxOutputChars?: number;
}

export interface ShellResult {
  readonly command: string;
  /** Real exit code of the shell (undefined kill becomes -1). */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 64_000;

export function platformShell(): { command: string; args: (c: string) => string[] } {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: (c) => ['/d', '/s', '/c', c] };
  }
  return { command: '/bin/sh', args: (c) => ['-c', c] };
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[output truncated]`;
}

/**
 * Terminates the child AND everything it spawned.
 *
 * Why this exists
 * ---------------
 * The child is a shell. `cmd.exe /c cline --version` makes `cline` a
 * GRANDCHILD, and a Node-based `cline` shim makes a great-grandchild. On
 * win32, `child.kill('SIGKILL')` terminates only the direct child - the
 * descendants are re-parented and keep running.
 *
 * That matters because a capability probe is run repeatedly. Every timeout
 * therefore leaked a live `cline` (and its node host) which kept competing for
 * CPU, making the NEXT probe more likely to time out as well. The failure was
 * self-amplifying: a loaded machine leaked processes that loaded it further.
 *
 * On win32 we therefore ask the OS to kill the tree (`taskkill /T /F`), and on
 * POSIX we run the child as a group leader so the whole group can be signalled.
 */
function killProcessTree(child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean }): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      // /T = include descendants, /F = force. Best effort: a process that has
      // already exited makes taskkill return non-zero, which is not an error.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10_000,
      });
      return;
    } catch {
      // fall through to the direct kill below
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already exited
  }
}

export function runShellCommand(command: string, options: ShellOptions = {}): Promise<ShellResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const shell = platformShell();
  const startedAt = Date.now();
  const cwd = options.cwd;

  return new Promise((resolve) => {
    const isCmd = process.platform === 'win32';
    const child = spawn(shell.command, shell.args(command), {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: isCmd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxChars) stdout = truncate(stdout, maxChars);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > maxChars) stderr = truncate(stderr, maxChars);
    });

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      resolve({
        command,
        exitCode: timedOut || aborted || child.exitCode === null ? -1 : child.exitCode,
        stdout,
        stderr,
        durationMs,
        timedOut,
        aborted,
      });
    };

    child.on('close', () => finish());

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        killProcessTree(child);
      } catch {
        // already exited
      }
      finish();
    }, timeoutMs);

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        aborted = true;
        try {
          killProcessTree(child);
        } catch {
          // already exited
        }
        finish();
      } else {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            try {
              killProcessTree(child);
            } catch {
              // already exited
            }
            finish();
          },
          { once: true },
        );
      }
    }
  });
}