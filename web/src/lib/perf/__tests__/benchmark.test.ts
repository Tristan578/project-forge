/**
 * Unit tests for the benchmark COMPARATOR HELPERS.
 *
 * Everything in this file feeds `makeResult()` — hand-written numbers — into
 * `benchmark()`, `buildReport()` and `detectRegressions()` and asserts on the
 * arithmetic. No product code is timed here, and no assertion in this file
 * would notice if a real SpawnForge code path became ten times slower.
 *
 * The benchmarks that DO time product code live in `productBenchmarks.test.ts`
 * and are compared against `benchmarks/baseline.json` by
 * `scripts/run-benchmarks.sh`. Historically this file was the entire
 * "benchmark harness", which is how #6697 came to be closed COMPLETED without
 * a single product path ever having been measured; #9458 added the real
 * measurements. Both files are worth keeping: these tests pin the comparator
 * arithmetic that the product benchmarks depend on but never exercise.
 */

import { describe, it, expect } from 'vitest';
import {
  benchmark,
  buildReport,
  detectRegressions,
  diffBenchmarkNames,
  DEFAULT_NOISE_FLOOR_MS,
  DEFAULT_REGRESSION_METRICS,
  type BenchmarkResult,
  type BenchmarkReport,
} from '../benchmark';
import { getBaseline, isWithinBudget, PERFORMANCE_BASELINES } from '../baselines';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(name: string, overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    name,
    avg: 5,
    p50: 4,
    p95: 8,
    p99: 12,
    min: 1,
    max: 20,
    iterations: 100,
    ...overrides,
  };
}

function makeReport(
  results: BenchmarkResult[],
  commit = 'abc123',
): BenchmarkReport {
  return buildReport(results, commit);
}

// ---------------------------------------------------------------------------
// benchmark() — statistical correctness
// ---------------------------------------------------------------------------

describe('benchmark()', () => {
  it('runs the function the specified number of iterations', async () => {
    let callCount = 0;
    await benchmark('counter', () => { callCount++; }, { iterations: 20, warmupRuns: 0 });
    expect(callCount).toBe(20);
  });

  it('runs warm-up iterations before measuring', async () => {
    let callCount = 0;
    await benchmark('warmup', () => { callCount++; }, { iterations: 10, warmupRuns: 5 });
    // 10 measured + 5 warm-up = 15 total calls
    expect(callCount).toBe(15);
  });

  it('returns correct iteration count in result', async () => {
    const result = await benchmark('iter-count', () => {}, { iterations: 7, warmupRuns: 0 });
    expect(result.iterations).toBe(7);
  });

  it('returns the correct name in result', async () => {
    const result = await benchmark('my-bench', () => {}, { iterations: 1, warmupRuns: 0 });
    expect(result.name).toBe('my-bench');
  });

  it('avg is between min and max', async () => {
    const result = await benchmark('avg-check', () => {}, { iterations: 20, warmupRuns: 0 });
    expect(result.avg).toBeGreaterThanOrEqual(result.min);
    expect(result.avg).toBeLessThanOrEqual(result.max);
  });

  it('p50 <= p95 <= p99 <= max', async () => {
    const result = await benchmark('percentile-order', () => {}, { iterations: 50, warmupRuns: 0 });
    expect(result.p50).toBeLessThanOrEqual(result.p95);
    expect(result.p95).toBeLessThanOrEqual(result.p99);
    expect(result.p99).toBeLessThanOrEqual(result.max);
  });

  it('min <= p50', async () => {
    const result = await benchmark('min-p50', () => {}, { iterations: 50, warmupRuns: 0 });
    expect(result.min).toBeLessThanOrEqual(result.p50);
  });

  it('all durations are non-negative', async () => {
    const result = await benchmark('non-negative', () => {}, { iterations: 10, warmupRuns: 0 });
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.avg).toBeGreaterThanOrEqual(0);
  });

  it('works with async functions', async () => {
    let ran = false;
    await benchmark(
      'async-fn',
      async () => {
        await Promise.resolve();
        ran = true;
      },
      { iterations: 3, warmupRuns: 0 },
    );
    expect(ran).toBe(true);
  });

  it('uses default options when none provided', async () => {
    let callCount = 0;
    const result = await benchmark('defaults', () => { callCount++; });
    // 100 iterations + 5 warm-up = 105 total
    expect(callCount).toBe(105);
    expect(result.iterations).toBe(100);
  });

  it('measures faster operations as faster than slower ones', async () => {
    const fast = await benchmark('fast', () => {}, { iterations: 20, warmupRuns: 0 });

    const slow = await benchmark(
      'slow',
      () => {
        // Busy-spin for ~1ms worth of work
        const end = Date.now() + 1;
        while (Date.now() < end) { /* spin */ }
      },
      { iterations: 20, warmupRuns: 0 },
    );

    // The slow benchmark should have a higher average than the fast one
    expect(slow.avg).toBeGreaterThan(fast.avg);
  });
});

