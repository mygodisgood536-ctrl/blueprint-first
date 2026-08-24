/**
 * Structured logging with secret redaction.
 *
 * Subsystems never log directly to the console; they receive a Logger. Entries
 * are JSON objects (timestamp, level, message, bound + per-call fields).
 * Values whose keys look secret-like are masked before reaching any sink.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogSink {
  write(level: LogLevel, entry: Record<string, unknown>): void;
}

export function consoleSink(): LogSink {
  return {
    write(level, entry) {
      const line = JSON.stringify(entry);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}

export function memorySink(): LogSink & { entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    write(_level, entry) {
      entries.push(entry);
    },
  };
}

const DEFAULT_SECRET_KEY_PATTERN = /api[-_]?key|authorization|secret|password|token|credential/i;

/** Deep redaction: masks values under secret-looking keys; depth-capped. */
export function redact(
  value: unknown,
  pattern: RegExp = DEFAULT_SECRET_KEY_PATTERN,
  depth = 0,
): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redact(v, pattern, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = pattern.test(k) ? '[REDACTED]' : redact(v, pattern, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Returns a logger with additional fields permanently bound. */
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
  secretKeyPattern?: RegExp;
}

function emit(
  sink: LogSink,
  threshold: LogLevel,
  level: LogLevel,
  message: string,
  bindings: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
  secretKeyPattern: RegExp,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[threshold]) return;
  sink.write(level, {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact({ ...bindings, ...(fields ?? {}) }, secretKeyPattern) as Record<string, unknown>,
  });
}

export function createLogger(options: LoggerOptions = {}, bound: Record<string, unknown> = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? memorySink();
  const pattern = options.secretKeyPattern ?? DEFAULT_SECRET_KEY_PATTERN;
  return {
    debug: (m, f) => emit(sink, level, 'debug', m, bound, f, pattern),
    info: (m, f) => emit(sink, level, 'info', m, bound, f, pattern),
    warn: (m, f) => emit(sink, level, 'warn', m, bound, f, pattern),
    error: (m, f) => emit(sink, level, 'error', m, bound, f, pattern),
    child: (bindings) => createLogger(options, { ...bound, ...bindings }),
  };
}
