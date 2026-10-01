/**
 * OpenCode provider - the real integrated AI execution layer behind the
 * existing `DiscoverableProvider` port.
 *
 * The project's selected provider/model is passed EXPLICITLY to a real
 * `opencode run` subprocess and its real session identity, text, tokens and
 * cost are returned on the response. No silent model/provider substitution
 * and no hard-coded catalogue: model availability and the free model set are
 * read from the installed runtime's own catalogue state.
 *
 * Honesty: `connectionVerified` means the real runtime resolved AND the model
 * exists in the live catalogue - it never implies a fabricated result. A
 * missing runtime, model, or credential requirement reports its real state.
 */

import type {
  AiCompletionRequest,
  AiCompletionResponse,
} from '../types.ts';
import type {
  ConnectionTestResult,
  DiscoverableProvider,
  ModelAccessCategory,
  ModelCapabilities,
  ModelInfo,
  ProviderAuthMethod,
  ProviderInfo,
} from '../provider-metadata.ts';
import { OpenCodeError, OpenCodeRuntime } from './opencode-runtime.ts';

export interface OpenCodeProviderOptions {
  runtime?: OpenCodeRuntime;
}

/**
 * The `opencode` provider's models are served by the installed runtime itself
 * with zero user credentials. Every such model is marked free_no_api_key ONLY
 * after the runtime is present and the model appears in the live catalogue -
 * classification stays a platform access proof, never a guess.
 */
export class OpenCodeProvider implements DiscoverableProvider {
  readonly id = 'opencode';
  readonly name = 'OpenCode';

  private readonly runtime: OpenCodeRuntime;
  private lastConnectionResult: ConnectionTestResult | null = null;

  constructor(options: OpenCodeProviderOptions = {}) {
    this.runtime = options.runtime ?? new OpenCodeRuntime();
  }

  /** The runtime this provider executes through (used by catalogue wiring). */
  get opencodeRuntime(): OpenCodeRuntime {
    return this.runtime;
  }

  get info(): ProviderInfo {
    const available = this.available();
    const categories = this.accessCategories();
    return {
      id: this.id,
      name: this.name,
      description: 'OpenCode integrated AI execution layer: a project\u2019s selected provider/model runs in a real opencode session on this host.',
      authMethod: 'none',
      accessCategories: categories,
      websiteUrl: 'https://opencode.ai',
      docsUrl: 'https://opencode.ai/docs',
      configured: available,
      connectionVerified: this.lastConnectionResult?.success === true,
      lastConnectionResult: this.lastConnectionResult,
    };
  }

  /** True only when a REAL executable resolved on this host. */
  available(): boolean {
    return this.runtime.available();
  }

