#!/usr/bin/env bash
# Unit tests for scripts/check-vitest-exit.sh — the vitest exit-code gate.
#
# This gate is the single source of truth for the vitest#3077 open-handle
# workaround used by BOTH .github/workflows/quality-gates.yml (with --coverage)
# and .github/workflows/cd.yml (without). The workaround swallows a non-zero
# vitest exit when no tests actually failed (open handles after a green run).
#
# The bug this suite locks down (#8598 / F06): a COVERAGE-THRESHOLD failure
# also exits non-zero with NO "Test Files ... failed" line, so the old inline
# `grep "Test Files.*failed"` check mistook it for an open-handle false positive
# and exited 0 — silently green-lighting a coverage regression. The gate MUST
# propagate coverage failures (fail closed), and MUST fail closed when the exit
# is non-zero but the evidence file is missing/empty.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-vitest-exit.sh"
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

# Run the gate, capturing its exit code. Usage: run_gate <code> <file>
run_gate() {
  bash "$GATE" "$1" "$2" >/dev/null 2>&1
  echo $?
}

mkfile() {
  local path="$TMPDIR_T/$1"
  printf '%s\n' "$2" > "$path"
  echo "$path"
}

# ── Real vitest fixtures ──────────────────────────────────────────────────────
PASS_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)'

TESTFAIL_OUTPUT=' Test Files  2 failed | 118 passed (120)
      Tests  3 failed | 1397 passed (1400)'

# Coverage-threshold failure: all tests pass, vitest still exits 1.
COVERAGE_GLOBAL_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
ERROR: Coverage for lines (68.51%) does not meet global threshold (72%)
ERROR: Coverage for statements (69.2%) does not meet global threshold (70%)'

COVERAGE_PERFILE_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
ERROR: Coverage for functions (40%) does not meet threshold (65%)'

# Open-handle false positive: green run, non-zero exit, no coverage section.
OPENHANDLE_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)

Error: A worker process has failed to exit gracefully'

# ANSI-colored coverage error (vitest colorizes ERROR lines). The escapes here
# SPLIT two regex-load-bearing tokens mid-word — "Co\x1b[31mverage" and
# "thr\x1b[0meshold" — NOT just colorize at the line boundary. That distinction
# is what gives test #7 teeth: the detection regex's `.*` wildcards already span
# a boundary escape, so a boundary-only fixture would still match even if the
# sed ANSI-strip were deleted (a surviving mutant). With the escapes inside the
# tokens, the literal substrings "coverage"/"threshold" only exist AFTER the
# strip runs, so removing the strip makes the gate miss the line and the test
# fails — proving the strip line is the code under test, not decoration.
ANSI_COVERAGE_OUTPUT=$' Test Files  120 passed (120)\n\x1b[31mERROR: Co\x1b[31mverage for branches (55%) does not meet global thr\x1b[0meshold (60%)\x1b[0m'

# vitest's SECOND threshold-failure form (negative / max-uncovered threshold):
# "Uncovered X (N) exceed global threshold (M)". All tests pass, exit still 1.
# Missing this form re-opens #8598 for max-uncovered thresholds (F06 follow-up).
COVERAGE_UNCOVERED_GLOBAL_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
ERROR: Uncovered statements (33) exceed global threshold (30)'

COVERAGE_UNCOVERED_PERFILE_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
ERROR: Uncovered lines (12) exceed "src/math.ts" threshold (10)'

# ANSI-colored TEST-FAILURE marker with the load-bearing tokens split mid-word
# ("Fi\x1b[31mles", "fai\x1b[1mled") — the marker is only detectable AFTER the
# ANSI strip, same teeth rationale as ANSI_COVERAGE_OUTPUT above.
ANSI_TESTFAIL_OUTPUT=$' Test Fi\x1b[31mles  2 fai\x1b[1mled | 118 passed (120)\x1b[0m\n      Tests  3 failed | 1397 passed (1400)'

# Truncated mid-run output: the CI `timeout` wrapper killed vitest BEFORE the
# "Test Files ..." summary printed. Non-empty, no failure markers — but also no
# positive proof the run completed. A 124 with this evidence MUST fail closed:
# absence of failure markers proves nothing when the run never finished.
TRUNCATED_OUTPUT=' RUN  v4.1.7 /home/runner/work/project-forge/web

 ✓ src/lib/tokens/creditManager.test.ts (12 tests) 34ms
 ✓ src/stores/slices/selectionSlice.test.ts (8 tests) 21ms'

