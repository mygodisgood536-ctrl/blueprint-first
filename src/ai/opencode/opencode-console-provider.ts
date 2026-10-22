/**
 * OpenCode Console provider.
 *
 * The installed `opencode` runtime is one way to reach OpenCode. It is a
 * 170 MB native binary, so it cannot live inside a serverless function, and the
 * OpenCode Console itself publishes the SAME provider/model catalogue over
 * plain HTTPS. This provider therefore speaks to OpenCode directly:
 *
 *   - the catalogue comes from the provider's own published data, never from a
 *     list frozen in this repository;
 *   - the model list the connected account can actually use comes from the
 *     account's own OpenCode endpoint, so a model OpenCode withdraws stops
 *     being offered;
 *   - generation is a real request to the endpoint OpenCode published for that
 *     model, and a refusal is reported as a refusal.
 *
 * The console key is a server-side secret. It is read from the platform's
 * credential boundary, is never sent to a browser, and never appears in a
 * response, a log line or an evidence record.
 */

import {
  fetchOpenCodeConsoleCatalogue,
  OPENCODE_CONSOLE_DEFAULT_BASE,
  type OpenCodeConsoleResult,
} from './opencode-console.ts';
import type {
  ConnectionTestResult,
  DiscoverableProvider,
  ModelAccessCategory,
  ModelCapabilities,
  ModelInfo,
  ProviderAuthMethod,
  ProviderInfo,
} from '../provider-metadata.ts';
import type { AiCompletionRequest, AiCompletionResponse } from '../types.ts';
import { ConfigurationError, ProviderHttpError } from '../../core/errors.ts';

export const OPENCODE_CONSOLE_PROVIDER_ID = 'opencode';

export interface OpenCodeConsoleProviderOptions {
  /** The console API key. Server-side only. */
  readonly apiKey: string;
  /** Console base URL. Defaults to OpenCode's hosted console. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /**
   * The inference endpoint OpenCode published for each model, keyed by model
   * id. It comes from the same provider catalogue the model list is built from,
   * so the platform never guesses an endpoint.
   */
  readonly inferenceEndpoints?: Readonly<Record<string, string>>;
  /** Default inference endpoint for models with no published endpoint. */
  readonly defaultInferenceEndpoint?: string;
}

/**
 * The endpoint OpenCode publishes for its own models.
 *
 * OpenCode's catalogue lists, per model, the endpoint that serves it. The
 * OpenAI-compatible chat endpoint is the documented default for the console's
 * own models, so it is used only when the catalogue has nothing more specific.
 */
const DEFAULT_CHAT_ENDPOINT = '/inference/openai/v1/chat/completions';

export class OpenCodeConsoleProvider implements DiscoverableProvider {
  readonly id = OPENCODE_CONSOLE_PROVIDER_ID;
  readonly name = 'OpenCode';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly inferenceEndpoints: Readonly<Record<string, string>>;
  private readonly defaultInferenceEndpoint: string;
  private lastConnectionResult: ConnectionTestResult | null = null;
  private lastCatalogue: OpenCodeConsoleResult | null = null;

  constructor(options: OpenCodeConsoleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? OPENCODE_CONSOLE_DEFAULT_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.inferenceEndpoints = options.inferenceEndpoints ?? {};
    this.defaultInferenceEndpoint = options.defaultInferenceEndpoint ?? DEFAULT_CHAT_ENDPOINT;
  }

  get info(): ProviderInfo {
    const configured = this.apiKey.trim().length > 0;
    return {
      id: this.id,
      name: this.name,
      description:
        'OpenCode Console: the provider/model catalogue and account availability are published by OpenCode itself, ' +
        'and generation is a real request to the endpoint OpenCode publishes for the selected model.',
      authMethod: 'api_key' as ProviderAuthMethod,
      accessCategories: this.accessCategories(),
      websiteUrl: 'https://opencode.ai',
      docsUrl: 'https://opencode.ai/docs/zen',
      configured,
      connectionVerified: this.lastConnectionResult?.success === true,
      lastConnectionResult: this.lastConnectionResult,
    };
  }

  /**
   * The access categories this provider's models fall into.
   *
   * A console key is required to use any console model, so a free model is
   * "free WITH a key" rather than "free without one". Nothing is claimed
   * beyond what the published catalogue shows.
   */
  accessCategories(): readonly ModelAccessCategory[] {
    return ['free_api_key_required', 'paid'];
  }

