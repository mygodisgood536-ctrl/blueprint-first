/**
 * AI provider port. Any backend (scripted, OpenAI-compatible HTTP, Anthropic,
 * local models, ...) implements this interface; nothing above this seam may
 * depend on a specific vendor. Concrete providers stamp every response with
 * their id and the concrete model id so provenance can be recorded.
 */

import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';

export interface AiProvider {
  readonly id: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
