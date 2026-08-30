/**
 * Models.dev catalogue source.
 *
 * Models.dev (https://models.dev) is an open-source database of AI model
 * specifications. Verified wire shape of GET https://models.dev/api.json:
 *
 *   {
 *     "<providerId>": {
 *       "id": "<providerId>", "name": "<Provider Name>",
 *       "env": ["<ENV_VAR_NAME>"], "api": "<base url>", "doc": "<url>",
 *       "models": {
 *         "<modelId>": {
 *           "id", "name", "attachment", "reasoning", "tool_call",
 *           "structured_output", "temperature", "modalities",
 *           "open_weights", "limit", "cost"
 *         }
 *       }
 *     }
 *   }
 *
 * Classification honesty: `cost.input/output` are USD per 1M tokens. Zero
 * cost in the catalogue classifies as free-with-key ('free_api_key_required')
 * because Models.dev exposes no no-user-key access mechanism. Missing cost
 * fields mean pricing unknown -> 'paid' (conservative: never advertise free
 * on guesswork). A genuine 'free_no_api_key' classification can only come
 * from an explicitly proven access route (ModelCatalogue overrides).
 */

import type { ModelInfo, ModelCapabilities, ModelAccessCategory } from './provider-metadata.ts';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

/** Minimal structural fetch abstraction (keeps DOM lib out of tsconfig). */
export interface FetchFn {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
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

export class ProviderHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

interface ModelsDevModel {
  id: string;
  name: string;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
}

interface ModelsDevProvider {
  id: string;
  name?: string;
  models?: Record<string, ModelsDevModel>;
}

export interface ModelsDevSourceOptions {
  fetchImpl?: FetchFn;
  /** Cache lifetime for a successful fetch, in milliseconds. */
  cacheTtlMs?: number;
}

export class ModelsDevSource {
  private readonly fetchImpl: FetchFn;
  private readonly cacheTtlMs: number;
  private cache: readonly ModelInfo[] | null = null;
  private cacheTimestamp = 0;

  constructor(options: ModelsDevSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  }

  /** True when the cached catalogue is present and still fresh. */
  get cacheFresh(): boolean {
    return this.cache !== null && Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }

  clearCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  async fetchCatalog(): Promise<readonly ModelInfo[]> {
    if (this.cacheFresh && this.cache !== null) return this.cache;

    const response = await this.fetchImpl(MODELS_DEV_API_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ProviderHttpError(
        `models.dev catalogue request failed with HTTP ${response.status}.`,
      );
    }
    const json = await response.json();
    const models = normalizeModelsDevPayload(json);
    this.cache = models;
    this.cacheTimestamp = Date.now();
    return models;
  }
}

/** Strictly normalizes the verified models.dev payload shape. */
export function normalizeModelsDevPayload(json: unknown): readonly ModelInfo[] {
  if (!isRecord(json)) {
    throw new ProviderHttpError('models.dev catalogue payload was not a JSON object.');
  }
  const models: ModelInfo[] = [];
  for (const [providerId, providerValue] of Object.entries(json)) {
    if (!isRecord(providerValue)) continue;
    const provider = providerValue as unknown as ModelsDevProvider;
    const providerName = typeof provider.name === 'string' ? provider.name : providerId;
    const providerModels = isRecord(provider.models) ? provider.models : {};
    for (const [modelKey, modelValue] of Object.entries(providerModels)) {
      if (!isRecord(modelValue)) continue;
      const m = modelValue as ModelsDevModel;
      const modelId = typeof m.id === 'string' ? m.id : modelKey;
      const name = typeof m.name === 'string' ? m.name : modelId;
      const contextLength = typeof m.limit?.context === 'number' ? m.limit.context : 0;
      const maxOutputTokens = typeof m.limit?.output === 'number' ? m.limit.output : contextLength;
      const inputModalities = m.modalities?.input ?? ['text'];
      const capabilities: ModelCapabilities = {
        // Not exposed by models.dev; chat-completion APIs stream.
        streaming: true,
        toolCalling: m.tool_call === true,
        vision: inputModalities.includes('image'),
        reasoning: m.reasoning === true,
        structuredOutput: m.structured_output === true,
      };
      const hasKnownCost =
        typeof m.cost?.input === 'number' || typeof m.cost?.output === 'number';
      const accessCategory: ModelAccessCategory = !hasKnownCost
        ? 'paid' // pricing unknown: conservative, never advertised as free
        : (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0
          ? 'free_api_key_required' // free per catalogue; no no-key path proven
          : 'paid';
      models.push({
        modelId,
        name,
        providerId,
        providerName,
        accessCategory,
        contextLength,
        maxOutputTokens,
        capabilities,
        inputCostPer1M: typeof m.cost?.input === 'number' ? m.cost.input : null,
        outputCostPer1M: typeof m.cost?.output === 'number' ? m.cost.output : null,
        available: true, // catalogue presence = EXISTS; accessibility needs a live check
        metadata: {
          source: 'models.dev',
          openWeights: m.open_weights === true,
        },
      });
    }
  }
  return models;
}
