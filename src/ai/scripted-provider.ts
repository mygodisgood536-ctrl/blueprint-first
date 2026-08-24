/**
 * Deterministic scripted AI provider.
 *
 * Purpose: exercise the full provider/router/orchestration plumbing in tests
 * and demos WITHOUT a live model and without fabricating real AI results.
 * Responses come exclusively from caller-supplied rules or a FIFO queue; the
 * provider records every call for assertion. It is clearly labeled as scripted
 * wherever it is used - it is test infrastructure, not a stand-in for a model.
 */

import { ProviderExhaustedError } from '../core/errors.ts';
import type { AiProvider } from './provider.ts';
import type { AiCompletionRequest, AiCompletionResponse } from './types.ts';

export interface ScriptedRule {
  match(request: AiCompletionRequest): boolean;
  respond(request: AiCompletionRequest): string;
}

export interface ScriptedCall {
  taskType: string;
  messageCount: number;
}

type QueueEntry = string | ((request: AiCompletionRequest) => string);

export class ScriptedProvider implements AiProvider {
  readonly id: string;
  private rules: readonly ScriptedRule[];
  private queue: QueueEntry[];
  /** Every request seen, in order - used by tests to verify routing. */
  readonly calls: ScriptedCall[] = [];

  constructor(options: { id?: string; rules?: readonly ScriptedRule[]; queue?: QueueEntry[] } = {}) {
    this.id = options.id ?? 'scripted';
    this.rules = options.rules ?? [];
    this.queue = [...(options.queue ?? [])];
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    this.calls.push({ taskType: request.taskType, messageCount: request.messages.length });
    const rule = this.rules.find((r) => r.match(request));
    let content: string | undefined;
    if (rule !== undefined) {
      content = rule.respond(request);
    } else {
      const next = this.queue.shift();
      if (next === undefined) throw new ProviderExhaustedError(this.id);
      content = typeof next === 'function' ? next(request) : next;
    }
    return {
      content,
      providerId: this.id,
      modelId: `${this.id}-deterministic-v1`,
      finishReason: 'stop',
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
  }
}
