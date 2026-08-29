#!/usr/bin/env node
/**
 * compare-benchmarks.mjs — diff a benchmark report against a committed baseline.
 *
 * Invoked by scripts/run-benchmarks.sh. Split out of that script because the
 * comparison used to live in a shell heredoc that interpolated file paths
 * straight into JavaScript string literals, which is both unquotable and
 * untestable. This file has a sibling `node --test` suite
 * (scripts/compare-benchmarks.test.mjs).
 *
 * This is the deliberate twin of `detectRegressions()` /
 * `diffBenchmarkNames()` in web/src/lib/perf/benchmark.ts. The TypeScript
 * copy is what product code and the vitest suite use; this copy is what CI
 * uses, because CI has no TypeScript runner at this point in the pipeline.
 * The test suite pins NOISE_FLOOR_MS against the TypeScript source so the two
 * cannot drift apart silently.
 *
 * Usage:
 *   node scripts/compare-benchmarks.mjs --current <path> --baseline <path>
 *        [--threshold <N>] [--metrics min,p50]
 *
 * Exit codes:
 *   0  no regressions
 *   1  one or more regressions, a benchmark vanished from the current run, or
 *      a baseline entry sits under the noise floor and guards nothing
 *   2  usage / configuration error (including: baseline file missing)
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';

/**
 * Timings at or below this are at the harness's own resolution limit. Kept
 * numerically identical to DEFAULT_NOISE_FLOOR_MS in
 * web/src/lib/perf/benchmark.ts; compare-benchmarks.test.mjs enforces that.
 */
export const NOISE_FLOOR_MS = 0.05;

/** Metrics compared unless --metrics says otherwise. See the README. */
export const DEFAULT_METRICS = ['min', 'p50'];

/** Regression multiplier used unless --threshold says otherwise. */
export const DEFAULT_THRESHOLD = 3.0;

const VALID_METRICS = new Set(['avg', 'p50', 'p95', 'p99', 'min', 'max']);

/**
 * Compare two reports and return the metrics that exceeded the threshold.
 *
 * A zero baseline is divided by the noise floor rather than skipped: a
 * benchmark that used to be instantaneous and is now slow is the case most
 * worth catching. Pairs where both sides are below the floor are skipped,
 * because the ratio between two sub-microsecond readings is clock granularity.
 */
export function detectRegressions(current, baseline, threshold, metrics, noiseFloorMs = NOISE_FLOOR_MS) {
  const regressions = [];

  for (const [name, cur] of Object.entries(current.results ?? {})) {
    const base = baseline.results?.[name];
    if (!base) continue; // New benchmark — nothing to compare against.

    for (const metric of metrics) {
      const baselineMs = base[metric];
      const currentMs = cur[metric];
      if (typeof baselineMs !== 'number' || typeof currentMs !== 'number') continue;
      if (baselineMs <= noiseFloorMs && currentMs <= noiseFloorMs) continue;

      const ratio = currentMs / Math.max(baselineMs, noiseFloorMs);
      if (ratio > threshold) {
        regressions.push({ name, metric, baselineMs, currentMs, ratio });
      }
    }
  }

  return regressions;
}

/**
 * Names that appear on only one side. detectRegressions() skips these, so
 * without this check a renamed, deleted, or crashed benchmark reports a clean
 * run — the benchmark silently stops guarding anything.
 */
export function diffBenchmarkNames(current, baseline) {
  const currentNames = new Set(Object.keys(current.results ?? {}));
  const baselineNames = new Set(Object.keys(baseline.results ?? {}));
  return {
    addedInCurrent: [...currentNames].filter((n) => !baselineNames.has(n)).sort(),
    missingFromCurrent: [...baselineNames].filter((n) => !currentNames.has(n)).sort(),
  };
}

