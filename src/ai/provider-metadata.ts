/**
 * Extended provider contracts for model discovery, classification, and
 * connection verification.
 *
 * The minimal `AiProvider` port (provider.ts) is preserved unchanged; these
 * types extend it. Classification rules are honest by design: an access
 * category reflects the *verified access mechanism*, never a marketing label.
 * A catalogue entry alone proves a model EXISTS - only a connection test
 * proves it is ACCESSIBLE (see verifyConnection on concrete providers).
 */

import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';

/**
 * Authentication method required by a provider.
 * - 'api_key': user supplies an API key
 * - 'oauth':   user authorizes via an OAuth/account flow
 * - 'none':    no authentication required
 * - 'platform': Blueprint-First itself provides the access
 */
export type ProviderAuthMethod = 'api_key' | 'oauth' | 'none' | 'platform';

/**
 * Access category for a model, derived from the actual access mechanism.
 *
 * Honest-classification rules:
 *  - 'free_no_api_key'       ONLY when a verified no-user-key path exists.
 *  - 'free_api_key_required' free per catalogue, but the user's own key is
 *                            the access path (until a no-key path is proven).
 *  - 'free_oauth'            free access via account/OAuth authorization.
 *  - 'platform_provided'     Blueprint-First provides the access route.
 *  - 'paid'                  requires paid provider credentials.
 *  - 'local'                 served by a local runtime (Ollama, LM Studio...).
 */
export type ModelAccessCategory =
  | 'free_no_api_key'
  | 'free_api_key_required'
  | 'free_oauth'
  | 'platform_provided'
  | 'paid'
  | 'local';

/** Normalized, evidence-based capability flags for a model. */
export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly reasoning: boolean;
  readonly structuredOutput: boolean;
}

/** Normalized model information from any catalogue source. */
export interface ModelInfo {
  readonly modelId: string;
  readonly name: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly accessCategory: ModelAccessCategory;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly capabilities: ModelCapabilities;
  /** USD per 1M input tokens; null when unknown/free. */
  readonly inputCostPer1M: number | null;
  /** USD per 1M output tokens; null when unknown/free. */
  readonly outputCostPer1M: number | null;
  readonly available: boolean;
  readonly metadata: Record<string, unknown>;
}

/** Describes a provider itself (not its individual models). */
export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authMethod: ProviderAuthMethod;
  readonly accessCategories: readonly ModelAccessCategory[];
  readonly websiteUrl: string;
  readonly docsUrl: string;
  /** True when usable credentials are currently resolvable. */
  readonly configured: boolean;
  /** True only after a real connection test has succeeded. */
  readonly connectionVerified: boolean;
  readonly lastConnectionResult: ConnectionTestResult | null;
}

/** Result of a real connection-verification attempt. */
export interface ConnectionTestResult {
  readonly success: boolean;
  readonly timestamp: string;
  readonly latencyMs?: number;
  readonly errorMessage?: string;
  readonly modelsAvailable?: number;
}

/**
 * Extended provider interface supporting discovery and verification.
 * Concrete providers satisfy this structurally; MODEL EXISTS (catalogue)
 * is distinguished from MODEL IS ACCESSIBLE (connectionVerified).
 */
export interface DiscoverableProvider {
  readonly info: ProviderInfo;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
  listModels(): Promise<readonly ModelInfo[]>;
  verifyConnection(): Promise<ConnectionTestResult>;
}