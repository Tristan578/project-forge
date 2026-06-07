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

# ANSI-colored coverage error (vitest colorizes ERROR lines).
ANSI_COVERAGE_OUTPUT=$' Test Files  120 passed (120)\n\x1b[31mERROR: Coverage for branches (55%) does not meet global threshold (60%)\x1b[0m'

echo "== check-vitest-exit.sh =="

# 1. Clean pass (exit 0) → gate passes.
f="$(mkfile pass.txt "$PASS_OUTPUT")"
rc="$(run_gate 0 "$f")"
if [ "$rc" = "0" ]; then pass "exit 0 → gate 0"; else fail "exit 0 → expected 0, got $rc"; fi

# 2. Timeout (exit 124) → swallowed as warning (vitest#3077 hang on cleanup).
f="$(mkfile to.txt "$PASS_OUTPUT")"
rc="$(run_gate 124 "$f")"
if [ "$rc" = "0" ]; then pass "exit 124 → gate 0 (timeout warning)"; else fail "exit 124 → expected 0, got $rc"; fi

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

# 7. ANSI-colored coverage error still detected → propagate.
f="$(mkfile ansi.txt "$ANSI_COVERAGE_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "ANSI coverage miss → gate 1 (ANSI stripped)"; else fail "ANSI coverage miss → expected 1, got $rc"; fi

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

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-vitest-exit.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
