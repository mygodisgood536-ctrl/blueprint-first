/**
 * Real Daytona project-execution-environment adapter (LAW - DAYTONA MUST BE
 * INSTALLED AND INTEGRATED).
 *
 * Backs an environment with a REAL Daytona sandbox driven by the REAL Daytona
 * CLI. The command surface below was taken from the installed CLI itself
 * (`daytona <cmd> --help`, v0.190.0), not assumed:
 *
 *   daytona create --name <name> [--snapshot <s>] ...   create a sandbox
 *   daytona list --format json                          list sandboxes (JSON)
 *   daytona exec <SANDBOX_ID|NAME> -- <COMMAND> [ARGS…] [--cwd <dir>] [--timeout <s>]
 *   daytona delete <SANDBOX_ID|NAME>                    delete a sandbox
 *   daytona info <SANDBOX_ID|NAME>                      sandbox info
 *
 * Every operation is a real child process; there is no simulated output. The
 * adapter is selected only when capability discovery reports the `daytona` CLI
 * READY. If the CLI stops answering, health honestly fails rather than
 * pretending the sandbox is there.
 */

import path from 'node:path';
import { runShellCommand } from '../runtime/shell.ts';
import { redactTerminal } from './local-workspace.ts';
import type {
  CommandResultLike,
  EnvAdapter,
  EnvHealth,
  EnvSpec,
  FileEntry,
  GitStatus,
} from './types.ts';

const MAX_READ_CHARS = 3 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 120_000;

export interface DaytonaAdapterOptions {
  /** The daytona executable name/path (default "daytona"). */
  readonly cli?: string;
  /** Snapshot for new sandboxes (passed as --snapshot when given). */
  readonly snapshot?: string;
}

interface DaytonaSandbox {
  id?: string;
  name?: string;
  state?: string;
  snapshot?: string;
  cpu?: number;
  memory?: number;
  [k: string]: unknown;
}

/**
 * Transport notes (win32 cmd.exe): a command line that STARTS with a quoted
 * path trips cmd's /s quote-strip rule, and reserved characters (`& | > < ^`)
 * outside a quoted token are interpreted by cmd before the CLI sees them. We
 * therefore reach a spaced CLI path via `call "...";`, and render any argument
 * containing whitespace or a reserved character as ONE double-quoted token.
 */