  /**
   * Fetches the account's authoritative model list.
   *
   * This is the list OpenCode publishes for THIS account: a model that is
   * withdrawn, disabled or unavailable in the account's region simply is not in
   * it. The result is kept so a caller can report exactly when it was fetched
   * and, on failure, what went wrong.
   */
  async fetchAccountCatalogue(): Promise<OpenCodeConsoleResult> {
    const result = await fetchOpenCodeConsoleCatalogue({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      timeoutMs: Math.min(this.timeoutMs, 20_000),
      fetchImpl: this.fetchImpl,
    });
    this.lastCatalogue = result;
    if (!result.ok) {
      this.lastConnectionResult = {
        success: false,
        timestamp: new Date().toISOString(),
        latencyMs: 0,
        errorMessage: result.detail,
      };
    }
    return result;
  }

  /** The last catalogue result, successful or not. */
  get catalogueResult(): OpenCodeConsoleResult | null {
    return this.lastCatalogue;
  }

  /**
   * A REAL connection test.
   *
   * It proves the key is accepted by OpenCode AND that the account can see a
   * catalogue. It deliberately does NOT claim that generation works: catalogue
   * access and successful inference are different things, and only a real
   * generation request can prove the second.
   */
  async verifyConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const result = await this.fetchAccountCatalogue();
    const timestamp = new Date().toISOString();
    if (!result.ok) {
      const failure: ConnectionTestResult = {
        success: false,
        timestamp,
        latencyMs: Date.now() - startedAt,
        errorMessage: result.detail,
      };
      this.lastConnectionResult = failure;
      return failure;
    }
    const success: ConnectionTestResult = {
      success: true,
      timestamp,
      latencyMs: Date.now() - startedAt,
      modelsAvailable: result.models.length,
    };
    this.lastConnectionResult = success;
    return success;
  }

  /**
   * The model ids this account can use right now.
   *
   * Returns null when the account's list has not been fetched (or could not be
   * fetched), which is deliberately different from an empty list: "unknown" and
   * "nothing available" must not look the same.
   */
  async availableModelIds(): Promise<ReadonlySet<string> | null> {
    const result = this.lastCatalogue ?? (await this.fetchAccountCatalogue());
    if (!result.ok) return null;
    return new Set(result.models.map((m) => m.id));
  }

  /**
   * Lists the models this account can use.
   *
   * The catalogue rows themselves (names, context limits, PRICING) come from
   * the provider catalogue; the availability of each row comes from the account
   * list. Neither is invented here.
   */
  async listModels(catalogue: readonly ModelInfo[] = []): Promise<readonly ModelInfo[]> {
    const available = await this.availableModelIds();
    if (available === null) {
      throw new ConfigurationError(
        'The OpenCode account catalogue could not be read, so model availability is unknown. ' +
          'The platform will not present a stale list as current availability.',
      );
    }
    return catalogue
      .filter((m) => m.providerId === this.id)
      .map((m) => ({ ...m, available: available.has(m.modelId) }));
  }

  /** The inference endpoint OpenCode published for a model. */
  inferenceEndpointFor(modelId: string): string {
    const published = this.inferenceEndpoints[modelId];
    if (published !== undefined && published.length > 0) return published;
    return this.defaultInferenceEndpoint;
  }

  /**
   * Performs a REAL generation request against the endpoint OpenCode published
   * for the selected model. A refusal is surfaced as a refusal.
   */
  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const modelId = request.model;
    if (modelId === undefined || modelId.length === 0) {
      throw new ConfigurationError('A model must be selected before OpenCode can generate.');
    }
    const available = await this.availableModelIds();
    if (available !== null && !available.has(modelId)) {
      throw new ProviderHttpError(
        409,
        `OpenCode does not currently offer "${modelId}" to this account. Choose a model from the current OpenCode list.`,
      );
    }
    const endpoint = `${this.baseUrl}${this.inferenceEndpointFor(modelId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: request.maxTokens ?? 2048,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ProviderHttpError(res.status, text);
      }
      const body = JSON.parse(text) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content ?? '';
      return {
        content,
        providerId: this.id,
        modelId,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError(
        502,
        `The OpenCode request could not be completed: ${redact(error instanceof Error ? error.message : String(error))}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Removes anything that could be a secret from a provider message. */
function redact(text: string): string {
  return text.replace(/oc_sk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/\s+/g, ' ').trim();
}
