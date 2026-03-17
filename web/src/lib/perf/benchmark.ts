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
 * Compares a new report against a baseline report.
 * Returns a list of regressions where any metric exceeds `thresholdMultiplier` × baseline.
 *
 * @param current            The freshly-generated report
 * @param baseline           The stored baseline report
 * @param thresholdMultiplier Ratio above which a result is considered a regression (default 2.0 = 2×)
 */
export interface RegressionEntry {
  name: string;
  metric: keyof Pick<BenchmarkResult, 'avg' | 'p50' | 'p95' | 'p99'>;
  baselineMs: number;
  currentMs: number;
  ratio: number;
}

export function detectRegressions(
  current: BenchmarkReport,
  baseline: BenchmarkReport,
  thresholdMultiplier = 2.0,
): RegressionEntry[] {
  const regressions: RegressionEntry[] = [];
  const metrics: Array<keyof Pick<BenchmarkResult, 'avg' | 'p50' | 'p95' | 'p99'>> = [
    'avg',
    'p50',
    'p95',
    'p99',
  ];

  for (const [name, currentResult] of Object.entries(current.results)) {
    const baselineResult = baseline.results[name];
    if (!baselineResult) continue; // New benchmark — skip regression check

    for (const metric of metrics) {
      const baselineMs = baselineResult[metric];
      const currentMs = currentResult[metric];
      if (baselineMs === 0) continue;
      const ratio = currentMs / baselineMs;
      if (ratio > thresholdMultiplier) {
        regressions.push({ name, metric, baselineMs, currentMs, ratio });
      }
    }
  }

  return regressions;
}
