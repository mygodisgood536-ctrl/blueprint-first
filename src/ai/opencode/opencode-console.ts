/**
 * OpenCode Console client — the authoritative account catalogue.
 *
 * OpenCode Console is a pay-as-you-go gateway. The account's API key
 * authenticates against OpenCode's own endpoints, and the model list it returns
 * is what that account can ACTUALLY use right now: a model that has been
 * withdrawn, disabled for the workspace, or made unavailable in the account's
 * region simply does not appear in the response.
 *
 * Two facts drive this module's design:
 *
 *   1. The catalogue must be PUSHED by OpenCode, never hard-coded by the
 *      platform. A model list frozen in the source is wrong the moment OpenCode
 *      changes, and the platform would go on offering a model that no longer
 *      exists.
 *
 *   2. The console key is a secret. It is read from the server-side secret
 *      boundary, is never sent to a browser, never logged, and never included
 *      in a response body. The browser only ever receives model identifiers and
 *      the non-secret availability state.
 *
 * Failures are reported precisely, because a stale catalogue silently presented
 * as fresh is worse than an honest error: the caller records the failure, the
 * age of the data it still has, and whether what it is serving is expired.
 */

import { createHash } from 'node:crypto';

export const OPENCODE_CONSOLE_DEFAULT_BASE = 'https://opencode.ai';

export type OpenCodeConsoleFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'not-found'
  | 'server-error'
  | 'network'
  | 'malformed';

export interface OpenCodeConsoleModel {
  readonly id: string;
  readonly ownedBy: string;
}

export interface OpenCodeConsoleSuccess {
  readonly ok: true;
  readonly models: readonly OpenCodeConsoleModel[];
  /** The instant the catalogue was actually fetched. */
  readonly fetchedAt: string;
  /** sha256 over the model ids, so a change is detectable cheaply. */
  readonly catalogueHash: string;
}

export interface OpenCodeConsoleFailureResult {
  readonly ok: false;
  readonly failure: OpenCodeConsoleFailure;
  /** Actionable, secret-free explanation. */
  readonly detail: string;
  /** HTTP status when there was a response. */
  readonly status: number | null;
  /** Seconds the caller should wait before retrying, when the service said so. */
  readonly retryAfterSeconds: number | null;
}

export type OpenCodeConsoleResult = OpenCodeConsoleSuccess | OpenCodeConsoleFailureResult;

export interface OpenCodeConsoleOptions {
  readonly apiKey: string;
  /** Console base URL. Defaults to OpenCode's hosted console. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * The console model list endpoint.
 *
 * OpenCode documents this as the way to fetch "the full list of available
 * models and their metadata". The response is OpenAI-shaped: `{ data: [...] }`
 * with an `id` per model. Only the identifier and owner are used: the platform
 * takes PRICING from the catalogue it already syncs and AVAILABILITY from this
 * list, so nothing is invented on either side.
 */
export function openCodeConsoleModelsPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/inference/v1/models`;
}

/**
 * Fetches the model list the connected OpenCode account can actually use.
 *
 * The key is sent only in the Authorization header and is never included in the
 * result, so a failure can be surfaced to a user without leaking it.
 */
export async function fetchOpenCodeConsoleCatalogue(
  options: OpenCodeConsoleOptions,
): Promise<OpenCodeConsoleResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? OPENCODE_CONSOLE_DEFAULT_BASE).replace(/\/+$/, '');
  const url = openCodeConsoleModelsPath(base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (res.status === 401) {
      return {
        ok: false,
        failure: 'unauthorized',
        detail: 'OpenCode rejected the console API key. The stored key is not authorized for this account.',
        status: 401,
        retryAfterSeconds: null,
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        failure: 'forbidden',
        detail: 'OpenCode refused the console API key for this operation. The key is valid but not permitted here.',
        status: 403,
        retryAfterSeconds: null,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        failure: 'not-found',
        detail: 'The OpenCode console model endpoint was not found at the configured address.',
        status: 404,
        retryAfterSeconds: null,
      };
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '');
      return {
        ok: false,
        failure: 'rate-limited',
        detail: 'OpenCode is rate limiting the console catalogue request.',
        status: 429,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        failure: 'server-error',
        detail: `The OpenCode console catalogue request failed with HTTP ${res.status}.`,
        status: res.status,
        retryAfterSeconds: null,
      };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown })?.data)
        ? ((body as { data: unknown[] }).data)
        : null;
    if (rows === null) {
      return {
        ok: false,
        failure: 'malformed',
        detail: 'The OpenCode console catalogue response was not a recognised model list.',
        status: res.status,
        retryAfterSeconds: null,
      };
    }
    const models: OpenCodeConsoleModel[] = [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const id = (row as { id?: unknown }).id;
      if (typeof id !== 'string' || id.trim().length === 0) continue;
      const ownedBy = (row as { owned_by?: unknown }).owned_by;
      models.push({ id: id.trim(), ownedBy: typeof ownedBy === 'string' ? ownedBy : 'opencode' });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return {
      ok: true,
      models,
      fetchedAt: new Date().toISOString(),
      catalogueHash: createHash('sha256').update(models.map((m) => m.id).join('\n')).digest('hex'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failure: 'network',
      detail: `The OpenCode console could not be reached: ${message.replace(/oc_sk_[A-Za-z0-9_-]+/g, '[redacted]')}`,
      status: null,
      retryAfterSeconds: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
