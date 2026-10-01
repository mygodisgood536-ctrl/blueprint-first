/**
 * Real HTTP adapters for the vendor providers named by the design brief
 * (Oluwasegunfunmi Design Instructions §1120: OpenAI, Google, Anthropic):
 *
 *   openai   -> OpenAI Chat Completions API  (https://api.openai.com/v1)
 *   anthropic-> Anthropic Messages API       (https://api.anthropic.com/v1)
 *   google   -> Google Gemini via the Generative Language API
 *                                            (https://generativelanguage.googleapis.com/v1beta)
 *   mistral  -> Mistral Chat Completions API (https://api.mistral.ai/v1)
 *
 * OpenRouter (openrouter-provider.ts) and local runtimes (local-provider.ts)
 * keep their own adapters; this module is the wired catalog of the remaining
 * providers the selectable list exposes. Every method issues a REAL HTTP call
 * against the provider - nothing here is scripted, faked, or browse-only:
 *
 *   verifyConnection(): authenticated GET /models - succeeds only on a real
 *                       verifiable 2xx from the provider, never fabricated.
 *   listModels():       GET /models (the same authenticated call) normalized
 *                       into ModelInfo rows; each row proves the model EXISTS
 *                       on the live provider - not that the key was valid.
 *   complete():         real chat completion request, recording the raw
 *                       provider/model identity on the response.
 *
 * The API key is never logged and never embedded in the error messages that
 * reach a client (only a bounded body preview is retained).
 */

import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';
import type {
  ModelInfo,
  ModelCapabilities,
  ModelAccessCategory,
  ConnectionTestResult,
  DiscoverableProvider,
  ProviderAuthMethod,
} from './provider-metadata.ts';
import { ProviderHttpError } from '../core/errors.ts';
import { isRecord, type FetchFn } from './openrouter-provider.ts';

const BODY_PREVIEW_MAX_CHARS = 500;
const DEFAULT_MAX_TOKENS = 2048;
const ANTHROPIC_VERSION_HEADER = '2023-06-01';

export type HostedEndpointKind = 'openai-compatible' | 'anthropic' | 'google';

export interface HostedProviderMeta {
  readonly providerId: string;
  readonly name: string;
  readonly description: string;
  readonly websiteUrl: string;
  readonly docsUrl: string;
  readonly baseUrl: string;
  readonly accessCategories: readonly ModelAccessCategory[];
  readonly authMethod: ProviderAuthMethod;
  readonly endpointKind: HostedEndpointKind;
}

/** Concrete vendors the build can really execute against (no catalogue-only). */
export const HOSTED_PROVIDER_META: readonly HostedProviderMeta[] = [
  {
    providerId: 'openai',
    name: 'OpenAI',
    description: 'OpenAI API — GPT and o-series models via the official Chat Completions API.',
    websiteUrl: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    baseUrl: 'https://api.openai.com/v1',
    accessCategories: ['free_api_key_required', 'paid'],
    authMethod: 'api_key',
    endpointKind: 'openai-compatible',
  },
  {
    providerId: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic API — Claude models via the Messages API.',
    websiteUrl: 'https://www.anthropic.com',
    docsUrl: 'https://docs.anthropic.com',
    baseUrl: 'https://api.anthropic.com/v1',
    accessCategories: ['free_api_key_required', 'paid'],
    authMethod: 'api_key',
    endpointKind: 'anthropic',
  },
  {
    providerId: 'google',
    name: 'Google',
    description: 'Google AI (Gemini) — Gemini models via the Generative Language API.',
    websiteUrl: 'https://ai.google.dev',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    accessCategories: ['free_api_key_required', 'paid'],
    authMethod: 'api_key',
    endpointKind: 'google',
  },
  {
    providerId: 'mistral',
    name: 'Mistral',
    description: 'Mistral AI — Mistral models via the official Chat Completions API.',
    websiteUrl: 'https://mistral.ai',
    docsUrl: 'https://docs.mistral.ai',
    baseUrl: 'https://api.mistral.ai/v1',
    accessCategories: ['free_api_key_required', 'paid'],
    authMethod: 'api_key',
    endpointKind: 'openai-compatible',
  },
];

export const WIRED_HOSTED_PROVIDER_IDS: readonly string[] = HOSTED_PROVIDER_META.map(
  (m) => m.providerId,
);

export function hostedMetaFor(providerId: string): HostedProviderMeta | undefined {
  return HOSTED_PROVIDER_META.find((m) => m.providerId === providerId);
}

