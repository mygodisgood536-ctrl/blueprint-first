/**
 * Real local project environment: a real directory on the host with real
 * files, real child-process commands and real git.
 *
 * This is the environment backend used on this host (where no Daytona CLI is
 * present). It is NOT a simulation: listFiles/readFile/writeFile operate on
 * actual filesystem entries, runCommand executes a real process through the
 * platform shell, and git operations use the system git executable. The
 * Daytona adapter implements the same contract and is selected when available.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runShellCommand } from '../runtime/shell.ts';
import type {
  CommandResultLike,
  EnvAdapter,
  EnvHealth,
  EnvSpec,
  FileEntry,
  GitStatus,
} from './types.ts';

const MAX_READ_CHARS = 3 * 1024 * 1024;
const MANIFEST_NAME = '.nexona-manifest.json';

/** Masks obvious credential material in captured terminal output. */
export function redactTerminal(text: string): string {
  return (
    text
      // "Authorization: Bearer <token...>" / "Bearer <token>": redact the whole
      // value including multi-token credentials (conservative over-redaction).
      .replace(
        /\b(bearer|authorization)\b(\s*[:=]?\s+)([A-Za-z0-9._~+/=!#@-]+(?:\s+[A-Za-z0-9._~+/=!#@-]+){0,4})/gi,
        '$1$2[REDACTED]',
      )
      // "key=value", "key: value" for common secret names
      .replace(/(api[_-]?key|secret|token)([=:]\s*)(\S+)/gi, '$1$2[REDACTED]')
      // long OpenAI-style keys
      .replace(/\b(sk|pk)-[A-Za-z0-9_-]{12,}\b/g, '$1-[REDACTED]')
  );
}

function sanitizeRelPath(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${relPath}" escapes the workspace; rejected.`);
  }
  return resolved;
}

export class LocalWorkspaceEnvAdapter implements EnvAdapter {
  readonly kind = 'local-workspace';
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = workspaceRoot;
  }

  get workspaceRoot(): string {
    return this.root;
  }

  async provision(spec: EnvSpec): Promise<EnvHealth> {
    await fs.mkdir(this.root, { recursive: true });
    const manifest = {
      kind: 'nexona-project-environment',
      adapter: 'local-workspace',
      label: spec.label,
      gitEnabled: spec.gitEnabled,
      createdAt: new Date().toISOString(),
      nonce: randomBytes(8).toString('hex'),
    };
    await fs.writeFile(path.join(this.root, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');
    if (spec.gitEnabled) {
      await this.gitInit('main');
    }
    return this.health();
  }

  private async gitInit(branch: string): Promise<void> {
    try {
      await this.runReal('git', ['-C', this.root, 'init', `--initial-branch=${branch}`]);
      try {
        await this.runReal('git', ['-C', this.root, 'add', '-A']);
        await this.gitCommit('Initial workspace materialization');
      } catch {
        // no commitable files yet is not a failure
      }
    } catch {
      // git unavailability is reported through health(), never hidden
    }
  }

  private async runReal(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString('utf8');
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
      });
      child.on('close', () => {
        resolve({ exitCode: child.exitCode ?? -1, stdout, stderr });
      });
    });
  }

  async health(): Promise<EnvHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const stat = await fs.stat(this.root);
      if (!stat.isDirectory()) {
        return { ok: false, checkedAt, detail: `Workspace root ${this.root} is not a directory.` };
      }
      await fs.access(path.join(this.root, MANIFEST_NAME));
      let detail = 'Workspace and manifest present.';
      try {
        const status = await this.gitStatus();
        return {
          ok: true,
          checkedAt,
          detail: `${detail} Git status read (${status.entries.length} changes on ${status.branch}).`,
          gitAvailable: true,
          gitBranch: status.branch,
        };
      } catch {
        return { ok: true, checkedAt, detail: `${detail} Git not available in this environment.`, gitAvailable: false };
      }
    } catch {
      return { ok: false, checkedAt, detail: `Workspace ${this.root} is missing or incomplete.` };
    }
  }

  async destroy(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }

  async listFiles(relPath: string): Promise<FileEntry[]> {
    const dir = sanitizeRelPath(this.root, relPath);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      out.push({
        name: entry.name,
        relPath: path.join(relPath, entry.name).replace(/\\/g, '/'),
        kind: entry.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async readFile(relPath: string): Promise<{ content: string; truncated: boolean }> {
    const file = sanitizeRelPath(this.root, relPath);
    const raw = await fs.readFile(file, 'utf8');
    const truncated = raw.length > MAX_READ_CHARS;
    return { content: truncated ? raw.slice(0, MAX_READ_CHARS) + '\n…[truncated]' : raw, truncated };
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const file = sanitizeRelPath(this.root, relPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }

  async deleteFile(relPath: string): Promise<void> {
    const file = sanitizeRelPath(this.root, relPath);
    await fs.rm(file, { recursive: true, force: true });
  }

  async renameFile(from: string, to: string): Promise<void> {
    const source = sanitizeRelPath(this.root, from);
    const target = sanitizeRelPath(this.root, to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
  }

  async runCommand(
    command: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CommandResultLike> {
    const result = await runShellCommand(command, {
      cwd: this.root,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return {
      exitCode: result.exitCode,
      stdout: redactTerminal(result.stdout),
      stderr: redactTerminal(result.stderr),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      aborted: result.aborted,
    };
  }

  async gitStatus(): Promise<GitStatus> {
    const status = await this.runReal('git', ['-C', this.root, 'status', '--porcelain=v1', '--branch']);
    if (status.exitCode !== 0) throw new Error(`git status failed: ${redactTerminal(status.stderr)}`);
    const lines = status.stdout.split(/\r?\n/).filter((line) => line.length > 0);
    let branch = 'unknown';
    const entries: { path: string; status: string }[] = [];
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const head = line.slice(3);
        const onIdx = head.indexOf(' on ');
        if (onIdx !== -1) {
          branch = head.slice(onIdx + 4).trim();
        } else {
          branch = head.split('...')[0]?.split(' ')[0] ?? branch;
        }
        continue;
      }
      if (line.length >= 4) {
        entries.push({ path: line.slice(3).trim(), status: line.slice(0, 2) });
      }
    }
    return { branch, entries };
  }

  async gitCommit(message: string): Promise<{ commit: string }> {
    await this.runReal('git', ['-C', this.root, '-c', 'user.name=Nexona Workspace', '-c', 'user.email=nexona@local', 'add', '-A']);
    const commit = await this.runReal('git', [
      '-C',
      this.root,
      '-c',
      'user.name=Nexona Workspace',
      '-c',
      'user.email=nexona@local',
      'commit',
      '-m',
      message,
    ]);
    if (commit.exitCode !== 0) throw new Error(`git commit failed: ${redactTerminal(commit.stderr)}`);
    const hash = /\[[A-Za-z]+ [0-9a-f]{7,}\]/.exec(commit.stdout)?.[0];
    return { commit: hash ? hash : 'committed' };
  }
}