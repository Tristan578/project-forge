/**
 * Unit tests for scripts/compare-benchmarks.mjs.
 *
 * Run with:  node --test scripts/compare-benchmarks.test.mjs
 * (Mirrors the scripts/pitr-verify.test.mjs convention — these live outside
 * web/, so they are not part of the vitest workspace.)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectRegressions,
  diffBenchmarkNames,
  findUnguarded,
  parseArgs,
  loadReport,
  formatReport,
  main,
  NOISE_FLOOR_MS,
  DEFAULT_METRICS,
  DEFAULT_THRESHOLD,
} from './compare-benchmarks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function result(name, overrides = {}) {
  return { name, avg: 5, p50: 4, p95: 8, p99: 12, min: 1, max: 20, iterations: 40, ...overrides };
}

function report(results) {
  const record = {};
  for (const r of results) record[r.name] = r;
  return { timestamp: '2026-08-29T00:00:00.000Z', commit: 'abc123', results: record };
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cmp-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Capture stdout+stderr around a call so CLI tests stay quiet. */
function captureOutput(fn) {
  const out = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { out.push(String(chunk)); return true; };
  try {
    const value = fn();
    return { value, output: out.join('') };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

// ---------------------------------------------------------------------------
// Anti-drift: this file is a deliberate twin of the TypeScript comparator.
// ---------------------------------------------------------------------------

describe('parity with web/src/lib/perf/benchmark.ts', () => {
  test('NOISE_FLOOR_MS matches DEFAULT_NOISE_FLOOR_MS in the TypeScript source', () => {
    const ts = readFileSync(join(REPO_ROOT, 'web/src/lib/perf/benchmark.ts'), 'utf8');
    const match = ts.match(/export const DEFAULT_NOISE_FLOOR_MS\s*=\s*([0-9.]+)\s*;/);
    assert.ok(match, 'DEFAULT_NOISE_FLOOR_MS not found in benchmark.ts — did it get renamed?');
    assert.equal(
      Number(match[1]),
      NOISE_FLOOR_MS,
      'The CI comparator and the TypeScript comparator disagree on the noise floor.',
    );
  });

  test('the TypeScript source still exports the functions this file mirrors', () => {
    const ts = readFileSync(join(REPO_ROOT, 'web/src/lib/perf/benchmark.ts'), 'utf8');
    assert.match(ts, /export function detectRegressions\(/);
    assert.match(ts, /export function diffBenchmarkNames\(/);
  });
});

// ---------------------------------------------------------------------------
// detectRegressions()
// ---------------------------------------------------------------------------

describe('detectRegressions()', () => {
  test('reports nothing for identical reports', () => {
    const r = report([result('op')]);
    assert.deepEqual(detectRegressions(r, r, 3.0, ['min', 'p50']), []);
  });

  test('reports a metric beyond the threshold', () => {
    const current = report([result('op', { p50: 20 })]);
    const baseline = report([result('op', { p50: 4 })]);
    const found = detectRegressions(current, baseline, 3.0, ['min', 'p50']);
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'op');
    assert.equal(found[0].metric, 'p50');
    assert.equal(found[0].ratio, 5);
  });

  test('does not report a metric exactly at the threshold', () => {
    const current = report([result('op', { p50: 12 })]);
    const baseline = report([result('op', { p50: 4 })]);
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['p50']), []);
  });

  test('ignores metrics that were not requested', () => {
    const current = report([result('op', { p99: 1000 })]);
    const baseline = report([result('op', { p99: 12 })]);
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['min', 'p50']), []);
  });

  test('skips benchmarks with no baseline entry', () => {
    const current = report([result('brand-new')]);
    const baseline = report([result('other')]);
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['min', 'p50']), []);
  });

  test('a zero baseline against a slow current is reported, not skipped', () => {
    const current = report([result('op', { p50: 500 })]);
    const baseline = report([result('op', { p50: 0 })]);
    const found = detectRegressions(current, baseline, 3.0, ['p50']);
    assert.equal(found.length, 1);
    assert.ok(Number.isFinite(found[0].ratio));
    assert.equal(found[0].ratio, 500 / NOISE_FLOOR_MS);
  });

  test('sub-noise-floor movement is not a regression', () => {
    const current = report([result('op', { min: 0.004, p50: 0.004 })]);
    const baseline = report([result('op', { min: 0.001, p50: 0.001 })]);
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['min', 'p50']), []);
  });

  test('non-numeric metric values are skipped rather than producing NaN ratios', () => {
    const current = report([result('op', { p50: 'slow' })]);
    const baseline = report([result('op', { p50: 4 })]);
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['p50']), []);
  });

  test('tolerates a report with no results object', () => {
    assert.deepEqual(detectRegressions({}, {}, 3.0, ['p50']), []);
  });
});

