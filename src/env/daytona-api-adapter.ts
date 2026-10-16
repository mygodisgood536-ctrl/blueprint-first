/**
 * Daytona REST execution-environment adapter (LAW — DAYTONA MUST BE REAL).
 *
 * Implements the same `EnvAdapter` port as the CLI-backed adapter, but over
 * Daytona's documented HTTP API. This is the ONLY Daytona path that can work on
 * a managed control plane, because a serverless instance has no `daytona`
 * binary and never will.
 *
 * Honesty rules that shape this file:
 *   - a sandbox is READY only after a real `/process/execute` round trip
 *   - a commit returns Daytona's real `hash`; nothing else is ever reported
 *   - every failure carries Daytona's own status and a credential-redacted
 *     detail, so the platform can surface the true condition instead of
 *     claiming success
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { DaytonaApiClient, type DaytonaSandboxRecord } from './daytona-api.ts';
import { redactTerminal } from './local-workspace.ts';
import type {
  CommandResultLike,
  EnvAdapter,
  EnvHealth,
  EnvSpec,
  FileEntry,
  GitStatus,
} from './types.ts';

const EXEC_TIMEOUT_MS = 120_000;

export interface DaytonaApiAdapterOptions {
  readonly apiKey: string;
  readonly apiUrl?: string;
  readonly snapshot?: string;
  readonly fetchImpl?: typeof fetch;
}

export class DaytonaApiWorkspaceAdapter implements EnvAdapter {
  readonly kind = 'daytona' as const;
  /** How this Daytona environment is reached. */
  readonly transport = 'api' as const;
  private readonly client: DaytonaApiClient;
  private readonly name: string;
  private readonly snapshot: string | undefined;

  constructor(workspaceRoot: string, options: DaytonaApiAdapterOptions) {
    this.client = new DaytonaApiClient({
      apiKey: options.apiKey,
      ...(options.apiUrl !== undefined ? { apiUrl: options.apiUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    // Same determinism rule as the CLI adapter: the sandbox name is derived from
    // the workspace path so recovery resolves to the same sandbox, while the
    // hash suffix keeps two tenants/projects from ever colliding in one account.
    const base = path.basename(workspaceRoot).replace(/[^A-Za-z0-9._-]/g, '-');
    const digest = createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 8);
    this.name = `${base}-${digest}`.slice(0, 60);
    this.snapshot = options.snapshot;
  }

  /** Sandbox name this environment owns (exposed for operator diagnostics). */
  get sandboxName(): string {
    return this.name;
  }

  private async sandbox(): Promise<DaytonaSandboxRecord | null> {
    const listed = await this.client.listSandboxes();
    return listed.find((s) => s.name === this.name || s.id === this.name) ?? null;
  }

  async provision(spec: EnvSpec): Promise<EnvHealth> {
    const checkedAt = new Date().toISOString();
    const existing = await this.sandbox();
    if (existing === null) {
      const created = await this.client.createSandbox({
        name: this.name,
        ...(this.snapshot !== undefined ? { snapshot: this.snapshot } : {}),
      });
      if (created.id === undefined) {
        return { ok: false, checkedAt, detail: 'Daytona accepted the create request but returned no sandbox id.' };
      }
    } else {
      // RECONCILIATION BEFORE RETRY: an existing-but-stopped sandbox is started,
      // never duplicated.
      const state = String(existing.state ?? '').toLowerCase();
      if (state !== 'started' && state !== 'running') {
        await this.client.startSandbox(this.name);
      }
    }
    const health = await this.health();
    if (!health.ok) {
      return { ok: false, checkedAt, detail: `Daytona sandbox was requested but is not ready: ${health.detail}` };
    }
    if (spec.gitEnabled) {
      const git = await this.exec('git init --initial-branch=main');
      if (git.exitCode !== 0) {
        return {
          ok: false,
          checkedAt,
          detail: `Daytona sandbox verified but git could not be initialized: ${git.stderr.trim().slice(0, 300)}`,
        };
      }
    }
    return health;
  }

  async health(): Promise<EnvHealth> {
    const checkedAt = new Date().toISOString();
    const api = await this.client.healthy();
    if (!api.ok) return { ok: false, checkedAt, detail: api.detail };
    const sandbox = await this.sandbox();
    if (sandbox === null) {
      return { ok: false, checkedAt, detail: `Daytona sandbox "${this.name}" is not present in the real sandbox list.` };
    }
    const reachable = await this.exec('pwd');
    if (reachable.exitCode !== 0) {
      return {
        ok: false,
        checkedAt,
        detail: `Daytona sandbox "${this.name}" is listed but not reachable for execution: ${reachable.stderr.trim().slice(0, 300)}`,
      };
    }
    const branch = await this.exec('git rev-parse --abbrev-ref HEAD');
    const gitAvailable = branch.exitCode === 0;
    return {
      ok: true,
      checkedAt,
      detail: `Daytona sandbox "${this.name}" (${String(sandbox.state ?? 'unknown')}) answered a real toolbox execution probe over the Daytona API.`,
      gitAvailable,
      ...(gitAvailable ? { gitBranch: branch.result.trim().split(/\r?\n/)[0] ?? 'unknown' } : {}),
    };
  }

  async destroy(): Promise<void> {
    await this.client.deleteSandbox(this.name);
  }

  private async exec(
    command: string,
    options: { cwd?: string; timeoutMs?: number } = {},
  ): Promise<{ exitCode: number; result: string; stderr: string }> {
    const sandbox = await this.sandbox();
    if (sandbox === null) {
      return { exitCode: 127, result: '', stderr: `Daytona sandbox "${this.name}" does not exist.` };
    }
    const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS;
    const out = await this.client.exec(sandbox, command, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      timeoutSec: Math.max(1, Math.round(timeoutMs / 1000)),
    });
    return {
      exitCode: out.exitCode,
      result: out.result,
      stderr: out.exitCode === 0 ? '' : out.result,
    };
  }

  private async requiredSandbox(): Promise<DaytonaSandboxRecord> {
    const sandbox = await this.sandbox();
    if (sandbox === null) throw new Error(`Daytona sandbox "${this.name}" does not exist.`);
    return sandbox;
  }

  async listFiles(relPath: string): Promise<FileEntry[]> {
    const sandbox = await this.requiredSandbox();
    const entries = await this.client.listFiles(sandbox, relPath);
    return entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({
        name: e.name,
        relPath: path.posix.join(relPath, e.name),
        kind: e.isDir ? ('dir' as const) : ('file' as const),
        size: e.size,
        mtime: e.modifiedAt,
      }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async readFile(relPath: string): Promise<{ content: string; truncated: boolean }> {
    const sandbox = await this.requiredSandbox();
    return DaytonaApiClient.truncate(await this.client.readFile(sandbox, relPath));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const sandbox = await this.requiredSandbox();
    await this.client.writeFile(sandbox, relPath, content);
  }

  async deleteFile(relPath: string): Promise<void> {
    const sandbox = await this.requiredSandbox();
    await this.client.deleteFile(sandbox, relPath);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const sandbox = await this.requiredSandbox();
    await this.client.renameFile(sandbox, from, to);
  }

  async runCommand(
    command: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CommandResultLike> {
    const startedAt = Date.now();
    if (options.signal?.aborted === true) {
      return { exitCode: -1, stdout: '', stderr: 'aborted before execution', durationMs: 0, timedOut: false, aborted: true };
    }
    try {
      const out = await this.exec(command, options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {});
      return {
        exitCode: out.exitCode,
        stdout: redactTerminal(out.result),
        stderr: redactTerminal(out.stderr),
        durationMs: Date.now() - startedAt,
        timedOut: false,
        aborted: options.signal?.aborted ?? false,
      };
    } catch (error) {
      return {
        exitCode: 70,
        stdout: '',
        stderr: redactTerminal(`Daytona execution failed: ${(error as Error).message}`),
        durationMs: Date.now() - startedAt,
        timedOut: false,
        aborted: options.signal?.aborted ?? false,
      };
    }
  }

  async gitStatus(): Promise<GitStatus> {
    const sandbox = await this.requiredSandbox();
    const status = await this.client.gitStatus(sandbox);
    return {
      branch: status.currentBranch === '' ? 'unknown' : status.currentBranch,
      entries: (status.fileStatus ?? []).map((f) => ({
        path: f.name,
        status: `${f.staging}${f.worktree === null || f.worktree === undefined ? '' : f.worktree}`,
      })),
    };
  }

  async gitCommit(message: string): Promise<{ commit: string }> {
    const sandbox = await this.requiredSandbox();
    await this.client.gitAdd(sandbox, '.', ['.']);
    // REALITY OVER DECLARATION: the reported identity is Daytona's real commit
    // hash. If Daytona returns no hash - an empty body, a malformed payload, a
    // field that is simply not there - the commit is reported as a failure
    // rather than fabricating provenance for a governance record.
    const result = await this.client.gitCommit(sandbox, '.', message);
    const hash = (result as { hash?: unknown } | null | undefined)?.hash;
    if (typeof hash !== 'string' || hash.trim().length === 0) {
      throw new Error('Daytona accepted the commit but returned no commit hash; no provenance is claimed.');
    }
    return { commit: hash.trim() };
  }
}