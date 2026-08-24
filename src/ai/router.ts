/**
 * AI Router foundation.
 *
 * Selects a provider per task type using an explicit routing table with a
 * default fallback, and records every selection (provider + concrete model)
 * so callers can stamp artifact provenance with "which model produced or
 * verified this". Providers are registered behind the AiProvider port; the
 * router never knows vendor specifics.
 */

import { RoutingError } from '../core/errors.ts';
import type { Logger } from '../core/logging.ts';
import type { AiProvider } from './provider.ts';
import type { AiCompletionRequest, AiCompletionResponse, AiTaskType } from './types.ts';

export interface RoutingSelection {
  taskType: AiTaskType;
  providerId: string;
  matchedBy: 'rule' | 'default';
  at: string;
}

export interface CompletedSelection extends RoutingSelection {
  modelId: string;
}

export class AiRouter {
  private providers: Map<string, AiProvider> = new Map();
  private rules: Map<AiTaskType, string> = new Map();
  private defaultProviderId?: string;
  private readonly logger?: Logger;
  /** Every completed completion, newest last - provenance source of truth. */
  readonly completedSelections: CompletedSelection[] = [];

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
  }

  register(provider: AiProvider): this {
    if (this.providers.has(provider.id)) {
      throw new RoutingError(`Provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  setDefaultProvider(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw new RoutingError(
        `Cannot set default provider "${providerId}"; registered providers: ${[...this.providers.keys()].join(', ') || '(none)'}.`,
      );
    }
    this.defaultProviderId = providerId;
    return this;
  }

  /** Task-specific override; validated lazily so rules may precede registration. */
  setRoute(taskType: AiTaskType, providerId: string): this {
    this.rules.set(taskType, providerId);
    return this;
  }

  resolve(taskType: AiTaskType): { provider: AiProvider; matchedBy: 'rule' | 'default' } {
    const ruleProviderId = this.rules.get(taskType);
    if (ruleProviderId !== undefined) {
      const provider = this.providers.get(ruleProviderId);
      if (provider !== undefined) return { provider, matchedBy: 'rule' };
      throw new RoutingError(
        `Route for ${taskType} points at unregistered provider "${ruleProviderId}". Registered: ${[...this.providers.keys()].join(', ') || '(none)'}.`,
      );
    }
    if (this.defaultProviderId !== undefined) {
      const provider = this.providers.get(this.defaultProviderId);
      if (provider !== undefined) return { provider, matchedBy: 'default' };
      throw new RoutingError(
        `Default provider "${this.defaultProviderId}" is not registered. Registered: ${[...this.providers.keys()].join(', ') || '(none)'}.`,
      );
    }
    throw new RoutingError(
      `No route for task "${taskType}" and no default provider configured.`,
    );
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const { provider, matchedBy } = this.resolve(request.taskType);
    const response = await provider.complete(request);
    const selection: CompletedSelection = {
      taskType: request.taskType,
      providerId: response.providerId,
      modelId: response.modelId,
      matchedBy,
      at: new Date().toISOString(),
    };
    this.completedSelections.push(selection);
    this.logger?.info('ai.completion', {
      taskType: request.taskType,
      providerId: response.providerId,
      modelId: response.modelId,
      matchedBy,
      requestId: request.requestId,
    });
    // Defense in depth: the port contract says providers stamp themselves.
    if (response.providerId !== provider.id) {
      throw new RoutingError(
        `Provider "${provider.id}" returned mismatched providerId "${response.providerId}".`,
      );
    }
    return response;
  }
}
