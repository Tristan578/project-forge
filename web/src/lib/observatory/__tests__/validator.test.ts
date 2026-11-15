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

  it('rejects a measured latency value whose value disagrees with withinBudget/eligible', () => {
    // Latency's measured value is itself a ratio (budget compliance,
    // withinBudget/eligible). A hand-built or API-supplied value that never
    // passed through deriveMetricValue must still be caught by the consistency
    // check — 95/100 is 0.95, so a stated 0.5 is a lie about the same axis a
    // completeness mismatch would be.
    const value = {
      metric: 'latency',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      source: 'latency-monitor',
      releaseSha: 'a1b2c3d4',
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.latency,
      state: 'measured',
      value: 0.5,
      numerator: 95,
      denominator: 100,
      sampleSize: 100,
      freshnessTtlSeconds: 3600,
    };
    const result = validateMetricValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('does not equal numerator/denominator');
  });

  it('accepts a measured latency value whose value equals withinBudget/eligible', () => {
    const value = {
      metric: 'latency',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      source: 'latency-monitor',
      releaseSha: 'a1b2c3d4',
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.latency,
      state: 'measured',
      value: 0.95,
      numerator: 95,
      denominator: 100,
      sampleSize: 100,
      freshnessTtlSeconds: 3600,
    };
    const result = validateMetricValue(value);
    expect(result.ok).toBe(true);
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

describe('observatory/validator — evidence subject requirement', () => {
  it('rejects an observation whose evidence references no subject id', () => {
    // zEvidenceRef.refine: a metric anchored to nothing (no capability,
    // artifact, journey, or dependency) cannot be attributed to anything.
    const obs = { ...baseCompletenessObservation(), evidence: {} };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('at least one subject');
  });

  it('rejects evidence carrying only observationIds but no subject id', () => {
    const obs = {
      ...baseCompletenessObservation(),
      evidence: { observationIds: ['obs:01J9EVIDENCEONLY00000001'] },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('at least one subject');
  });
});

describe('observatory/validator — latency distribution invariants', () => {
  /** A well-formed latency observation: 95 within budget of 100 eligible. */
  function baseLatencyObservation(): Record<string, unknown> {
    return {
      observationId: 'obs:01J9LATENCYBASE0000000001',
      metric: 'latency',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      evidence: { capabilityId: 'cap:generate.gdd@1' },
      source: 'latency-monitor',
      releaseSha: 'a1b2c3d4',
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.latency,
      sampleSize: 100,
      latencyDistribution: {
        p50Ms: 820,
        p95Ms: 1900,
        p99Ms: 4200,
        budgetMs: 5000,
        withinBudget: 95,
        eligible: 100,
      },
    };
  }

  it('rejects a distribution whose percentiles are not monotonic (p99 < p95)', () => {
    const obs = {
      ...baseLatencyObservation(),
      latencyDistribution: {
        p50Ms: 820,
        p95Ms: 1900,
        p99Ms: 1000,
        budgetMs: 5000,
        withinBudget: 95,
        eligible: 100,
      },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('monotonic');
  });

  it('rejects a distribution whose withinBudget exceeds eligible', () => {
    const obs = {
      ...baseLatencyObservation(),
      latencyDistribution: {
        p50Ms: 820,
        p95Ms: 1900,
        p99Ms: 4200,
        budgetMs: 5000,
        withinBudget: 101,
        eligible: 100,
      },
    };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('withinBudget cannot exceed eligible');
  });

  it('derives insufficient_sample (null) for a latency observation with no distribution', () => {
    // sampleSize (100) is well above the latency minimum (20), so the ONLY
    // reason this falls through to insufficient_sample is the absent
    // numerator/denominator that the missing distribution would have supplied.
    const obs = { ...baseLatencyObservation() };
    delete (obs as Record<string, unknown>).latencyDistribution;
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('insufficient_sample');
    expect(result.data.value).toBeNull();
  });
});

describe('observatory/validator — minimum sample gates the resolved denominator, not sampleSize', () => {
  it('cannot fabricate a measured value by inflating sampleSize above the real denominator', () => {
    // friction minimum is 5 resolved attempts. Only 3 attempts actually
    // resolved (denominator: 3), but sampleSize claims 5 — the gate must key
    // off the denominator, not the caller-controlled sampleSize.
    const obs = {
      ...baseCompletenessObservation(),
      metric: 'friction',
      formulaVersion: FORMULA_VERSIONS.friction,
      evidence: { journeyId: 'jrn:first-game@1' },
      source: 'journey-telemetry',
      numerator: 1,
      denominator: 3,
      sampleSize: 5,
    };
    const result = deriveMetricValue(obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('insufficient_sample');
    expect(result.data.value).toBeNull();
  });

  it('rejects an observation whose sampleSize is less than its denominator', () => {
    const obs = { ...baseCompletenessObservation(), numerator: 4, denominator: 5, sampleSize: 4 };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('sampleSize cannot be less than denominator');
  });

  it('rejects a latency observation whose sampleSize is less than latencyDistribution.eligible', () => {
    const obs = {
      observationId: 'obs:01J9LATENCYSAMPLE0000001',
      metric: 'latency',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      evidence: { capabilityId: 'cap:generate.gdd@1' },
      source: 'latency-monitor',
      releaseSha: 'a1b2c3d4',
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.latency,
      sampleSize: 50,
      latencyDistribution: {
        p50Ms: 820,
        p95Ms: 1900,
        p99Ms: 4200,
        budgetMs: 5000,
        withinBudget: 95,
        eligible: 100,
      },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('sampleSize cannot be less than latencyDistribution.eligible');
  });
});

describe('observatory/validator — window labels must carry their exact duration', () => {
  it('rejects a window labeled 24h that actually spans 7 days', () => {
    const obs = {
      ...baseCompletenessObservation(),
      window: { label: '24h', start: '2026-09-07T00:00:00Z', end: '2026-09-14T00:00:00Z' },
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('must span exactly');
  });
});

describe('observatory/validator — metric metadata must match the dictionary', () => {
  function measuredCompleteness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      metric: 'completeness',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment: 'production',
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
      ...overrides,
    };
  }

  it('rejects a completeness value whose source names another metric\'s system', () => {
    const result = validateMetricValue(measuredCompleteness({ source: 'synthetic-monitor' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('source: expected capability-contract');
  });

  it('rejects a completeness value with a mismatched display direction', () => {
    const result = validateMetricValue(measuredCompleteness({ direction: 'lower_is_better' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('direction: expected higher_is_better');
  });

  it('rejects a completeness value whose unit contradicts the dictionary', () => {
    const result = validateMetricValue(measuredCompleteness({ unit: 'percent' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('unit: expected ratio');
  });

  it('rejects a completeness value with a mismatched freshnessTtlSeconds', () => {
    const result = validateMetricValue(measuredCompleteness({ freshnessTtlSeconds: 60 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('freshnessTtlSeconds: expected 86400');
  });

  it('rejects an observation whose source names another metric\'s system', () => {
    const obs = {
      ...baseCompletenessObservation(),
      source: 'synthetic-monitor',
    };
    const result = validateObservation(obs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('source: expected capability-contract');
  });
});

describe('observatory/validator — measured/stale values must stay within their unit range', () => {
  it('rejects a measured ratio value above 1, even when internally "consistent"', () => {
    // numerator/denominator here agree with value (both express a 2x ratio),
    // so the numerator<=denominator check on Observation never runs — only a
    // direct range check on the persisted MetricValue catches this.
    const value = {
      metric: 'uptime',
      unit: 'ratio',
      direction: 'higher_is_better',
      environment: 'production',
      window: { label: '24h', start: '2026-09-13T00:00:00Z', end: '2026-09-14T00:00:00Z' },
      source: 'synthetic-monitor',
      releaseSha: null,
      observedAt: '2026-09-13T23:00:00Z',
      ingestedAt: '2026-09-13T23:05:00Z',
      confidence: 'verified',
      applicability: 'applicable',
      formulaVersion: FORMULA_VERSIONS.uptime,
      state: 'measured',
      value: 2,
      numerator: 20,
      denominator: 10,
      sampleSize: 20,
      freshnessTtlSeconds: 900,
    };
    const result = validateMetricValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('is outside the valid range for unit ratio');
  });

  it('rejects a stale lastObservedValue outside [0,1]', () => {
    const value = {
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
      lastObservedValue: -1,
      lastObservedAt: '2026-09-13T18:00:00Z',
      sampleSize: 216,
      freshnessTtlSeconds: 900,
    };
    const result = validateMetricValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('lastObservedValue -1 is outside the valid range for unit ratio');
  });
});

describe('observatory/validator — snapshot schemaVersion is pinned', () => {
  it('rejects a snapshot whose schemaVersion is not the current SCHEMA_VERSION', () => {
    const snapshot = {
      snapshotId: 'snap:01J9OLDSCHEMA0000000001',
      environment: 'production',
      builtAt: '2026-09-14T00:05:00Z',
      schemaVersion: '0.9.0',
      values: [],
    };
    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(false);
  });
});
