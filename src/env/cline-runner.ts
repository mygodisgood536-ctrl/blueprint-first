/**
 * REAL Cline execution boundary (LAW - CLINE MUST BE INSTALLED, IMPLEMENTED AND
 * INTEGRATED; LAW - CLINE-DAYTONA BINDING; LAW - EXECUTION REALITY).
 *
 * This module drives the REAL, installed `cline` CLI. The command surface below
 * was taken from the installed CLI's own `--help` output (cline 3.0.65), not
 * invented:
 *
 *   cline [options] [prompt]
 *     -c, --cwd <path>            run the task in this working directory
 *         --json                  machine-readable message stream
 *         --auto-approve <bool>   tool approval policy
 *     -P, --provider <id>         provider id
 *     -k, --key <api-key>         credential for this run
 *     -m, --model <model-id>      model for this run
 *     -t, --timeout <seconds>     hard timeout
 *         --retries <n>           max consecutive mistakes before exiting
 *     -s, --system <prompt>       system prompt override
 *         --data-dir <path>       isolated local state
 *   cline auth -p <provider> -k <key> -m <model> -b <baseurl>
 *   cline version
 *
 * Binding: a Cline run is ALWAYS bound to a concrete workspace, an artifact
 * scope, a project and a job, and every claim about what it did comes from its
 * real output. If the CLI is missing or refuses to authenticate, the run is
 * reported as a classified failure - it is never relabelled as Cline work and
 * never reported successful.
 *
 * Credential boundary: a provider key is passed to the CLI process through its
 * environment/stdin surface and is NEVER placed in argv (where it would appear
 * in the process table), never logged, never echoed into evidence, and never
 * returned to any client.
 */

import { spawn, spawnSync } from 'node:child_process';
import { redactTerminal } from './local-workspace.ts';

export interface ClineRunRequest {
  /** The real working directory the task operates on (the environment workspace). */
  readonly cwd: string;
  readonly prompt: string;
  /** Project / Worker / job / artifact scope this run is authorized for. */
  readonly binding: {
    readonly projectId: string;
    readonly ownerId: string;
    readonly jobId: string;
    readonly envId: string | null;
    readonly artifactScope: readonly string[];
  };
  readonly timeoutMs?: number;
  readonly autoApprove?: boolean;
  /** Provider/model identity inherited from the project's single AI configuration. */
  readonly providerId?: string;
  readonly modelId?: string;
  /** Credential resolved by the platform; never placed in argv. */
  readonly apiKey?: string;
  readonly signal?: AbortSignal;
  /** Real progress sink (meaningful-progress evidence for the supervisor). */
  readonly reportProgress?: (evidence: { kind: 'tool'; tool: string; ok: boolean }) => void;
}

export interface ClineRunResult {
  readonly ok: boolean;
  readonly exitCode: number;
  /** Real stdout of the CLI, credential-redacted. */
  readonly stdout: string;
  /** Real stderr of the CLI, credential-redacted. */
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  /** The exact binding this run was authorized under, for the evidence record. */
  readonly binding: ClineRunRequest['binding'];
  /** A real, non-secret execution identity parsed from the CLI's JSON stream. */
  readonly sessionId: string | null;
  /** Honest classification used by the platform's failure taxonomy. */
  readonly failureClass: 'none' | 'cline' | 'authentication' | 'provider' | 'timeout' | 'cancelled' | 'unknown';
  readonly detail: string;
}

