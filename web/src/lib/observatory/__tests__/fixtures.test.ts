import { describe, it, expect } from 'vitest';
import {
  validateObservation,
  validateMetricValue,
  validateSnapshot,
  deriveMetricValue,
} from '../validator';

import completenessVerified from '../fixtures/completeness-verified.json';
import completenessZeroEligible from '../fixtures/completeness-zero-eligible.json';
import frictionFailedResolved from '../fixtures/friction-failed-resolved.json';
import latencyBudgetCompliance from '../fixtures/latency-budget-compliance.json';
import uptimeEligibleObservations from '../fixtures/uptime-eligible-observations.json';
import staleLastGoodValue from '../fixtures/stale-last-good-value.json';
import mixedEnvironmentInvalid from '../fixtures/mixed-environment-invalid.json';
import formulaVersionMismatch from '../fixtures/formula-version-mismatch.json';

describe('observatory/fixtures — golden metric outputs', () => {
  it('completeness-verified: 4 verified of 5 applicable derives 80%', () => {
    const shape = validateObservation(completenessVerified);
    expect(shape.ok).toBe(true);
    const derived = deriveMetricValue(completenessVerified);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.data.state).toBe('measured');
    if (derived.data.state !== 'measured') return;
    expect(derived.data.value).toBeCloseTo(0.8, 10);
    expect(derived.data.unit).toBe('ratio');
    expect(derived.data.direction).toBe('higher_is_better');
  });

  it('completeness-zero-eligible: zero eligible derives null + insufficient-data', () => {
    const derived = deriveMetricValue(completenessZeroEligible);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.data.state).toBe('insufficient_sample');
    expect(derived.data.value).toBeNull();
    // Explicitly NOT a measured zero and NOT 100% healthy.
    expect(derived.data.value).not.toBe(0);
  });

  it('friction-failed-resolved: 2 failed of 10 resolved derives 20%', () => {
    const derived = deriveMetricValue(frictionFailedResolved);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.data.state).toBe('measured');
    if (derived.data.state !== 'measured') return;
    expect(derived.data.value).toBeCloseTo(0.2, 10);
    // Friction is normalized lower-is-better.
    expect(derived.data.direction).toBe('lower_is_better');
  });

  it('latency-budget-compliance: 95 within budget of 100 eligible derives 95%', () => {
    const derived = deriveMetricValue(latencyBudgetCompliance);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.data.state).toBe('measured');
    if (derived.data.state !== 'measured') return;
    expect(derived.data.value).toBeCloseTo(0.95, 10);
  });

  it('uptime-eligible-observations: 286 of 288 eligible derives ~99.3%', () => {
    const derived = deriveMetricValue(uptimeEligibleObservations);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.data.state).toBe('measured');
    if (derived.data.state !== 'measured') return;
    expect(derived.data.value).toBeCloseTo(286 / 288, 10);
  });

  it('stale-last-good-value: parses, keeps last-good value, claims no current health', () => {
    const result = validateMetricValue(staleLastGoodValue);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('stale');
    expect(result.data.value).toBeNull();
    if (result.data.state !== 'stale') return;
    expect(result.data.lastObservedValue).toBeCloseTo(0.997, 10);
  });

  it('mixed-environment-invalid: a snapshot mixing prod and preview is rejected', () => {
    const result = validateSnapshot(mixedEnvironmentInvalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('does not match snapshot environment');
  });

  it('formula-version-mismatch: an observation on the wrong formula is rejected', () => {
    const result = validateObservation(formulaVersionMismatch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('completeness@1');
  });
});
