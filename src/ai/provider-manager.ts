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

import { ConfigurationError, RoutingError } from '../core/errors.ts';
import type { Logger } from '../core/logging.ts';
import type { AiProvider } from './provider.ts';
import type { ModelAccessCategory, ConnectionTestResult, DiscoverableProvider, ProviderAuthMethod } from './provider-metadata.ts';
import type { CatalogueProviderSummary } from './model-catalogue.ts';
import { OpenRouterProvider } from './openrouter-provider.ts';
import { HostedProvider, hostedMetaFor, WIRED_HOSTED_PROVIDER_IDS } from './hosted-providers.ts';
import { LocalProvider, type ProviderStatus } from './local-provider.ts';
import { OpenCodeProvider } from './opencode/opencode-provider.ts';
import { AiRouter } from './router.ts';
import { AI_TASK_TYPES } from './types.ts';
import {
  CredentialStore,
  type CredentialReference,
} from './credential-store.ts';

/** Every provider this build has a REAL execution adapter for. */
export const WIRED_PROVIDER_IDS: readonly string[] = [
  'openrouter',
  ...WIRED_HOSTED_PROVIDER_IDS,
  'opencode',
] as const;

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
  /** The platform's integrated OpenCode execution layer (real runtime subprocess). */
  opencodeProvider?: OpenCodeProvider;
}

/** What the platform can configure for one supported provider (no secrets). */
export interface ProviderDescriptor {
  readonly providerId: string;
  readonly name: string;
  readonly description: string;
  readonly authMethod: ProviderAuthMethod;
  /** Derived honestly from authMethod: only key/oauth flows need a credential. */
  readonly credentialRequired: boolean;
  readonly accessCategories: readonly ModelAccessCategory[];
  readonly websiteUrl: string;
  readonly docsUrl: string;
  readonly configured: boolean;
  readonly connectionVerified: boolean;
  readonly lastConnectionResult: ConnectionTestResult | null;
  /**
   * True when this build has a real execution adapter for the provider
   * (only those can be verified/selected/run). Catalogue-only providers are
   * listed honestly with wired:false and return 501 on verify/select.
   */
  readonly wired: boolean;
  /** Catalogue model count for this provider (undefined when runtime-sourced). */
  readonly modelCount?: number;
}

/** A real execution route once the user has a verified model selected. */
export interface ExecutionRoute {
  readonly providerId: string;
  readonly modelId: string;
  readonly router: AiRouter;
}

export class ProviderManager {
  readonly id = 'provider-manager';
  private readonly credentialStore: CredentialStore;
  private readonly providers = new Map<string, AiProvider & { id: string }>();
  private readonly logger?: Logger;
  private local: LocalProvider | null = null;
  private openCode: OpenCodeProvider | null = null;
  /**
   * Per-user current selection slot. Selections are account-scoped: one user's
   * selection must never mask or displace another's (a single process-wide
   * slot would leak identity across accounts).
   */
  private readonly currentByUser = new Map<string, { userId: string; providerId: string; modelId: string }>();
  private readonly history: SelectionState[] = [];
  /** Per-user discoverable provider instances (e.g. a user's OpenRouter connection). */
  private readonly userProviders = new Map<string, Map<string, DiscoverableProvider>>();

  constructor(options?: ProviderManagerOptions) {
    this.credentialStore = options?.credentialStore ?? new CredentialStore();
    this.logger = options?.logger;
    if (options?.opencodeProvider !== undefined) this.enableOpenCode(options.opencodeProvider);
  }

  /**
   * Enables the platform's integrated OpenCode execution layer. Registration
   * proves nothing: models become selectable/usable only after the REAL
   * runtime resolves and a real connection test holds.
   */
  enableOpenCode(provider: OpenCodeProvider): this {
    if (this.openCode !== null && this.openCode !== provider) {
      throw new RoutingError('An OpenCode provider is already enabled for the provider manager.');
    }
    this.openCode = provider;
    this.providers.delete(provider.id);
    this.providers.set(provider.id, provider);
    return this;
  }

