import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  validateObservation,
  validateMetricValue,
  validateSnapshot,
  deriveMetricValue,
} from '../validator';
import { FORMULA_VERSIONS } from '../schema';

/** A well-formed completeness observation (4 of 5 verified). */
function baseCompletenessObservation(): Record<string, unknown> {
  return {
    observationId: 'obs:01J9VALIDROUNDTRIP00001',
    metric: 'completeness',
    environment: 'production',
    window: {
      label: '30d',
      start: '2026-08-15T00:00:00Z',
      end: '2026-09-14T00:00:00Z',
    },
    evidence: { capabilityId: 'cap:scene.spawn@1' },
    source: 'capability-contract',
    releaseSha: 'a1b2c3d4',
    observedAt: '2026-09-13T23:00:00Z',
    ingestedAt: '2026-09-13T23:05:00Z',
    confidence: 'verified',
    applicability: 'applicable',
    formulaVersion: FORMULA_VERSIONS.completeness,
    numerator: 4,
    denominator: 5,
    sampleSize: 5,
  };
}

describe('observatory/validator — validateObservation', () => {
  it('accepts a well-formed observation and round-trips it', () => {
    const result = validateObservation(baseCompletenessObservation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metric).toBe('completeness');
    expect(result.data.numerator).toBe(4);
    expect(result.data.denominator).toBe(5);
  });

  it('rejects a formula-version mismatch and names both versions', () => {
    const obs = { ...baseCompletenessObservation(), formulaVersion: 'completeness@0' };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('completeness@1');
    expect(result.errors.join(' ')).toContain('completeness@0');
  });

  it('rejects a numerator greater than its denominator', () => {
    const obs = { ...baseCompletenessObservation(), numerator: 6, denominator: 5 };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
  });
});

