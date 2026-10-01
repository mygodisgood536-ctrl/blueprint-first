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
  /**
   * External cancellation: when the caller aborts, the provider really
   * terminates the in-flight request (HTTP connection or spawned process).
   * REAL TERMINATION - a cancelled run never leaves live work behind.
   */
  signal?: AbortSignal;
  /**
   * Real progress sink for a LONG single model call (LAW - REAL PROGRESS ONLY,
   * §54/§55).
   *
   * A streaming provider emits real state-advancement events (a started step, a
   * completed tool call, a produced text chunk) while the request is still in
   * flight. Without a way to surface them, a genuinely WORKING long call is
   * indistinguishable from a silent one to the Execution Supervisor, so the
   * independent three-minute hard timeout terminates healthy work. Only genuine
   * advancement from the provider may be reported here - never a heartbeat,
   * repeated status message or timestamp change.
   */
  onProgress?: (evidence: { kind: string; detail?: string }) => void;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiCompletionResponse {
  content: string;
  providerId: string;
  modelId: string;
  /**
   * The model as REQUESTED when the provider actually served a different one
   * (e.g. OpenRouter routing/substitution). Present only in that case so the
   * provenance trail records both identities and no substitution is silent.
   */
  requestedModelId?: string;
  usage?: AiUsage;
  finishReason?: string;
  requestId?: string;
  /**
   * Real execution-session identity for providers that expose one (e.g. the
   * opencode run session id `ses_...`). Present only when the provider truly
   * produced and exposes its session - never fabricated.
   */
  sessionId?: string;
  /** USD cost reported by the real execution layer, when it reports one. */
  cost?: number;
}