// ---------------------------------------------------------------------------
// diffBenchmarkNames()
// ---------------------------------------------------------------------------

describe('diffBenchmarkNames()', () => {
  test('reports a baseline benchmark that vanished from the current run', () => {
    const current = report([result('a')]);
    const baseline = report([result('a'), result('b')]);
    // The regression check itself sees nothing wrong — that is the point.
    assert.deepEqual(detectRegressions(current, baseline, 3.0, ['min', 'p50']), []);
    assert.deepEqual(diffBenchmarkNames(current, baseline).missingFromCurrent, ['b']);
  });

  test('reports a new benchmark separately from a missing one', () => {
    const diff = diffBenchmarkNames(report([result('after')]), report([result('before')]));
    assert.deepEqual(diff, { addedInCurrent: ['after'], missingFromCurrent: ['before'] });
  });
});

// ---------------------------------------------------------------------------
// parseArgs()
// ---------------------------------------------------------------------------

describe('parseArgs()', () => {
  test('applies documented defaults', () => {
    const opts = parseArgs(['--current', 'c.json', '--baseline', 'b.json']);
    assert.equal(opts.threshold, DEFAULT_THRESHOLD);
    assert.deepEqual(opts.metrics, DEFAULT_METRICS);
  });

  test('requires --current and --baseline', () => {
    assert.throws(() => parseArgs(['--baseline', 'b.json']), /--current is required/);
    assert.throws(() => parseArgs(['--current', 'c.json']), /--baseline is required/);
  });

  test('rejects a non-numeric threshold', () => {
    assert.throws(
      () => parseArgs(['--current', 'c', '--baseline', 'b', '--threshold', 'fast']),
      /--threshold must be a number greater than 1/,
    );
  });

  test('rejects a threshold of 1 or below, which would flag everything', () => {
    for (const bad of ['1', '0', '-2']) {
      assert.throws(
        () => parseArgs(['--current', 'c', '--baseline', 'b', '--threshold', bad]),
        /--threshold must be a number greater than 1/,
      );
    }
  });

  test('rejects an unknown metric name', () => {
    assert.throws(
      () => parseArgs(['--current', 'c', '--baseline', 'b', '--metrics', 'p50,mean']),
      /Unknown metric "mean"/,
    );
  });

  test('rejects a flag with no value', () => {
    assert.throws(() => parseArgs(['--current']), /Missing value for --current/);
  });

  test('rejects unknown flags', () => {
    assert.throws(
      () => parseArgs(['--current', 'c', '--baseline', 'b', '--fast']),
      /Unknown argument: --fast/,
    );
  });
});

// ---------------------------------------------------------------------------
// loadReport()
// ---------------------------------------------------------------------------

