/**
 * Environment-driven configuration with secure defaults.
 *
 * Rules enforced here:
 *  - Secrets are read from environment variables at call time only; they are
 *    never embedded in code, config files, or logs. Only variable NAMES are
 *    ever surfaced in errors.
 *  - Missing configuration fails fast with an actionable message naming the
 *    exact env var to set.
 */

import type { LogLevel } from './logging.ts';
import type { AiTaskType } from '../ai/types.ts';
import { AI_TASK_TYPES } from '../ai/types.ts';
import { ConfigurationError } from './errors.ts';

export interface OpenAiCompatibleSettings {
  readonly baseUrlEnvVar: string;
  readonly modelEnvVar: string;
  readonly apiKeyEnvVar: string;
  readonly timeoutMs: number;
}

export interface AiConfig {
  readonly defaultProvider: string;
  /** Task-type -> provider id overrides parsed from BF_AI_ROUTING. */
  readonly routing: Readonly<Partial<Record<AiTaskType, string>>>;
  readonly openaiCompatible: OpenAiCompatibleSettings;
}

export interface AppConfig {
  readonly envName: string;
  readonly logLevel: LogLevel;
  readonly dataDir: string;
  readonly ai: AiConfig;
}

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

export const DEFAULT_OPENAI_COMPATIBLE_SETTINGS: OpenAiCompatibleSettings = {
  baseUrlEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
  modelEnvVar: 'OPENAI_COMPATIBLE_MODEL',
  apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
  timeoutMs: 120_000,
};

export function parseRoutingOverrides(raw: string | undefined): Partial<Record<AiTaskType, string>> {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) return {};
  const routing: Partial<Record<AiTaskType, string>> = {};
  for (const pair of trimmed.split(',')) {
    const piece = pair.trim();
    if (piece.length === 0) continue;
    const eq = piece.indexOf('=');
    if (eq <= 0 || eq === piece.length - 1) {
      throw new ConfigurationError(
        `BF_AI_ROUTING entry "${piece}" is malformed; expected TASK=PROVIDER pairs separated by commas.`,
      );
    }
    const taskRaw = piece.slice(0, eq).trim();
    const providerId = piece.slice(eq + 1).trim();
    if (!AI_TASK_TYPES.includes(taskRaw as AiTaskType)) {
      throw new ConfigurationError(
        `BF_AI_ROUTING task "${taskRaw}" is not a known AI task type. Known: ${AI_TASK_TYPES.join(', ')}.`,
      );
    }
    routing[taskRaw as AiTaskType] = providerId;
  }
  return routing;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const envName = env['BF_ENV']?.trim() || 'development';
  const logLevelRaw = env['BF_LOG_LEVEL']?.trim() || 'info';
  if (!LOG_LEVELS.has(logLevelRaw)) {
    throw new ConfigurationError(
      `BF_LOG_LEVEL="${logLevelRaw}" is invalid. Valid levels: debug, info, warn, error.`,
    );
  }
  const aiRouting = parseRoutingOverrides(env['BF_AI_ROUTING']);
  return {
    envName,
    logLevel: logLevelRaw as LogLevel,
    dataDir: env['BF_DATA_DIR']?.trim() || './data',
    ai: {
      defaultProvider: env['BF_AI_DEFAULT_PROVIDER']?.trim() || 'scripted',
      routing: aiRouting,
      openaiCompatible: DEFAULT_OPENAI_COMPATIBLE_SETTINGS,
    },
  };
}

export interface ResolvedProviderCredentials {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * Resolves openai-compatible credentials from the given environment.
 * Throws ConfigurationError naming missing variables (never their values).
 */
export function resolveOpenAiCredentials(
  settings: OpenAiCompatibleSettings,
  env: Record<string, string | undefined>,
): ResolvedProviderCredentials {
  const missing: string[] = [];
  const baseUrl = env[settings.baseUrlEnvVar]?.trim() ?? '';
  const model = env[settings.modelEnvVar]?.trim() ?? '';
  const apiKey = env[settings.apiKeyEnvVar]?.trim() ?? '';
  if (baseUrl.length === 0) missing.push(settings.baseUrlEnvVar);
  if (model.length === 0) missing.push(settings.modelEnvVar);
  if (apiKey.length === 0) missing.push(settings.apiKeyEnvVar);
  if (missing.length > 0) {
    throw new ConfigurationError(
      `openai-compatible provider is selected but required environment variable(s) are unset or empty: ${missing.join(', ')}. Set them (e.g. in .env) before using this provider.`,
    );
  }
  // Basic URL sanity without echoing credentials anywhere.
  try {
    new URL(baseUrl);
  } catch {
    throw new ConfigurationError(
      `${settings.baseUrlEnvVar} is not a valid absolute URL.`,
    );
  }
  return { baseUrl, model, apiKey };
}
