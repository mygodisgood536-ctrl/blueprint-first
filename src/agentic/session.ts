/**
 * Agentic session loop (Layer 4).
 *
 * A Cline-style REPL over a real execution environment: the session drives an
 * EnvAdapter workspace with file/terminal/git tools until the model answers
 * with a plain-text final summary. Tool calls travel as `TOOL_CALL <json>`
 * lines inside model output, so any text-capable provider can drive the loop
 * (scripted provider in tests, real routers in production). What is NEVER
 * fabricated is the execution: every file/terminal/git effect runs against the
 * real adapter and its outcome is the only thing echoed back to the model.
 */

import type { AiRouter } from '../ai/router.ts';
import type { AiMessage, AiTaskType } from '../ai/types.ts';
import type { EnvAdapter } from '../env/types.ts';

export type AgentToolName =
  | 'file.read'
  | 'file.write'
  | 'file.list'
  | 'terminal.run'
  | 'git.status'
  | 'git.commit';

export interface AgentToolCall {
  readonly name: AgentToolName;
  readonly input: Record<string, unknown>;
}

export interface AgentToolOutcome {
  readonly call: AgentToolCall;
  readonly ok: boolean;
  readonly summary: string;
  readonly seconds: number;
}

export interface AgentSessionOptions {
  /** Router used for every model step. */
  readonly router: AiRouter;
  /** Task type routed to a provider (DISCOVERY / DESIGN / BUILD ...). */
  readonly taskType: AiTaskType;
  /** The project-bound provider id this session inherits (§ one authoritative config). */
  readonly providerId?: string;
  /** Optional explicit model override (multi-model routers). */
  readonly model?: string;
  /** The stage goal handed to the model as the task brief. */
  readonly goals: string;
  /** Durable project context (blueprint, decisions, artifacts) read into the system prompt. */
  readonly context?: string;
  /** The real workspace the tools operate on. */
  readonly env: EnvAdapter;
  /** Cap on tool executions per session; final answers do not consume it. */
  readonly maxToolCalls?: number;
  /**
   * External cancellation: when aborted, the session stops the loop, a
   * running model step rejects, and an in-flight terminal command is really
   * terminated (REAL TERMINATION). Without this a cancelled job could leave
   * a live tool process writing to the workspace.
   */
  readonly signal?: AbortSignal;
  /**
   * Real progress sink for in-flight model work (LAW - REAL PROGRESS ONLY,
   * §54/§55). A single model call against a real provider can legitimately run
   * for many minutes while genuinely advancing. The session forwards the
   * provider's own advancement events so the Execution Supervisor can tell that
   * apart from a silent hang; without it the independent three-minute hard
   * timeout terminates healthy work.
   */
  readonly onProgress?: (evidence: { kind: string; detail?: string }) => void;
}

export interface AgentSessionResult {
  readonly ok: boolean;
  readonly steps: number;
  readonly toolCalls: number;
  readonly finalText: string;
  readonly toolLog: readonly { readonly tool: string; readonly ok: boolean }[];
  /** Human-readable evidence lines for durable certification. */
  readonly evidence: readonly string[];
  readonly providerId: string;
  readonly modelId: string;
  /** Real execution-session ids reported by the underlying provider steps. */
  readonly sessionIds: readonly string[];
}

interface SessionTranscriptTurn {
  readonly assistant: string;
  readonly tool: AgentToolOutcome;
}

const DEFAULT_MAX_TOOL_CALLS = 24;
const TOOL_MARKER = 'TOOL_CALL';
const MAX_TOOL_OUTPUT = 4000;

const TOOL_SPECS: Record<AgentToolName, string> = {
  'file.read': 'read a file at `path` (relative to the workspace root); returns its content',
  'file.write': 'write `content` to `path`, creating parent directories if needed',
  'file.list': 'list entries at `path` (default "."); returns names, kinds and sizes',
  'terminal.run': 'run `command` in the workspace shell; optional `cwd` is a relative subdirectory. The command is REALLY executed and its exit code is returned',
  'git.status': 'report the workspace git branch and working-tree changes',
  'git.commit': 'add -A and commit with `message`; returns the commit id',
};

/** Parses every `TOOL_CALL {json}` line (strict, one tool per line). */
export function parseToolCalls(content: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(TOOL_MARKER)) continue;
    const json = line.slice(TOOL_MARKER.length).trim();
    if (json === '') continue;
    try {
      const parsed = JSON.parse(json) as { tool?: unknown; input?: unknown };
      if (typeof parsed.tool !== 'string') continue;
      calls.push({
        name: parsed.tool as AgentToolName,
        input: (parsed.input as Record<string, unknown>) ?? {},
      });
    } catch {
      // malformed tool line: skipped, the model will see the outcome summary
    }
  }
  return calls;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
}

function containsToolLines(content: string): boolean {
  return content.split(/\r?\n/).some((line) => line.trim().startsWith(TOOL_MARKER));
}