describe('loadReport()', () => {
  test('a missing baseline names the file and says how to record one', () => {
    assert.throws(
      () => loadReport('/nonexistent/baseline.json', 'Baseline'),
      /Baseline report not found.*run-benchmarks\.sh --update-baseline/s,
    );
  });

  test('malformed JSON is reported as such', () => {
    withTempDir((dir) => {
      const p = join(dir, 'bad.json');
      writeFileSync(p, '{not json');
      assert.throws(() => loadReport(p, 'Current'), /not valid JSON/);
    });
  });

  test('a report with an empty results object is rejected', () => {
    withTempDir((dir) => {
      const p = join(dir, 'empty.json');
      writeFileSync(p, JSON.stringify({ results: {} }));
      assert.throws(() => loadReport(p, 'Current'), /contains zero benchmarks/);
    });
  });

  test('a report with no results key is rejected', () => {
    withTempDir((dir) => {
      const p = join(dir, 'shape.json');
      writeFileSync(p, JSON.stringify({ timestamp: 'x' }));
      assert.throws(() => loadReport(p, 'Current'), /has no "results" object/);
    });
  });
});

// ---------------------------------------------------------------------------
// formatReport()
// ---------------------------------------------------------------------------

describe('formatReport()', () => {
  test('says OK when there is nothing to report', () => {
    const lines = formatReport({
      regressions: [],
      nameDiff: { addedInCurrent: [], missingFromCurrent: [] },
      threshold: 3,
      metrics: ['min', 'p50'],
      comparedCount: 8,
    });
    assert.ok(lines.some((l) => l.startsWith('OK:')));
    assert.ok(lines.some((l) => l.includes('Compared 8 benchmark(s)')));
  });

  test('names the regressed benchmark and metric', () => {
    const lines = formatReport({
      regressions: [{ name: 'scene-serialize-100-entities', metric: 'p50', baselineMs: 1, currentMs: 9, ratio: 9 }],
      nameDiff: { addedInCurrent: [], missingFromCurrent: [] },
      threshold: 3,
      metrics: ['p50'],
      comparedCount: 1,
    });
    const line = lines.find((l) => l.startsWith('REGRESSION:'));
    assert.ok(line);
    assert.ok(line.includes('scene-serialize-100-entities'));
    assert.ok(line.includes('[p50]'));
    assert.ok(line.includes('9.00x'));
    assert.ok(!lines.some((l) => l.startsWith('OK:')));
  });
});

// ---------------------------------------------------------------------------
// main() — CLI behaviour
// ---------------------------------------------------------------------------

describe('main()', () => {
  test('exits 0 when the current run matches the baseline', () => {
    withTempDir((dir) => {
      const cur = join(dir, 'cur.json');
      const base = join(dir, 'base.json');
      writeFileSync(cur, JSON.stringify(report([result('op')])));
      writeFileSync(base, JSON.stringify(report([result('op')])));
      const { value } = captureOutput(() => main(['--current', cur, '--baseline', base]));
      assert.equal(value, 0);
    });
  });

  test('exits 1 and names the benchmark on a regression', () => {
    withTempDir((dir) => {
      const cur = join(dir, 'cur.json');
      const base = join(dir, 'base.json');
      writeFileSync(cur, JSON.stringify(report([result('op', { p50: 40 })])));
      writeFileSync(base, JSON.stringify(report([result('op', { p50: 4 })])));
      const { value, output } = captureOutput(() => main(['--current', cur, '--baseline', base]));
      assert.equal(value, 1);
      assert.match(output, /REGRESSION: op \[p50\]/);
    });
  });

  test('exits 2 when the baseline file is missing — never a silent pass', () => {
    withTempDir((dir) => {
      const cur = join(dir, 'cur.json');
      writeFileSync(cur, JSON.stringify(report([result('op')])));
      const { value, output } = captureOutput(() =>
        main(['--current', cur, '--baseline', join(dir, 'nope.json')]),
      );
      assert.equal(value, 2);
      assert.match(output, /Baseline report not found/);
    });
  });

  test('exits 1 when a baseline benchmark stopped being measured', () => {
    withTempDir((dir) => {
      const cur = join(dir, 'cur.json');
      const base = join(dir, 'base.json');
      writeFileSync(cur, JSON.stringify(report([result('a')])));
      writeFileSync(base, JSON.stringify(report([result('a'), result('b')])));
      const { value, output } = captureOutput(() => main(['--current', cur, '--baseline', base]));
      assert.equal(value, 1);
      assert.match(output, /MISSING: "b"/);
    });
  });

  test('exits 2 on a bad argument', () => {
    const { value, output } = captureOutput(() => main(['--nope', 'x']));
    assert.equal(value, 2);
    assert.match(output, /Unknown argument/);
  });
});

