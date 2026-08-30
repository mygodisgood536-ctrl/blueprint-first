/**
 * OpenRouter provider implementation.
 *
 * OpenRouter (https://openrouter.ai) is a unified gateway exposing hundreds
 * of models from many upstream providers through an OpenAI-compatible
 * chat-completions API. Verified wire shapes:
 *
 *  GET  {base}/models  -> { data: [ { id, name, description, context_length,
 *       pricing: { prompt, completion } (strings, USD per token),
 *       architecture: { input_modalities }, top_provider:
 *       { max_completion_tokens }, supported_parameters: [...] } ] }
 *       NOTE: /models is PUBLIC - it does not authenticate the caller.
 *  GET  {base}/key     -> { data: { label, limit, usage, ... } }
 *       Authenticated; verifies the key WITHOUT spending tokens.
 *  POST {base}/chat/completions  OpenAI-compatible; `model` picks the route.
 *
 * Honest classification: pricing "0"/"0" is free per OpenRouter's catalogue,
 * but the user's key is still the access path, so the category stays
 * 'free_api_key_required'. There is no proven no-user-key path on OpenRouter.
 *
 * Connection verification runs a real authenticated GET /key request; it
 * never fabricates success. The key is never logged or embedded in errors.
 */

import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';
import type {
  ModelInfo,
  ModelCapabilities,
  ModelAccessCategory,
  ConnectionTestResult,
} from './provider-metadata.ts';
import { ProviderHttpError } from './models-dev-source.ts';

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_KEY_URL_PATH = '/key';
const OPENROUTER_COMPLETIONS_PATH = '/chat/completions';
const OPENROUTER_MODELS_PATH = '/models';
/** Cap on provider error-body previews kept in error messages. */
const BODY_PREVIEW_MAX_CHARS = 500;

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

export interface OpenRouterProviderOptions {
  /** The user's (or platform's) OpenRouter API key. Never logged. */
  apiKey: string;
  fetchImpl?: FetchFn;
  baseUrl?: string;
  /** Optional attribution headers recommended by OpenRouter. */
  siteUrl?: string;
  siteName?: string;
  /** Timeout for completion requests, in milliseconds. */
  timeoutMs?: number;
}

