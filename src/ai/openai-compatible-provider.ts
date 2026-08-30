/**
 * OpenAI-compatible HTTP chat-completions provider.
 *
 * STATUS: implemented and unit-tested against an injected fetch double
 * (request shaping, auth header presence, response parsing, error mapping).
 * NOT yet verified against a live external endpoint - that requires real
 * credentials and is explicitly out of scope for this stage.
 *
 * Security properties:
 *  - The API key is resolved from environment variables at call time via
 *    resolveOpenAiCredentials(); it is never hard-coded, logged, or embedded
 *    in error messages.
 *  - fetch is injectable, so no network access occurs in tests.
 */

import {
  ConfigurationError,
  ProviderHttpError,
} from '../core/errors.ts';
import { resolveOpenAiCredentials } from '../core/config.ts';
import type { OpenAiCompatibleSettings } from '../core/config.ts';
import type { AiProvider } from './provider.ts';
import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';

/** Minimal structural fetch abstraction (keeps DOM lib out of tsconfig). */
export interface FetchFn {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
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

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';
  private readonly settings: OpenAiCompatibleSettings;
  private readonly fetchImpl: FetchFn;
  private readonly env: Record<string, string | undefined>;

  constructor(options: {
    settings: OpenAiCompatibleSettings;
    fetchImpl?: FetchFn;
    env?: Record<string, string | undefined>;
  }) {
    this.settings = options.settings;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
    this.env = options.env ?? process.env;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    // Resolved at call time; throws ConfigurationError naming missing env vars.
    const creds = resolveOpenAiCredentials(this.settings, this.env);
    // A caller may target a specific model (multi-model gateways); otherwise
    // the configured model is used unchanged, preserving existing behavior.
    const model = request.model ?? creds.model;
    const body = JSON.stringify({
      model,
      messages: request.messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    let raw: Awaited<ReturnType<FetchFn>>;
    try {
      raw = await this.fetchImpl(joinUrl(creds.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!raw.ok) {
      const text = await raw.text();
      throw new ProviderHttpError(raw.status, text.slice(0, 500));
    }
    const json: unknown = await raw.json();
    if (!isRecord(json)) {
      throw new ProviderHttpError(raw.status, 'Response body was not a JSON object.');
    }
    const choices = json['choices'];
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) && isRecord(first['message']) ? first['message'] : undefined;
    const content = typeof message?.['content'] === 'string' ? message['content'] : '';
    if (content.length === 0) {
      throw new ProviderHttpError(raw.status, 'Response contained no assistant message content.');
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
      modelId: model,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }
}
