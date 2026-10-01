/**
 * Local runtime provider (Ollama, LM Studio, and other OpenAI-compatible
 * local runtimes).
 *
 * This is Blueprint-First's real 'local' access path: a model served by a
 * runtime on the user's own machine requires no API key, so verification
 * legitimately succeeds WITHOUT credentials — that is the honest mechanism
 * behind the 'local' access category, never an inference from a catalogue.
 *
 * Verified wire shapes (both runtimes expose an OpenAI-compatible surface):
 *   GET  {base}/models            -> { object: "list", data: [ { id, ... } ] }
 *   POST {base}/chat/completions  -> OpenAI chat-completions shape
 * (Ollama also accepts /v1/models and /v1/chat/completions; LM Studio serves
 * /v1/... directly. The base URL carries the version prefix, so this module
 * appends only /models and /chat/completions.)
 *
 * Status taxonomy (expansion §19) — every state is reported honestly:
 *   connected | auth_required | rate_limited | model_unavailable |
 *   provider_unavailable | unsupported
 * A reachable runtime that lacks a requested model reports
 * 'model_unavailable' with the model id — never a generic failure.
 */

import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';
import type {
  ModelInfo,
  ModelCapabilities,
  ConnectionTestResult,
} from './provider-metadata.ts';
import { ProviderHttpError } from '../core/errors.ts';

export const LOCAL_PROVIDER_ID = 'local';
/** Runtimes known to serve the OpenAI-compatible surface this module speaks. */
export const SUPPORTED_LOCAL_RUNTIMES = ['ollama', 'lmstudio'] as const;
export type LocalRuntime = (typeof SUPPORTED_LOCAL_RUNTIMES)[number];

/** Connection/availability status reported by localProviderStatus(). */
export type ProviderStatus =
  | 'connected'
  | 'auth_required'
  | 'rate_limited'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'unsupported';

