/**
 * Real OpenCode runtime client (verified surface, opencode-ai v1.18.32).
 *
 * OpenCode is the integrated AI execution layer: a project's selected
 * provider/model is passed EXPLICITLY to a real `opencode run` subprocess and
 * the real session identity, events, token usage and cost flow back. Nothing
 * here is simulated and no CLI surface beyond what has been verified is used:
 *
 *   opencode run --format json -m <provider>/<model> "<prompt>"
 *       -> one JSON object per stdout line:
 *          {"type":"step_start"|"text"|"step_finish"|..., "timestamp",
 *           "sessionID", "part":{...}}
 *          - "text".part.text      assistant text
 *          - "step_finish".part    {reason, tokens:{...}, cost}
 *   opencode models --refresh      refresh the runtime catalogue cache
 *   <home>/.cache/opencode/models.json
 *       -> { "<providerId>": { id, env?, npm, api?, name, doc?, models } }
 *          models: { "<modelId>": { id, name, cost:{input,output,...},
 *                                  limit:{context,output}, ... } }
 *
 * Everything is driven by the installed runtime and its live catalogue state.
 * A missing executable or an unreadable/stale catalogue is reported honestly
 * (unavailable), never substituted with a hard-coded copy.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Default catalog cache location used by the opencode runtime itself. */
export function defaultOpenCodeCachePath(): string {
  return join(homedir(), '.cache', 'opencode', 'models.json');
}

/** Default scratch directory used for headless runs (never the repo cwd). */
export function defaultOpenCodeScratchDir(): string {
  return join(tmpdir(), 'nexona-opencode');
}

export class OpenCodeError extends Error {
  readonly detail?: Readonly<{ exitCode?: number; stderrTail?: string }>;
  constructor(message: string, detail?: Readonly<{ exitCode?: number; stderrTail?: string }>) {
    super(message);
    this.name = 'OpenCodeError';
    this.detail = detail;
  }
}

/** Token bill reported by a real step_finish event. */
export interface OpenCodeUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** A finished real opencode session. */
export interface OpenCodeRunResult {
  /** Joined assistant text from the `text` events. */
  readonly content: string;
  /** The real opencode session identity (ses_...). */
  readonly sessionID: string;
  /** Provider side of the exact `-m provider/model` passed. */
  readonly providerId: string;
  /** Model side of the exact `-m provider/model` passed. */
  readonly modelId: string;
  readonly usage: OpenCodeUsage;
  /** USD cost reported by opencode (0 for the free opencode/* models). */
  readonly cost: number;
  readonly finishReason?: string;
  readonly durationMs: number;
  /** Number of parsed JSON events received from the real stream. */
  readonly events: number;
}

/** A model row from the runtime catalogue cache. */
export interface OpenCodeModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly family?: string;
  readonly costInputPer1M: number | null;
  readonly costOutputPer1M: number | null;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly attachment: boolean;
  readonly status?: string;
  readonly releaseDate?: string;
}

/** The opencode provider's own catalogue entry (env vars, names, models). */
export interface OpenCodeCatalogEntry {
  readonly providerId: string;
  readonly name: string;
  /** Env vars the provider declares for credentials (e.g. OPENCODE_API_KEY). */
  readonly env: readonly string[];
  readonly models: readonly OpenCodeModel[];
}

export interface OpenCodeRuntimeOptions {
  /** Explicit executable path (overrides PATH/npm-global resolution). */
  executablePath?: string;
  /** Explicit catalogue cache path (overrides <home>/.cache/opencode/models.json). */
  cachePath?: string;
  /** Working directory for spawned runs (defaults to a scratch dir). */
  cwd?: string;
  /**
   * Overall safety cap for one run. This is NOT the hang detector: a genuinely
   * slow but progressing run must survive. Defaults to 15 minutes because real
   * agentic work against a free hosted model legitimately takes minutes.
   */
  timeoutMs?: number;
  /**
   * The architecture's NO-MEANINGFUL-PROGRESS timeout. The timer is reset on every
   * chunk the process emits, so only genuine silence is treated as a hang.
   * Defaults to the architecture's 3 minutes.
   */
  noProgressMs?: number;
  /**
   * When true, only the explicit executablePath / OPENCODE_BIN candidate is
   * probed (no PATH/npm-global fallback). Used to pin deployments and to make
   * "runtime unavailable" a true, local fact in tests.
   */
  disableFallback?: boolean;
  /** Extra environment injected into the subprocess (never logged). */
  extraEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * Injectable runner for unit tests. When supplied, `run()` and `--version`
   * use it instead of spawning a real process. Never used by production wiring.
   */
  runner?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface ParsedRunEvent {
  type?: unknown;
  sessionID?: unknown;
  part?: unknown;
}

export class OpenCodeRuntime {
  readonly scratchDir: string;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly noProgressMs: number;
  private readonly extraEnv: Readonly<Record<string, string | undefined>>;
  private readonly runner?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  private readonly disableFallback: boolean;
  private executable: string | null = null;
  private probed = false;
  private lastExitCode = -1;
  private lastStderrTail = '';

