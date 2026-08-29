#!/usr/bin/env bash
# run-benchmarks.sh — SpawnForge performance benchmark runner
#
# Times real product code paths (web/src/lib/perf/__tests__/productBenchmarks.test.ts)
# and diffs the result against the committed baseline at benchmarks/baseline.json.
#
# Usage:
#   bash scripts/run-benchmarks.sh [options]
#
# Options:
#   --baseline <path>   Baseline report to compare against
#                       (default: benchmarks/baseline.json)
#   --output <path>     Where to write the new report
#                       (default: a temp file, removed on exit)
#   --threshold <N>     Multiplier above which a metric counts as a regression
#                       (default: 3.0 — see "Why 3.0x" below)
#   --metrics <list>    Comma-separated metrics to compare
#                       (default: min,p50 — see "Which metrics" below)
#   --iterations <N>    Measured iterations per benchmark (default: 200)
#   --warmup <N>        Unmeasured warm-up runs per benchmark (default: 20)
#   --update-baseline   Record the current run AS the baseline and skip the
#                       comparison. Use when a change is a deliberate,
#                       understood cost, or when adding a benchmark.
#
# Exit codes:
#   0  No regressions
#   1  One or more regressions, or a baseline benchmark stopped being measured
#   2  Configuration error (missing baseline, missing node_modules, bad flag)
#
# ---------------------------------------------------------------------------
# Handling machine variance
# ---------------------------------------------------------------------------
# Benchmarks on shared CI hardware measure the runner as much as the code. The
# three levers this script pulls, and the reasoning for each:
#
# WARM-UP (--warmup, default 20)
#   V8 runs the first calls in the interpreter and only tiers up to an
#   optimising compiler once the function is hot. Measuring cold code times
#   the JIT's warm-up curve, not the code. Warm-up runs are executed and
#   discarded before any timing starts.
#
# ITERATIONS (--iterations, default 200)
#   The reported statistics are only as stable as the sample behind them. 200
#   iterations keeps the whole suite near a second while giving the median
#   enough samples to be insensitive to a handful of preempted runs. The
#   in-suite default is lower (40) so the everyday `vitest run` stays fast;
#   this script raises it because it is the one that gates on the numbers.
#
# WHICH METRICS (--metrics, default min,p50)
#   Measured directly: five back-to-back runs of *identical* code on one
#   machine, and the worst spread each metric showed across those five runs:
#
#       min  1.80x      p50  1.96x
#       avg  5.93x      p95 10.79x      p99 79.28x
#
#   A GC pause or a descheduled thread lands in the tail, so p95/p99 move by
#   an order of magnitude between runs of code that did not change, and avg is
#   dragged along with them. Comparing those metrics produces a gate that
#   fires at random. min and p50 are the two that survive contact with a noisy
#   machine, so they are the two that get compared.
#
# WHY 3.0x
#   3.0x sits above the 1.96x worst-case run-to-run spread measured for p50 on
#   a deliberately loaded machine, with headroom. A tighter threshold (the
#   2.0x this script used to nominally carry) is *below* observed same-code
#   noise and would fire on runs where nothing changed. A real regression — an
#   accidental O(n^2), a lost memo, a dropped early return — is normally an
#   order of magnitude rather than 2.5x, so 3.0x still catches what matters.
#   The trade is deliberate: this gate is tuned against false alarms, because
#   a benchmark job that cries wolf gets ignored and then deleted.
#
# The workflow that runs this (.github/workflows/benchmarks.yml) is
# non-blocking for the same reason: even at 3.0x a sufficiently unlucky runner
# can trip it, and that must cost a warning annotation rather than a red
# required check.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
BENCHMARKS_DIR="$REPO_ROOT/benchmarks"
BENCH_SUITE="src/lib/perf/__tests__/productBenchmarks.test.ts"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
BASELINE_PATH="$BENCHMARKS_DIR/baseline.json"
OUTPUT_PATH=""
THRESHOLD="3.0"
METRICS="min,p50"
ITERATIONS="200"
WARMUP="20"
UPDATE_BASELINE=0

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --baseline)
      [[ $# -ge 2 ]] || { echo "ERROR: --baseline needs a value" >&2; exit 2; }
      BASELINE_PATH="$2"; shift 2 ;;
    --output)
      [[ $# -ge 2 ]] || { echo "ERROR: --output needs a value" >&2; exit 2; }
      OUTPUT_PATH="$2"; shift 2 ;;
    --threshold)
      [[ $# -ge 2 ]] || { echo "ERROR: --threshold needs a value" >&2; exit 2; }
      THRESHOLD="$2"; shift 2 ;;
    --metrics)
      [[ $# -ge 2 ]] || { echo "ERROR: --metrics needs a value" >&2; exit 2; }
      METRICS="$2"; shift 2 ;;
    --iterations)
      [[ $# -ge 2 ]] || { echo "ERROR: --iterations needs a value" >&2; exit 2; }
      ITERATIONS="$2"; shift 2 ;;
    --warmup)
      [[ $# -ge 2 ]] || { echo "ERROR: --warmup needs a value" >&2; exit 2; }
      WARMUP="$2"; shift 2 ;;
    --update-baseline)
      UPDATE_BASELINE=1; shift ;;
    -h|--help)
      sed -n '2,76p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------
if [[ ! -f "$WEB_DIR/package.json" ]]; then
  echo "ERROR: web/package.json not found at $WEB_DIR." >&2
  exit 2
fi

# This repo has a single root lockfile: dependencies install to
# <root>/node_modules, not web/node_modules. The previous version of this
# script looked only in web/node_modules/.bin, which does not exist on any
# checkout — another reason it had never actually run.
VITEST=""
for candidate in "$REPO_ROOT/node_modules/.bin/vitest" "$WEB_DIR/node_modules/.bin/vitest"; do
  if [[ -x "$candidate" ]]; then
    VITEST="$candidate"
    break
  fi
done
if [[ -z "$VITEST" ]]; then
  echo "ERROR: vitest not found in $REPO_ROOT/node_modules/.bin or $WEB_DIR/node_modules/.bin." >&2
  echo "       Run 'npm ci' at the repo root first." >&2
  exit 2
fi

if [[ ! -f "$WEB_DIR/$BENCH_SUITE" ]]; then
  echo "ERROR: benchmark suite not found: $WEB_DIR/$BENCH_SUITE" >&2
  exit 2
fi

# A missing baseline must never read as "no regressions". The comparator
# enforces this too; checking here as well produces the better message and
# avoids paying for a benchmark run that could not be compared anyway.
if [[ $UPDATE_BASELINE -eq 0 && ! -f "$BASELINE_PATH" ]]; then
  echo "ERROR: No baseline at $BASELINE_PATH." >&2
  echo "       Record one with: bash scripts/run-benchmarks.sh --update-baseline" >&2
  echo "       Refusing to report success without something to compare against." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Resolve the output path
# ---------------------------------------------------------------------------
# With --update-baseline the report IS the baseline. Otherwise it goes to a
# temp file: writing the report over the baseline — which is what the previous
# defaults did, both being benchmarks/latest.json — means every run compares
# the baseline against itself and can never detect anything.
CLEANUP_OUTPUT=0
if [[ $UPDATE_BASELINE -eq 1 ]]; then
  if [[ -z "$OUTPUT_PATH" ]]; then
    OUTPUT_PATH="$BASELINE_PATH"
  fi
elif [[ -z "$OUTPUT_PATH" ]]; then
  OUTPUT_PATH="$(mktemp "${TMPDIR:-/tmp}/spawnforge-bench-XXXXXX")"
  CLEANUP_OUTPUT=1
fi

cleanup() {
  if [[ $CLEANUP_OUTPUT -eq 1 && -n "$OUTPUT_PATH" ]]; then
    rm -f "$OUTPUT_PATH"
  fi
}
trap cleanup EXIT

mkdir -p "$(dirname "$OUTPUT_PATH")" "$BENCHMARKS_DIR"

# ---------------------------------------------------------------------------
# Run the benchmark suite
# ---------------------------------------------------------------------------
COMMIT_SHA="${GITHUB_SHA:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"

echo "==> SpawnForge benchmarks"
echo "    Suite:      web/$BENCH_SUITE"
echo "    Commit:     $COMMIT_SHA"
echo "    Iterations: $ITERATIONS (warm-up $WARMUP, discarded)"
echo "    Output:     $OUTPUT_PATH"
if [[ $UPDATE_BASELINE -eq 1 ]]; then
  echo "    Mode:       recording a new baseline (no comparison)"
else
  echo "    Baseline:   $BASELINE_PATH"
  echo "    Threshold:  ${THRESHOLD}x on [$METRICS]"
fi
echo ""

# The suite writes the report itself, from the BenchmarkResult objects it
# measured. It is NOT derived from vitest's per-test wall-clock duration:
# that number covers fixture construction plus every iteration of the loop,
# and carries no percentiles at all.
#
# SPAWNFORGE_BENCH_SLOWDOWN is pinned to 1 rather than inherited. It is a
# mutation seam for testing the comparator, and letting it leak in from the
# ambient environment would allow a deliberately slowed run to be recorded as
# a baseline.
if ! (
  cd "$WEB_DIR" && \
  SPAWNFORGE_BENCH_OUTPUT="$OUTPUT_PATH" \
  BENCH_ITERATIONS="$ITERATIONS" \
  BENCH_WARMUP="$WARMUP" \
  GITHUB_SHA="$COMMIT_SHA" \
  SPAWNFORGE_BENCH_SLOWDOWN=1 \
  "$VITEST" run --config vitest.config.node.ts "$BENCH_SUITE" --reporter=verbose
); then
  echo "" >&2
  echo "FAIL: the benchmark suite did not pass. Timings from a failing suite are" >&2
  echo "      not comparable — a benchmark that throws early records a" >&2
  echo "      suspiciously fast time rather than a slow one." >&2
  exit 1
fi

if [[ ! -s "$OUTPUT_PATH" ]]; then
  echo "" >&2
  echo "FAIL: the benchmark suite passed but wrote no report to $OUTPUT_PATH." >&2
  echo "      Check that productBenchmarks.test.ts still honours" >&2
  echo "      SPAWNFORGE_BENCH_OUTPUT." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Compare, or record
# ---------------------------------------------------------------------------
if [[ $UPDATE_BASELINE -eq 1 ]]; then
  echo ""
  echo "==> Baseline recorded: $OUTPUT_PATH"
  echo "    Commit it, and say in the commit message why the numbers moved."
  exit 0
fi

echo ""
echo "==> Comparing against $BASELINE_PATH"

# Paths go through argv, never interpolated into a JavaScript heredoc.
# `set +e` around the call because `set -e` would abort before $? is read,
# which is how the previous version's regression branch became unreachable.
set +e
node "$SCRIPT_DIR/compare-benchmarks.mjs" \
  --current "$OUTPUT_PATH" \
  --baseline "$BASELINE_PATH" \
  --threshold "$THRESHOLD" \
  --metrics "$METRICS"
COMPARE_EXIT=$?
set -e

echo ""
case $COMPARE_EXIT in
  0) echo "==> Benchmark run complete: within threshold." ;;
  1) echo "==> Benchmark run complete: REGRESSIONS DETECTED." ;;
  *) echo "==> Benchmark comparison could not run (exit $COMPARE_EXIT)." ;;
esac

exit $COMPARE_EXIT