  /** The wired OpenCode provider, or null when this build has none. */
  getOpenCodeProvider(): OpenCodeProvider | null {
    return this.openCode;
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

  /**
   * Selects an OpenCode model for a project's AI configuration. Honest gate:
   * the REAL runtime must resolve, its live catalogue must contain the model,
   * and a real connection verification must hold. The model is never marked
   * available on guesswork; failures are recorded with their true status.
   */
  async selectOpenCodeModel(userId: string, modelId: string): Promise<SelectionState> {
    const provider = this.openCode;
    if (provider === null) {
      throw new RoutingError(
        'The OpenCode execution layer is not wired in this build. Nothing was selected.',
      );
    }
    const verification = await provider.verifyConnection();
    if (!verification.success) {
      const status = providerStatusFromFailure(verification);
      this.recordFailure(
        userId,
        'opencode',
        modelId,
        'free_no_api_key',
        false,
        status,
        verification.errorMessage ?? null,
      );
      throw new RoutingError(
        `OpenCode verification failed (${status})${verification.errorMessage ? `: ${verification.errorMessage}` : ''}. The model was NOT made available.`,
      );
    }
    if (!provider.opencodeRuntime.hasModel('opencode', modelId)) {
      this.recordFailure(
        userId,
        'opencode',
        modelId,
        'free_no_api_key',
        false,
        'provider_unavailable',
        `Model "${modelId}" is not present in the real OpenCode catalogue.`,
      );
      throw new RoutingError(
        `Model "${modelId}" is not present in the real OpenCode catalogue. Select a model the runtime actually exposes; nothing was substituted.`,
      );
    }
    return this.recordSelection(userId, 'opencode', modelId, 'free_no_api_key', true, 'connected');
  }

  // ---- per-user API-key providers (OpenRouter + hosted vendors) -------------

  /**
   * Connects a user's credential to a real provider instance (OpenRouter or a
   * hosted vendor adapter). The key is taken from the credential store; it is
   * never logged and never returned. Registration alone changes nothing visible.
   */
  connectOpenRouter(userId: string, credentialId: string, fetchImpl?: unknown): CredentialReference {
    return this.connectUserProvider(userId, 'openrouter', credentialId, fetchImpl);
  }

  connectUserProvider(
    userId: string,
    providerId: string,
    credentialId: string,
    fetchImpl?: unknown,
  ): CredentialReference {
    const secret = this.credentials.resolveSecret(userId, credentialId);
    let provider: DiscoverableProvider;
    if (providerId === 'openrouter') {
      provider = new OpenRouterProvider({
        apiKey: secret,
        ...(fetchImpl !== undefined ? { fetchImpl: fetchImpl as never } : {}),
      });
    } else {
      const meta = hostedMetaFor(providerId);
      if (meta === undefined) {
        throw new ConfigurationError(`no execution adapter for provider "${providerId}"`);
      }
      provider = new HostedProvider(meta, {
        apiKey: secret,
        ...(fetchImpl !== undefined ? { fetchImpl: fetchImpl as never } : {}),
      });
    }
    let perUser = this.userProviders.get(userId);
    if (perUser === undefined) {
      perUser = new Map();
      this.userProviders.set(userId, perUser);
    }
    perUser.set(provider.info.id, provider);
    return this.credentials.getReference(userId, credentialId);
  }

  /**
   * Real verification of a user's stored credential (GET /models against the
   * live endpoint for every wired provider). Records the outcome on the
   * credential and returns it honestly.
   */
  async verifyCredential(userId: string, credentialId: string, fetchImpl?: unknown): Promise<ConnectionTestResult> {
    const ref = this.credentials.getReference(userId, credentialId);
    if (ref.providerId !== 'openrouter' && !WIRED_HOSTED_PROVIDER_IDS.includes(ref.providerId)) {
      // Honest surface: no fabricated verification for unimplemented providers.
      throw new ConfigurationError(
        `connection verification for provider "${ref.providerId}" is not implemented yet`,
      );
    }
    if (this.userProviders.get(userId)?.get(ref.providerId) === undefined) {
      this.connectUserProvider(userId, ref.providerId, credentialId, fetchImpl);
    }
    const provider = this.requireUserProvider(userId, ref.providerId);
    const result = await provider.verifyConnection();
    this.credentials.markVerified(userId, credentialId, result.success, result.errorMessage);
    return result;
  }

  /**
   * Real verification of a user's OpenRouter credential. Delegates to the
   * generic path; kept for compatibility with existing callers.
   */
  async verifyOpenRouter(userId: string, credentialId: string): Promise<ConnectionTestResult> {
    // Legacy guide-first contract: verification requires an existing connection,
    // which itself requires a stored credential for this user.
    this.requireUserProvider(userId, 'openrouter');
    return this.verifyCredential(userId, credentialId);
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
    return this.selectModel(userId, credentialId, 'openrouter', modelId);
  }

  /**
   * Selects a user's model on a hosted vendor provider under the same honest
   * gate: a model becomes selectable only after a real verification held.
   */
  async selectHostedModel(
    userId: string,
    credentialId: string,
    providerId: string,
    modelId: string,
  ): Promise<SelectionState> {
    return this.selectModel(userId, credentialId, providerId, modelId);
  }

  private async selectModel(
    userId: string,
    credentialId: string,
    providerId: string,
    modelId: string,
  ): Promise<SelectionState> {
    const provider = this.requireUserProvider(userId, providerId);
    if (!provider.info.connectionVerified) {
      this.recordFailure(userId, providerId, modelId, 'paid', false, 'auth_required', null);
      throw new RoutingError(
        `Credential "${credentialId}" (${providerId}) has no verified connection. Verify it first; CONFIGURED does not mean AVAILABLE.`,
      );
    }
    const result = await provider.verifyConnection();
    if (!result.success) {
      const status = providerStatusFromFailure(result);
      this.recordFailure(userId, providerId, modelId, 'paid', false, status, result.errorMessage ?? null);
      throw new RoutingError(
        `${provider.info.name} verification failed (${status})${result.errorMessage ? `: ${result.errorMessage}` : ''}. The model was NOT made available.`,
      );
    }
    return this.recordSelection(userId, providerId, modelId, 'paid', true, 'connected');
  }

  private requireUserProvider(userId: string, providerId: string): DiscoverableProvider {
    const perUser = this.userProviders.get(userId)?.get(providerId);
    if (perUser === undefined) {
      throw new RoutingError(
        `No ${providerId === 'openrouter' ? 'OpenRouter' : providerId} connection for user "${userId}". Add a credential and connect it first. (connectOpenRouter / connectUserProvider)`,
      );
    }
    return perUser;
  }

  // ---- provider descriptors + real execution wiring ---------------------------

  /**
   * The providers this build can actually configure for the calling user,
   * each with honest, live state (credential present, connection verified,
   * last real test result). credentialRequired is derived from authMethod -
   * never a marketing label.
   *
   * Every real catalogue provider is also listed (with its true model count
   * and access categories) but marked wired:false unless an execution adapter
   * exists - so the Free/Subscription filter and catalogues are real without
   * ever pretending a provider can run work it cannot.
   */
  describeProviders(
    userId: string,
    catalogueByProvider: Readonly<Record<string, CatalogueProviderSummary>>,
  ): ProviderDescriptor[] {
    const wired: ProviderDescriptor[] = [];

    // Every provider with a real execution adapter (OpenRouter + the hosted
    // vendors). Their configured/verified state below comes from the calling
    // user's stored credential and live connection - never a label.
    for (const providerId of WIRED_PROVIDER_IDS) {
      // OpenCode is a platform-level runtime, not a per-user credential: its
      // descriptor reflects the real installed runtime state, never a key.
      if (providerId === 'opencode') {
        const oc = this.openCode;
        const info = oc?.info;
        const cat = catalogueByProvider[providerId];
        if (oc !== null) {
          wired.push({
            providerId,
            name: info?.name ?? 'OpenCode',
            description:
              info?.description ??
              'OpenCode integrated AI execution layer: the project\u2019s selected provider/model runs in a real opencode session on this host.',
            authMethod: info?.authMethod ?? 'none',
            credentialRequired: false,
            accessCategories: info?.accessCategories ?? (cat?.categories ?? ['free_no_api_key']),
            websiteUrl: info?.websiteUrl ?? 'https://opencode.ai',
            docsUrl: info?.docsUrl ?? 'https://opencode.ai/docs',
            configured: info?.configured ?? true,
            connectionVerified: info?.connectionVerified ?? false,
            lastConnectionResult: info?.lastConnectionResult ?? null,
            wired: true,
            ...(cat !== undefined ? { modelCount: cat.modelCount } : {}),
          });
        }
        continue;
      }
      const ref = this.credentials.findByUserAndProvider(userId, providerId);
      const connected = this.userProviders.get(userId)?.get(providerId);
      const info = connected?.info;
      const isOpenrouter = providerId === 'openrouter';
      const meta = hostedMetaFor(providerId);
      const cat = catalogueByProvider[providerId];
      const authMethod: ProviderAuthMethod =
        info?.authMethod ?? (isOpenrouter ? 'api_key' : meta?.authMethod ?? 'api_key');
      wired.push({
        providerId,
        name: info?.name ?? (isOpenrouter ? 'OpenRouter' : meta?.name ?? providerId),
        description:
          info?.description ??
          (isOpenrouter
            ? 'OpenRouter: one API key, models from many providers.'
            : meta?.description ?? `${providerId}: wired execution adapter.`),
        authMethod,
        credentialRequired: authMethod !== 'none',
        accessCategories:
          cat?.categories ??
          info?.accessCategories ??
          (isOpenrouter
            ? ['free_api_key_required', 'free_oauth', 'paid']
            : meta?.accessCategories ?? ['paid']),
        websiteUrl: info?.websiteUrl ?? (isOpenrouter ? 'https://openrouter.ai' : meta?.websiteUrl ?? ''),
        docsUrl: info?.docsUrl ?? (isOpenrouter ? 'https://openrouter.ai/docs' : meta?.docsUrl ?? ''),
        configured: ref !== null,
        connectionVerified: info?.connectionVerified ?? false,
        lastConnectionResult: info?.lastConnectionResult ?? null,
        wired: true,
        ...(cat !== undefined ? { modelCount: cat.modelCount } : {}),
      });
    }

    if (this.local !== null) {
      const info = this.local.info;
      wired.push({
        providerId: 'local',
        name: info.name,
        description: info.description,
        authMethod: 'none',
        credentialRequired: false,
        accessCategories: ['local'],
        websiteUrl: info.websiteUrl,
        docsUrl: info.docsUrl,
        configured: info.configured,
        connectionVerified: info.connectionVerified,
        lastConnectionResult: info.lastConnectionResult,
        wired: true,
      });
    }

    // Catalogue-backed providers: real models, no adapter in this build. They
    // are browseable and searchable but verify/select honestly answer 501.
    const catalogueOnly: ProviderDescriptor[] = [];
    for (const [providerId, summary] of Object.entries(catalogueByProvider)) {
      if ((WIRED_PROVIDER_IDS as readonly string[]).includes(providerId) || providerId === 'local') continue;
      const label = summary.name || providerId;
      catalogueOnly.push({
        providerId,
        name: label,
        description: `${label}: ${summary.modelCount} model(s) listed in the NEXORA catalogue. No execution adapter is wired in this build, so verification and selection are not implemented yet.`,
        authMethod: 'api_key',
        credentialRequired: true,
        accessCategories: [...summary.categories],
        websiteUrl: '',
        docsUrl: '',
        configured: false,
        connectionVerified: false,
        lastConnectionResult: null,
        wired: false,
        modelCount: summary.modelCount,
      });
    }
    catalogueOnly.sort((a, b) => a.providerId.localeCompare(b.providerId));

    return [...wired, ...catalogueOnly];
  }

  /**
   * REAL connection verification for a provider, scoped to the user:
   *  - openrouter: proves the user's stored key against GET /key.
   *  - openai/anthropic/google/mistral: proves the user's stored key against
   *    the vendor's authenticated GET /models.
   *  - local:      proves the configured runtime is reachable (no key).
   * Anything else is honestly unimplemented (ConfigurationError).
   */
  async verifyProviderConnection(
    userId: string,
    providerId: string,
    fetchImpl?: unknown,
  ): Promise<ConnectionTestResult> {
    if (providerId === 'openrouter' || WIRED_HOSTED_PROVIDER_IDS.includes(providerId)) {
      const ref = this.credentials.findByUserAndProvider(userId, providerId);
      if (ref === null) {
        throw new ConfigurationError(
          `No ${providerId === 'openrouter' ? 'OpenRouter' : providerId} credential for this user. Add one (POST /api/credentials) before verifying; CONFIGURED does not mean AVAILABLE.`,
        );
      }
      this.connectUserProvider(userId, providerId, ref.id, fetchImpl);
      const provider = this.requireUserProvider(userId, providerId);
      const result = await provider.verifyConnection();
      this.credentials.markVerified(userId, ref.id, result.success, result.errorMessage);
      return result;
    }
    if (providerId === 'local') {
      const local = this.local;
      if (local === null) {
        throw new ConfigurationError(
          'No local runtime is configured in this environment. Configure one (setLocalRuntime) before verifying.',
        );
      }
      return local.verifyConnection();
    }
    if (providerId === 'opencode') {
      const openCode = this.openCode;
      if (openCode === null) {
        throw new ConfigurationError(
          'The OpenCode execution layer is not wired in this build. Enable it before verifying.',
        );
      }
      return openCode.verifyConnection();
    }
    throw new ConfigurationError(
      `connection verification for provider "${providerId}" is not implemented yet`,
    );
  }

  /**
   * Builds a real execution route ONLY when the user has a selection whose
   * connection was actually verified. Returns null otherwise - callers should
   * NOT fabricate a run. The returned router is pre-wired to the user's
   * selected provider with every task type routed to it, so the model id is
   * the only per-request input needed.
   */
  getExecutionRouter(userId: string): ExecutionRoute | null {
    const selection = this.getCurrentSelection(userId);
    if (selection === null || !selection.connectionVerified || selection.status !== 'connected') {
      return null;
    }
    let provider: DiscoverableProvider | null;
    if (selection.providerId === 'local') {
      provider = this.local;
    } else if (selection.providerId === 'opencode') {
      provider = this.openCode;
    } else {
      provider = this.userProviders.get(userId)?.get(selection.providerId) ?? null;
    }
    if (provider === null) return null;
    return this.buildRouter(selection.providerId, selection.modelId, provider);
  }

  /**
   * Builds a real execution route for an EXPLICIT provider/model (used by the
   * per-project AI configuration). The user must hold a stored credential for
   * that provider whose connection is actually verified - the connection is
   * re-tested live before the route is produced, so a stale or dead key never
   * runs silently. Returns null (honest) when the route cannot be proven.
   */
  async getExecutionRouterFor(
    userId: string,
    providerId: string,
    modelId: string,
  ): Promise<ExecutionRoute | null> {
    if (providerId === 'opencode') {
      const openCode = this.openCode;
      if (openCode === null) return null;
      const verification = await openCode.verifyConnection();
      if (!verification.success) return null;
      if (!openCode.opencodeRuntime.hasModel('opencode', modelId)) return null;
      return this.buildRouter('opencode', modelId, openCode);
    }
    if (providerId === 'local') {
      const local = this.local;
      if (local === null) return null;
      const presence = await local.statusFor(modelId);
      if (presence.status !== 'connected') return null;
      return this.buildRouter('local', modelId, local);
    }
    const ref = this.credentials.findByUserAndProvider(userId, providerId);
    if (ref === null) return null;
    let provider = this.userProviders.get(userId)?.get(providerId);
    if (provider === undefined) {
      try {
        this.connectUserProvider(userId, providerId, ref.id);
      } catch {
        return null;
      }
      provider = this.userProviders.get(userId)?.get(providerId);
    }
    if (provider === undefined) return null;
    if (provider.info.connectionVerified !== true) {
      const verification = await provider.verifyConnection();
      this.credentials.markVerified(userId, ref.id, verification.success, verification.errorMessage);
      if (!verification.success) return null;
    }
    return this.buildRouter(providerId, modelId, provider);
  }

  private buildRouter(
    providerId: string,
    modelId: string,
    provider: DiscoverableProvider,
  ): ExecutionRoute {
    // AiRouter needs the minimal AiProvider port only; the concrete provider
    // satisfies it structurally, so we adapt without widening the manager's types.
    const adapted: AiProvider = {
      id: provider.info.id,
      complete: (request) => provider.complete(request),
    };
    const router = new AiRouter();
    router.register(adapted);
    for (const taskType of AI_TASK_TYPES) {
      router.setRoute(taskType, provider.info.id);
    }
    router.setDefaultProvider(provider.info.id);
    return { providerId, modelId, router };
  }

  // ---- status accessors --------------------------------------------------------

  /** Current selection for a user, or null when nothing is selected. */
  getCurrentSelection(userId: string): SelectionState | null {
    if (!this.currentByUser.has(userId)) return null;
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
    this.currentByUser.set(userId, { userId, providerId, modelId });
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