  constructor(options: OpenCodeRuntimeOptions = {}) {
    this.scratchDir = options.cwd ?? defaultOpenCodeScratchDir();
    this.cachePath = options.cachePath ?? defaultOpenCodeCachePath();
    this.timeoutMs = options.timeoutMs ?? 900_000;
    this.noProgressMs = options.noProgressMs ?? 180_000;
    this.extraEnv = options.extraEnv ?? {};
    this.runner = options.runner;
    this.disableFallback = options.disableFallback === true;
    if (options.executablePath !== undefined) this.executable = options.executablePath;
  }

  /** The resolved executable (null when absent/unusable). */
  get executablePath(): string | null {
    return this.available() ? this.executable : null;
  }

  /**
   * True only after a REAL `opencode --version` probe succeeded. The probe
   * runs once and is cached; an explicitly supplied path is probed too, so a
   * bogus executable reports unavailable instead of failing at run time.
   */
  available(): boolean {
    if (!this.probed) {
      this.probed = true;
      this.executable = this.resolveExecutable();
    }
    return this.executable !== null;
  }

  private resolveExecutable(): string | null {
    const explicit =
      typeof this.executable === 'string' && this.executable.trim() !== '' ? this.executable : null;
    const direct = process.env['OPENCODE_BIN'];
    const explicitCandidates = [
      ...(explicit !== null ? [explicit] : []),
      ...(direct !== undefined && direct.trim() !== '' ? [direct] : []),
    ];
    const candidates = this.disableFallback
      ? explicitCandidates
      : [
          ...explicitCandidates,
          'opencode',
          // npm global install shapes seen in the field (windows).
          join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
          join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.cmd'),
          join(homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
        ];
    for (const candidate of candidates) {
      if (this.versionExitsCleanly(candidate)) return candidate;
    }
    return null;
  }

  /** Real `candidate --version`; succeeds only on a verifiable exit 0. */
  private versionExitsCleanly(candidate: string): boolean {
    if (this.runner !== undefined) {
      return candidate.length > 0;
    }
    try {
      const result = spawnSyncQuiet(candidate, ['--version'], this.timeoutMs, this.extraEnv);
      if (result === null) return false;
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Runs a REAL opencode session with the exact model `providerId/modelId`.
   * Returns the parsed real session (identity, text, tokens, cost). Throws
   * OpenCodeError on any genuine failure - never a fabricated answer.
   */
  async run(
    prompt: string,
    options: {
      providerId: string;
      modelId: string;
      sessionID?: string;
      signal?: AbortSignal;
      /**
       * Real progress sink fed from the run's own JSON event stream (§54/§55).
       * Only genuine advancement is reported: a started step, a produced text
       * chunk, or a finished step. A silent run reports nothing, which is what
       * lets the Execution Supervisor distinguish healthy long work from a
       * genuine hang. See AiCompletionRequest.onProgress.
       */
      onProgress?: (evidence: { kind: string; detail?: string }) => void;
    },
  ): Promise<OpenCodeRunResult> {
    const model = `${options.providerId}/${options.modelId}`;
    if (!this.available()) {
      throw new OpenCodeError(
        'The OpenCode execution layer is unavailable: no opencode executable could be resolved and verified on this host.',
      );
    }
    const started = Date.now();
    const args = ['run', '--pure', '--format', 'json', '-m', model, ...(options.sessionID !== undefined ? ['--session', options.sessionID] : [])];
    const output = await this.execute(args, `${options.providerId}/${options.modelId}`, prompt, options.signal, options.onProgress);
    const parsed = parseRunJson(output.stdout);
    const durationMs = Date.now() - started;
    if (output.exitCode !== 0) {
      throw new OpenCodeError(
        `opencode run exited ${output.exitCode}${lastStderrLine(output.stderr) ? `: ${lastStderrLine(output.stderr)}` : ''}.`,
        { exitCode: output.exitCode, stderrTail: tail(output.stderr, 500) },
      );
    }
    if (parsed.text.join('').trim() === '') {
      throw new OpenCodeError(
        `opencode run ${model} completed with no assistant text${parsed.finishReason ? ` (finishReason: ${parsed.finishReason})` : ''}${lastStderrLine(output.stderr) ? `; ${lastStderrLine(output.stderr)}` : ''}.`,
        { exitCode: output.exitCode, stderrTail: tail(output.stderr, 500) },
      );
    }
    return {
      content: parsed.text.join(''),
      sessionID: parsed.sessionID,
      providerId: options.providerId,
      modelId: options.modelId,
      usage: parsed.usage,
      cost: parsed.cost,
      finishReason: parsed.finishReason,
      durationMs,
      events: parsed.events,
    };
  }

  /** Reads the runtime's own catalogue cache. Returns null when not present. */
  readCatalogCache(): OpenCodeCatalogEntry[] | null {
    if (!existsSync(this.cachePath)) return null;
    let raw: string;
    try {
      raw = readFileSync(this.cachePath, 'utf8');
    } catch {
      return null;
    }
    return normalizeCatalogCache(this.cachePath, raw);
  }

  /** True when the named model exists in the REAL runtime catalogue. */
  hasModel(providerId: string, modelId: string): boolean {
    const entry = this.readCatalogCache()?.find((p) => p.providerId === providerId);
    if (entry === undefined) return false;
    return entry.models.some((m) => m.id === modelId);
  }

  /** Refreshes the runtime catalogue cache via the verified `--refresh` flag. */
  async refreshCatalog(): Promise<boolean> {
    if (!this.available()) return false;
    const output = await this.execute(['models', '--refresh'], 'models --refresh', '');
    return output.exitCode === 0 && this.readCatalogCache() !== null;
  }

  private async execute(
    args: readonly string[],
    label: string,
    prompt: string,
    signal?: AbortSignal,
    onProgress?: (evidence: { kind: string; detail?: string }) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.runner !== undefined) {
      if (signal?.aborted === true) throw new OpenCodeError(`opencode ${label} aborted by caller.`);
      return this.runner([...args, prompt]);
    }
    if (this.executable === null) {
      throw new OpenCodeError(`The OpenCode execution layer is unavailable: no opencode executable is present.`);
    }
    if (!existsSync(this.scratchDir)) {
      mkdirSync(this.scratchDir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable as string, [...args, prompt], {
        cwd: this.scratchDir,
        env: { ...process.env, PATH: process.env['PATH'] ?? '', ...this.extraEnv },
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const totalTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onExternalAbort);
        killTree(child);
        reject(new OpenCodeError(`opencode ${label} timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      /**
       * The architecture's execution law is a NO-MEANINGFUL-PROGRESS timeout, not
       * a total-duration cap: a real agentic run that keeps streaming genuine
       * progress must not be killed for merely taking a long time, while a silent
       * run must still be terminated. Because the runtime streams JSON events, the
       * timer is reset on every chunk the process actually emits, so only genuine
       * silence is treated as a hang.
       */
      let progressTimer: NodeJS.Timeout | null = null;
      const armProgressTimer = (): void => {
        if (progressTimer !== null) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(totalTimer);
          signal?.removeEventListener('abort', onExternalAbort);
          killTree(child);
          reject(new OpenCodeError(
            `opencode ${label} made no meaningful progress for ${this.noProgressMs}ms and was terminated.`,
          ));
        }, this.noProgressMs);
      };
      armProgressTimer();
      const settle = (): void => {
        clearTimeout(totalTimer);
        if (progressTimer !== null) clearTimeout(progressTimer);
        signal?.removeEventListener('abort', onExternalAbort);
      };
      const onExternalAbort = (): void => {
        if (settled) return;
        settled = true;
        settle();
        killTree(child);
        reject(new OpenCodeError(`opencode ${label} aborted by caller.`));
      };
      signal?.addEventListener('abort', onExternalAbort, { once: true });
      /**
       * LAW - REAL PROGRESS ONLY (§54): forward genuine advancement from the
       * run's own JSON event stream to the supervisor. A completed step_start,
       * a produced text chunk, or a completed step_finish are real state
       * advancement; only genuine advancement is reported here, never a
       * heartbeat or a timestamp change, and a silent run reports nothing -
       * which is precisely what makes the three-minute timeout meaningful.
       *
       * IMPORTANT (§55): the throttle below bounds CHECKPOINT CHURN, never
       * progress itself. A burst of genuine events is still reported often
       * enough that the supervision window keeps resetting: the rate limit is
       * deliberately much shorter than the hard-timeout window, and only
       * consecutive text-chunk events are throttled. An earlier version throttled
       * by wall-clock alone, which silently swallowed a whole burst of genuine
       * advancement arriving in one tick and let healthy work be timed out.
       */
      let lastReportAt = 0;
      let lastType = '';
      const emitStreamProgress = (line: string): void => {
        if (onProgress === undefined) return;
        let type: unknown;
        try {
          type = (JSON.parse(line) as { type?: unknown }).type;
        } catch {
          return; // not a complete JSON line yet; never guess progress from it
        }
        if (type !== 'step_start' && type !== 'step_finish' && type !== 'text' && type !== 'tool_use') return;
        const kind = `opencode.${String(type)}`;
        const now = Date.now();
        // Throttle only a rapid run of the SAME kind (e.g. a text stream). Any
        // change of kind is genuine advancement and is always reported, as is
        // the first event of a burst.
        if (kind === lastType && now - lastReportAt < 2_000) return;
        lastType = kind;
        lastReportAt = now;
        try {
          onProgress({ kind, detail: line.slice(0, 200) });
        } catch {
          // A faulty progress sink must never break the real execution.
        }
      };
      let buffered = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        armProgressTimer();
        buffered += text;
        let nl = buffered.indexOf('\n');
        while (nl !== -1) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (line.length > 0) emitStreamProgress(line);
          nl = buffered.indexOf('\n');
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        armProgressTimer();
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        settle();
        reject(new OpenCodeError(`Failed to start opencode: ${error.message}`));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        settle();
        this.lastExitCode = code ?? -1;
        this.lastStderrTail = tail(stderr, 500);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
  }
}

function lastStderrLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? '';
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…\n${text.slice(-max)}`;
}

/** Strict-tolerant parse of the verified one-JSON-object-per-line stdout. */
export function parseRunJson(stdout: string): {
  text: string[];
  sessionID: string;
  usage: OpenCodeUsage;
  cost: number;
  finishReason?: string;
  events: number;
} {
  let text = '';
  let sessionID = '';
  let cost = 0;
  let finishReason: string | undefined;
  let usage: OpenCodeUsage = { input: 0, output: 0 };
  let events = 0;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    let event: ParsedRunEvent;
    try {
      event = JSON.parse(line) as ParsedRunEvent;
    } catch {
      continue; // not a JSON event line; not part of the verified shape
    }
    if (typeof event.sessionID === 'string' && event.sessionID !== '' && sessionID === '') {
      sessionID = event.sessionID;
    }
    const type = event.type;
    if (type !== 'text' && type !== 'step_finish') continue;
    const part = event.part;
    if (!isRecord(part)) continue;
    events += 1;
    if (type === 'text' && typeof part['text'] === 'string') {
      text += part['text'];
      continue;
    }
    if (type === 'step_finish') {
      if (typeof part['reason'] === 'string' && finishReason === undefined) finishReason = part['reason'];
      if (isRecord(part['tokens'])) {
        const t = part['tokens'] as Record<string, unknown>;
        usage = {
          input: numOr(t['input'], usage.input),
          output: numOr(t['output'], usage.output),
          ...(typeof t['reasoning'] === 'number' ? { reasoning: t['reasoning'] } : {}),
          ...(isRecord(t['cache'])
            ? {
                cacheRead: numOr((t['cache'] as Record<string, unknown>)['read'], 0),
                cacheWrite: numOr((t['cache'] as Record<string, unknown>)['write'], 0),
              }
            : {}),
        };
      }
      if (typeof part['cost'] === 'number') cost = part['cost'] as number;
    }
  }
  if (sessionID === '') {
    const m = stdout.match(/"sessionID"\s*:\s*"([^"]+)"/);
    sessionID = m?.[1] ?? '';
  }
  return { text: [text], sessionID, usage, cost, finishReason, events };
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

/** Normalizes the verified runtime cache shape into catalogue entries. */
export function normalizeCatalogCache(cachePath: string, raw: string): OpenCodeCatalogEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OpenCodeError(`OpenCode catalogue cache is not valid JSON: ${cachePath}`);
  }
  if (!isRecord(json)) {
    throw new OpenCodeError(`OpenCode catalogue cache has an unexpected shape: ${cachePath}`);
  }
  const entries: OpenCodeCatalogEntry[] = [];
  for (const [providerId, value] of Object.entries(json)) {
    if (!isRecord(value)) continue;
    const provider = value as Record<string, unknown>;
    const models = isRecord(provider['models']) ? provider['models'] as Record<string, unknown> : {};
    const out: OpenCodeModel[] = [];
    for (const [modelKey, modelValue] of Object.entries(models)) {
      if (!isRecord(modelValue)) continue;
      const m = modelValue as Record<string, unknown>;
      const id = typeof m['id'] === 'string' ? m['id'] : modelKey;
      if (id === '') continue;
      const limit = isRecord(m['limit']) ? m['limit'] as Record<string, unknown> : {};
      const cost = isRecord(m['cost']) ? m['cost'] as Record<string, unknown> : {};
      const modalities = isRecord(m['modalities']) ? (m['modalities'] as Record<string, unknown>)['input'] : undefined;
      const inputModalities = Array.isArray(modalities) ? (modalities as unknown[]).filter((x): x is string => typeof x === 'string') : ['text'];
      out.push({
        id,
        name: typeof m['name'] === 'string' ? m['name'] : id,
        ...(typeof m['description'] === 'string' ? { description: m['description'] } : {}),
        ...(typeof m['family'] === 'string' ? { family: m['family'] } : {}),
        costInputPer1M: typeof cost['input'] === 'number' ? (cost['input'] as number) : null,
        costOutputPer1M: typeof cost['output'] === 'number' ? (cost['output'] as number) : null,
        contextLength: typeof limit['context'] === 'number' ? (limit['context'] as number) : 0,
        maxOutputTokens:
          typeof limit['output'] === 'number'
            ? (limit['output'] as number)
            : typeof limit['context'] === 'number'
              ? (limit['context'] as number)
              : 0,
        toolCalling: m['tool_call'] === true,
        reasoning: m['reasoning'] === true,
        attachment: m['attachment'] === true,
        ...(typeof m['status'] === 'string' ? { status: m['status'] } : {}),
        ...(typeof m['release_date'] === 'string' ? { releaseDate: m['release_date'] } : {}),
      });
    }
    const envRaw = provider['env'];
    entries.push({
      providerId,
      name: typeof provider['name'] === 'string' ? (provider['name'] as string) : providerId,
      env: Array.isArray(envRaw) ? (envRaw as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      models: out,
    });
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kills the whole spawned process tree (launcher + node grandchild + conhost). */
function killTree(child: { kill: () => void; pid?: number }): void {
  try {
    child.kill();
  } catch {
    // ignore
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000,
        encoding: 'utf8',
      });
    } catch {
      // best-effort; the kill() above still applies
    }
  }
}

/** Minimal spawn for the availability probe; resolves PATH/PATHEXT shims. */
function spawnSyncQuiet(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  extraEnv: Readonly<Record<string, string | undefined>>,
): { exitCode: number; stdout: string; stderr: string } | null {
  let result;
  try {
    result = spawnSync(command, [...args], {
      env: { ...process.env, PATH: process.env['PATH'] ?? '', ...extraEnv },
      windowsHide: true,
      timeout: timeoutMs,
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
  if (result.error !== undefined && result.error !== null) return null;
  return { exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}