export class AgenticSession {
  private readonly router: AiRouter;
  private readonly options: AgentSessionOptions;
  private readonly turns: SessionTranscriptTurn[] = [];
  private readonly maxToolCalls: number;

  constructor(options: AgentSessionOptions) {
    this.router = options.router;
    this.options = options;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  }

  /** REAL TERMINATION: stop the moment cancellation arrives, from any await. */
  private throwIfAborted(phase: string): void {
    if (this.options.signal?.aborted === true) {
      throw new Error(`Agentic session ${phase} aborted by caller.`);
    }
  }

  private systemPrompt(): string {
    const tools = (Object.keys(TOOL_SPECS) as AgentToolName[])
      .map((name) => `- ${name}: ${TOOL_SPECS[name]}`)
      .join('\n');
    const head: string[] = [
      'You are a Worker Agent completing a project stage inside a real, isolated workspace.',
      '',
      `STAGE GOALS: ${this.options.goals}`,
    ];
    if (this.options.context !== undefined && this.options.context.trim() !== '') {
      head.push('', 'DURABLE PROJECT CONTEXT:', this.options.context.trim());
    }
    return [
      ...head,
      '',
      'TOOLS (call exactly one per reply unless a reply repeats the same tool):',
      tools,
      '',
      `To call a tool, print a single line starting with ${TOOL_MARKER} followed by a JSON object on the SAME line, e.g.:`,
      `${TOOL_MARKER} {"tool":"terminal.run","input":{"command":"node --version"}}`,
      '',
      'Write file content as JSON-escaped text inside the `content` field. Every terminal command is executed for real;',
      'a non-zero exit code means the command really failed.',
      '',
      'When the stage is complete (or you are certain you cannot make honest progress), stop calling tools and reply ',
      'with a PLAIN-TEXT final summary of exactly what you did, what you verified, and any remaining risk. A final ',
      'summary must contain no TOOL_CALL lines.',
    ].join('\n');
  }

  private transcriptMessages(): AiMessage[] {
    const messages: AiMessage[] = [{ role: 'system', content: this.systemPrompt() }];
    for (const turn of this.turns) {
      messages.push({ role: 'assistant', content: turn.assistant });
      const outcome = turn.tool;
      const body = [
        `tool=${outcome.call.name}`,
        `result=${outcome.ok ? 'TOL_OK' : 'TOL_ERR'}`,
        `seconds=${outcome.seconds}`,
        '',
        clamp(outcome.summary, MAX_TOOL_OUTPUT),
      ].join('\n');
      messages.push({ role: 'user', content: body });
    }
    return messages;
  }

  async run(): Promise<AgentSessionResult> {
    let steps = 0;
    let toolCalls = 0;
    const toolLog: { tool: string; ok: boolean }[] = [];
    const evidence: string[] = [];
    const sessionIds: string[] = [];
    let lastProviderId = this.options.providerId ?? 'unknown';
    let lastModelId = this.options.model ?? 'unknown';

    for (;;) {
      this.throwIfAborted('step');
      const response = await this.router.complete({
        taskType: this.options.taskType,
        messages: this.transcriptMessages(),
        ...(this.options.model !== undefined ? { model: this.options.model } : {}),
        ...(this.options.signal !== undefined ? { signal: this.options.signal } : {}),
        ...(this.options.onProgress !== undefined ? { onProgress: this.options.onProgress } : {}),
      });
      lastProviderId = response.providerId;
      lastModelId = response.modelId;
      this.throwIfAborted('after model step');
      if (typeof response.sessionId === 'string' && response.sessionId !== '' && !sessionIds.includes(response.sessionId)) {
        sessionIds.push(response.sessionId);
      }
      steps += 1;

      const calls = parseToolCalls(response.content);
      if (calls.length === 0) {
        // Malformed tool intent must not masquerade as a final answer: if the
        // model clearly tried to call a tool but none parsed, bounce back the
        // malformed attempt. It burns one tool-budget slot so garbage input
        // always terminates honestly instead of hanging or faking completion.
        if (containsToolLines(response.content)) {
          toolCalls += 1;
          this.turns.push({
            assistant: response.content,
            tool: {
              call: { name: 'file.read', input: {} },
              ok: false,
              summary: 'Your reply contained TOOL_CALL line(s), but no well-formed tool JSON could be parsed. Republish each tool call as a single TOOL_CALL {"tool":"...", "input":{...}} line, or reply with a plain-text final summary (no TOOL_CALL lines).',
              seconds: 0,
            },
          });
          if (toolCalls >= this.maxToolCalls) {
            return {
              ok: false,
              steps,
              toolCalls,
              finalText: response.content,
              toolLog,
              evidence,
              providerId: lastProviderId,
              modelId: lastModelId,
              sessionIds,
            };
          }
          continue;
        }
        const finalText = response.content.trim();
        return {
          ok: finalText.length > 0,
          steps,
          toolCalls,
          finalText,
          toolLog,
          evidence,
          providerId: lastProviderId,
          modelId: lastModelId,
          sessionIds,
        };
      }

      let executed = 0;
      for (const call of calls) {
        if (toolCalls >= this.maxToolCalls) break;
        const outcome = await this.executeTool(call);
        this.turns.push({ assistant: response.content, tool: outcome });
        toolLog.push({ tool: call.name, ok: outcome.ok });
        executed += 1;
        toolCalls += 1;
        const line =
          outcome.ok
            ? `tool.${call.name}.ok ${JSON.stringify(call.input)} -> ${outcome.summary}`
            : `tool.${call.name}.failed ${JSON.stringify(call.input)}: ${outcome.summary}`;
        if (call.name !== 'file.read' && call.name !== 'file.list' && call.name !== 'git.status') {
          evidence.push(`@${lastProviderId}/${lastModelId} ${line}`);
        }
      }

      if (executed === 0) {
        // only malformed/over-budget calls remained; bounce them back
        this.turns.push({
          assistant: response.content,
          tool: {
            call: { name: 'file.read', input: {} },
            ok: false,
            summary: 'No tool call could be executed within the budget. Final answers must be plain text without TOOL_CALL lines.',
            seconds: 0,
          },
        });
      }

      if (toolCalls >= this.maxToolCalls && calls.length > 0) {
        return {
          ok: false,
          steps,
          toolCalls,
          finalText: response.content,
          toolLog,
          evidence,
          providerId: lastProviderId,
          modelId: lastModelId,
          sessionIds,
        };
      }
    }
  }

