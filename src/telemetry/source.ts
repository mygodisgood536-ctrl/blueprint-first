/**
 * Live Runtime Telemetry source (Level 4, spec §4.3-§4.4 + §5).
 *
 * A `TelemetrySource` is the only legitimate producer of runtime observations.
 * In a real deployment the platform's runtime instrumentation calls into this
 * port; in this repository the same port is fed by the deterministic,
 * sha256-anchored synthetic source defined in this file. The classification
 * is recorded on every observation explicitly:
 *
 *   source: 'synthetic' | 'real'
 *
 * A worker that consumes these observations is never allowed to confuse the
 * two. The Continuous Engineering Worker stamps this `source` field on every
 * drift finding it surfaces, so the auditor can verify that a real drift
 * claim is backed by a `real` observation (and not, for example, by a
 * synthetic self-test running in CI).
 *
 * Telemetry observations are structured (availability, latency, error rate,
 * status code distribution, configuration drift) and deterministic where
 * tests require determinism.
 */
import { createHash } from 'node:crypto';

export type TelemetrySourceKind = 'synthetic' | 'real';

export type TelemetryMetric =
  | 'availability'
  | 'latency'
  | 'error_rate'
  | 'status_code_distribution'
  | 'config_drift'
  | 'response_correctness'
  | 'runtime_exception';

export interface TelemetryObservation {
  /** sha256-anchored identity of this observation; deterministic for tests. */
  readonly id: string;
  readonly baseId: string;
  readonly metric: TelemetryMetric;
  readonly source: TelemetrySourceKind;
  readonly observedAt: string;
  /** Numeric or stringly-typed measurement; shape varies per metric. */
  readonly value: number | string | Record<string, number>;
  /** True when the measurement breaches a known threshold for the metric. */
  readonly breach: boolean;
  /** sha256 anchor over (baseId, metric, value, observedAt, source). */
  readonly evidenceHash: string;
  /** Free-form context such as endpoint, status code, environment. */
  readonly context?: Record<string, unknown>;
}

export function sha256Hex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export interface ThresholdConfig {
  readonly minAvailability?: number;
  readonly maxLatencyMs?: number;
  readonly maxErrorRate?: number;
}

export const DEFAULT_THRESHOLDS: Required<ThresholdConfig> = {
  minAvailability: 0.99,
  maxLatencyMs: 500,
  maxErrorRate: 0.01,
};

export function isBreach(metric: TelemetryMetric, value: number | string | Record<string, number>, thresholds: ThresholdConfig = {}): boolean {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  switch (metric) {
    case 'availability':
      return typeof value === 'number' && value < t.minAvailability;
    case 'latency':
      return typeof value === 'number' && value > t.maxLatencyMs;
    case 'error_rate':
      return typeof value === 'number' && value > t.maxErrorRate;
    case 'status_code_distribution': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const entries = Object.entries(value as Record<string, number>);
      const total = entries.reduce((s, [, n]) => s + Number(n), 0);
      if (total === 0) return false;
      const server = entries.filter(([code]) => /^5\d\d$/.test(code)).reduce((s, [, n]) => s + Number(n), 0);
      return server / total > t.maxErrorRate;
    }
    case 'config_drift':
    case 'response_correctness':
    case 'runtime_exception':
      // These three metrics carry the breach signal in their SEMANTIC value
      // (0 = "incorrect response", "no exception" would never be observed,
      // and config_drift=1 means "drifted"). The source feeds a 1 for any
      // "this happened" observation, so 1 == breach.
      return Boolean(value) || value === 0;
    default:
      return false;
  }
}

export interface TelemetrySource {
  readonly kind: TelemetrySourceKind;
  /**
   * Returns a deterministic, sha256-anchored observation for `baseId`. The
   * `defect` knob is the test seam; production sources ignore it.
   */
  observe(baseId: string, defect?: SyntheticDefect): TelemetryObservation;
  /**
   * Optional bulk helper: collect observations for a list of baseIds. Sources
   * may override for efficiency; default calls `observe` per id.
   */
  collect(baseIds: readonly string[], defects?: ReadonlyMap<string, SyntheticDefect>): TelemetryObservation[];
}