/**
 * Baseline entries whose every compared metric sits at or below the noise
 * floor. detectRegressions() skips those pairs by design, so such a benchmark
 * is in the report, looks healthy, and guards nothing — the exact
 * false-confidence failure PF-9458 exists to remove. The fix is always to
 * raise that benchmark's batch size and re-record, never to lower the floor.
 */
export function findUnguarded(baseline, metrics, noiseFloorMs = NOISE_FLOOR_MS) {
  const unguarded = [];
  for (const [name, base] of Object.entries(baseline.results ?? {})) {
    const readings = metrics
      .map((m) => base[m])
      .filter((v) => typeof v === 'number');
    if (readings.length === 0) continue;
    if (readings.every((v) => v <= noiseFloorMs)) {
      unguarded.push({ name, maxMs: Math.max(...readings) });
    }
  }
  return unguarded.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse argv into an options object. Throws on anything malformed. */
export function parseArgs(argv) {
  const opts = {
    current: null,
    baseline: null,
    threshold: DEFAULT_THRESHOLD,
    metrics: [...DEFAULT_METRICS],
  };

  const KNOWN_FLAGS = new Set(['--current', '--baseline', '--threshold', '--metrics']);

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    // Reject unknown flags before complaining about their missing value —
    // otherwise `--fast` at the end of the line reports "Missing value for
    // --fast", which sends the reader looking for a value that never existed.
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown argument: ${flag}`);

    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);

    switch (flag) {
      case '--current':
        opts.current = value;
        break;
      case '--baseline':
        opts.baseline = value;
        break;
      case '--threshold': {
        const parsed = Number(value);
        // Number('') is 0 and Number('x') is NaN; a threshold of 0 or below
        // would flag every benchmark, so reject rather than silently accept.
        if (!Number.isFinite(parsed) || parsed <= 1) {
          throw new Error(`--threshold must be a number greater than 1, got "${value}"`);
        }
        opts.threshold = parsed;
        break;
      }
      case '--metrics': {
        const list = value.split(',').map((m) => m.trim()).filter(Boolean);
        if (list.length === 0) throw new Error('--metrics must name at least one metric');
        for (const m of list) {
          if (!VALID_METRICS.has(m)) {
            throw new Error(`Unknown metric "${m}" (valid: ${[...VALID_METRICS].join(', ')})`);
          }
        }
        opts.metrics = list;
        break;
      }
      /* c8 ignore next 2 -- unreachable: KNOWN_FLAGS is checked above. */
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
    i++;
  }

  if (!opts.current) throw new Error('--current is required');
  if (!opts.baseline) throw new Error('--baseline is required');
  return opts;
}

/** Read and parse a report, with an error message that names the file. */
export function loadReport(path, label) {
  if (!existsSync(path)) {
    throw new Error(
      `${label} report not found: ${path}\n` +
        (label === 'Baseline'
          ? '       A committed baseline is required. Record one with:\n' +
            '         bash scripts/run-benchmarks.sh --update-baseline\n' +
            '       Refusing to report "no regressions" without something to compare against.'
          : '       The benchmark suite did not write a report.'),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${label} report is not valid JSON: ${path}\n       ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.results !== 'object' || parsed.results === null) {
    throw new Error(`${label} report has no "results" object: ${path}`);
  }
  if (Object.keys(parsed.results).length === 0) {
    throw new Error(`${label} report contains zero benchmarks: ${path}`);
  }
  return parsed;
}

/** Render the comparison as plain text lines. */
export function formatReport({ regressions, nameDiff, unguarded = [], threshold, metrics, comparedCount }) {
  const lines = [];
  lines.push(`Compared ${comparedCount} benchmark(s) on [${metrics.join(', ')}] at a ${threshold}x threshold.`);

  if (nameDiff.addedInCurrent.length > 0) {
    lines.push(`NEW (no baseline yet, not checked): ${nameDiff.addedInCurrent.join(', ')}`);
  }
  for (const name of nameDiff.missingFromCurrent) {
    lines.push(`MISSING: "${name}" is in the baseline but was not measured. A benchmark that stops running stops guarding anything.`);
  }
  for (const u of unguarded) {
    lines.push(
      `UNGUARDED: "${u.name}" baseline is ${u.maxMs.toFixed(4)}ms, at or below the ` +
        `${NOISE_FLOOR_MS}ms noise floor, so no regression on it can ever be detected. ` +
        `Raise its batch size in productBenchmarks.test.ts and re-record.`,
    );
  }
  for (const r of regressions) {
    lines.push(
      `REGRESSION: ${r.name} [${r.metric}] ` +
        `${r.baselineMs.toFixed(4)}ms -> ${r.currentMs.toFixed(4)}ms ` +
        `(${r.ratio.toFixed(2)}x > ${threshold}x threshold)`,
    );
  }

  if (regressions.length === 0 && nameDiff.missingFromCurrent.length === 0 && unguarded.length === 0) {
    lines.push(`OK: no regressions. Every compared metric is within ${threshold}x of the baseline.`);
  }
  return lines;
}

/** Append a markdown block to $GITHUB_STEP_SUMMARY when running in Actions. */
function writeStepSummary(lines, failed) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const heading = failed ? '### Benchmark regressions detected' : '### Benchmarks within threshold';
  const body = `${heading}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
  try {
    appendFileSync(summaryPath, body);
  } catch {
    // A summary is a nicety. Never let it change the exit code.
  }
}

/** Emit a workflow annotation so the result is visible without opening logs. */
function writeAnnotations(regressions, nameDiff, unguarded = []) {
  if (!process.env.GITHUB_ACTIONS) return;
  // Deliberately ::warning:: not ::error::. This job is non-blocking by
  // design (see .github/workflows/benchmarks.yml) — timings on shared
  // runners are too noisy to gate a merge on.
  for (const r of regressions) {
    process.stdout.write(
      `::warning title=Benchmark regression::${r.name} [${r.metric}] ` +
        `${r.baselineMs.toFixed(4)}ms -> ${r.currentMs.toFixed(4)}ms (${r.ratio.toFixed(2)}x)\n`,
    );
  }
  for (const name of nameDiff.missingFromCurrent) {
    process.stdout.write(
      `::warning title=Benchmark missing::${name} is in the baseline but was not measured\n`,
    );
  }
  for (const u of unguarded) {
    process.stdout.write(
      `::warning title=Benchmark unguarded::${u.name} baseline is ${u.maxMs.toFixed(4)}ms, ` +
        `at or below the ${NOISE_FLOOR_MS}ms noise floor — no regression on it can be detected\n`,
    );
  }
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 2;
  }

  let current;
  let baseline;
  try {
    current = loadReport(opts.current, 'Current');
    baseline = loadReport(opts.baseline, 'Baseline');
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 2;
  }

  const regressions = detectRegressions(current, baseline, opts.threshold, opts.metrics);
  const nameDiff = diffBenchmarkNames(current, baseline);
  const unguarded = findUnguarded(baseline, opts.metrics);
  const comparedCount = Object.keys(current.results).filter(
    (n) => baseline.results[n] !== undefined,
  ).length;

  const failed =
    regressions.length > 0 || nameDiff.missingFromCurrent.length > 0 || unguarded.length > 0;
  const lines = formatReport({
    regressions,
    nameDiff,
    unguarded,
    threshold: opts.threshold,
    metrics: opts.metrics,
    comparedCount,
  });

  for (const line of lines) {
    if (line.startsWith('REGRESSION:') || line.startsWith('MISSING:') || line.startsWith('UNGUARDED:')) {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  writeAnnotations(regressions, nameDiff, unguarded);
  writeStepSummary(lines, failed);

  return failed ? 1 : 0;
}

// Only run the CLI when executed directly, so the test suite can import the
// functions above without triggering a process exit.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