  private async executeTool(call: AgentToolCall): Promise<AgentToolOutcome> {
    this.throwIfAborted(`before tool ${String(call.name)}`);
    const started = Date.now();
    try {
      const outcome = await this.dispatch(call);
      return { call, ok: outcome.ok, summary: outcome.text, seconds: (Date.now() - started) / 1000 };
    } catch (error) {
      return {
        call,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        seconds: (Date.now() - started) / 1000,
      };
    }
  }

  private async dispatch(call: AgentToolCall): Promise<{ ok: boolean; text: string }> {
    const env = this.options.env;
    switch (call.name) {
      case 'file.read': {
        const { content, truncated } = await env.readFile(this.relPath(call));
        return content.length === 0
          ? { ok: true, text: '0 bytes (empty file)' }
          : { ok: true, text: `${clamp(content, MAX_TOOL_OUTPUT)}${truncated ? '\n… file truncated' : ''}` };
      }
      case 'file.write': {
        const path = this.stringInput(call, 'path');
        const content = this.stringInput(call, 'content');
        await env.writeFile(path, content);
        return { ok: true, text: `wrote ${content.length} bytes to ${path}` };
      }
      case 'file.list': {
        const path = this.stringInput(call, 'path') || '.';
        const entries = await env.listFiles(path);
        if (entries.length === 0) return { ok: true, text: '(empty directory)' };
        return {
          ok: true,
          text: entries
            .map((e) => `${e.kind === 'dir' ? 'd' : 'f'} ${e.relPath} (${e.kind === 'dir' ? 'dir' : `${e.size}b`})`)
            .join('\n'),
        };
      }
      case 'terminal.run': {
        const command = this.stringInput(call, 'command');
        if (command === '') throw new Error('terminal.run requires a non-empty command');
        const cwd = this.stringInput(call, 'cwd');
        const full = cwd === '' ? command : `cd /d "${cwd}" && ${command}`;
        const result = await env.runCommand(full, {
          timeoutMs: 60_000,
          ...(this.options.signal !== undefined ? { signal: this.options.signal } : {}),
        });
        const out = result.stdout.trim();
        const err = result.stderr.trim();
        const parts: string[] = [`exit=${result.exitCode}`, `durationMs=${result.durationMs}`];
        if (out !== '') parts.push('\n[stdout]\n' + clamp(out, MAX_TOOL_OUTPUT));
        if (err !== '') parts.push('\n[stderr]\n' + clamp(err, MAX_TOOL_OUTPUT));
        if (result.timedOut) parts.push('\n[tool timed out]');
        const cleanExit = result.exitCode === 0 && !result.timedOut && !result.aborted;
        return { ok: cleanExit, text: parts.join(' ') };
      }
      case 'git.status': {
        const status = await env.gitStatus();
        const lines = status.entries.map((e) => `${e.status} ${e.path}`);
        return { ok: true, text: `branch ${status.branch}\n${lines.length === 0 ? '(clean working tree)' : lines.join('\n')}` };
      }
      case 'git.commit': {
        const message = this.stringInput(call, 'message');
        if (message === '') throw new Error('git.commit requires a message');
        const { commit } = await env.gitCommit(message);
        return { ok: true, text: `committed ${commit}` };
      }
      default:
        throw new Error(`Unknown tool "${String((call as { name: unknown }).name)}".`);
    }
  }

  private relPath(call: AgentToolCall): string {
    const p = this.stringInput(call, 'path');
    return p === '' ? '.' : p;
  }

  private stringInput(call: AgentToolCall, key: string): string {
    const value = call.input[key];
    if (typeof value === 'string') return value;
    return '';
  }
}