echo "== check-vitest-exit.sh =="

# 1. Clean pass (exit 0) → gate passes.
f="$(mkfile pass.txt "$PASS_OUTPUT")"
rc="$(run_gate 0 "$f")"
if [ "$rc" = "0" ]; then pass "exit 0 → gate 0"; else fail "exit 0 → expected 0, got $rc"; fi

# 2. Timeout (exit 124) WITH evidence of a fully passing run → swallowed as a
#    warning (vitest#3077 hang on cleanup). 124 alone is NOT a free pass — see
#    cases 15-21 — but timeout + proven-green run stays green.
f="$(mkfile to.txt "$PASS_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "0" ]; then pass "exit 124 + passing evidence → gate 0 (timeout warning)"; else fail "exit 124 + passing evidence → expected 0, got $rc"; fi

# 3. Real test failures → propagate non-zero.
f="$(mkfile tf.txt "$TESTFAIL_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "test failures → gate 1 (propagate)"; else fail "test failures → expected 1, got $rc"; fi

# 4. THE FIX: coverage-threshold failure (global) with no failed tests → propagate.
f="$(mkfile cov.txt "$COVERAGE_GLOBAL_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "coverage global miss → gate 1 (NOT swallowed)"; else fail "coverage global miss → expected 1, got $rc (REGRESSION: swallowed)"; fi

# 5. Coverage-threshold failure (per-file, no 'global') → propagate.
f="$(mkfile covpf.txt "$COVERAGE_PERFILE_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "coverage per-file miss → gate 1"; else fail "coverage per-file miss → expected 1, got $rc"; fi

# 6. Open-handle false positive → swallowed (preserve #3077 workaround).
f="$(mkfile oh.txt "$OPENHANDLE_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "0" ]; then pass "open-handle noise → gate 0 (workaround preserved)"; else fail "open-handle noise → expected 0, got $rc"; fi

# 7. ANSI escapes split the "coverage"/"threshold" tokens mid-word → the gate
#    only matches after the sed strip runs (delete the strip and this regresses
#    to a swallowed miss). Real teeth on the ANSI-strip line, not boundary color.
f="$(mkfile ansi.txt "$ANSI_COVERAGE_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "ANSI mid-token coverage miss → gate 1 (strip is load-bearing)"; else fail "ANSI mid-token coverage miss → expected 1, got $rc"; fi

# 8. Fail closed: non-zero exit but evidence file MISSING → propagate, never swallow.
rc="$(run_gate 1 "$TMPDIR_T/does-not-exist.txt")"
if [ "$rc" != "0" ]; then pass "missing output + non-zero → gate non-zero (fail closed)"; else fail "missing output + non-zero → expected non-zero, got $rc"; fi

# 9. Fail closed: non-zero exit with EMPTY evidence file → propagate.
f="$(mkfile empty.txt "")"
: > "$f"
rc="$(run_gate 1 "$f")"
if [ "$rc" != "0" ]; then pass "empty output + non-zero → gate non-zero (fail closed)"; else fail "empty output + non-zero → expected non-zero, got $rc"; fi

# 10. Usage error: wrong arg count → exit 2 (surface misconfig, never silent-pass).
bash "$GATE" 1 >/dev/null 2>&1; rc=$?
if [ "$rc" = "2" ]; then pass "missing file arg → exit 2 (usage)"; else fail "missing file arg → expected 2, got $rc"; fi

# 11. Usage error: non-numeric exit code → exit 2.
f="$(mkfile nn.txt "$PASS_OUTPUT")"
bash "$GATE" "notanumber" "$f" >/dev/null 2>&1; rc=$?
if [ "$rc" = "2" ]; then pass "non-numeric code → exit 2 (usage)"; else fail "non-numeric code → expected 2, got $rc"; fi

# 12. Coverage miss takes precedence even if a test-fail line is ALSO present
#     (still a failure either way — must propagate).
f="$(mkfile both.txt "$TESTFAIL_OUTPUT
ERROR: Coverage for lines (1%) does not meet global threshold (72%)")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "both test-fail + coverage → gate 1"; else fail "both → expected 1, got $rc"; fi

