/**
 * AI task taxonomy and wire types shared by every provider implementation.
 * Providers receive requests and return responses carrying explicit
 * provider/model identity so provenance can be recorded on artifacts.
 */

export const AI_TASK_TYPES = [
  'DISCOVERY',
  'DESIGN',
  'BUILD',
  'VERIFICATION',
  'REVIEW',
  'OPERATIONS',
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  taskType: AiTaskType;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Caller-chosen model identifier. Optional; multi-model providers (e.g.
   * OpenRouter) require it to route the request, while single-model providers
   * ignore it and keep using their configured model.
   */
  model?: string;
  /** Caller-chosen correlation id, echoed in the response when supported. */
  requestId?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiCompletionResponse {
  content: string;
  providerId: string;
  modelId: string;
  usage?: AiUsage;
  finishReason?: string;
  requestId?: string;
}
