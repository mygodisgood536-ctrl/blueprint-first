/**
 * Unit tests for the Live Runtime Telemetry source (Level 4, spec §4.3).
 *
 * The telemetry source is the only legitimate producer of runtime
 * observations. Its correctness gates both the Continuous Engineering
 * Worker (which surfaces telemetry breaches as drift items) and the Safe
 * Change Department (which uses observation ids as evidence).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_THRESHOLDS,
  NoTelemetrySource,
  SyntheticTelemetrySource,
  isBreach,
  sha256Hex,
} from '../src/telemetry/source.ts';

describe('Telemetry source — sha256-anchored determinism', () => {
  it('same baseId + same defect yields the same metric, baseId, breach, source', () => {
    const a = new SyntheticTelemetrySource();
    const b = new SyntheticTelemetrySource();
    const obs1 = a.observe('PAGE-0001', { errorRate: 0.42 });
    const obs2 = b.observe('PAGE-0001', { errorRate: 0.42 });
    assert.equal(obs1.metric, obs2.metric);
    assert.equal(obs1.breach, obs2.breach);
    assert.equal(obs1.baseId, obs2.baseId);
    assert.equal(obs1.source, 'synthetic');
  });

  it('evidenceHash is a 64-char lowercase hex sha256 string', () => {
    const src = new SyntheticTelemetrySource();
    const obs = src.observe('FEATURE-0001', { latencyMs: 9999 });
    assert.match(obs.evidenceHash, /^[0-9a-f]{64}$/);
    const manual = sha256Hex([
      'FEATURE-0001',
      obs.metric,
      JSON.stringify(obs.value),
      obs.observedAt,
      'synthetic',
    ]);
    assert.equal(obs.evidenceHash, manual);
  });

  it('observation id is derived from the evidenceHash prefix', () => {
    const src = new SyntheticTelemetrySource();
    const obs = src.observe('PAGE-0001', { errorRate: 0.5 });
    assert.ok(obs.id.startsWith('OBS-'));
    assert.equal(obs.id, 'OBS-' + obs.evidenceHash.slice(0, 12));
  });
});


describe('Telemetry source — breach classification per metric', () => {
  it('availability below threshold is a breach', () => {
    const src = new SyntheticTelemetrySource();
    const ok = src.observe('PAGE-0001', { availability: 1.0 });
    assert.equal(ok.breach, false);
    assert.equal(ok.metric, 'availability');
    const bad = src.observe('PAGE-0002', { availability: 0.5 });
    assert.equal(bad.breach, true);
  });

  it('latency above threshold is a breach', () => {
    const src = new SyntheticTelemetrySource();
    const ok = src.observe('PAGE-0001', { latencyMs: 50 });
    assert.equal(ok.breach, false);
    const bad = src.observe('PAGE-0002', { latencyMs: 5000 });
    assert.equal(bad.breach, true);
    assert.equal(bad.metric, 'latency');
  });

  it('error_rate above threshold is a breach', () => {
    const src = new SyntheticTelemetrySource();
    const ok = src.observe('PAGE-0001', { errorRate: 0.0 });
    assert.equal(ok.breach, false);
    const bad = src.observe('PAGE-0002', { errorRate: 0.5 });
    assert.equal(bad.breach, true);
    assert.equal(bad.metric, 'error_rate');
  });

  it('config_drift is always a breach when flagged', () => {
    const src = new SyntheticTelemetrySource();
    const bad = src.observe('PAGE-0001', { configDrift: true });
    assert.equal(bad.breach, true);
    assert.equal(bad.metric, 'config_drift');
  });

  it('response_correctness=false is a breach', () => {
    const src = new SyntheticTelemetrySource();
    const bad = src.observe('PAGE-0001', { responseCorrect: false });
    assert.equal(bad.breach, true);
    assert.equal(bad.metric, 'response_correctness');
  });

  it('runtime_exception is a breach and records the exception in context', () => {
    const src = new SyntheticTelemetrySource();
    const bad = src.observe('PAGE-0001', { exception: 'NullPointerException' });
    assert.equal(bad.breach, true);
    assert.equal(bad.metric, 'runtime_exception');
    assert.equal(bad.context?.['exception'], 'NullPointerException');
  });

  it('honest pass-through: no defect -> availability observation, no breach', () => {
    const src = new SyntheticTelemetrySource();
    const obs = src.observe('PAGE-0001');
    assert.equal(obs.breach, false);
    assert.equal(obs.metric, 'availability');
    assert.equal(obs.value, 1.0);
  });
});


describe('Telemetry source — isBreach direct', () => {
  it('returns false for non-numeric availability/latency/error_rate', () => {
    assert.equal(isBreach('availability', 'not-a-number'), false);
    assert.equal(isBreach('latency', '9999'), false);
    assert.equal(isBreach('error_rate', '0.5'), false);
  });

  it('respects custom thresholds', () => {
    const tight = { minAvailability: 0.999, maxLatencyMs: 100, maxErrorRate: 0.001 };
    assert.equal(isBreach('availability', 0.998, tight), true);
    assert.equal(isBreach('latency', 150, tight), true);
    assert.equal(isBreach('error_rate', 0.01, tight), true);
  });

  it('default thresholds match DEFAULT_THRESHOLDS', () => {
    assert.equal(DEFAULT_THRESHOLDS.minAvailability, 0.99);
    assert.equal(DEFAULT_THRESHOLDS.maxLatencyMs, 500);
    assert.equal(DEFAULT_THRESHOLDS.maxErrorRate, 0.01);
  });
});

describe('Telemetry source — NoTelemetrySource fails closed', () => {
  it('refuses to fabricate a single observation', () => {
    const src = new NoTelemetrySource();
    assert.throws(() => src.observe('PAGE-0001'), /NoTelemetrySource/);
  });

  it('refuses to fabricate a batch when there is at least one baseId', () => {
    const src = new NoTelemetrySource();
    assert.throws(() => src.collect(['PAGE-0001']), /NoTelemetrySource/);
  });

  it('returns an empty list when there is nothing to observe', () => {
    const src = new NoTelemetrySource();
    assert.deepEqual(src.collect([]), []);
  });
});

describe('Telemetry source — collect batch', () => {
  it('collect() produces one observation per baseId, with independent breaches', () => {
    const src = new SyntheticTelemetrySource();
    const defects = new Map([
      ['PAGE-0001', { errorRate: 0.5 }],
      ['PAGE-0002', { errorRate: 0.0 }],
    ]);
    const obs = src.collect([...defects.keys()], defects);
    assert.equal(obs.length, 2);
    const byId = new Map(obs.map((o) => [o.baseId, o]));
    assert.equal(byId.get('PAGE-0001')?.breach, true);
    assert.equal(byId.get('PAGE-0002')?.breach, false);
  });
});
