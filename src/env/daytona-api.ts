/**
 * Real Daytona REST client (cloud execution environment).
 *
 * The control plane runs on Vercel, where no `daytona` binary can exist. The
 * architecture requires a REAL Daytona integration, not a simulated one, so the
 * production path drives Daytona's documented HTTP API directly:
 *
 *   Platform API  {DAYTONA_API_URL}/…            (default https://app.daytona.io/api)
 *     GET    /health
 *     GET    /sandbox
 *     POST   /sandbox
 *     GET    /sandbox/{idOrName}
 *     POST   /sandbox/{idOrName}/start
 *     DELETE /sandbox/{idOrName}
 *
 *   Toolbox API   {sandbox.toolboxProxyUrl}/{sandboxId}/…
 *     POST /process/execute      GET  /files        GET  /files/download
 *     POST /files/upload-v2      POST /files/move    DELETE /files
 *     GET  /git/status           POST /git/add       POST /git/commit
 *
 * Every call is a genuine HTTPS request against Daytona. Nothing here fabricates
 * a sandbox, a command result, a file or a commit id: a failed call surfaces the
 * real status and body (credential-redacted) so the caller can report the true
 * condition.
 *
 * Secret boundary: the API key is read from the server-side credential store and
 * is never logged, echoed, placed in evidence, or returned to a client.
 */

import path from 'node:path';

const DEFAULT_PLATFORM_URL = 'https://app.daytona.io/api';
const MAX_READ_BYTES = 4 * 1024 * 1024;

export interface DaytonaApiOptions {
  readonly apiKey: string;
  /** Platform API base URL. Defaults to Daytona's hosted API. */
  readonly apiUrl?: string;
  /** Default request timeout in ms. */
  readonly timeoutMs?: number;
  /** Injectable fetch (tests). Defaults to the global. */
  readonly fetchImpl?: typeof fetch;
}

export interface DaytonaSandboxRecord {
  readonly id: string;
  readonly name?: string;
  readonly state?: string;
  readonly snapshot?: string;
  readonly toolboxProxyUrl?: string;
  readonly target?: string;
  readonly rootDir?: string;
}

interface DaytonaErrorBody {
  readonly message?: string;
  readonly error?: string;
}

export class DaytonaApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DaytonaApiError';
    this.status = status;
    this.code = code;
  }
}

function redact(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/dtn_[A-Za-z0-9_-]+/g, '<redacted>')
    .slice(0, 400);
}