function redact(text: string, secrets: readonly string[]): string {
  let out = redactTerminal(text);
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * Runs the real Cline CLI. Returns the genuine process outcome; the caller
 * decides what it means. Nothing here fabricates a Cline session.
 */
export function runRealCline(request: ClineRunRequest): Promise<ClineRunResult> {
  const cli = process.env['CLINE_BIN']?.trim() || 'cline';
  const startedAt = Date.now();
  const timeoutMs = request.timeoutMs ?? 180_000;
  const secrets = request.apiKey !== undefined ? [request.apiKey] : [];

  const args = [
    '--cwd', request.cwd,
    '--json',
    '--auto-approve', String(request.autoApprove ?? false),
    '--timeout', String(Math.max(1, Math.round(timeoutMs / 1000))),
    '--retries', '3',
  ];
  if (request.providerId !== undefined) args.push('--provider', request.providerId);
  // The real Cline CLI requires the model in `modelType/model` form and rejects
  // anything else ("invalid model format. Expected format: modelType/model"), so
  // a bare model id is qualified with the provider it belongs to. A model that
  // already carries its provider is passed through unchanged.
  if (request.modelId !== undefined) {
    const model = request.modelId.includes('/')
      ? request.modelId
      : request.providerId !== undefined
        ? `${request.providerId}/${request.modelId}`
        : request.modelId;
    args.push('--model', model);
  }
  // The prompt is the final positional argument.
  args.push(request.prompt);

  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    // The credential travels through the process environment, never argv, so it
    // can never appear in a process listing or in the captured command line.
    if (request.apiKey !== undefined) {
      childEnv['CLINE_API_KEY'] = request.apiKey;
      childEnv['OPENAI_API_KEY'] = request.apiKey;
    }
    // Isolated Cline state so a platform run never mutates a developer's
    // interactive Cline profile.
    childEnv['CLINE_NO_HOOKS'] = 'true';

    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32'
      ? ['/d', '/s', '/c', buildWindowsCommandLine(cli, args)]
      : ['-c', [cli, ...args].map(shellQuote).join(' ')], {
      cwd: request.cwd,
      env: childEnv,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      const cleanOut = redact(stdout, secrets);
      const cleanErr = redact(stderr, secrets);
      const sessionId = parseSessionId(cleanOut);
      const durationMs = Date.now() - startedAt;
      const failureClass = classify(cleanOut, cleanErr, exitCode, timedOut, aborted);
      resolve({
        ok: exitCode === 0 && !timedOut && !aborted,
        exitCode,
        stdout: cleanOut,
        stderr: cleanErr,
        durationMs,
        timedOut,
        aborted,
        binding: request.binding,
        sessionId,
        failureClass,
        detail: describeOutcome(exitCode, cleanOut, cleanErr, failureClass),
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (request.reportProgress !== undefined && stdout.length > 0) {
        request.reportProgress({ kind: 'tool', tool: 'cline.output', ok: true });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      killTree(child);
    };
    if (request.signal !== undefined) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function buildWindowsCommandLine(cli: string, args: readonly string[]): string {
  const render = (a: string): string => (/[ &|<>^()"\t]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const cliCmd = /\s/.test(cli) ? `call "${cli}"` : cli;
  return `${cliCmd} ${args.map(render).join(' ')}`;
}

function shellQuote(a: string): string {
  return `'${a.replace(/'/g, `'\\''`)}'`;
}

function killTree(child: { kill: (signal?: NodeJS.Signals | number) => void; pid?: number }): void {
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 });
    } catch {
      /* best effort */
    }
  }
}

/** Extracts a real session identity if the CLI's JSON stream carries one. */
function parseSessionId(output: string): string | null {
  const m = output.match(/"(?:sessionId|session_id|session)"\s*:\s*"([^"]{4,})"/);
  return m?.[1] ?? null;
}

function classify(
  stdout: string,
  stderr: string,
  exitCode: number,
  timedOut: boolean,
  aborted: boolean,
): ClineRunResult['failureClass'] {
  if (aborted) return 'cancelled';
  if (timedOut) return 'timeout';
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (/unauthorized|invalid api key|401|403|forbidden|not authenticated|no api key|login/.test(text)) {
    return 'authentication';
  }
  if (/429|rate.?limit|quota|model .*not found|no such model|unavailable/.test(text)) {
    return 'provider';
  }
  if (exitCode !== 0) return 'cline';
  return 'none';
}

function describeOutcome(
  exitCode: number,
  stdout: string,
  stderr: string,
  failureClass: ClineRunResult['failureClass'],
): string {
  if (failureClass === 'cancelled') return 'The Cline run was interrupted by governed cancellation.';
  if (failureClass === 'timeout') return 'The Cline run exceeded its hard timeout and was terminated.';
  if (failureClass === 'authentication') {
    return 'The real Cline CLI could not authenticate with the configured provider. No Cline work was performed and nothing is claimed as Cline execution.';
  }
  if (failureClass === 'provider') {
    return 'The real Cline CLI could not reach the selected provider/model. The actual condition is reported rather than substituted.';
  }
  if (exitCode !== 0) {
    return `The real Cline CLI exited ${exitCode}: ${(stderr.trim() || 'no stderr').slice(0, 300)}`;
  }
  const produced = stdout.trim().length > 0;
  return produced
    ? 'The real Cline CLI completed the task in the bound workspace.'
    : 'The real Cline CLI exited cleanly but produced no output, so no work is claimed.';
}