export class OpenRouterProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly description =
    'Unified gateway to hundreds of models from many providers via one OpenAI-compatible API.';
  readonly authMethod = 'api_key' as const;
  readonly websiteUrl = 'https://openrouter.ai';
  readonly docsUrl = 'https://openrouter.ai/docs';

  private readonly apiKey: string;
  private readonly fetchImpl: FetchFn;
  private readonly baseUrl: string;
  private readonly siteUrl?: string;
  private readonly siteName?: string;
  private readonly timeoutMs: number;
  private lastConnectionResult: ConnectionTestResult | null = null;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
    this.baseUrl = options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL;
    this.siteUrl = options.siteUrl;
    this.siteName = options.siteName;
    this.timeoutMs = options.timeoutMs ?? 30_000;
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
      accessCategories: ['free_api_key_required', 'paid'] as const,
      websiteUrl: this.websiteUrl,
      docsUrl: this.docsUrl,
      configured: this.apiKey.length > 0,
      connectionVerified: this.connectionVerified,
      lastConnectionResult: this.lastConnectionResult,
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    if (!request.model) {
      throw new ProviderHttpError(
        'OpenRouter requests must specify a model (request.model), e.g. "openai/gpt-4o".',
      );
    }
    const body = JSON.stringify({
      model: request.model,
      messages: request.messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: Awaited<ReturnType<FetchFn>>;
    try {
      raw = await this.fetchImpl(`${this.baseUrl}${OPENROUTER_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(this.siteUrl ? { 'HTTP-Referer': this.siteUrl } : {}),
          ...(this.siteName ? { 'X-Title': this.siteName } : {}),
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!raw.ok) {
      const text = await raw.text();
      throw new ProviderHttpError(
        `OpenRouter completions returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
      );
    }
    const json: unknown = await raw.json();
    if (!isRecord(json)) {
      throw new ProviderHttpError('OpenRouter completions response was not a JSON object.');
    }
    const choices = json['choices'];
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) && isRecord(first['message']) ? first['message'] : undefined;
    const content = typeof message?.['content'] === 'string' ? message['content'] : '';
    if (content.length === 0) {
      throw new ProviderHttpError('OpenRouter response contained no assistant message content.');
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
    return {
      content,
      providerId: this.id,
      modelId: request.model,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    // /models is public; this fetches the catalogue WITHOUT pretending to
    // authenticate - existence here never implies verified accessibility.
    const raw = await this.fetchImpl(`${this.baseUrl}${OPENROUTER_MODELS_PATH}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!raw.ok) {
      throw new ProviderHttpError(`OpenRouter models request returned HTTP ${raw.status}.`);
    }
    const json: unknown = await raw.json();
    if (!isRecord(json) || !Array.isArray(json['data'])) {
      throw new ProviderHttpError(
        'OpenRouter models response was not a JSON object with a data array.',
      );
    }
    return (json['data'] as unknown[]).flatMap((entry) =>
      isRecord(entry) ? [normalizeOpenRouterModel(entry)] : [],
    );
  }

  /**
   * Real connection verification: authenticated GET /key against the live
   * endpoint. Succeeds only on a verifiable authenticated response; any
   * failure is recorded and returned (never swallowed, never faked).
   */
  async verifyConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    try {
      const raw = await this.fetchImpl(`${this.baseUrl}${OPENROUTER_KEY_URL_PATH}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (!raw.ok) {
        // Error text is previewed only; the key is never included anywhere.
        const text = await raw.text();
        throw new ProviderHttpError(
          `OpenRouter key check returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
        );
      }
      const json: unknown = await raw.json();
      if (!isRecord(json) || !isRecord(json['data'])) {
        throw new ProviderHttpError('OpenRouter key check returned an unexpected payload shape.');
      }
      const result: ConnectionTestResult = {
        success: true,
        timestamp,
        latencyMs: Date.now() - startedAt,
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
}

/** Normalizes one verified-shape OpenRouter model entry. */
export function normalizeOpenRouterModel(entry: Record<string, unknown>): ModelInfo {
  const modelId = typeof entry['id'] === 'string' ? entry['id'] : 'unknown';
  const name = typeof entry['name'] === 'string' ? entry['name'] : modelId;
  const contextLength = typeof entry['context_length'] === 'number' ? entry['context_length'] : 0;
  const topProvider = isRecord(entry['top_provider']) ? entry['top_provider'] : undefined;
  const maxCompletion =
    typeof topProvider?.['max_completion_tokens'] === 'number'
      ? topProvider['max_completion_tokens']
      : contextLength;
  const architecture = isRecord(entry['architecture']) ? entry['architecture'] : undefined;
  const inputModalities = Array.isArray(architecture?.['input_modalities'])
    ? (architecture['input_modalities'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : ['text'];
  const supportedParameters = Array.isArray(entry['supported_parameters'])
    ? (entry['supported_parameters'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const pricing = isRecord(entry['pricing']) ? entry['pricing'] : undefined;

  const promptPerToken = parsePrice(pricing?.['prompt']);
  const completionPerToken = parsePrice(pricing?.['completion']);
  const inputCostPer1M = promptPerToken === null ? null : promptPerToken * 1_000_000;
  const outputCostPer1M = completionPerToken === null ? null : completionPerToken * 1_000_000;
  const isFree = promptPerToken === 0 && completionPerToken === 0;
  // Free per OpenRouter's catalogue, but the user's key is still the access
  // path; OpenRouter exposes no no-user-key route we could honestly verify.
  const accessCategory: ModelAccessCategory = isFree ? 'free_api_key_required' : 'paid';

  const capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: supportedParameters.includes('tools') || supportedParameters.includes('tool_choice'),
    vision: inputModalities.includes('image'),
    reasoning: supportedParameters.includes('reasoning'),
    structuredOutput: supportedParameters.includes('structured_outputs'),
  };

  return {
    modelId,
    name,
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    accessCategory,
    contextLength,
    maxOutputTokens: maxCompletion,
    capabilities,
    inputCostPer1M,
    outputCostPer1M,
    available: true, // catalogue presence = EXISTS; accessibility needs verification
    metadata: {
      source: 'openrouter',
      description: typeof entry['description'] === 'string' ? entry['description'] : undefined,
    },
  };
}

/** Parses OpenRouter's string per-token price ("0.000000834"); null if absent/invalid. */
export function parsePrice(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return null;
  return num;
}
