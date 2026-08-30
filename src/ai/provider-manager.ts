/**
 * Provider manager — the platform layer between model selection and the
 * existing AiRouter (expansion §3, §12, §13, §16-17).
 *
 * Responsibilities (and non-responsibilities):
 *  - Registers concrete providers behind the EXISTING AiProvider port; the
 *    AiRouter keeps routing exactly as before. No routing behavior changes.
 *  - Holds per-user credentials via CredentialStore; secrets never leave
 *    this layer, are never logged, and are never serialized to any client.
 *  - Selection lifecycle is honest (§18-19): a model becomes routable only
 *    after a REAL connection verification succeeded. CONFIGURED ≠ AVAILABLE
 *    is enforced structurally — selection reports the true status instead
 *    of pretending success.
 *  - Every selection is recorded as a SelectionState so provenance can show
 *    which model was used and under what verification state.
 */

import { RoutingError } from '../core/errors.ts';
import type { Logger } from '../core/logging.ts';
import type { AiProvider } from './provider.ts';
import type { ModelAccessCategory, ConnectionTestResult, DiscoverableProvider } from './provider-metadata.ts';
import { OpenRouterProvider } from './openrouter-provider.ts';
import { LocalProvider, type ProviderStatus } from './local-provider.ts';
import {
  CredentialStore,
  type CredentialReference,
} from './credential-store.ts';

/** Honest snapshot of one model selection (§19 states, never faked). */
export interface SelectionState {
  readonly userId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly category: ModelAccessCategory;
  /** True only when the provider's real connection test currently holds. */
  readonly connectionVerified: boolean;
  readonly status: ProviderStatus;
  /** Present on failed selections: why the model is not available. */
  readonly detail?: string | null;
}

/**
 * Maps a failed verification result to the honest §19 status taxonomy,
 * derived only from the recorded error (no guessing beyond evidence).
 */
export function providerStatusFromFailure(result: ConnectionTestResult): ProviderStatus {
  const message = result.errorMessage ?? '';
  if (/\b401\b|\b403\b|unauthorized|forbidden|invalid api key/i.test(message)) {
    return 'auth_required';
  }
  if (/\b429\b|rate.?limit|quota/i.test(message)) {
    return 'rate_limited';
  }
  return 'provider_unavailable';
}

export interface ProviderManagerOptions {
  credentialStore?: CredentialStore;
  logger?: Logger;
}

export class ProviderManager {
  readonly id = 'provider-manager';
  private readonly credentialStore: CredentialStore;
  private readonly providers = new Map<string, AiProvider & { id: string }>();
  private readonly logger?: Logger;
  private local: LocalProvider | null = null;
  private current: { userId: string; providerId: string; modelId: string } | null = null;
  private readonly history: SelectionState[] = [];
  /** Per-user discoverable provider instances (e.g. a user's OpenRouter connection). */
  private readonly userProviders = new Map<string, Map<string, DiscoverableProvider>>();

  constructor(options?: ProviderManagerOptions) {
    this.credentialStore = options?.credentialStore ?? new CredentialStore();
    this.logger = options?.logger;
  }

  /** The credential store (single instance per manager, shared by the web layer). */
  get credentials(): CredentialStore {
    return this.credentialStore;
  }

