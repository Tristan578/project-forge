import { describe, it, expect } from 'vitest';
import { PERFORMANCE_BASELINES, getBaseline, isWithinBudget } from '../baselines';

describe('perf/baselines', () => {
  it('every baseline has positive p95 and avg times', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.p95Ms, `${name} p95Ms`).toBeGreaterThan(0);
      expect(baseline.avgMs, `${name} avgMs`).toBeGreaterThan(0);
      expect(baseline.p95Ms, `${name} p95 should be >= avg`).toBeGreaterThanOrEqual(baseline.avgMs);
    }
  });

  it('every baseline has a description', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.description, `${name} description`).toBeTruthy();
    }
  });

  describe('getBaseline', () => {
    it('returns baseline for known benchmark', () => {
      const b = getBaseline('command-dispatch-single');
      expect(b).not.toBeNull();
      expect(b!.p95Ms).toBe(1);
    });

    it('returns null for unknown benchmark', () => {
      expect(getBaseline('nonexistent-benchmark')).toBeNull();
    });
  });

  describe('isWithinBudget', () => {
    it('returns true when measured is within 2x baseline', () => {
      // command-dispatch-single p95 = 1ms, so 2ms should be within 2x budget
      expect(isWithinBudget('command-dispatch-single', 1.5)).toBe(true);
    });

    it('returns true when measured equals 2x baseline', () => {
      expect(isWithinBudget('command-dispatch-single', 2.0)).toBe(true);
    });

    it('returns false when measured exceeds 2x baseline', () => {
      expect(isWithinBudget('command-dispatch-single', 2.1)).toBe(false);
    });

    it('respects custom threshold multiplier', () => {
      // p95 = 1ms, measured = 3ms, 3x threshold → within budget
      expect(isWithinBudget('command-dispatch-single', 3.0, 3.0)).toBe(true);
      // p95 = 1ms, measured = 3.1ms, 3x threshold → over budget
      expect(isWithinBudget('command-dispatch-single', 3.1, 3.0)).toBe(false);
    });

    it('returns true for unknown benchmarks (cannot evaluate)', () => {
      expect(isWithinBudget('unknown-benchmark', 999999)).toBe(true);
    });
  });
});