// ---------------------------------------------------------------------------
// buildReport()
// ---------------------------------------------------------------------------

describe('buildReport()', () => {
  it('includes all results keyed by name', () => {
    const r1 = makeResult('bench-a');
    const r2 = makeResult('bench-b');
    const report = buildReport([r1, r2], 'sha1');
    expect(report.results['bench-a']).toEqual(r1);
    expect(report.results['bench-b']).toEqual(r2);
  });

  it('stores the provided commit SHA', () => {
    const report = buildReport([], 'deadbeef');
    expect(report.commit).toBe('deadbeef');
  });

  it('defaults commit to "unknown" when not provided', () => {
    const report = buildReport([]);
    expect(report.commit).toBe('unknown');
  });

  it('includes a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    const report = buildReport([]);
    const after = new Date().toISOString();
    expect(report.timestamp >= before).toBe(true);
    expect(report.timestamp <= after).toBe(true);
  });

  it('returns an empty results object for empty input', () => {
    const report = buildReport([]);
    expect(Object.keys(report.results)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectRegressions()
// ---------------------------------------------------------------------------

describe('detectRegressions()', () => {
  it('returns empty array when no regressions exist', () => {
    const current = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    expect(detectRegressions(current, baseline)).toHaveLength(0);
  });

  it('detects avg regression beyond 2× threshold', () => {
    const current = makeReport([makeResult('op', { avg: 11, p50: 4, p95: 8, p99: 10 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const regressions = detectRegressions(current, baseline, 2.0);
    const avgRegression = regressions.find(r => r.metric === 'avg');
    expect(avgRegression).toBeDefined();
    expect(avgRegression?.ratio).toBeCloseTo(11 / 5);
  });

  it('detects p95 regression', () => {
    const current = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 20, p99: 10 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const regressions = detectRegressions(current, baseline, 2.0);
    const p95regression = regressions.find(r => r.metric === 'p95');
    expect(p95regression).toBeDefined();
  });

  it('skips benchmarks that exist in current but not in baseline', () => {
    const current = makeReport([makeResult('new-op')]);
    const baseline = makeReport([]);
    expect(detectRegressions(current, baseline)).toHaveLength(0);
  });

  it('ignores benchmarks that exist in baseline but not in current', () => {
    const current = makeReport([]);
    const baseline = makeReport([makeResult('old-op')]);
    expect(detectRegressions(current, baseline)).toHaveLength(0);
  });

  it('respects custom threshold multiplier', () => {
    // With 1.5× threshold, a 1.6× regression should be detected
    const current = makeReport([makeResult('op', { avg: 8, p50: 4, p95: 8, p99: 10 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const regressions = detectRegressions(current, baseline, 1.5);
    expect(regressions.some(r => r.metric === 'avg')).toBe(true);
  });

  it('does not flag a result that is exactly at threshold', () => {
    // Exactly 2× should NOT be a regression (> not >=)
    const current = makeReport([makeResult('op', { avg: 10, p50: 4, p95: 8, p99: 10 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const regressions = detectRegressions(current, baseline, 2.0);
    const avgRegression = regressions.find(r => r.metric === 'avg');
    expect(avgRegression).toBeUndefined();
  });

  it('does not divide by zero, and does not go quiet, on a zero baseline', () => {
    const current = makeReport([makeResult('op', { avg: 999, p50: 0, p95: 0, p99: 0 })]);
    const baseline = makeReport([makeResult('op', { avg: 0, p50: 0, p95: 0, p99: 0 })]);
    const regressions = detectRegressions(current, baseline);

    // A 0 ms baseline against a 999 ms current is the single most important
    // case to catch, not to skip: it is what a benchmark that used to be
    // instantaneous and is now catastrophically slow looks like. The old
    // `if (baselineMs === 0) continue` swallowed it entirely.
    const avgRegression = regressions.find((r) => r.metric === 'avg');
    expect(avgRegression).toBeDefined();
    expect(Number.isFinite(avgRegression?.ratio)).toBe(true);
    expect(avgRegression?.ratio).toBeCloseTo(999 / DEFAULT_NOISE_FLOOR_MS);

    // 0 vs 0 is genuinely nothing to report.
    expect(regressions.every((r) => r.metric !== 'p50')).toBe(true);
    expect(regressions.every((r) => r.metric !== 'p95')).toBe(true);
    expect(regressions.every((r) => r.metric !== 'p99')).toBe(true);
  });

  it('treats sub-noise-floor movement as noise, not as a regression', () => {
    // 0.001 ms -> 0.004 ms is a 4x ratio and pure clock granularity.
    const current = makeReport([makeResult('op', { avg: 0.004, p50: 0.004, p95: 0.004, p99: 0.004 })]);
    const baseline = makeReport([makeResult('op', { avg: 0.001, p50: 0.001, p95: 0.001, p99: 0.001 })]);
    expect(detectRegressions(current, baseline, 2.0)).toHaveLength(0);
  });

  it('reports a regression once the current value clears the noise floor', () => {
    const current = makeReport([makeResult('op', { avg: 1, p50: 1, p95: 1, p99: 1 })]);
    const baseline = makeReport([makeResult('op', { avg: 0.001, p50: 0.001, p95: 0.001, p99: 0.001 })]);
    expect(detectRegressions(current, baseline, 2.0).length).toBeGreaterThan(0);
  });

  it('honours an explicit noiseFloorMs of 0', () => {
    const current = makeReport([makeResult('op', { avg: 0.004, p50: 0.004, p95: 0.004, p99: 0.004 })]);
    const baseline = makeReport([makeResult('op', { avg: 0.001, p50: 0.001, p95: 0.001, p99: 0.001 })]);
    // `??` semantics: 0 must disable the floor, not fall back to the default.
    const regressions = detectRegressions(current, baseline, 2.0, { noiseFloorMs: 0 });
    expect(regressions.some((r) => r.metric === 'avg')).toBe(true);
  });

  it('compares only the requested metrics', () => {
    const current = makeReport([makeResult('op', { avg: 100, p50: 4, p95: 100, p99: 100, min: 1 })]);
    const baseline = makeReport([makeResult('op', { avg: 5, p50: 4, p95: 8, p99: 12, min: 1 })]);
    const regressions = detectRegressions(current, baseline, 2.0, { metrics: ['min', 'p50'] });
    expect(regressions).toHaveLength(0);
  });

  it('can compare min, which is not in the default metric set', () => {
    const current = makeReport([makeResult('op', { min: 10 })]);
    const baseline = makeReport([makeResult('op', { min: 1 })]);
    expect(detectRegressions(current, baseline, 2.0)).toHaveLength(0);
    const explicit = detectRegressions(current, baseline, 2.0, { metrics: ['min'] });
    expect(explicit.map((r) => r.metric)).toEqual(['min']);
  });

  it('defaults to the historical four-metric set', () => {
    expect([...DEFAULT_REGRESSION_METRICS]).toEqual(['avg', 'p50', 'p95', 'p99']);
  });

  it('includes benchmark name in regression entry', () => {
    const current = makeReport([makeResult('slow-op', { avg: 100, p50: 4, p95: 8, p99: 10 })]);
    const baseline = makeReport([makeResult('slow-op', { avg: 5, p50: 4, p95: 8, p99: 10 })]);
    const regressions = detectRegressions(current, baseline);
    expect(regressions.some(r => r.name === 'slow-op')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// diffBenchmarkNames()
// ---------------------------------------------------------------------------

describe('diffBenchmarkNames()', () => {
  it('reports nothing when both sides carry the same names', () => {
    const current = makeReport([makeResult('a'), makeResult('b')]);
    const baseline = makeReport([makeResult('b'), makeResult('a')]);
    expect(diffBenchmarkNames(current, baseline)).toEqual({
      addedInCurrent: [],
      missingFromCurrent: [],
    });
  });

  it('reports a benchmark that disappeared from the current run', () => {
    // This is the case detectRegressions() reports as "all clear": a renamed,
    // deleted, or crashed-before-recording benchmark produces zero regressions.
    const current = makeReport([makeResult('a')]);
    const baseline = makeReport([makeResult('a'), makeResult('b')]);
    expect(detectRegressions(current, baseline)).toHaveLength(0);
    expect(diffBenchmarkNames(current, baseline).missingFromCurrent).toEqual(['b']);
  });

  it('reports a benchmark that is new in the current run', () => {
    const current = makeReport([makeResult('a'), makeResult('new')]);
    const baseline = makeReport([makeResult('a')]);
    expect(diffBenchmarkNames(current, baseline).addedInCurrent).toEqual(['new']);
  });

  it('reports both sides of a rename', () => {
    const current = makeReport([makeResult('after')]);
    const baseline = makeReport([makeResult('before')]);
    expect(diffBenchmarkNames(current, baseline)).toEqual({
      addedInCurrent: ['after'],
      missingFromCurrent: ['before'],
    });
  });

  it('returns names in sorted order', () => {
    const current = makeReport([makeResult('z'), makeResult('a'), makeResult('m')]);
    const baseline = makeReport([]);
    expect(diffBenchmarkNames(current, baseline).addedInCurrent).toEqual(['a', 'm', 'z']);
  });
});

// ---------------------------------------------------------------------------
// getBaseline() and isWithinBudget()
// ---------------------------------------------------------------------------

describe('getBaseline()', () => {
  it('returns a baseline for known benchmark names', () => {
    const baseline = getBaseline('scene-serialize-100-entities');
    expect(baseline).not.toBeNull();
    expect(baseline?.p95Ms).toBeGreaterThan(0);
    expect(baseline?.avgMs).toBeGreaterThan(0);
    expect(typeof baseline?.description).toBe('string');
  });

  it('returns null for unknown benchmark names', () => {
    expect(getBaseline('nonexistent-benchmark-xyz')).toBeNull();
  });

  it('returns baselines for all registered benchmarks', () => {
    for (const name of Object.keys(PERFORMANCE_BASELINES)) {
      const baseline = getBaseline(name);
      expect(baseline).not.toBeNull();
    }
  });
});

describe('isWithinBudget()', () => {
  it('returns true when measurement is well within budget', () => {
    // scene-serialize has p95Ms = 50; 10ms is well within 2× budget of 100ms
    expect(isWithinBudget('scene-serialize-100-entities', 10)).toBe(true);
  });

  it('returns false when measurement exceeds 2× baseline p95', () => {
    // scene-serialize has p95Ms = 50; 101ms exceeds 2× budget of 100ms
    expect(isWithinBudget('scene-serialize-100-entities', 101)).toBe(false);
  });

  it('returns true for exact 2× boundary (within budget, not exceeding)', () => {
    // p95Ms = 50 → budget = 100ms. Exactly 100ms is within budget.
    expect(isWithinBudget('scene-serialize-100-entities', 100)).toBe(true);
  });

  it('returns true for unknown benchmark names (cannot evaluate)', () => {
    expect(isWithinBudget('unknown-benchmark', 9999)).toBe(true);
  });

  it('respects custom threshold multiplier', () => {
    // scene-serialize p95Ms = 50; with 1.5× threshold, 76ms exceeds budget of 75ms
    expect(isWithinBudget('scene-serialize-100-entities', 76, 1.5)).toBe(false);
    expect(isWithinBudget('scene-serialize-100-entities', 74, 1.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PERFORMANCE_BASELINES — schema sanity checks
// ---------------------------------------------------------------------------

describe('PERFORMANCE_BASELINES', () => {
  it('has at least 5 registered baselines', () => {
    expect(Object.keys(PERFORMANCE_BASELINES).length).toBeGreaterThanOrEqual(5);
  });

  it('every baseline has a positive p95Ms', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.p95Ms, `${name} p95Ms`).toBeGreaterThan(0);
    }
  });

  it('every baseline has a positive avgMs', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.avgMs, `${name} avgMs`).toBeGreaterThan(0);
    }
  });

  it('avgMs is always <= p95Ms', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.avgMs, `${name} avg <= p95`).toBeLessThanOrEqual(baseline.p95Ms);
    }
  });

  it('every baseline has a non-empty description', () => {
    for (const [name, baseline] of Object.entries(PERFORMANCE_BASELINES)) {
      expect(baseline.description.trim(), `${name} description`).not.toBe('');
    }
  });
});
