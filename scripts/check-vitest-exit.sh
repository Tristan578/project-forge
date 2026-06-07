#!/usr/bin/env bash
# check-vitest-exit.sh — decide whether a non-zero `vitest run` exit is a real
# failure or the known vitest#3077 open-handle false positive.
#
# Single source of truth for the exit-code workaround used by BOTH
# .github/workflows/quality-gates.yml (vitest --coverage) and
# .github/workflows/cd.yml (vitest). Keeping it in one tested script stops the
# two inline copies from drifting and — the reason this script exists (#8598) —
# stops a COVERAGE-THRESHOLD failure from being silently swallowed.
#
# vitest exits non-zero in three distinct situations:
#   1. A test actually failed              → summary has "Test Files ... failed"
#   2. A coverage threshold was not met    → "Coverage for X does not meet threshold",
#                                            but NO "Test Files ... failed" line
#   3. Open handles after a green run      → non-zero exit, neither marker present
# Only (3) is a false positive. (1) and (2) MUST propagate.
#
# Usage: check-vitest-exit.sh <vitest_exit_code> <output_file>
#   <output_file> is the captured (tee'd) combined stdout+stderr of the run.
# Exit: 0 = treat as success; the original code = real failure; 2 = usage error.
#
# Fail-closed contract: if the exit code is non-zero and the evidence file is
# missing or empty, we CANNOT prove it was an open-handle false positive, so we
# propagate the failure rather than swallow it.
set -uo pipefail

usage() {
  echo "usage: $(basename "$0") <vitest_exit_code> <output_file>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
EXIT_CODE="$1"
OUTPUT_FILE="$2"

# Exit code must be a non-negative integer.
case "$EXIT_CODE" in
  ''|*[!0-9]*) usage ;;
esac

# 124 = `timeout` killed a process that hung during cleanup after tests already
# completed (vitest#3077). Treat as a warning, not a failure.
if [ "$EXIT_CODE" -eq 124 ]; then
  echo "::warning::vitest process was killed after timeout — likely hung during cleanup (vitest#3077)"
  exit 0
fi

# Clean exit — nothing to adjudicate.
if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# Non-zero from here on. We need the evidence file to classify it.
if [ ! -s "$OUTPUT_FILE" ]; then
  echo "::error::vitest exited with code $EXIT_CODE but no output was captured at '$OUTPUT_FILE' — failing closed (cannot prove an open-handle false positive)"
  exit "$EXIT_CODE"
fi

# Strip ANSI color codes once; both markers can be colorized by vitest.
CLEAN="$(sed 's/\x1b\[[0-9;]*m//g' "$OUTPUT_FILE")"

# (1) A test actually failed → propagate.
if printf '%s\n' "$CLEAN" | grep -qE "Test Files.*failed"; then
  exit "$EXIT_CODE"
fi

# (2) A coverage threshold was not met → propagate (the #8598 fix). Matches both
#     "does not meet global threshold" and per-file "does not meet threshold".
if printf '%s\n' "$CLEAN" | grep -qiE "coverage for .*does not meet.*threshold"; then
  echo "::error::vitest coverage thresholds not met — failing the build (this was previously swallowed: #8598)"
  exit "$EXIT_CODE"
fi

# (3) Neither marker → assume the vitest#3077 open-handle false positive.
echo "::warning::vitest exited with code $EXIT_CODE but no test failures or coverage-threshold failures detected — likely open handle issue (vitest#3077)"
exit 0
