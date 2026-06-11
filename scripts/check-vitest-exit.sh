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
# vitest exits non-zero in four distinct situations:
#   1. A test actually failed              → summary has "Test Files ... failed"
#   2. A coverage threshold was not met    → one of vitest's two threshold-failure
#                                            forms (see below), but NO
#                                            "Test Files ... failed" line
#   3. Open handles after a green run      → non-zero exit, neither marker present
#   4. The CI `timeout` wrapper killed it  → exit 124; the run may have hung
#                                            during cleanup AFTER passing
#                                            (vitest#3077) OR been killed mid-run
#                                            with failures already on record
# Only (3), and (4) when the evidence proves a fully passing run, are false
# positives. (1) and (2) MUST propagate — INCLUDING when the exit code is 124.
# An early `exit 0` on 124 used to bypass every evidence check below, silently
# green-lighting timed-out runs that also failed tests or coverage thresholds
# (PR #8721 P0, Sentry r3391661666).
#
# vitest emits the coverage-threshold failure in TWO forms (vitest source
# coverage chunk; verified against 4.1.7), and BOTH must be caught or the gate
# silently swallows them — the #8598 regression class:
#   A. positive % threshold:  "ERROR: Coverage for statements (50%) does not meet global threshold (85%)"
#   B. negative (max-uncovered) threshold: "ERROR: Uncovered statements (33) exceed global threshold (30)"
# Per-file variants substitute "\"path\" threshold" for "global threshold".
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

# NOTE: 124 (`timeout` kill) deliberately gets NO early exit — it must flow
# through the same evidence checks as every other non-zero code. See header.

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

# (2) A coverage threshold was not met → propagate (the #8598 fix). Matches BOTH
#     vitest forms: the positive-% "Coverage for X does not meet ... threshold"
#     and the negative-count "Uncovered X exceed ... threshold" — global and
#     per-file variants alike. Missing form B would re-open #8598 for any repo
#     (or future config) that sets a max-uncovered threshold.
if printf '%s\n' "$CLEAN" \
  | grep -qiE "coverage for .*does not meet .*threshold|uncovered .*exceed .*threshold"; then
  echo "::error::vitest coverage thresholds not met — failing the build (this was previously swallowed: #8598)"
  exit "$EXIT_CODE"
fi

# (4) Exit 124 with neither failure marker: the `timeout` wrapper can kill
#     vitest BEFORE the summary prints, so for 124 the ABSENCE of failure
#     markers proves nothing. Swallowing a timeout requires POSITIVE evidence
#     of a completed passing run — the "Test Files ... passed" summary. Any
#     "Test Files ... failed" line was already propagated above, so a match
#     here can only be a fully green summary. Without it, fail closed.
if [ "$EXIT_CODE" -eq 124 ]; then
  if printf '%s\n' "$CLEAN" | grep -qE "Test Files.*passed"; then
    echo "::warning::vitest was killed by the timeout wrapper after a fully passing run — likely hung during cleanup (vitest#3077)"
    exit 0
  fi
  echo "::error::vitest was killed by the timeout wrapper (exit 124) and the captured output shows no completed passing run — failing closed (cannot prove the vitest#3077 false positive)"
  exit "$EXIT_CODE"
fi

# (3) Neither marker → assume the vitest#3077 open-handle false positive.
echo "::warning::vitest exited with code $EXIT_CODE but no test failures or coverage-threshold failures detected — likely open handle issue (vitest#3077)"
exit 0