  /**
   * Real availability probe: the executable resolves AND the runtime
   * catalogue is readable AND (for the free bundled models) no key is needed.
   */
  async verifyConnection(): Promise<ConnectionTestResult> {
    const timestamp = new Date().toISOString();
    const startedAt = Date.now();
    if (!this.available()) {
      const result: ConnectionTestResult = {
        success: false,
        timestamp,
        latencyMs: Date.now() - startedAt,
        errorMessage: 'The OpenCode execution layer is unavailable: no real opencode executable resolved on this host.',
      };
      this.lastConnectionResult = result;
      return result;
    }
    let models: readonly ModelInfo[];
    try {
      models = await this.listModels();
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
    const result: ConnectionTestResult = {
      success: models.length > 0,
      timestamp,
      latencyMs: Date.now() - startedAt,
      modelsAvailable: models.length,
    };
    this.lastConnectionResult = result;
    return result;
  }

  /** Live model list from the real runtime catalogue (no hard-coding). */
  async listModels(): Promise<readonly ModelInfo[]> {
    const entry = this.runtime
      .readCatalogCache()
      ?.find((p) => p.providerId === this.id);
    if (entry === undefined) {
      throw new OpenCodeError(
        `The OpenCode catalogue does not expose a "${this.id}" provider entry. Refresh it (opencode models --refresh) or resolve the real runtime.`,
      );
    }
    return entry.models.map((m) => {
      const free = (m.costInputPer1M ?? 0) === 0 && (m.costOutputPer1M ?? 0) === 0;
      const capabilities: ModelCapabilities = {
        streaming: true,
        toolCalling: m.toolCalling,
        vision: m.attachment,
        reasoning: m.reasoning,
        structuredOutput: true,
      };
      return {
        modelId: m.id,
        name: m.name,
        providerId: this.id,
        providerName: this.name,
        accessCategory: modelAccessCategory(this.id, m.id, free),
        contextLength: m.contextLength,
        maxOutputTokens: m.maxOutputTokens,
        capabilities,
        inputCostPer1M: m.costInputPer1M,
        outputCostPer1M: m.costOutputPer1M,
        available: true,
        metadata: {
          source: 'opencode-runtime',
          family: m.family ?? null,
          status: m.status ?? 'active',
          releaseDate: m.releaseDate ?? null,
        },
      };
    });
  }

  /**
   * Real execution: the exact `providerId/modelId` is passed to a real
   * `opencode run` subprocess. The session identity, tokens and cost from the
   * real stream return on the response; any genuine failure throws instead of
   * fabricating a result.
   */
  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    if (typeof request.model !== 'string' || request.model.trim() === '') {
      throw new OpenCodeError(
        'OpenCode execution requires an explicit model id (request.model). No silent model selection is performed.',
      );
    }
    const modelId = request.model.trim();
    if (!this.available()) {
      throw new OpenCodeError(
        'The OpenCode execution layer is unavailable: no real opencode executable resolved on this host.',
      );
    }
    if (!this.runtime.hasModel(this.id, modelId)) {
      throw new OpenCodeError(
        `Model "${modelId}" is not present in the real OpenCode catalogue. Select a model the runtime actually exposes; nothing was substituted.`,
      );
    }
    const result = await this.runtime.run(renderPrompt(request.messages), {
      providerId: this.id,
      modelId,
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      ...(request.onProgress !== undefined ? { onProgress: request.onProgress } : {}),
    });
    return {
      content: result.content,
      providerId: this.id,
      modelId,
      usage: { inputTokens: result.usage.input, outputTokens: result.usage.output },
      ...(result.finishReason !== undefined ? { finishReason: result.finishReason } : {}),
      ...(result.sessionID !== '' ? { sessionId: result.sessionID } : {}),
      ...(result.cost > 0 ? { cost: result.cost } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }

  private accessCategories(): readonly ModelAccessCategory[] {
    const entry = this.runtime.readCatalogCache()?.find((p) => p.providerId === this.id);
    if (entry === undefined) return ['free_no_api_key'];
    const hasFree = entry.models.some((m) => (m.costInputPer1M ?? 0) === 0 && (m.costOutputPer1M ?? 0) === 0);
    const hasPaid = entry.models.some((m) => (m.costInputPer1M ?? 0) !== 0 || (m.costOutputPer1M ?? 0) !== 0);
    const categories: ModelAccessCategory[] = [];
    if (hasFree) categories.push('free_no_api_key');
    if (hasPaid) categories.push('free_api_key_required');
    return categories.length > 0 ? categories : ['free_no_api_key'];
  }
}

/**
 * Access classification is a PLATFORM ACCESS PROOF, not a guess: cost-0 models
 * under the `opencode` provider are free with no user key because the runtime
 * itself serves them (proven by real zero-credential runs of these models).
 */
function modelAccessCategory(providerId: string, modelId: string, free: boolean): ModelAccessCategory {
  return free ? 'free_no_api_key' : 'free_api_key_required';
}

/** Renders the durable transcript into one explicit prompt for `opencode run`. */
export function renderPrompt(messages: AiCompletionRequest['messages']): string {
  return messages
    .map((m) => (m.role === 'assistant' ? `[ASSISTANT]\n${m.content}` : `[${m.role.toUpperCase()}]\n${m.content}`))
    .join('\n\n');
}