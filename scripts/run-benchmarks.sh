#!/usr/bin/env bash
# run-benchmarks.sh — SpawnForge performance benchmark runner
#
# Usage:
#   bash scripts/run-benchmarks.sh [--baseline <path>] [--output <path>]
#
# Options:
#   --baseline <path>   Path to a previous benchmark report JSON for regression
#                       comparison (default: benchmarks/latest.json)
#   --output <path>     Path to write the new report JSON
#                       (default: benchmarks/latest.json)
#   --threshold <N>     Multiplier above which a result is a regression (default: 2.0)
#
# Exit codes:
#   0  All benchmarks passed (within threshold of baseline)
#   1  One or more benchmarks regressed beyond threshold
#   2  Configuration error
#
# Notes:
#   - Benchmark suite is located in web/src/lib/perf/__tests__/benchmark.test.ts
#   - The runner uses vitest in the web/ directory; node_modules must be installed.
#   - Regression comparison is only performed when a baseline file exists.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
BENCHMARKS_DIR="$REPO_ROOT/benchmarks"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
BASELINE_PATH="$BENCHMARKS_DIR/latest.json"
OUTPUT_PATH="$BENCHMARKS_DIR/latest.json"
THRESHOLD="2.0"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --baseline)
      BASELINE_PATH="$2"; shift 2 ;;
    --output)
      OUTPUT_PATH="$2"; shift 2 ;;
    --threshold)
      THRESHOLD="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------
if [[ ! -f "$WEB_DIR/package.json" ]]; then
  echo "ERROR: web/package.json not found. Run from repo root." >&2
  exit 2
fi

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  echo "ERROR: web/node_modules not found. Run 'npm ci' in web/ first." >&2
  exit 2
fi

VITEST="$WEB_DIR/node_modules/.bin/vitest"
if [[ ! -x "$VITEST" ]]; then
  echo "ERROR: vitest not found at $VITEST" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Prepare output directory
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$OUTPUT_PATH")"
mkdir -p "$BENCHMARKS_DIR"

# ---------------------------------------------------------------------------
# Run benchmark suite via vitest
# ---------------------------------------------------------------------------
echo "==> Running SpawnForge benchmark suite..."
echo "    Web dir:    $WEB_DIR"
echo "    Output:     $OUTPUT_PATH"
echo "    Baseline:   $BASELINE_PATH"
echo "    Threshold:  ${THRESHOLD}x"
echo ""

# Run the benchmark tests — vitest exits 0 on pass, 1 on failure
COMMIT_SHA="${GITHUB_SHA:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"

cd "$WEB_DIR"
"$VITEST" run src/lib/perf/__tests__/benchmark.test.ts \
  --reporter=verbose 2>&1

VITEST_EXIT=$?
if [[ $VITEST_EXIT -ne 0 ]]; then
  echo ""
  echo "FAIL: Benchmark test suite failed (vitest exit $VITEST_EXIT)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Emit a JSON report
# The benchmark tests themselves validate statistical correctness; here we
# produce a lightweight timing report from vitest's JSON reporter for CI diff.
# ---------------------------------------------------------------------------
echo ""
echo "==> Generating benchmark report..."

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Use vitest's JSON reporter to collect timing data into a temp file
VITEST_JSON_TMP="$(mktemp /tmp/vitest-bench-XXXXXX.json)"

"$VITEST" run src/lib/perf/__tests__/benchmark.test.ts \
  --reporter=json \
  --outputFile="$VITEST_JSON_TMP" 2>/dev/null || true

# Build a structured benchmark report from test results
node - <<NODEJS_SCRIPT
const fs = require('fs');

const vitestResult = JSON.parse(fs.readFileSync('$VITEST_JSON_TMP', 'utf8'));
const threshold = parseFloat('$THRESHOLD');

// Extract test-level timing from vitest JSON output
const results = {};
for (const suite of (vitestResult.testResults || [])) {
  for (const test of (suite.assertionResults || [])) {
    const name = test.fullName || test.title;
    const durationMs = test.duration ?? 0;
    results[name] = {
      name,
      // vitest only gives total duration per test; map to all stats as same value
      avg: durationMs,
      p50: durationMs,
      p95: durationMs,
      p99: durationMs,
      min: durationMs,
      max: durationMs,
      iterations: 1,
    };
  }
}

const report = {
  timestamp: '$TIMESTAMP',
  commit: '$COMMIT_SHA',
  results,
};

fs.writeFileSync('$OUTPUT_PATH', JSON.stringify(report, null, 2));
console.log('Report written to: $OUTPUT_PATH');
NODEJS_SCRIPT

rm -f "$VITEST_JSON_TMP"

# ---------------------------------------------------------------------------
# Regression comparison (if baseline exists)
# ---------------------------------------------------------------------------
REGRESSION_COUNT=0

if [[ -f "$BASELINE_PATH" && "$BASELINE_PATH" != "$OUTPUT_PATH" ]]; then
  echo ""
  echo "==> Comparing against baseline: $BASELINE_PATH"

  node - <<NODEJS_REGRESSION
const fs = require('fs');

const current  = JSON.parse(fs.readFileSync('$OUTPUT_PATH',   'utf8'));
const baseline = JSON.parse(fs.readFileSync('$BASELINE_PATH', 'utf8'));
const threshold = parseFloat('$THRESHOLD');

const metrics = ['avg', 'p50', 'p95', 'p99'];
let regressions = 0;

for (const [name, cur] of Object.entries(current.results)) {
  const base = baseline.results && baseline.results[name];
  if (!base) continue; // New benchmark — skip

  for (const metric of metrics) {
    const baseMs = base[metric];
    const curMs  = cur[metric];
    if (baseMs === 0) continue;
    const ratio = curMs / baseMs;
    if (ratio > threshold) {
      console.error(
        'REGRESSION: ' + name + ' [' + metric + '] ' +
        baseMs.toFixed(2) + 'ms -> ' + curMs.toFixed(2) + 'ms (' +
        ratio.toFixed(2) + 'x > ' + threshold + 'x threshold)'
      );
      regressions++;
    }
  }
}

if (regressions === 0) {
  console.log('No regressions detected. All benchmarks within ' + threshold + 'x baseline.');
} else {
  console.error('');
  console.error('FAIL: ' + regressions + ' regression(s) detected.');
}

process.exit(regressions > 0 ? 1 : 0);
NODEJS_REGRESSION

  REGRESSION_EXIT=$?
  REGRESSION_COUNT=$REGRESSION_EXIT
else
  if [[ ! -f "$BASELINE_PATH" ]]; then
    echo ""
    echo "INFO: No baseline found at $BASELINE_PATH — skipping regression comparison."
    echo "      The current report has been saved as the new baseline."
    # Copy current report as baseline if they're the same path (default mode)
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $REGRESSION_COUNT -eq 0 ]]; then
  echo "==> Benchmark run complete. Report: $OUTPUT_PATH"
  exit 0
else
  echo "==> Benchmark run complete with regressions. Report: $OUTPUT_PATH"
  exit 1
fi