const BODY_PREVIEW_MAX_CHARS = 500;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface FetchFn {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export interface LocalProviderOptions {
  /** Base URL including any version prefix, e.g. "http://127.0.0.1:11434/v1". */
  baseUrl: string;
  runtime?: LocalRuntime;
  fetchImpl?: FetchFn;
  /** Default model when a request carries none (optional for local runtimes). */
  defaultModel?: string;
  timeoutMs?: number;
}

export class LocalProvider {
  readonly id = LOCAL_PROVIDER_ID;
  readonly name: string;
  readonly description =
    'Models served by a local OpenAI-compatible runtime (Ollama, LM Studio). No API key; traffic never leaves the machine.';
  readonly authMethod = 'none' as const;
  readonly websiteUrl = 'https://ollama.com';
  readonly docsUrl = 'https://github.com/ollama/ollama/blob/main/docs/openai.md';

  private readonly baseUrl: string;
  private readonly runtime: LocalRuntime;
  private readonly fetchImpl: FetchFn;
  private readonly defaultModel?: string;
  private readonly timeoutMs: number;
  private lastConnectionResult: ConnectionTestResult | null = null;

  constructor(options: LocalProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.runtime = options.runtime ?? 'ollama';
    this.name = this.runtime === 'lmstudio' ? 'LM Studio (local)' : 'Ollama (local)';
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
    this.defaultModel = options.defaultModel;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True only while a connection test has succeeded (no failure since). */
  get connectionVerified(): boolean {
    return this.lastConnectionResult?.success === true;
  }

  get info() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      authMethod: this.authMethod,
      accessCategories: ['local'] as const,
      websiteUrl: this.websiteUrl,
      docsUrl: this.docsUrl,
      configured: this.baseUrl.length > 0,
      connectionVerified: this.connectionVerified,
      lastConnectionResult: this.lastConnectionResult,
    };
  }

  /**
   * Real completion against the local runtime. Uses request.model when given
   * (model-routed selection), else the configured default, else fails honestly.
   */
  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    if (!model) {
      throw new ProviderHttpError(
        'Local runtime requests must specify a model (request.model) or a configured default model.',
      );
    }
    const body = JSON.stringify({
      model,
      messages: request.messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    });
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: Awaited<ReturnType<FetchFn>>;
    try {
      raw = await this.fetchImpl(joinUrl(this.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
    if (!raw.ok) {
      const text = await raw.text();
      throw new ProviderHttpError(
        `Local runtime completions returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
      );
    }
    const json: unknown = await raw.json();
    if (!isRecord(json)) {
      throw new ProviderHttpError('Local runtime response was not a JSON object.');
    }
    const choices = json['choices'];
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) && isRecord(first['message']) ? first['message'] : undefined;
    const content = typeof message?.['content'] === 'string' ? message['content'] : '';
    if (content.length === 0) {
      throw new ProviderHttpError('Local runtime response contained no assistant message content.');
    }
    const finishReason =
      isRecord(first) && typeof first['finish_reason'] === 'string'
        ? first['finish_reason']
        : undefined;
    const usage = isRecord(json['usage'])
      ? {
          inputTokens:
            typeof json['usage']['prompt_tokens'] === 'number'
              ? json['usage']['prompt_tokens']
              : undefined,
          outputTokens:
            typeof json['usage']['completion_tokens'] === 'number'
              ? json['usage']['completion_tokens']
              : undefined,
        }
      : undefined;
    // The local runtime reports which model actually served the request; when
    // it differs from the requested model, both identities are recorded.
    const servedModel =
      typeof json['model'] === 'string' && json['model'] !== '' ? json['model'] : model;
    return {
      content,
      providerId: this.id,
      modelId: servedModel,
      ...(model !== servedModel ? { requestedModelId: model } : {}),
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }

  /** Live discovery from the runtime itself — the source of truth for locals. */
  async listModels(): Promise<readonly ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: Awaited<ReturnType<FetchFn>>;
    try {
      raw = await this.fetchImpl(joinUrl(this.baseUrl, '/models'), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!raw.ok) {
      const text = await raw.text();
      throw new ProviderHttpError(
        `Local runtime models returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
      );
    }
    const json: unknown = await raw.json();
    if (!isRecord(json) || !Array.isArray(json['data'])) {
      throw new ProviderHttpError('Local runtime models response was not a JSON object with a data array.');
    }
    return (json['data'] as unknown[]).flatMap((entry) =>
      isRecord(entry) ? [normalizeLocalModel(entry, this.runtime)] : [],
    );
  }

  /**
   * Real verification against GET /models — no key involved, so success
   * proves the no-credential access path honestly. Never fabricates success.
   */
  async verifyConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    try {
      const models = await this.listModels();
      const result: ConnectionTestResult = {
        success: true,
        timestamp,
        latencyMs: Date.now() - startedAt,
        modelsAvailable: models.length,
      };
      this.lastConnectionResult = result;
      return result;
    } catch (error) {
      const result: ConnectionTestResult = {
        success: false,
        timestamp,
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      this.lastConnectionResult = result;
      return result;
    }
  }

  /** Honest status probe for this runtime, optionally for a specific model. */
  statusFor(modelId?: string): Promise<{ status: ProviderStatus; detail: string | null }> {
    return localProviderStatus(
      this.baseUrl,
      this.fetchImpl,
      modelId !== undefined ? { modelId } : {},
    );
  }
}

/** Normalizes one verified-shape local runtime model entry. */
export function normalizeLocalModel(entry: Record<string, unknown>, runtime: LocalRuntime): ModelInfo {
  const modelId = typeof entry['id'] === 'string' ? entry['id'] : 'unknown';
  const name = typeof entry['name'] === 'string' ? entry['name'] : modelId;
  const contextLength =
    typeof entry['context_length'] === 'number'
      ? entry['context_length']
      : typeof entry['context_window'] === 'number'
        ? entry['context_window']
        : 0;
  const details = isRecord(entry['details']) ? entry['details'] : undefined;
  const capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: details?.['function_calling'] === true,
    vision: false,
    reasoning: false,
    structuredOutput: true,
  };
  return {
    modelId,
    name,
    providerId: LOCAL_PROVIDER_ID,
    providerName: runtime === 'lmstudio' ? 'LM Studio (local)' : 'Ollama (local)',
    accessCategory: 'local',
    contextLength,
    maxOutputTokens: 0,
    capabilities,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    available: true,
    metadata: {
      source: 'local-runtime',
      runtime,
      family: typeof details?.['family'] === 'string' ? details['family'] : null,
    },
  };
}

/**
 * Maps a raw failure (HTTP status, network error, or runtime-reported model
 * miss) to the honest status taxonomy of expansion §19. A reachable runtime
 * reporting an unknown model yields 'model_unavailable' naming the model —
 * never a generic failure that hides which model was missing.
 */
export function localProviderStatus(
  baseUrl: string,
  probe: FetchFn,
  context: { modelId?: string } = {},
): Promise<{ status: ProviderStatus; detail: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  return probe(joinUrl(baseUrl, '/models'), {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: controller.signal,
  })
    .then(async (raw) => {
      if (raw.ok) {
        if (context.modelId === undefined) return { status: 'connected' as const, detail: null };
        const json: unknown = await raw.json();
        const data = isRecord(json) && Array.isArray(json['data']) ? json['data'] : [];
        const ids = data.flatMap((e) =>
          isRecord(e) && typeof e['id'] === 'string' ? [e['id']] : [],
        );
        return ids.includes(context.modelId)
          ? { status: 'connected' as const, detail: null }
          : {
              status: 'model_unavailable' as const,
              detail: `Model "${context.modelId}" is not present in the runtime's model list.`,
            };
      }
      if (raw.status === 401 || raw.status === 403) {
        return { status: 'auth_required' as const, detail: `HTTP ${raw.status}` };
      }
      if (raw.status === 429) {
        return { status: 'rate_limited' as const, detail: `HTTP ${raw.status}` };
      }
      return { status: 'provider_unavailable' as const, detail: `HTTP ${raw.status}` };
    })
    .catch((error: unknown) => ({
      status: 'provider_unavailable' as const,
      detail: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => clearTimeout(timer));
}


