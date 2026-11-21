/**
 * Lightweight benchmarking utility for SpawnForge performance regression detection.
 *
 * Usage:
 *   const result = await benchmark('scene-serialize-100', async () => {
 *     await serializeScene(entities);
 *   }, { iterations: 50 });
 *   console.log(result.p95); // 95th-percentile duration in ms
 */

export interface BenchmarkOptions {
  /** Number of times to run the function. Defaults to 100. */
  iterations?: number;
  /** Number of warm-up runs before measurement (not counted). Defaults to 5. */
  warmupRuns?: number;
}

export interface BenchmarkResult {
  /** Name of the benchmark */
  name: string;
  /** Average duration in milliseconds */
  avg: number;
  /** 50th-percentile duration in milliseconds */
  p50: number;
  /** 95th-percentile duration in milliseconds */
  p95: number;
  /** 99th-percentile duration in milliseconds */
  p99: number;
  /** Minimum duration in milliseconds */
  min: number;
  /** Maximum duration in milliseconds */
  max: number;
  /** Number of iterations measured */
  iterations: number;
}

export interface BenchmarkReport {
  /** ISO timestamp of when the report was generated */
  timestamp: string;
  /** Git commit SHA if available, otherwise 'unknown' */
  commit: string;
  /** Individual benchmark results keyed by benchmark name */
  results: Record<string, BenchmarkResult>;
}

/**
 * Returns a high-resolution timestamp in milliseconds.
 * Uses performance.now() in browser/jsdom; falls back to Date.now() in pure Node.
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Computes the Nth percentile from a sorted array of numbers.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const fraction = idx - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Runs `fn` N times and returns statistical measurements of its duration.
 *
 * @param name    Human-readable name for reporting
 * @param fn      Function to benchmark (sync or async)
 * @param options Configuration (iterations, warmupRuns)
 */
export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const iterations = options.iterations ?? 100;
  const warmupRuns = options.warmupRuns ?? 5;

  // Warm-up pass — not measured
  for (let i = 0; i < warmupRuns; i++) {
    await fn();
  }

  const durations: number[] = new Array(iterations) as number[];

  for (let i = 0; i < iterations; i++) {
    const start = now();
    await fn();
    durations[i] = now() - start;
  }

  durations.sort((a, b) => a - b);

  const sum = durations.reduce((acc, d) => acc + d, 0);

  return {
    name,
    avg: sum / iterations,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    min: durations[0],
    max: durations[durations.length - 1],
    iterations,
  };
}

/**
 * Builds a BenchmarkReport from an array of results.
 * The report can be serialized to JSON and stored for CI comparison.
 */
export function buildReport(
  results: BenchmarkResult[],
  commit = 'unknown',
): BenchmarkReport {
  const record: Record<string, BenchmarkResult> = {};
  for (const r of results) {
    record[r.name] = r;
  }
  return {
    timestamp: new Date().toISOString(),
    commit,
    results: record,
  };
}

/**
 * The metrics a regression check can compare.
 *
 * `min` and `p50` are the robust ones. See `DEFAULT_REGRESSION_METRICS` and
 * `benchmarks/README.md` for the measurements that justify preferring them.
 */
export type BenchmarkMetric = keyof Pick<
  BenchmarkResult,
  'avg' | 'p50' | 'p95' | 'p99' | 'min' | 'max'
>;

export interface RegressionEntry {
  name: string;
  metric: BenchmarkMetric;
  baselineMs: number;
  currentMs: number;
  ratio: number;
}

export interface RegressionOptions {
  /**
   * Which metrics to compare. Defaults to `DEFAULT_REGRESSION_METRICS`.
   *
   * Callers running on shared CI hardware should pass `['min', 'p50']`.
   * `avg`, `p95` and `p99` are dominated by GC pauses and scheduler
   * preemption: across five back-to-back runs of identical code on one
   * machine they swung by up to 5.9x, 10.8x and 79.3x respectively, while
   * `min` and `p50` stayed within 1.80x and 1.96x.
   */
  metrics?: readonly BenchmarkMetric[];
  /**
   * Timings at or below this many milliseconds are treated as unmeasurable
   * noise rather than signal. Defaults to `DEFAULT_NOISE_FLOOR_MS`.
   *
   * Two things depend on it:
   *  - a 0 ms baseline no longer disables the check for that metric (a 0 ms
   *    baseline against a 500 ms current used to be skipped outright);
   *  - a 0.001 ms -> 0.004 ms clock-granularity wobble is not reported as a
   *    4x regression.
   */
  noiseFloorMs?: number;
}