export class DaytonaApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DaytonaApiOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.apiUrl ?? DEFAULT_PLATFORM_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    url: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let detail = text;
        try {
          const parsed = JSON.parse(text) as DaytonaErrorBody;
          detail = parsed.message ?? parsed.error ?? text;
        } catch {
          /* keep raw text */
        }
        throw new DaytonaApiError(response.status, `daytona_http_${response.status}`, redact(detail));
      }
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (text.length === 0) {
        throw new DaytonaApiError(response.status, 'daytona_empty_response', `Daytona returned an empty body for ${new URL(url).pathname}.`);
      }
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof DaytonaApiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new DaytonaApiError(0, 'daytona_timeout', `Daytona request timed out after ${this.timeoutMs}ms.`);
      }
      throw new DaytonaApiError(0, 'daytona_unreachable', redact((error as Error).message));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Raw (non-JSON) GET, used for file downloads. */
  private async requestText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        throw new DaytonaApiError(response.status, `daytona_http_${response.status}`, redact(await response.text().catch(() => '')));
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Raw (binary) POST, used for the multipart upload endpoint. */
  private async requestBytes(
    url: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': contentType,
          'Content-Length': String(body.byteLength),
        },
        body: new Uint8Array(body),
      });
      if (!response.ok) {
        return { ok: false, detail: redact(await response.text().catch(() => '')) };
      }
      return { ok: true, detail: 'ok' };
    } catch (error) {
      return { ok: false, detail: redact((error as Error).message) };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- platform API -------------------------------------------------------------

  async healthy(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.request<unknown>(`${this.baseUrl}/health`);
      return { ok: true, detail: `Daytona platform API reachable at ${this.baseUrl}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  /** Verifies the credential itself (V.10 — real connection, not a config record). */
  /**
   * Verifies the credential against the endpoints the platform ACTUALLY uses.
   *
   * The probe deliberately does not depend on `/users/me`: against Daytona's
   * live API that endpoint authenticates an interactive session and answers
   * "Invalid credentials" for a perfectly valid API key, while the sandbox
   * endpoints - the ones every real operation goes through - accept it. Gating
   * on it reported a working credential as broken and left the platform unable
   * to execute anything.
   *
   * The sandbox listing is the authoritative check, because a credential that
   * can list the account's sandboxes can also create them. The account label
   * is derived from what Daytona actually answered.
   */
  async verifyCredential(): Promise<{ ok: boolean; detail: string; user?: string }> {
    try {
      const body = await this.request<DaytonaSandboxRecord[] | { items?: DaytonaSandboxRecord[] }>(
        `${this.baseUrl}/sandbox`,
      );
      const items = Array.isArray(body) ? body : (body.items ?? []);
      const label = `the authenticated Daytona account (${items.length} sandbox${items.length === 1 ? '' : 'es'} visible)`;
      return { ok: true, detail: `Daytona credential accepted for ${label}.`, user: label };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async listSandboxes(): Promise<DaytonaSandboxRecord[]> {
    const body = await this.request<DaytonaSandboxRecord[] | { items?: DaytonaSandboxRecord[] }>(
      `${this.baseUrl}/sandbox`,
    );
    if (Array.isArray(body)) return body;
    return body.items ?? [];
  }

  async getSandbox(idOrName: string): Promise<DaytonaSandboxRecord | null> {
    try {
      return await this.request<DaytonaSandboxRecord>(
        `${this.baseUrl}/sandbox/${encodeURIComponent(idOrName)}`,
      );
    } catch (error) {
      if (error instanceof DaytonaApiError && error.status === 404) return null;
      throw error;
    }
  }

  async createSandbox(input: { name?: string; snapshot?: string }): Promise<DaytonaSandboxRecord> {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body['name'] = input.name;
    if (input.snapshot !== undefined) body['snapshot'] = input.snapshot;
    return this.request<DaytonaSandboxRecord>(`${this.baseUrl}/sandbox`, { method: 'POST', body });
  }

  async startSandbox(idOrName: string): Promise<void> {
    await this.request<void>(`${this.baseUrl}/sandbox/${encodeURIComponent(idOrName)}/start`, {
      method: 'POST',
      body: {},
    });
  }

  async deleteSandbox(idOrName: string): Promise<void> {
    await this.request<void>(`${this.baseUrl}/sandbox/${encodeURIComponent(idOrName)}`, {
      method: 'DELETE',
    });
  }

  // --- toolbox API -------------------------------------------------------------

  async toolbox(sandbox: DaytonaSandboxRecord): Promise<string> {
    if (sandbox.toolboxProxyUrl !== undefined && sandbox.toolboxProxyUrl.length > 0) {
      return `${sandbox.toolboxProxyUrl.replace(/\/+$/, '')}/${sandbox.id}`;
    }
    const detail = await this.request<{ toolboxProxyUrl?: string }>(
      `${this.baseUrl}/sandbox/${encodeURIComponent(sandbox.id)}`,
    );
    if (detail.toolboxProxyUrl === undefined) {
      throw new DaytonaApiError(0, 'daytona_no_toolbox', 'Daytona did not report a toolbox proxy URL for this sandbox.');
    }
    return `${detail.toolboxProxyUrl.replace(/\/+$/, '')}/${sandbox.id}`;
  }

  async exec(
    sandbox: DaytonaSandboxRecord,
    command: string,
    options: { cwd?: string; timeoutSec?: number } = {},
  ): Promise<{ exitCode: number; result: string }> {
    const base = await this.toolbox(sandbox);
    const response = await this.request<{ result?: string; exitCode?: number }>(
      `${base}/process/execute`,
      {
        method: 'POST',
        body: {
          command,
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.timeoutSec !== undefined ? { timeout: options.timeoutSec } : {}),
        },
      },
    );
    return { exitCode: response.exitCode ?? 0, result: response.result ?? '' };
  }

  async listFiles(
    sandbox: DaytonaSandboxRecord,
    relPath: string,
  ): Promise<{ name: string; path: string; isDir: boolean; size: number; modifiedAt: string }[]> {
    const base = await this.toolbox(sandbox);
    const entries = await this.request<
      { name: string; path: string; isDir: boolean; size: number; modifiedAt: string }[]
    >(`${base}/files?path=${encodeURIComponent(relPath)}`);
    return Array.isArray(entries) ? entries : [];
  }

  async readFile(sandbox: DaytonaSandboxRecord, relPath: string): Promise<string> {
    const base = await this.toolbox(sandbox);
    return this.requestText(`${base}/files/download?path=${encodeURIComponent(relPath)}`);
  }

  async writeFile(sandbox: DaytonaSandboxRecord, relPath: string, content: string): Promise<void> {
    const base = await this.toolbox(sandbox);
    const payload = Buffer.from(content, 'utf8');
    const boundary = `----blueprintfirst${Date.now().toString(16)}${payload.byteLength.toString(16)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="content"; filename="${path.basename(relPath).replace(/"/g, '')}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, payload, tail]);
    const result = await this.requestBytes(
      `${base}/files/upload-v2?path=${encodeURIComponent(relPath)}`,
      body,
      `multipart/form-data; boundary=${boundary}`,
    );
    if (!result.ok) throw new DaytonaApiError(0, 'daytona_write_failed', result.detail);
  }

  async deleteFile(sandbox: DaytonaSandboxRecord, relPath: string): Promise<void> {
    const base = await this.toolbox(sandbox);
    await this.request<void>(
      `${base}/files?path=${encodeURIComponent(relPath)}&recursive=${path.basename(relPath).length > 0 ? 'true' : 'false'}`,
      { method: 'DELETE' },
    );
  }

  async renameFile(
    sandbox: DaytonaSandboxRecord,
    from: string,
    to: string,
  ): Promise<void> {
    const base = await this.toolbox(sandbox);
    await this.request<void>(
      `${base}/files/move?source=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`,
      { method: 'POST', body: {} },
    );
  }

  async gitStatus(
    sandbox: DaytonaSandboxRecord,
  ): Promise<{ currentBranch: string; fileStatus: { name: string; staging: string; worktree: string | null }[] }> {
    const base = await this.toolbox(sandbox);
    return this.request(`${base}/git/status?path=${encodeURIComponent('.')}`);
  }

  async gitAdd(sandbox: DaytonaSandboxRecord, relPath: string, files: string[]): Promise<void> {
    const base = await this.toolbox(sandbox);
    await this.request<void>(`${base}/git/add`, { method: 'POST', body: { path: relPath, files } });
  }

  async gitCommit(
    sandbox: DaytonaSandboxRecord,
    relPath: string,
    message: string,
    author = 'Blueprint-First Workspace',
    email = 'bf@daytona.local',
  ): Promise<{ hash: string }> {
    const base = await this.toolbox(sandbox);
    return this.request<{ hash: string }>(`${base}/git/commit`, {
      method: 'POST',
      body: { path: relPath, message, author, email },
    });
  }

  /** Bounded read helper so a huge file cannot exhaust the control plane. */
  static truncate(content: string): { content: string; truncated: boolean } {
    const truncated = content.length > MAX_READ_BYTES;
    return {
      content: truncated ? `${content.slice(0, MAX_READ_BYTES)}\n…[truncated]` : content,
      truncated,
    };
  }
}

/** Verifies an API key against the real Daytona API before it is ever stored. */
export async function verifyDaytonaApiKey(
  apiKey: string,
  options: { apiUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; detail: string }> {
  const client = new DaytonaApiClient({
    apiKey,
    ...(options.apiUrl !== undefined ? { apiUrl: options.apiUrl } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    timeoutMs: 15_000,
  });
  return client.verifyCredential();
}