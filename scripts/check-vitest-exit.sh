#!/usr/bin/env bash
# check-vitest-exit.sh — decide whether a non-zero `vitest run` exit is a real
# failure or the known vitest#3077 open-handle false positive.
#
# Single source of truth for the exit-code workaround used by BOTH
# .github/workflows/quality-gates.yml (vitest --coverage, invoked with the
# --coverage mode flag) and .github/workflows/cd.yml (vitest). Keeping it in
# one tested script stops the two inline copies from drifting and — the reason
# this script exists (#8598) — stops a COVERAGE-THRESHOLD failure from being
# silently swallowed.
#
# vitest exits non-zero in four distinct situations:
#   1. A test actually failed              → summary has "Test Files ... failed"
#   2. A coverage threshold was not met    → one of vitest's two threshold-failure
#                                            forms (see below), but NO
#                                            "Test Files ... failed" line
#   3. The process died/hung AFTER a green run → open handles (vitest#3077) or a
#                                            late kill (e.g. the CI `timeout`
#                                            wrapper, exit 124); the
#                                            "Test Files ... passed" summary IS
#                                            present in the output
#   4. The process died MID-RUN            → killed before the summary printed:
#                                            timeout (124), OOM SIGKILL (137),
#                                            V8 abort/segfault (134/139),
#                                            SIGTERM (143), worker crash (1), …
#                                            Output is truncated — no summary.
# Only (3) is a false positive. (1) and (2) MUST propagate regardless of the
# exit code. (4) MUST fail closed: when the run never finished, the ABSENCE of
# failure markers proves nothing, so swallowing requires POSITIVE evidence of a
# completed passing run — the "Test Files ... passed" summary. That rule applies
# to EVERY non-zero exit code, not just 124: an early `exit 0` on 124 used to
# bypass every evidence check (PR #8721 P0, Sentry r3391661666), and the same
# silent-green class remained open for 137/139/143/1 with truncated output
# until the positive-proof rule was generalized (review of PR #8721).
#
# vitest emits the coverage-threshold failure in TWO forms (vitest source
# coverage chunk; verified against 4.1.7), and BOTH must be caught or the gate
# silently swallows them — the #8598 regression class:
#   A. positive % threshold:  "ERROR: Coverage for statements (50%) does not meet global threshold (85%)"
#   B. negative (max-uncovered) threshold: "ERROR: Uncovered statements (33) exceed global threshold (30)"
# Per-file variants substitute "\"path\" threshold" for "global threshold".
#
# Usage: check-vitest-exit.sh <vitest_exit_code> <output_file> [--coverage]
#   <output_file> is the captured (tee'd) combined stdout+stderr of the run.
#   --coverage: the caller ran `vitest run --coverage` (quality-gates.yml). The
#     "Test Files ... passed" summary then proves only that the TEST phase
#     completed — coverage report generation and threshold adjudication happen
#     AFTER the summary prints, and are the slow (hang-prone) tail of the run.
#     In this mode, swallowing additionally requires the coverage-report marker
#     ("Coverage report from ...").
#     What the marker actually proves (verified against the pinned
#     @vitest/coverage-v8 4.1.7, dist/provider.js generateReports()): it prints
#     AFTER the expensive v8→istanbul remap completes but BEFORE the reporters
#     execute and BEFORE reportThresholds() runs. So it is positive proof the
#     coverage phase reached report generation — the strongest in-band evidence
#     available, since a passing adjudication prints nothing — NOT proof that
#     thresholds were adjudicated. A kill landing inside the remaining
#     reporter-write + threshold-math window (typically seconds of a ~600s
#     budget) is still swallowed. This narrows the unprotected window
#     enormously but does not close it: defense-in-depth, not an airtight
#     proof (same honesty contract as check-ci-success.sh).
#     CI-redness trap, not a security hole: vitest prints the marker only when
#     coverage.reporter includes a terminal reporter (text / text-summary /
#     text-lcov / teamcity — vitest's DEFAULT reporters include "text", which
#     this repo relies on). If coverage.reporter is ever overridden to
#     file-only reporters (e.g. ['json-summary'] alone), coverage mode fails
#     closed on EVERY vitest#3077 hang. That is the fail-safe direction, but
#     the fix is to restore a terminal reporter — never to loosen this gate.
# Exit: 0 = treat as success; the original code = real failure; 2 = usage error.
#
# Fail-closed contract: if the exit code is non-zero and the evidence file is
# missing or empty, we CANNOT prove it was an open-handle false positive, so we
# propagate the failure rather than swallow it.
set -uo pipefail