/**
 * Metrics compared when the caller does not choose. Kept at the historical
 * four so existing callers keep their behaviour; new callers — including
 * `scripts/run-benchmarks.sh` — should narrow this to the robust subset.
 */
export const DEFAULT_REGRESSION_METRICS: readonly BenchmarkMetric[] = [
  'avg',
  'p50',
  'p95',
  'p99',
];

/**
 * Timings below this are at the resolution limit of the harness itself: one
 * measured iteration costs an await tick plus two `performance.now()` reads,
 * which is on the order of a microsecond, and OS timer granularity adds more.
 * 0.05 ms leaves roughly 50x headroom over that floor.
 */
export const DEFAULT_NOISE_FLOOR_MS = 0.05;

/**
 * Compares a new report against a baseline report.
 * Returns a list of regressions where a compared metric exceeds
 * `thresholdMultiplier` × baseline.
 *
 * @param current             The freshly-generated report
 * @param baseline            The stored baseline report
 * @param thresholdMultiplier Ratio above which a result is a regression (default 2.0 = 2×)
 * @param options             Metric selection and noise floor
 */
export function detectRegressions(
  current: BenchmarkReport,
  baseline: BenchmarkReport,
  thresholdMultiplier = 2.0,
  options: RegressionOptions = {},
): RegressionEntry[] {
  const regressions: RegressionEntry[] = [];
  const metrics = options.metrics ?? DEFAULT_REGRESSION_METRICS;
  // `??` not `||`: a caller may legitimately pass 0 to disable the floor.
  const noiseFloorMs = options.noiseFloorMs ?? DEFAULT_NOISE_FLOOR_MS;

  for (const [name, currentResult] of Object.entries(current.results)) {
    const baselineResult = baseline.results[name];
    if (!baselineResult) continue; // New benchmark — nothing to compare against.

    for (const metric of metrics) {
      const baselineMs = baselineResult[metric];
      const currentMs = currentResult[metric];

      // Both sides unmeasurably fast — any ratio between them is clock noise.
      if (baselineMs <= noiseFloorMs && currentMs <= noiseFloorMs) continue;

      // Divide by the floor, never by zero. A 0 ms baseline paired with a slow
      // current value now reports a large finite ratio instead of being skipped.
      const ratio = currentMs / Math.max(baselineMs, noiseFloorMs);
      if (ratio > thresholdMultiplier) {
        regressions.push({ name, metric, baselineMs, currentMs, ratio });
      }
    }
  }

  return regressions;
}

export interface BenchmarkNameDiff {
  /** Present in `current`, absent from `baseline` — never regression-checked. */
  addedInCurrent: string[];
  /** Present in `baseline`, absent from `current` — silently stopped running. */
  missingFromCurrent: string[];
}

/**
 * Reports benchmark names that do not appear on both sides of a comparison.
 *
 * `detectRegressions()` deliberately skips such names, which means a rename, a
 * deleted benchmark, or a benchmark that threw before recording its result all
 * produce zero regressions and a false all-clear. Any caller treating "no
 * regressions" as a gate must check this too.
 */
export function diffBenchmarkNames(
  current: BenchmarkReport,
  baseline: BenchmarkReport,
): BenchmarkNameDiff {
  const currentNames = new Set(Object.keys(current.results));
  const baselineNames = new Set(Object.keys(baseline.results));

  return {
    addedInCurrent: [...currentNames].filter((n) => !baselineNames.has(n)).sort(),
    missingFromCurrent: [...baselineNames].filter((n) => !currentNames.has(n)).sort(),
  };
}
