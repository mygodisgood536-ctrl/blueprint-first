/**
 * Structured project configuration and initialization (expansion §5).
 *
 * Project configuration lives as structured, validated state on the PROJECT
 * artifact (`attributes.projectConfig`) and is managed by the ProjectRegistry.
 * It declares per-task provider/model preferences, quality gates, feature
 * toggles, and runtime settings for a single project - orthogonal to the
 * global AppConfig (env-driven) and to the AI provider platform layer.
 *
 * This module is additive: it does not alter the global config system, the AI
 * router, or any Level 0-5 infrastructure. It only gives the project a
 * well-typed, validated configuration payload.
 */

import type { AiTaskType } from '../ai/types.ts';
import { AI_TASK_TYPES } from '../ai/types.ts';
import type { ProjectMode } from './types.ts';
import { PROJECT_MODES } from './types.ts';

/** Per-task provider/model preference (empty = use the global default). */
export interface ProviderPreference {
  readonly providerId: string;
  /** Optional explicit model identifier for multi-model providers. */
  readonly model?: string;
}

/** Feature toggles scoped to a project. Each is a real behavioral switch. */
export interface ProjectFeatureToggles {
  readonly qaAlongsideDevelopment: boolean;
  readonly safeChange: boolean;
  readonly continuousEngineering: boolean;
  readonly recursionDiscovery: boolean;
  readonly permanentEngineeringOrg: boolean;
}

/** Quality gates the certification path must satisfy for this project. */
export interface ProjectQualityGates {
  /** Require the master verification engine rollup to pass every dimension. */
  readonly requireMasterPass: boolean;
  /** Require an endorsed council deliberation before certification. */
  readonly requireCouncilEndorsement: boolean;
  /** Require full requirements traceability before certification. */
  readonly requireCompleteTraceability: boolean;
}

/** Structured, validated project configuration. */
export interface ProjectConfiguration {
  readonly mode: ProjectMode;
  /** Optional per-task provider/model preferences (task -> preference). */
  readonly providers: Readonly<Partial<Record<AiTaskType, ProviderPreference>>>;
  readonly features: ProjectFeatureToggles;
  readonly qualityGates: ProjectQualityGates;
  /** Runtime settings for the project's pipeline run. */
  readonly runtime: {
    readonly dataDir: string;
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Sample size used by acceptance/operations sampling. */
    readonly sampleSize?: number;
  };
}

/**
 * Default project configuration, derived from a global AppConfig (env-driven)
 * so a project inherits sensible runtime/provider defaults unless overridden.
 */
export function defaultProjectConfiguration(
  mode: ProjectMode,
  app: { dataDir: string; logLevel: string },
): ProjectConfiguration {
  return {
    mode,
    providers: {},
    features: {
      qaAlongsideDevelopment: true,
      safeChange: true,
      continuousEngineering: true,
      recursionDiscovery: mode === 'full-product',
      permanentEngineeringOrg: mode === 'full-product',
    },
    qualityGates: {
      requireMasterPass: true,
      requireCouncilEndorsement: true,
      requireCompleteTraceability: true,
    },
    runtime: {
      dataDir: app.dataDir,
      logLevel: isLogLevel(app.logLevel) ? app.logLevel : 'info',
    },
  };
}

type LogLevelLiteral = ProjectConfiguration['runtime']['logLevel'];
const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

function isLogLevel(v: string): v is LogLevelLiteral {
  return LOG_LEVELS.has(v);
}

function assertMode(mode: string): asserts mode is ProjectMode {
  if (!PROJECT_MODES.includes(mode as ProjectMode)) {
    throw new Error(`Invalid project mode "${mode}". Known: ${PROJECT_MODES.join(', ')}.`);
  }
}

function assertLogLevel(v: string): asserts v is LogLevelLiteral {
  if (!LOG_LEVELS.has(v)) {
    throw new Error(`Invalid log level "${v}". Valid: debug, info, warn, error.`);
  }
}

/**
 * Validates a free-form config payload and coerces it into a well-typed
 * ProjectConfiguration. Throws (fail-closed) on unknown modes, unknown task
 * types, malformed provider preferences, or invalid runtime values - so a bad
 * config is rejected up front rather than silently mis-applied.
 */