usage() {
  echo "usage: $(basename "$0") <vitest_exit_code> <output_file> [--coverage]" >&2
  exit 2
}

[ "$#" -eq 2 ] || [ "$#" -eq 3 ] || usage
EXIT_CODE="$1"
OUTPUT_FILE="$2"
COVERAGE_MODE=0
if [ "$#" -eq 3 ]; then
  # Only the exact mode flag is valid — anything else is a misconfigured call
  # site and must surface as a usage error, never silently change behavior.
  [ "$3" = "--coverage" ] || usage
  COVERAGE_MODE=1
fi

# Exit code must be a non-negative integer.
case "$EXIT_CODE" in
  ''|*[!0-9]*) usage ;;
esac

# NOTE: no exit code gets an early exit — every non-zero code (124, 137, 139,
# 143, 1, …) flows through the same evidence checks below. See header.

# Clean exit — nothing to adjudicate.
if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# Non-zero from here on. We need the evidence file to classify it.
if [ ! -s "$OUTPUT_FILE" ]; then
  echo "::error::vitest exited with code $EXIT_CODE but no output was captured at '$OUTPUT_FILE' — failing closed (cannot prove an open-handle false positive)"
  exit "$EXIT_CODE"
fi

# Strip ANSI color codes once; the markers below can be colorized by vitest.
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

# (4) No failure markers — but that alone is NOT enough to swallow: any abnormal
#     termination (timeout 124, OOM SIGKILL 137, segfault 134/139, SIGTERM 143,
#     worker crash 1, …) can kill vitest BEFORE the summary prints, so for a
#     truncated run the absence of failure markers proves nothing. Swallowing
#     requires POSITIVE evidence of a completed passing run — the
#     "Test Files ... passed" summary. Any "Test Files ... failed" line was
#     already propagated above, so a match here can only be a fully green
#     summary. Without it, fail closed.
if ! printf '%s\n' "$CLEAN" | grep -qE "Test Files.*passed"; then
  echo "::error::vitest exited with code $EXIT_CODE and the captured output shows no completed passing run — failing closed (likely killed mid-run; cannot prove the vitest#3077 false positive)"
  exit "$EXIT_CODE"
fi

# (--coverage mode) The green summary proves the TEST phase completed, but
# coverage report generation + threshold adjudication happen AFTER it and are
# the hang-prone tail of the run. Require the coverage-report marker too: it
# prints after the expensive remap and immediately BEFORE the reporters and
# threshold adjudication (see header), so — given a terminal coverage reporter
# is configured (vitest default "text"; see the header's reporter-override
# trap) — its ABSENCE means thresholds were never adjudicated, and nothing
# downstream catches that (the coverage ratchet skips with a warning when
# coverage-summary.json is absent).
# Its PRESENCE proves report generation began, not that adjudication finished:
# a kill inside the brief remaining reporter-write/threshold window is still
# swallowed (accepted residual — no in-band output exists after a passing
# adjudication that could anchor a stronger check).
if [ "$COVERAGE_MODE" -eq 1 ] \
  && ! printf '%s\n' "$CLEAN" | grep -qiE "coverage report from"; then
  echo "::error::vitest exited with code $EXIT_CODE after a passing test run but BEFORE the coverage report was produced — coverage thresholds were never adjudicated; failing closed"
  exit "$EXIT_CODE"
fi

# (3) Proven completed passing run with no threshold failures → the vitest#3077
#     false positive (open handles / hang after green). Safe to swallow.
if [ "$EXIT_CODE" -eq 124 ]; then
  echo "::warning::vitest was killed by the timeout wrapper after a fully passing run — likely hung during cleanup (vitest#3077)"
else
  echo "::warning::vitest exited with code $EXIT_CODE after a fully passing run with no coverage-threshold failures — likely open handle noise (vitest#3077)"
fi
exit 0