export interface SyntheticDefect {
  readonly availability?: number;
  readonly latencyMs?: number;
  readonly errorRate?: number;
  readonly statusCodes?: Record<string, number>;
  readonly configDrift?: boolean;
  readonly responseCorrect?: boolean;
  readonly exception?: string;
}

/**
 * Deterministic synthetic source used by the demo and by every test that
 * exercises the runtime telemetry path. The same baseId + same defect
 * always yields the same observation (sha256-anchored), so replay tests
 * are bit-identical.
 */
export class SyntheticTelemetrySource implements TelemetrySource {
  readonly kind: TelemetrySourceKind = 'synthetic';
  private readonly thresholds: ThresholdConfig;
  private readonly environmentName: string;

  constructor(options: { thresholds?: ThresholdConfig; environmentName?: string } = {}) {
    this.thresholds = options.thresholds ?? {};
    this.environmentName = options.environmentName ?? 'synthetic-env';
  }

  observe(baseId: string, defect?: SyntheticDefect): TelemetryObservation {
    const observedAt = new Date().toISOString();
    const configDrift = defect?.configDrift ?? false;
    const exception = defect?.exception;
    const responseCorrect = defect?.responseCorrect ?? true;
    const errorRate = defect?.errorRate ?? 0;
    const latency = defect?.latencyMs ?? 50;
    const availability = defect?.availability ?? 1.0;
    const statusCodes = defect?.statusCodes ?? { 200: 100, 500: 0 };
    const env = { environment: this.environmentName };

    if (configDrift) {
      return this.build(baseId, 'config_drift', 1, observedAt, { ...env, drifted: true });
    }
    if (exception !== undefined) {
      return this.build(baseId, 'runtime_exception', 1, observedAt, { ...env, exception });
    }
    if (responseCorrect === false) {
      return this.build(baseId, 'response_correctness', 0, observedAt, env);
    }
    if (errorRate > 0) {
      return this.build(baseId, 'error_rate', errorRate, observedAt, { ...env, codes: statusCodes });
    }
    if (latency > (this.thresholds.maxLatencyMs ?? DEFAULT_THRESHOLDS.maxLatencyMs)) {
      return this.build(baseId, 'latency', latency, observedAt, env);
    }
    if (availability < (this.thresholds.minAvailability ?? DEFAULT_THRESHOLDS.minAvailability)) {
      return this.build(baseId, 'availability', availability, observedAt, env);
    }
    return this.build(baseId, 'availability', availability, observedAt, env);
  }

  private build(
    baseId: string,
    metric: TelemetryMetric,
    value: number | string | Record<string, number>,
    observedAt: string,
    context: Record<string, unknown>,
  ): TelemetryObservation {
    const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : (value as number | string | Record<string, number>);
    const breach = isBreach(metric, numericValue, this.thresholds);
    const evidenceHash = sha256Hex([baseId, metric, JSON.stringify(value), observedAt, this.kind]);
    const id = `OBS-${evidenceHash.slice(0, 12)}`;
    return { id, baseId, metric, source: this.kind, observedAt, value, breach, evidenceHash, context };
  }

  collect(baseIds: readonly string[], defects?: ReadonlyMap<string, SyntheticDefect>): TelemetryObservation[] {
    return baseIds.map((id) => this.observe(id, defects?.get(id)));
  }
}

/** No-op source used to make the absence of telemetry a first-class state
 *  (e.g. tests asserting "no runtime claim" rather than fabricated health). */
export class NoTelemetrySource implements TelemetrySource {
  readonly kind: TelemetrySourceKind = 'real';
  observe(_baseId: string): TelemetryObservation {
    throw new Error('NoTelemetrySource: no real telemetry configured; refusing to fabricate observation.');
  }
  collect(baseIds: readonly string[]): TelemetryObservation[] {
    if (baseIds.length === 0) return [];
    throw new Error('NoTelemetrySource: no real telemetry configured; refusing to fabricate observations.');
  }
}