// ---------------------------------------------------------------------------
// findUnguarded() — the check that a benchmark is actually capable of failing
// ---------------------------------------------------------------------------

describe('findUnguarded()', () => {
  test('flags a baseline whose every compared metric is at or below the floor', () => {
    const base = report([result('tiny', { min: 0.01, p50: 0.02 })]);
    const found = findUnguarded(base, ['min', 'p50']);
    assert.deepEqual(
      found.map((u) => u.name),
      ['tiny'],
    );
    assert.equal(found[0].maxMs, 0.02);
  });

  test('does not flag a benchmark where one compared metric clears the floor', () => {
    // Partial coverage is still coverage: detectRegressions() will compare the
    // metric that is above the floor.
    const base = report([result('mixed', { min: 0.01, p50: 0.9 })]);
    assert.deepEqual(findUnguarded(base, ['min', 'p50']), []);
  });

  test('treats a reading exactly at the floor as unguarded', () => {
    // detectRegressions() skips pairs with `<= noiseFloorMs`, so equality is
    // on the unguarded side of the line. These two must agree.
    const base = report([result('edge', { min: NOISE_FLOOR_MS, p50: NOISE_FLOOR_MS })]);
    assert.equal(findUnguarded(base, ['min', 'p50']).length, 1);
    const regressions = detectRegressions(
      report([result('edge', { min: NOISE_FLOOR_MS, p50: NOISE_FLOOR_MS })]),
      base,
      DEFAULT_THRESHOLD,
      ['min', 'p50'],
    );
    assert.deepEqual(regressions, []);
  });

  test('only considers the metrics actually being compared', () => {
    const base = report([result('m', { min: 0.01, p50: 0.01, p95: 9 })]);
    assert.equal(findUnguarded(base, ['min', 'p50']).length, 1);
    assert.equal(findUnguarded(base, ['p95']).length, 0);
  });

  test('ignores an entry with no numeric readings for the compared metrics', () => {
    const base = { results: { odd: { name: 'odd' } } };
    assert.deepEqual(findUnguarded(base, ['min', 'p50']), []);
  });

  test('returns names sorted so output is stable across runs', () => {
    const base = report([
      result('zeta', { min: 0.001, p50: 0.001 }),
      result('alpha', { min: 0.001, p50: 0.001 }),
    ]);
    assert.deepEqual(
      findUnguarded(base, ['min', 'p50']).map((u) => u.name),
      ['alpha', 'zeta'],
    );
  });
});

describe('main() unguarded reporting', () => {
  test('exits 1 and names the benchmark when a baseline cannot fail', () => {
    withTempDir((dir) => {
      const cur = join(dir, 'cur.json');
      const base = join(dir, 'base.json');
      const tiny = [result('tiny', { min: 0.01, p50: 0.02 })];
      writeFileSync(cur, JSON.stringify(report(tiny)));
      writeFileSync(base, JSON.stringify(report(tiny)));
      const { value, output } = captureOutput(() => main(['--current', cur, '--baseline', base]));
      assert.equal(value, 1);
      assert.match(output, /UNGUARDED: "tiny"/);
      assert.match(output, /Raise its batch size/);
    });
  });

  test('the committed baseline has no unguarded benchmarks', () => {
    // The regression this whole ticket is about: a harness that reports green
    // because it measures things too small to measure.
    const baseline = loadReport(join(REPO_ROOT, 'benchmarks', 'baseline.json'), 'Baseline');
    assert.deepEqual(
      findUnguarded(baseline, DEFAULT_METRICS).map((u) => u.name),
      [],
    );
  });
});