/** Builds the provider-name label used by the UI (e.g. 'OpenAI'). */
export function hostedProviderName(providerId: string): string {
  return hostedMetaFor(providerId)?.name ?? providerId;
}

export interface HostedProviderOptions {
  apiKey: string;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
}

/**
 * One concrete, wired HTTP adapter for a vendor provider. Structurally
 * satisfies DiscoverableProvider so the provider manager can register it
 * behind the existing port exactly like OpenRouter.
 */
export class HostedProvider implements DiscoverableProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authMethod: ProviderAuthMethod;
  readonly websiteUrl: string;
  readonly docsUrl: string;
  readonly accessCategories: readonly ModelAccessCategory[];

  private readonly baseUrl: string;
  readonly endpointKind: HostedEndpointKind;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchFn;
  private readonly timeoutMs: number;
  private lastConnectionResult: ConnectionTestResult | null = null;

  constructor(meta: HostedProviderMeta, options: HostedProviderOptions) {
    this.id = meta.providerId;
    this.name = meta.name;
    this.description = meta.description;
    this.authMethod = meta.authMethod;
    this.websiteUrl = meta.websiteUrl;
    this.docsUrl = meta.docsUrl;
    this.accessCategories = meta.accessCategories;
    this.baseUrl = meta.baseUrl;
    this.endpointKind = meta.endpointKind;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get connectionVerified(): boolean {
    return this.lastConnectionResult?.success === true;
  }

  get info() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      authMethod: this.authMethod,
      accessCategories: this.accessCategories,
      websiteUrl: this.websiteUrl,
      docsUrl: this.docsUrl,
      configured: this.apiKey.length > 0,
      connectionVerified: this.connectionVerified,
      lastConnectionResult: this.lastConnectionResult,
    };
  }

  /** GET /models — authenticated where the provider requires it. */
  private async fetchModelList(): Promise<unknown> {
    const path = `${this.baseUrl}/models`;
    const headers: Record<string, string> =
      this.endpointKind === 'anthropic'
        ? { accept: 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION_HEADER }
        : this.endpointKind === 'google'
          ? { accept: 'application/json', 'x-goog-api-key': this.apiKey }
          : { accept: 'application/json', authorization: `Bearer ${this.apiKey}` };
    const raw = await this.fetchImpl(path, { method: 'GET', headers });
    if (!raw.ok) {
      const text = await raw.text();
      throw new ProviderHttpError(
        `${this.name} models request returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
      );
    }
    return raw.json();
  }

  /**
   * Real connection verification: authenticated GET /models. Succeeds only
   * on a verifiable 2xx; every failure is recorded and returned (never
   * swallowed, never faked). The model count is the live list length.
   */
  async verifyConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    try {
      const json: unknown = await this.fetchModelList();
      const models = normalizeModelList(this, json);
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

  /** Live model list from the provider, normalized into ModelInfo rows. */
  async listModels(): Promise<readonly ModelInfo[]> {
    return normalizeModelList(this, await this.fetchModelList());
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    if (!request.model) {
      throw new ProviderHttpError(
        `${this.name} requests must specify a model (request.model), e.g. "${this.idBasicModelSuggestion()}".`,
      );
    }
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const payload =
      this.endpointKind === 'anthropic'
        ? this.buildAnthropicPayload(request)
        : this.endpointKind === 'google'
          ? this.buildGooglePayload(request)
          : this.buildOpenAiCompatiblePayload(request);
    try {
      const headers: Record<string, string> =
        this.endpointKind === 'anthropic'
          ? {
              'content-type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': ANTHROPIC_VERSION_HEADER,
            }
          : this.endpointKind === 'google'
            ? { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }
            : { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
      const raw = await this.fetchImpl(`${payload.url}`, { method: 'POST', headers, body: payload.body, signal: controller.signal });
      if (!raw.ok) {
        const text = await raw.text();
        throw new ProviderHttpError(
          `${this.name} completions returned HTTP ${raw.status}. Body preview: ${text.slice(0, BODY_PREVIEW_MAX_CHARS)}`,
        );
      }
      const json: unknown = await raw.json();
      return normalizeCompletion(this, request, json);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private idBasicModelSuggestion(): string {
    if (this.endpointKind === 'anthropic') return 'claude-3-5-haiku-latest';
    if (this.endpointKind === 'google') return 'gemini-2.5-flash';
    if (this.id === 'mistral') return 'mistral-large-latest';
    return 'gpt-4o-mini';
  }

  private buildOpenAiCompatiblePayload(request: AiCompletionRequest): { url: string; body: string } {
    return {
      url: `${this.baseUrl}/chat/completions`,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      }),
    };
  }

  private buildAnthropicPayload(request: AiCompletionRequest): { url: string; body: string } {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      url: `${this.baseUrl}/messages`,
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system.length > 0 ? { system } : {}),
        messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      }),
    };
  }

  private buildGooglePayload(request: AiCompletionRequest): { url: string; body: string } {
    const system = request.messages.filter((m) => m.role === 'system');
    const rest = request.messages.filter((m) => m.role !== 'system');
    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) generationConfig['maxOutputTokens'] = request.maxTokens;
    if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
    return {
      url: `${this.baseUrl}/models/${request.model}:generateContent`,
      body: JSON.stringify({
        contents: rest.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        ...(system.length > 0
          ? { systemInstruction: { parts: system.map((m) => ({ text: m.content })) } }
          : {}),
        ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      }),
    };
  }
}

/** Normalizes one provider's live model list payload into ModelInfo rows. */
export function normalizeModelList(provider: HostedProvider, json: unknown): ModelInfo[] {
  if (provider.endpointKind === 'google') {
    const models = isRecord(json) && Array.isArray(json['models'])
      ? (json['models'] as unknown[])
      : [];
    const out: ModelInfo[] = [];
    for (const entry of models) {
      if (!isRecord(entry)) continue;
      const name = typeof entry['name'] === 'string' ? entry['name'] : '';
      const modelId = name.startsWith('models/') ? name.slice('models/'.length) : name;
      if (modelId.length === 0) continue;
      out.push({
        modelId,
        name: typeof entry['displayName'] === 'string' ? entry['displayName'] : modelId,
        providerId: provider.id,
        providerName: provider.name,
        accessCategory: 'paid',
        contextLength: typeof entry['inputTokenLimit'] === 'number' ? entry['inputTokenLimit'] : 0,
        maxOutputTokens: typeof entry['outputTokenLimit'] === 'number' ? entry['outputTokenLimit'] : 4096,
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: /gemini|imagen|veo/i.test(modelId),
          reasoning: /thinking|pro$/i.test(modelId),
          structuredOutput: true,
        },
        inputCostPer1M: null,
        outputCostPer1M: null,
        available: true,
        metadata: { source: `${provider.id}-live-models`, description: typeof entry['description'] === 'string' ? entry['description'] : undefined },
      });
    }
    return out;
  }
  const data = isRecord(json) && Array.isArray(json['data']) ? (json['data'] as unknown[]) : [];
  const out: ModelInfo[] = [];
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') continue;
    const modelId = entry['id'];
    out.push({
      modelId,
      name:
        typeof entry['name'] === 'string'
          ? entry['name']
          : typeof entry['display_name'] === 'string'
            ? entry['display_name']
            : modelId,
      providerId: provider.id,
      providerName: provider.name,
      accessCategory: 'paid',
      contextLength:
        typeof entry['context_size'] === 'number'
          ? entry['context_size']
          : typeof entry['context_length'] === 'number'
            ? entry['context_length']
            : (provider.id === 'anthropic' && typeof entry['context_window'] === 'number'
              ? entry['context_window']
              : 0),
      maxOutputTokens:
        typeof entry['max_output_tokens'] === 'number'
          ? entry['max_output_tokens']
          : (provider.id === 'anthropic'
            ? 8192
            : typeof entry['max_completion_tokens'] === 'number'
              ? entry['max_completion_tokens']
              : 4096),
      capabilities: defaultCapabilities(modelId),
      inputCostPer1M: null,
      outputCostPer1M: null,
      available: true,
      metadata: {
        source: `${provider.id}-live-models`,
        ...(typeof entry['description'] === 'string' ? { description: entry['description'] } : {}),
        ...(typeof entry['owned_by'] === 'string' || typeof entry['ownedBy'] === 'string'
          ? { owner: typeof entry['owned_by'] === 'string' ? entry['owned_by'] : entry['ownedBy'] }
          : {}),
      },
    });
  }
  return out;
}

function defaultCapabilities(modelId: string): ModelCapabilities {
  return {
    streaming: true,
    toolCalling: true,
    vision: /vision|gpt-4o|gemini|claude.*(opus|sonnet)/i.test(modelId),
    reasoning: /o1|o3|thinking|reasoning/i.test(modelId),
    structuredOutput: true,
  };
}

/** Normalizes a real completion response into AiCompletionResponse. */
export function normalizeCompletion(
  provider: HostedProvider,
  request: AiCompletionRequest,
  json: unknown,
): AiCompletionResponse {
  const rec = isRecord(json) ? json : null;
  if (provider.endpointKind === 'google') {
    const candidates = rec && Array.isArray(rec['candidates']) ? rec['candidates'] : [];
    const first = isRecord(candidates[0]) ? candidates[0] : undefined;
    const parts = isRecord(first?.['content'])
      ? (first['content']['parts'] as unknown[] | undefined) ?? []
      : [];
    const content = parts
      .filter((p): p is Record<string, unknown> => isRecord(p))
      .map((p) => (typeof p['text'] === 'string' ? p['text'] : ''))
      .join('');
    if (content.length === 0) {
      throw new ProviderHttpError(
        `${provider.name} response contained no assistant message content${
          isRecord(first) && typeof first['finishReason'] === 'string' ? ` (finishReason: ${first['finishReason']})` : ''
        }.`,
      );
    }
    const usageMeta = isRecord(rec?.['usageMetadata']) ? rec['usageMetadata'] : undefined;
    const usage =
      usageMeta !== undefined
        ? {
            inputTokens:
              typeof usageMeta['promptTokenCount'] === 'number'
                ? usageMeta['promptTokenCount']
                : undefined,
            outputTokens:
              typeof usageMeta['candidatesTokenCount'] === 'number'
                ? usageMeta['candidatesTokenCount']
                : undefined,
          }
        : undefined;
    return {
      content,
      providerId: provider.id,
      modelId: request.model!,
      ...(isRecord(first) && typeof first['finishReason'] === 'string'
        ? { finishReason: first['finishReason'] }
        : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }
  if (provider.endpointKind === 'anthropic') {
    const contentBlocks = rec && Array.isArray(rec['content']) ? rec['content'] : [];
    const content = contentBlocks
      .filter((b): b is Record<string, unknown> => isRecord(b))
      .map((b) => (typeof b['text'] === 'string' ? b['text'] : ''))
      .join('');
    if (content.length === 0) {
      throw new ProviderHttpError(`${provider.name} response contained no assistant message content.`);
    }
    const usageRec = isRecord(rec?.['usage']) ? rec['usage'] : undefined;
    const usage =
      usageRec !== undefined
        ? {
            inputTokens:
              typeof usageRec['input_tokens'] === 'number' ? usageRec['input_tokens'] : undefined,
            outputTokens:
              typeof usageRec['output_tokens'] === 'number' ? usageRec['output_tokens'] : undefined,
          }
        : undefined;
    return {
      content,
      providerId: provider.id,
      modelId: request.model!,
      ...(typeof rec?.['stop_reason'] === 'string' ? { finishReason: rec['stop_reason'] } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }
  const choices = rec && Array.isArray(rec['choices']) ? rec['choices'] : [];
  const first = isRecord(choices[0]) ? choices[0] : undefined;
  const message = isRecord(first?.['message']) ? first['message'] : undefined;
  const content = typeof message?.['content'] === 'string' ? message['content'] : '';
  if (content.length === 0) {
    throw new ProviderHttpError(`${provider.name} response contained no assistant message content.`);
  }
  const usageRec = isRecord(rec?.['usage']) ? rec['usage'] : undefined;
  const usage =
    usageRec !== undefined
      ? {
          inputTokens:
            typeof usageRec['prompt_tokens'] === 'number' ? usageRec['prompt_tokens'] : undefined,
          outputTokens:
            typeof usageRec['completion_tokens'] === 'number' ? usageRec['completion_tokens'] : undefined,
        }
      : undefined;
  // The vendor response may echo the model that actually served the request;
  // when it differs from the requested model, both are recorded so no
  // substitution is ever silent.
  const servedModel =
    isRecord(rec) && typeof rec['model'] === 'string' && rec['model'] !== ''
      ? rec['model']
      : request.model!;
  return {
    content,
    providerId: provider.id,
    modelId: servedModel,
    ...(request.model !== servedModel ? { requestedModelId: request.model } : {}),
    ...(isRecord(first) && typeof first['finish_reason'] === 'string'
      ? { finishReason: first['finish_reason'] }
      : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
  };
}