  /**
   * Registers any provider behind the existing port. The router keeps its own
   * registrations; this manager is the selection/credential layer above it.
   */
  register(provider: AiProvider & { id: string }): this {
    if (this.providers.has(provider.id)) {
      throw new RoutingError(
        `Provider "${provider.id}" is already registered with the provider manager.`,
      );
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  getRegisteredProviderIds(): string[] {
    return [...this.providers.keys()];
  }

  // ---- local runtimes --------------------------------------------------------

  /**
   * Configures the local runtime for this process (expansion §10 'LOCAL').
   * Registration alone proves nothing: the runtime becomes selectable only
   * after selectLocalModel() verifies it with a real request.
   */
  setLocalRuntime(
    options: { baseUrl: string; runtime?: 'ollama' | 'lmstudio'; defaultModel?: string },
    fetchImpl?: unknown,
  ): this {
    const provider = new LocalProvider({
      baseUrl: options.baseUrl,
      runtime: options.runtime,
      defaultModel: options.defaultModel,
      ...(fetchImpl !== undefined ? { fetchImpl: fetchImpl as never } : {}),
    });
    this.providers.delete('local');
    this.providers.set(provider.id, provider);
    this.local = provider;
    return this;
  }

  getLocalRuntime(): LocalProvider | null {
    return this.local;
  }

  // ---- selection lifecycle (honest: CONFIGURED ≠ AVAILABLE) -------------------

  /**
   * Selects a local model. Runs a REAL verification and a REAL model-presence
   * check; on any failure the selection is recorded with its honest status
   * and a RoutingError is thrown - the model is never marked available.
   */
  async selectLocalModel(userId: string, modelId: string): Promise<SelectionState> {
    const provider = this.local;
    if (provider === null) {
      throw new RoutingError(
        'No local runtime is configured. Configure one (setLocalRuntime) before selecting a local model.',
      );
    }
    const verification = await provider.verifyConnection();
    if (!verification.success) {
      const status = await provider.statusFor(modelId);
      this.recordFailure(userId, 'local', modelId, 'local', false, status.status, status.detail);
      throw new RoutingError(
        `Local runtime verification failed (${status.status})${status.detail ? `: ${status.detail}` : ''}. The model was NOT made available.`,
      );
    }
    const presence = await provider.statusFor(modelId);
    if (presence.status !== 'connected') {
      this.recordFailure(userId, 'local', modelId, 'local', false, presence.status, presence.detail);
      throw new RoutingError(
        `Local model "${modelId}" is not usable (${presence.status})${presence.detail ? `: ${presence.detail}` : ''}.`,
      );
    }
    return this.recordSelection(userId, 'local', modelId, 'local', true, 'connected');
  }

  // ---- per-user API-key providers (OpenRouter) -------------------------------

  /**
   * Connects a user's OpenRouter credential to a real provider instance.
   * The key is taken from the credential store; it is never logged and never
   * returned. Registration alone changes nothing observable.
   */
  connectOpenRouter(userId: string, credentialId: string, fetchImpl?: unknown): CredentialReference {
    const secret = this.credentials.resolveSecret(userId, credentialId);
    const provider = new OpenRouterProvider({
      apiKey: secret,
      ...(fetchImpl !== undefined ? { fetchImpl: fetchImpl as never } : {}),
    });
    let perUser = this.userProviders.get(userId);
    if (perUser === undefined) {
      perUser = new Map();
      this.userProviders.set(userId, perUser);
    }
    perUser.set(provider.id, provider);
    return this.credentials.getReference(userId, credentialId);
  }

  /**
   * Real verification of a user's OpenRouter credential (authenticated
   * GET /key). Records the outcome on the credential and returns it honestly.
   */
  async verifyOpenRouter(userId: string, credentialId: string): Promise<ConnectionTestResult> {
    const provider = this.requireUserProvider(userId, 'openrouter');
    const result = await provider.verifyConnection();
    this.credentials.markVerified(userId, credentialId, result.success, result.errorMessage);
    return result;
  }

  /**
   * Selects a user's OpenRouter model. Requires a prior successful
   * verification; otherwise records the honest state and refuses.
   */
  async selectOpenRouterModel(
    userId: string,
    credentialId: string,
    modelId: string,
  ): Promise<SelectionState> {
    const provider = this.requireUserProvider(userId, 'openrouter');
    if (!provider.info.connectionVerified) {
      this.recordFailure(userId, 'openrouter', modelId, 'paid', false, 'auth_required', null);
      throw new RoutingError(
        `OpenRouter credential "${credentialId}" has no verified connection. Run verifyOpenRouter() first; CONFIGURED does not mean AVAILABLE.`,
      );
    }
    const result = await provider.verifyConnection();
    if (!result.success) {
      const status = providerStatusFromFailure(result);
      this.recordFailure(userId, 'openrouter', modelId, 'paid', false, status, result.errorMessage ?? null);
      throw new RoutingError(
        `OpenRouter verification failed (${status})${result.errorMessage ? `: ${result.errorMessage}` : ''}. The model was NOT made available.`,
      );
    }
    return this.recordSelection(userId, 'openrouter', modelId, 'paid', true, 'connected');
  }

  private requireUserProvider(userId: string, providerId: string): DiscoverableProvider {
    const perUser = this.userProviders.get(userId)?.get(providerId);
    if (perUser === undefined) {
      throw new RoutingError(
        `No OpenRouter connection for user "${userId}". Call connectOpenRouter() first.`,
      );
    }
    return perUser;
  }

  // ---- status accessors --------------------------------------------------------

  /** Current selection for a user, or null when nothing is selected. */
  getCurrentSelection(userId: string): SelectionState | null {
    const cur = this.current;
    if (cur === null || cur.userId !== userId) return null;
    return (
      [...this.history].reverse().find((s) => s.userId === userId && s.status === 'connected') ??
      null
    );
  }

  /** Selection history for a user (newest last), including honest failures. */
  getSelectionHistory(userId: string): readonly SelectionState[] {
    return this.history.filter((s) => s.userId === userId);
  }

  private recordSelection(
    userId: string,
    providerId: string,
    modelId: string,
    category: ModelAccessCategory,
    connectionVerified: boolean,
    status: ProviderStatus,
  ): SelectionState {
    const state: SelectionState = {
      userId,
      providerId,
      modelId,
      category,
      connectionVerified,
      status,
    };
    this.current = { userId, providerId, modelId };
    this.history.push(state);
    this.logger?.info('ai.model_selected', { userId, providerId, modelId, status, connectionVerified });
    return state;
  }

  private recordFailure(
    userId: string,
    providerId: string,
    modelId: string,
    category: ModelAccessCategory,
    connectionVerified: boolean,
    status: ProviderStatus,
    detail: string | null,
  ): void {
    this.history.push({
      userId,
      providerId,
      modelId,
      category,
      connectionVerified,
      status,
      detail,
    });
    this.logger?.warn('ai.model_selection_failed', { userId, providerId, modelId, status, detail });
  }
}