export function normalizeProjectConfiguration(
  raw: Readonly<Record<string, unknown>>,
  fallback: ProjectConfiguration,
): ProjectConfiguration {
  const mode = typeof raw['mode'] === 'string' ? (raw['mode'] as string) : fallback.mode;
  assertMode(mode);

  const rawProviders = (raw['providers'] ?? fallback.providers) as
    | Record<string, unknown>
    | undefined;
  const providers: Partial<Record<AiTaskType, ProviderPreference>> = {};
  if (rawProviders) {
    for (const key of Object.keys(rawProviders)) {
      if (!AI_TASK_TYPES.includes(key as AiTaskType)) {
        throw new Error(`Project config references unknown AI task "${key}".`);
      }
      const pref = rawProviders[key] as Record<string, unknown> | undefined;
      if (!pref || typeof pref['providerId'] !== 'string' || pref['providerId'].trim().length === 0) {
        throw new Error(`Project config provider for task "${key}" requires a non-empty providerId.`);
      }
      const providerId = pref['providerId'].trim();
      const model = typeof pref['model'] === 'string' && pref['model'].trim().length > 0
        ? pref['model'].trim()
        : undefined;
      providers[key as AiTaskType] = model === undefined ? { providerId } : { providerId, model };
    }
  }

  const rawFeatures = raw['features'] as Partial<ProjectFeatureToggles> | undefined;
  const features = {
    qaAlongsideDevelopment:
      typeof rawFeatures?.qaAlongsideDevelopment === 'boolean'
        ? rawFeatures.qaAlongsideDevelopment
        : fallback.features.qaAlongsideDevelopment,
    safeChange:
      typeof rawFeatures?.safeChange === 'boolean'
        ? rawFeatures.safeChange
        : fallback.features.safeChange,
    continuousEngineering:
      typeof rawFeatures?.continuousEngineering === 'boolean'
        ? rawFeatures.continuousEngineering
        : fallback.features.continuousEngineering,
    recursionDiscovery:
      typeof rawFeatures?.recursionDiscovery === 'boolean'
        ? rawFeatures.recursionDiscovery
        : fallback.features.recursionDiscovery,
    permanentEngineeringOrg:
      typeof rawFeatures?.permanentEngineeringOrg === 'boolean'
        ? rawFeatures.permanentEngineeringOrg
        : fallback.features.permanentEngineeringOrg,
  };

  const rawGates = raw['qualityGates'] as Partial<ProjectQualityGates> | undefined;
  const qualityGates = {
    requireMasterPass:
      typeof rawGates?.requireMasterPass === 'boolean'
        ? rawGates.requireMasterPass
        : fallback.qualityGates.requireMasterPass,
    requireCouncilEndorsement:
      typeof rawGates?.requireCouncilEndorsement === 'boolean'
        ? rawGates.requireCouncilEndorsement
        : fallback.qualityGates.requireCouncilEndorsement,
    requireCompleteTraceability:
      typeof rawGates?.requireCompleteTraceability === 'boolean'
        ? rawGates.requireCompleteTraceability
        : fallback.qualityGates.requireCompleteTraceability,
  };

  const rawRuntime = (raw['runtime'] ?? fallback.runtime) as Record<string, unknown> | undefined;
  const dataDir =
    rawRuntime && typeof rawRuntime['dataDir'] === 'string' && rawRuntime['dataDir'].trim().length > 0
      ? rawRuntime['dataDir'].trim()
      : fallback.runtime.dataDir;
  const logLevelRaw =
    rawRuntime && typeof rawRuntime['logLevel'] === 'string' && rawRuntime['logLevel'].trim().length > 0
      ? rawRuntime['logLevel'].trim()
      : fallback.runtime.logLevel;
  assertLogLevel(logLevelRaw);
  const sampleSizeRaw =
    rawRuntime && typeof rawRuntime['sampleSize'] === 'number' ? (rawRuntime['sampleSize'] as number) : undefined;
  if (sampleSizeRaw !== undefined && (!Number.isInteger(sampleSizeRaw) || sampleSizeRaw < 1)) {
    throw new Error(`Project config sampleSize must be a positive integer.`);
  }

  return {
    mode,
    providers,
    features,
    qualityGates,
    runtime: {
      dataDir,
      logLevel: logLevelRaw,
      ...(sampleSizeRaw !== undefined ? { sampleSize: sampleSizeRaw } : {}),
    },
  };
}

/** True when a project feature/toggle/gate is present (helpers for rest of system). */
export function isFeatureEnabled(cfg: ProjectConfiguration, feature: keyof ProjectFeatureToggles): boolean {
  return cfg.features[feature];
}