describe('observatory/validator — deriveMetricValue', () => {
  it('derives a measured 0.80 completeness value (4 verified of 5 applicable)', () => {
    const result = deriveMetricValue(baseCompletenessObservation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('measured');
    if (result.data.state !== 'measured') return;
    expect(result.data.value).toBeCloseTo(0.8, 10);
    expect(result.data.applicability).toBe('applicable');
  });

  it('derives insufficient_sample (null, not zero) when the denominator is zero', () => {
    const obs = { ...baseCompletenessObservation(), numerator: 0, denominator: 0, sampleSize: 0 };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('insufficient_sample');
    expect(result.data.value).toBeNull();
    // A zero-eligible metric is NOT a measured zero and NOT healthy.
    expect(result.data.value).not.toBe(0);
  });

  it('derives insufficient_sample when the sample is below the metric minimum', () => {
    // friction minimum sample size is 5; supply 3.
    const obs = {
      ...baseCompletenessObservation(),
      metric: 'friction',
      formulaVersion: FORMULA_VERSIONS.friction,
      evidence: { journeyId: 'jrn:first-game@1' },
      source: 'journey-telemetry',
      numerator: 1,
      denominator: 3,
      sampleSize: 3,
    };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('insufficient_sample');
    expect(result.data.value).toBeNull();
  });

  it('derives not_applicable rather than a health value for a non-runtime artifact', () => {
    const obs = {
      ...baseCompletenessObservation(),
      metric: 'uptime',
      formulaVersion: FORMULA_VERSIONS.uptime,
      evidence: { artifactId: 'art:deadbeef' },
      source: 'synthetic-monitor',
      applicability: 'not_applicable',
      confidence: 'unavailable',
      numerator: 0,
      denominator: 0,
      sampleSize: 0,
    };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('not_applicable');
    expect(result.data.value).toBeNull();
    expect(result.data.applicability).toBe('not_applicable');
  });

  it('refuses to derive a measured value from evidence with unavailable provenance', () => {
    const obs = { ...baseCompletenessObservation(), confidence: 'unavailable' };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(false);
  });
});

describe('observatory/validator — validateMetricValue', () => {
  function staleValue(): Record<string, unknown> {
    return {
      metric: 'uptime',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      source: 'synthetic-monitor',
      releaseSha: null,
      observedAt: '2026-09-13T18:00:00Z',
      ingestedAt: '2026-09-13T18:01:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.uptime,
      state: 'stale',
      value: null,
      lastObservedValue: 0.997,
      lastObservedAt: '2026-09-13T18:00:00Z',
      sampleSize: 216,
      freshnessTtlSeconds: 900,
    };
  }

  it('accepts a stale value that keeps its last-observed value but claims no current health', () => {
    const result = validateMetricValue(staleValue());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('stale');
    // Current-health axis is null; last-good is retained on its own field.
    expect(result.data.value).toBeNull();
    if (result.data.state !== 'stale') return;
    expect(result.data.lastObservedValue).toBeCloseTo(0.997, 10);
  });

  it('rejects a measured ratio whose value disagrees with numerator/denominator', () => {
    const value = {
      ...staleValue(),
      state: 'measured',
      metric: 'completeness',
      formulaVersion: FORMULA_VERSIONS.completeness,
      value: 0.5,
      numerator: 4,
      denominator: 5,
      sampleSize: 5,
      freshnessTtlSeconds: 86400,
    };
    delete (value as Record<string, unknown>).lastObservedValue;
    delete (value as Record<string, unknown>).lastObservedAt;
    const result = validateMetricValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('does not equal numerator/denominator');
  });
});

describe('observatory/validator — validateSnapshot', () => {
  function measuredCompleteness(environment: string): Record<string, unknown> {
    return {
      metric: 'completeness',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment,
      window: { label: '30d', start: '2026-08-15T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      source: 'capability-contract',
      releaseSha: 'a1b2c3d4',
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.completeness,
      state: 'measured',
      value: 0.8,
      numerator: 4,
      denominator: 5,
      sampleSize: 5,
      freshnessTtlSeconds: 86400,
    };
  }

  it('accepts a single-environment snapshot', () => {
    const snapshot = {
      snapshotId: 'snap:01J9SINGLEENV0000000001',
      environment: 'production',
      builtAt: '2026-09-14T00:05:00Z',
      schemaVersion: '1.0.0',
      values: [measuredCompleteness('production')],
    };
    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(true);
  });

  it('rejects a snapshot mixing environments into one result', () => {
    const snapshot = {
      snapshotId: 'snap:01J9MIXEDENV0000000001',
      environment: 'production',
      builtAt: '2026-09-14T00:05:00Z',
      schemaVersion: '1.0.0',
      values: [measuredCompleteness('production'), measuredCompleteness('preview')],
    };
    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('does not match snapshot environment');
  });
});

describe('observatory/validator — half-open window boundaries', () => {
  it('accepts a window whose end is strictly after its start', () => {
    const result = validateObservation(baseCompletenessObservation());
    expect(result.ok).toBe(true);
  });

  it('rejects a degenerate window whose end equals its start', () => {
    const obs: Record<string, unknown> = {
      ...baseCompletenessObservation(),
      window: { label: '24h', start: '2026-09-14T00:00:00Z', end: '2026-09-14T00:00:00Z' },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('half-open');
  });

  it('rejects an inverted window whose end precedes its start', () => {
    const obs: Record<string, unknown> = {
      ...baseCompletenessObservation(),
      window: { label: '24h', start: '2026-09-14T00:00:00Z', end: '2026-09-13T00:00:00Z' },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
  });

  it('narrows the returned type so ONLY a measured value exposes a numeric value', () => {
    const result = deriveMetricValue(baseCompletenessObservation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The MetricValue union keys `value` on `state`: `measured` carries a
    // `number`, every other branch narrows `value` to `null`. Assert BOTH the
    // compile-time narrowing and its runtime witness, so widening `value` off
    // `state` (e.g. back to `number | null` on the measured branch) fails here.
    if (result.data.state === 'measured') {
      expectTypeOf(result.data.value).toEqualTypeOf<number>();
      expect(typeof result.data.value).toBe('number');
    } else {
      expectTypeOf(result.data.value).toEqualTypeOf<null>();
      expect(result.data.value).toBeNull();
    }
    // A well-formed 4/5 completeness observation must land on the measured
    // branch — a regression that misrouted it would trip the checks above.
    expect(result.data.state).toBe('measured');
  });
});