function runDaytona(
  cli: string,
  args: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const render = (a: string): string => (/[ &|<>^()"\t]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const cliCmd = /\s/.test(cli) ? `call "${cli}"` : cli;
  return runShellCommand(`${cliCmd} ${args.map(render).join(' ')}`, {
    timeoutMs: opts.timeoutMs ?? EXEC_TIMEOUT_MS,
    maxOutputChars: 256_000,
  }).then((r) => ({ ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }));
}

export class DaytonaWorkspaceAdapter implements EnvAdapter {
  readonly kind = 'daytona';
  private readonly cli: string;
  private readonly name: string;
  private readonly snapshot: string | undefined;

  constructor(workspaceRoot: string, options: DaytonaAdapterOptions = {}) {
    this.cli = options.cli ?? 'daytona';
    // The environment record id is the stable identity for the Daytona sandbox.
    this.name = path.basename(workspaceRoot);
    this.snapshot = options.snapshot;
  }

  /** `daytona exec <name> -- <command> [args...] [--cwd <dir>]` (real surface). */
  private exec(command: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
    const args = ['exec', this.name, '--', command];
    if (opts.cwd !== undefined && opts.cwd !== '.' && opts.cwd !== '') {
      args.push('--cwd', opts.cwd);
    }
    if (opts.timeoutMs !== undefined) {
      args.push('--timeout', String(Math.max(1, Math.round(opts.timeoutMs / 1000))));
    }
    return runDaytona(this.cli, args, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs + 10_000 } : {});
  }

  /** The real sandbox record, or null when the CLI cannot list it. */
  private async sandbox(): Promise<DaytonaSandbox | null> {
    const listed = await runDaytona(this.cli, ['list', '--format', 'json']);
    if (!listed.ok) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(listed.stdout);
    } catch {
      return null;
    }
    const items: DaytonaSandbox[] = Array.isArray(parsed)
      ? (parsed as DaytonaSandbox[])
      : Array.isArray((parsed as { items?: unknown })?.items)
        ? ((parsed as { items: DaytonaSandbox[] }).items)
        : [];
    return items.find((s) => s?.name === this.name || s?.id === this.name) ?? null;
  }

  async provision(spec: EnvSpec): Promise<EnvHealth> {
    const checkedAt = new Date().toISOString();
    const existing = await this.sandbox();
    if (existing === null) {
      const args = ['create', '--name', this.name, ...(this.snapshot !== undefined ? ['--snapshot', this.snapshot] : [])];
      const created = await runDaytona(this.cli, args, { timeoutMs: 300_000 });
      if (!created.ok) {
        return {
          ok: false,
          checkedAt,
          detail: `Daytona sandbox could not be created: ${redactTerminal(created.stderr).trim().slice(0, 300)}`,
        };
      }
    }
    const health = await this.health();
    if (!health.ok) {
      return {
        ok: false,
        checkedAt,
        detail: `Daytona sandbox was requested but could not be verified: ${health.detail}`,
      };
    }
    if (spec.gitEnabled) {
      const git = await this.exec('git init --initial-branch=main');
      if (!git.ok) {
        return {
          ok: false,
          checkedAt,
          detail: `Daytona sandbox verified but git could not be initialized: ${redactTerminal(git.stderr).trim().slice(0, 300)}`,
        };
      }
    }
    return health;
  }

  async health(): Promise<EnvHealth> {
    const checkedAt = new Date().toISOString();
    const version = await runDaytona(this.cli, ['--version']);
    if (!version.ok) {
      return {
        ok: false,
        checkedAt,
        detail: `Daytona CLI is not answering: ${redactTerminal(version.stderr).trim().slice(0, 300)}`,
      };
    }
    const sandbox = await this.sandbox();
    if (sandbox === null) {
      return { ok: false, checkedAt, detail: `Daytona sandbox "${this.name}" is not present in the real sandbox list.` };
    }
    const reachable = await this.exec('pwd');
    if (!reachable.ok) {
      return {
        ok: false,
        checkedAt,
        detail: `Daytona sandbox "${this.name}" is listed but not reachable for execution: ${redactTerminal(reachable.stderr).trim().slice(0, 300)}`,
      };
    }
    const gitAvailable = await this.exec('git status --porcelain');
    let gitBranch = 'unknown';
    if (gitAvailable.ok) {
      const branchProbe = await this.exec('git rev-parse --abbrev-ref HEAD');
      if (branchProbe.ok) gitBranch = branchProbe.stdout.trim().split(/\r?\n/)[0] || 'unknown';
    }
    const state = typeof sandbox.state === 'string' ? sandbox.state : 'unknown';
    return {
      ok: true,
      checkedAt,
      detail: `Daytona sandbox "${this.name}" (${state}) responded to a real execution probe via ${version.stdout.trim()}.`,
      ...(gitAvailable.ok ? { gitAvailable: true, gitBranch } : { gitAvailable: false }),
    };
  }

  async destroy(): Promise<void> {
    await runDaytona(this.cli, ['delete', this.name], { timeoutMs: 180_000 });
  }

  async listFiles(relPath: string): Promise<FileEntry[]> {
    const listing = await this.exec(`ls -la --color=never ${relPath}`);
    if (!listing.ok) {
      throw new Error(`daytona ls failed: ${redactTerminal(listing.stderr).trim().slice(0, 200)}`);
    }
    const entries: FileEntry[] = [];
    for (const raw of listing.stdout.split(/\r?\n/)) {
      const parts = raw.trim().split(/\s+/);
      const name = parts[parts.length - 1];
      if (name === undefined || name === '' || name === '.' || name === '..' || name === 'total') continue;
      const sizeText = parts[parts.length - 5];
      const mtimeText = `${parts[parts.length - 4] ?? ''} ${parts[parts.length - 3] ?? ''} ${parts[parts.length - 2] ?? ''}`;
      const isDir = raw.trim().startsWith('d');
      const size = Number.parseInt(sizeText ?? '0', 10);
      entries.push({
        name,
        relPath: path.posix.join(relPath, name),
        kind: isDir ? 'dir' : 'file',
        size: Number.isFinite(size) ? size : 0,
        mtime: mtimeText,
      });
    }
    return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async readFile(relPath: string): Promise<{ content: string; truncated: boolean }> {
    const out = await this.exec(`cat ${relPath}`);
    if (!out.ok) {
      throw new Error(`daytona cat failed: ${redactTerminal(out.stderr).trim().slice(0, 200)}`);
    }
    const truncated = out.stdout.length > MAX_READ_CHARS;
    return {
      content: truncated ? out.stdout.slice(0, MAX_READ_CHARS) + '\n…[truncated]' : out.stdout,
      truncated,
    };
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    // Single-line, newline-free transfer: `echo <base64> | base64 -d > file`.
    // Keeps the command injectable through ANY shell transport without quoting
    // or heredoc hazards, while still moving real bytes.
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const dir = path.posix.dirname(relPath);
    const mkdir = dir === '.' ? '' : `mkdir -p ${dir} && `;
    const out = await this.exec(`${mkdir}echo ${b64} | base64 -d > ${relPath}`);
    if (!out.ok) {
      throw new Error(`daytona write failed: ${redactTerminal(out.stderr).trim().slice(0, 200)}`);
    }
  }

  async deleteFile(relPath: string): Promise<void> {
    const out = await this.exec(`rm -rf ${relPath}`);
    if (!out.ok) {
      throw new Error(`daytona rm failed: ${redactTerminal(out.stderr).trim().slice(0, 200)}`);
    }
  }

  async renameFile(from: string, to: string): Promise<void> {
    const dir = path.posix.dirname(to);
    const out = await this.exec(`mkdir -p ${dir} && mv ${from} ${to}`);
    if (!out.ok) {
      throw new Error(`daytona mv failed: ${redactTerminal(out.stderr).trim().slice(0, 200)}`);
    }
  }

  async runCommand(
    command: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CommandResultLike> {
    const startedAt = Date.now();
    if (options.signal?.aborted === true) {
      return { exitCode: -1, stdout: '', stderr: 'aborted before execution', durationMs: 0, timedOut: false, aborted: true };
    }
    const out = await this.exec(command, {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    return {
      exitCode: out.ok ? 0 : out.exitCode,
      stdout: redactTerminal(out.stdout),
      stderr: redactTerminal(out.stderr),
      durationMs: Date.now() - startedAt,
      timedOut: false,
      aborted: options.signal?.aborted ?? false,
    };
  }

  async gitStatus(): Promise<GitStatus> {
    const out = await this.exec('git status --porcelain=v1 --branch');
    if (!out.ok) throw new Error(`daytona git status failed: ${redactTerminal(out.stderr).trim().slice(0, 200)}`);
    const lines = out.stdout.split(/\r?\n/).filter((line) => line.length > 0);
    let branch = 'unknown';
    const entries: { path: string; status: string }[] = [];
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const head = line.slice(3);
        const onIdx = head.indexOf(' on ');
        branch = onIdx !== -1 ? head.slice(onIdx + 4).trim() : head.split('...')[0]?.split(' ')[0] ?? branch;
        continue;
      }
      if (line.length >= 4) entries.push({ path: line.slice(3).trim(), status: line.slice(0, 2) });
    }
    return { branch, entries };
  }

  async gitCommit(message: string): Promise<{ commit: string }> {
    // Space-free identity: correct under both /bin/sh and win32 cmd.exe, whose
    // quote handling differs.
    const cfg = 'git -c user.name=Blueprint-First-Workspace -c user.email=bf@daytona.local';
    await this.exec(`${cfg} add -A`);
    const commit = await this.exec(`${cfg} commit -m '${message.replace(/'/g, "'\\''")}'`);
    if (!commit.ok) throw new Error(`daytona git commit failed: ${redactTerminal(commit.stderr).trim().slice(0, 200)}`);
    // LAW - REALITY OVER DECLARATION (§91) / source-control provenance (§"Git"):
    // the recorded commit identity must be the REAL sha of the commit that was
    // just created. Scraping git's human-readable stdout is unreliable (the
    // format varies by version/locale and the transport may truncate it), and
    // the previous fallback silently reported the literal placeholder
    // "committed" - a fabricated provenance value in a governance record.
    // `git rev-parse HEAD` is the authoritative answer; if even that cannot be
    // read the failure is surfaced instead of being papered over.
    const head = await this.exec(`${cfg} rev-parse HEAD`);
    const sha = /^\s*([0-9a-f]{7,40})\s*$/m.exec(head.stdout)?.[1];
    if (sha === undefined) {
      throw new Error(
        `daytona git commit succeeded but the real commit id could not be read from git (rev-parse HEAD returned nothing); no provenance is claimed.`,
      );
    }
    return { commit: sha };
  }
}