# 13. THE FOLLOW-UP FIX: form-B (max-uncovered) global threshold miss → propagate.
f="$(mkfile unc.txt "$COVERAGE_UNCOVERED_GLOBAL_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "uncovered global miss → gate 1 (form B NOT swallowed)"; else fail "uncovered global miss → expected 1, got $rc (REGRESSION: form B swallowed)"; fi

# 14. Form-B per-file (quoted path, no 'global') threshold miss → propagate.
f="$(mkfile uncpf.txt "$COVERAGE_UNCOVERED_PERFILE_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "uncovered per-file miss → gate 1 (form B)"; else fail "uncovered per-file miss → expected 1, got $rc"; fi

# ── Exit 124 must NOT bypass the evidence checks (PR #8721 P0, Sentry
#    r3391661666). The old gate exited 0 on 124 BEFORE the fail-closed evidence
#    check and the marker scans, so a timed-out run that ALSO failed tests or
#    coverage thresholds was silently green. 124 must flow through the SAME
#    evidence pipeline; only a proven fully-passing run may be swallowed. ──────

# 15. THE P0 FIX: 124 + coverage-threshold failure → propagate 124, never swallow.
f="$(mkfile to-cov.txt "$COVERAGE_GLOBAL_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "124" ]; then pass "124 + coverage miss → gate 124 (NOT swallowed)"; else fail "124 + coverage miss → expected 124, got $rc (REGRESSION: timeout swallowed a coverage failure)"; fi

# 16. 124 + real test failures → propagate 124.
f="$(mkfile to-tf.txt "$TESTFAIL_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "124" ]; then pass "124 + test failures → gate 124 (NOT swallowed)"; else fail "124 + test failures → expected 124, got $rc (REGRESSION: timeout swallowed test failures)"; fi

# 17. 124 + ANSI mid-token coverage marker → propagate 124. The marker must be
#     detected THROUGH color codes; this fixture's first line is an UNSPLIT
#     passing summary, so a mutant that deletes the ANSI strip would match the
#     positive-proof check and exit 0 — making this case fail. Teeth on both
#     the 124 routing AND the strip.
f="$(mkfile to-ansi.txt "$ANSI_COVERAGE_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "124" ]; then pass "124 + ANSI coverage miss → gate 124 (marker seen through color)"; else fail "124 + ANSI coverage miss → expected 124, got $rc"; fi

# 18. 124 + ANSI mid-token test-failure marker → propagate 124 via the MARKER
#     path, not the fail-closed fallback (assert no fail-closed message), so the
#     failure is detected through color codes rather than accidentally caught.
f="$(mkfile to-ansitf.txt "$ANSI_TESTFAIL_OUTPUT")"
GATE_OUT="$(bash "$GATE" 124 "$f" 2>&1)"; rc=$?
if [ "$rc" = "124" ] && ! printf '%s' "$GATE_OUT" | grep -q "failing closed"; then
  pass "124 + ANSI test-fail marker → gate 124 via marker detection"
else
  fail "124 + ANSI test-fail marker → expected 124 via marker path, got rc=$rc out='$GATE_OUT'"
fi

# 19. Fail closed: 124 with evidence file MISSING → propagate, never swallow.
rc="$(run_gate 124 "$TMPDIR_T/timeout-no-evidence.txt")"
if [ "$rc" = "124" ]; then pass "124 + missing evidence → gate 124 (fail closed)"; else fail "124 + missing evidence → expected 124, got $rc"; fi

# 20. Fail closed: 124 with EMPTY evidence file → propagate.
f="$(mkfile to-empty.txt "")"
: > "$f"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "124" ]; then pass "124 + empty evidence → gate 124 (fail closed)"; else fail "124 + empty evidence → expected 124, got $rc"; fi

# 21. Fail closed: 124 with TRUNCATED evidence (timeout killed vitest before the
#     summary printed — no markers, but no proof of a completed run either) →
#     propagate. Absence of failure markers is NOT evidence of success when the
#     run never finished.
f="$(mkfile to-trunc.txt "$TRUNCATED_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "124" ]; then pass "124 + truncated evidence → gate 124 (no positive proof)"; else fail "124 + truncated evidence → expected 124, got $rc"; fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-vitest-exit.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
