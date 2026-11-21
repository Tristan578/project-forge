#!/usr/bin/env bash
# Unit tests for scripts/check-vitest-exit.sh — the vitest exit-code gate.
#
# This gate is the single source of truth for the vitest#3077 open-handle
# workaround used by BOTH .github/workflows/quality-gates.yml and
# .github/workflows/cd.yml, each with --coverage. The workaround swallows a
# non-zero vitest exit when no tests actually failed (open handles after a
# green run).
#
# The bugs this suite locks down:
#   - #8598 / F06: a COVERAGE-THRESHOLD failure also exits non-zero with NO
#     "Test Files ... failed" line, so the old inline `grep "Test Files.*failed"`
#     check mistook it for an open-handle false positive and exited 0 — silently
#     green-lighting a coverage regression. Coverage failures MUST propagate.
#   - PR #8721 P0 (Sentry r3391661666): exit 124 used to get an early `exit 0`
#     that bypassed every evidence check. 124 must flow through the same
#     pipeline as every other code.
#   - PR #8721 review follow-up: the positive-proof rule ("Test Files ... passed"
#     required before swallowing) is generalized to EVERY non-zero exit code —
#     a mid-run kill via OOM SIGKILL (137), segfault (134/139), SIGTERM (143),
#     or worker crash (1) leaves truncated output with no markers, and the old
#     lenient path swallowed it green exactly like the 124 class.
#   - PR #8721 review follow-up (--coverage mode): for the --coverage caller,
#     the green summary proves only TEST-phase completion — coverage report
#     generation + threshold adjudication happen after it. In --coverage mode
#     the gate additionally requires the "Coverage report from" marker before
#     swallowing, or a kill in that window hides never-adjudicated thresholds.
# The gate MUST also fail closed when the exit is non-zero but the evidence
# file is missing/empty.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-vitest-exit.sh"
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

# Run the gate, capturing its exit code. Usage: run_gate <code> <file> [--coverage]
run_gate() {
  bash "$GATE" "$1" "$2" ${3:+"$3"} >/dev/null 2>&1
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

# Truncated mid-run output: vitest was killed BEFORE the "Test Files ..."
# summary printed (timeout 124, OOM SIGKILL 137, segfault 134/139, SIGTERM 143,
# worker crash 1, ...). Non-empty, no failure markers — but also no positive
# proof the run completed. ANY non-zero exit with this evidence MUST fail
# closed: absence of failure markers proves nothing when the run never finished.
TRUNCATED_OUTPUT=' RUN  v4.1.7 /home/runner/work/project-forge/web

 ✓ src/lib/tokens/creditManager.test.ts (12 tests) 34ms
 ✓ src/stores/slices/selectionSlice.test.ts (8 tests) 21ms'

# A --coverage run that completed BOTH phases: green test summary AND the
# coverage report (vitest prints " % Coverage report from v8" after the remap,
# immediately BEFORE the reporters execute and thresholds are adjudicated).
# The marker is the strongest in-band evidence available — a passing
# adjudication prints nothing — and the minimum required to swallow a non-zero
# exit in --coverage mode; it proves report generation began, not that
# adjudication finished (accepted residual, see the gate header).
COVERAGE_PASS_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
 % Coverage report from v8
----------|---------|----------|---------|---------|-------------------
File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
All files |   75.21 |    64.03 |   70.11 |   76.42 |'

# --coverage-mode open-handle false positive: both phases completed, then the
# worker failed to exit (vitest#3077). Must still be swallowed in coverage mode.
COVERAGE_OPENHANDLE_OUTPUT=' Test Files  120 passed (120)
      Tests  1400 passed (1400)
 % Coverage report from v8
----------|---------|----------|---------|---------|-------------------
All files |   75.21 |    64.03 |   70.11 |   76.42 |

Error: A worker process has failed to exit gracefully'

# The PGlite/V8 WASM-teardown crash (#9643, seen on #9590): a CHECK failure in
# ThreadIsolation::UnregisterWasmAllocation aborts the process with SIGILL, so
# vitest exits 132. Two distinct shapes, and the gate must treat them
# differently — the reason `.claude/rules/gotchas-build-ci.md` may not say "132
# always fails closed". Shape A kills the run mid-flight: no summary, no proof.
V8_CRASH_TRUNCATED_OUTPUT=' RUN  v4.1.7 /home/runner/work/project-forge/web

 ✓ src/stores/slices/selectionSlice.test.ts (8 tests) 21ms
#
# Fatal error in , line 0
# Check failed: jit_page_->allocations_.erase(addr) == 1.
#
 ==== C stack trace ===============================
 v8::internal::ThreadIsolation::UnregisterWasmAllocation(unsigned long, unsigned long)
Illegal instruction (core dumped)'

# Shape B is the same crash arriving AFTER both phases completed — the teardown
# runs once every suite has reported. Nothing was left unadjudicated, so this is
# the #3077 class and must be swallowed even in --coverage mode.
V8_CRASH_AFTER_GREEN_OUTPUT="$COVERAGE_PASS_OUTPUT
#
# Fatal error in , line 0
# Check failed: jit_page_->allocations_.erase(addr) == 1.
#
Illegal instruction (core dumped)"

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

# 6. Open-handle false positive → swallowed (preserve #3077 workaround). The
#    fixture contains the green "Test Files ... passed" summary — that POSITIVE
#    proof of a completed run is what licenses the swallow, not the mere absence
#    of failure markers (every legitimate vitest#3077 scenario has it: the hang
#    occurs after the summary prints).
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

# ── The positive-proof rule applies to EVERY non-zero exit, not just 124
#    (PR #8721 review follow-up). An OOM SIGKILL (137), a segfault (139, a
#    documented Node gotcha in this repo), a SIGTERM (143), or a worker crash
#    (1) kills vitest mid-run exactly like the timeout does — truncated output
#    with no markers must fail closed for ALL of them, or a killed half-run is
#    silently green through the lenient path the 124 fix removed. ──────────────

# 22. Fail closed: 137 (OOM SIGKILL) + truncated evidence → propagate 137.
f="$(mkfile oom-trunc.txt "$TRUNCATED_OUTPUT")"
rc="$(run_gate 137 "$f")"
if [ "$rc" = "137" ]; then pass "137 + truncated evidence → gate 137 (no positive proof)"; else fail "137 + truncated evidence → expected 137, got $rc (REGRESSION: OOM-killed half-run swallowed)"; fi

# 23. Fail closed: 139 (segfault) + truncated evidence → propagate 139.
f="$(mkfile segv-trunc.txt "$TRUNCATED_OUTPUT")"
rc="$(run_gate 139 "$f")"
if [ "$rc" = "139" ]; then pass "139 + truncated evidence → gate 139 (no positive proof)"; else fail "139 + truncated evidence → expected 139, got $rc (REGRESSION: segfaulted half-run swallowed)"; fi

# 24. Fail closed: exit 1 (worker crash) + truncated evidence, no markers and no
#     green summary → propagate. This was the old lenient path (3): it inferred
#     a green run from marker ABSENCE, the exact inference the 124 fix declared
#     invalid.
f="$(mkfile one-trunc.txt "$TRUNCATED_OUTPUT")"
rc="$(run_gate 1 "$f")"
if [ "$rc" = "1" ]; then pass "1 + truncated evidence → gate 1 (fail closed, lenient path removed)"; else fail "1 + truncated evidence → expected 1, got $rc (REGRESSION: crashed half-run swallowed)"; fi

# 25. The generalized rule does NOT over-block: 137 AFTER a proven green run
#     (summary present, open-handle noise) is still the #3077 class → swallowed.
f="$(mkfile oom-green.txt "$OPENHANDLE_OUTPUT")"
rc="$(run_gate 137 "$f")"
if [ "$rc" = "0" ]; then pass "137 + proven green run → gate 0 (workaround preserved)"; else fail "137 + proven green run → expected 0, got $rc"; fi

# ── --coverage mode (PR #8721 review follow-up): the green summary proves the
#    TEST phase only — coverage report generation + threshold adjudication
#    happen AFTER it and are the hang-prone tail. Swallowing in this mode also
#    requires the "Coverage report from" marker, or a kill in that window hides
#    never-adjudicated thresholds (the ratchet skips silently without
#    coverage-summary.json). ──────────────────────────────────────────────────

# 26. Coverage mode fail closed: 124 + green summary but NO coverage report →
#     thresholds were never adjudicated → propagate.
f="$(mkfile cov-mode-nocov.txt "$PASS_OUTPUT")"
rc="$(run_gate 124 "$f" --coverage)"
if [ "$rc" = "124" ]; then pass "--coverage: 124 + green tests, no coverage report → gate 124 (thresholds never adjudicated)"; else fail "--coverage: 124 + green tests, no coverage report → expected 124, got $rc (REGRESSION: unadjudicated coverage swallowed)"; fi

# 27. Coverage mode swallow: 124 + green summary + coverage report marker →
#     tests proven complete + coverage proven to have reached report generation
#     (the marker prints BEFORE reporters/threshold adjudication — strongest
#     in-band evidence available, not proof adjudication finished; see the gate
#     header) → gate 0 (#3077 workaround intact).
f="$(mkfile cov-mode-full.txt "$COVERAGE_PASS_OUTPUT")"
rc="$(run_gate 124 "$f" --coverage)"
if [ "$rc" = "0" ]; then pass "--coverage: 124 + green tests + coverage report → gate 0"; else fail "--coverage: 124 + green tests + coverage report → expected 0, got $rc"; fi

# 28. Coverage mode swallow: exit 1 open-handle noise after BOTH phases → gate 0.
f="$(mkfile cov-mode-oh.txt "$COVERAGE_OPENHANDLE_OUTPUT")"
rc="$(run_gate 1 "$f" --coverage)"
if [ "$rc" = "0" ]; then pass "--coverage: 1 + both phases complete + open-handle noise → gate 0"; else fail "--coverage: 1 + both phases + noise → expected 0, got $rc"; fi

# 29. Coverage mode fail closed: exit 1 + green summary, no coverage report →
#     propagate (same window as case 26, non-timeout code).
f="$(mkfile cov-mode-one.txt "$PASS_OUTPUT")"
rc="$(run_gate 1 "$f" --coverage)"
if [ "$rc" = "1" ]; then pass "--coverage: 1 + green tests, no coverage report → gate 1"; else fail "--coverage: 1 + green tests, no coverage report → expected 1, got $rc"; fi

# 30. Coverage mode still propagates a threshold failure (marker check (2) runs
#     before the mode logic — the mode must never weaken it).
f="$(mkfile cov-mode-miss.txt "$COVERAGE_GLOBAL_OUTPUT")"
rc="$(run_gate 1 "$f" --coverage)"
if [ "$rc" = "1" ]; then pass "--coverage: threshold miss → gate 1 (mode does not weaken #8598 fix)"; else fail "--coverage: threshold miss → expected 1, got $rc"; fi

# 31. Usage error: unknown third arg (misconfigured call site) → exit 2, never a
#     silent behavior change.
f="$(mkfile badflag.txt "$PASS_OUTPUT")"
bash "$GATE" 1 "$f" "--coverag" >/dev/null 2>&1; rc=$?
if [ "$rc" = "2" ]; then pass "unknown third arg → exit 2 (usage)"; else fail "unknown third arg → expected 2, got $rc"; fi

# ── Exit 132 (SIGILL) is the PGlite/V8 WASM-teardown crash of #9643. It is NOT
#    special-cased anywhere in the gate, and these two cases are what makes that
#    checkable: the SAME exit code adjudicates opposite ways purely on the
#    evidence. A doc entry (or a reader) claiming "132 always fails closed" is
#    contradicted by case 33; one claiming "132 is known noise, re-run it" is
#    contradicted by case 32. ──────────────────────────────────────────────────

# 32. Fail closed: 132 + the V8 crash killing the run mid-flight (no summary) →
#     propagate 132. This is the shape that reddens Web Tests, and it must.
f="$(mkfile v8-trunc.txt "$V8_CRASH_TRUNCATED_OUTPUT")"
rc="$(run_gate 132 "$f")"
if [ "$rc" = "132" ]; then pass "132 + truncated V8 crash → gate 132 (no positive proof)"; else fail "132 + truncated V8 crash → expected 132, got $rc (REGRESSION: SIGILL half-run swallowed)"; fi

# 33. The converse: 132 arriving AFTER both phases completed, in --coverage mode
#     (green summary + coverage report marker) → swallowed as #3077-class noise.
#     Nothing was left unadjudicated, so failing closed here would be over-block.
f="$(mkfile v8-green.txt "$V8_CRASH_AFTER_GREEN_OUTPUT")"
rc="$(run_gate 132 "$f" --coverage)"
if [ "$rc" = "0" ]; then pass "--coverage: 132 after both phases complete → gate 0 (132 is not special-cased)"; else fail "--coverage: 132 after both phases → expected 0, got $rc"; fi

# --- Call-site wiring pins -------------------------------------------------
#
# Cases 1-33 prove the gate adjudicates correctly when it is CALLED correctly.
# They say nothing about whether the workflows call it correctly, and that is
# where this gate has actually been defeated before: cd.yml ran `npx vitest run`
# with no --coverage at all, so the deploy path — the one that re-validates a
# commit which reached main WITHOUT the PR gate — never adjudicated a coverage
# threshold (F52 / #8644). The gate was fine; nothing invoked it in the mode
# that matters.
#
# The two flags are a matched pair and must be pinned together. Passing
# --coverage only to vitest leaves the gate willing to swallow a kill that
# happened before report generation; passing it only to the gate makes the gate
# demand a "Coverage report from" marker that a non-coverage run never prints,
# turning every #3077 false positive into a hard red. Either half alone is a
# silent misconfiguration, so assert both, in both workflows.
echo ""
echo "=== workflow wiring ==="

pin_coverage_wiring() {
  local wf="$1" label="$2" body
  if [ ! -f "$wf" ]; then
    fail "$label: workflow file not found at $wf"
    return
  fi
  # Strip comments before matching: the prose around these steps discusses
  # --coverage at length, and a commented-out invocation must not satisfy a pin.
  body="$(grep -v '^[[:space:]]*#' "$wf" || true)"
  if [ -z "$body" ]; then
    fail "$label: comment-strip produced no output — wiring cannot be verified"
    return
  fi
  if grep -Eq 'timeout 600 npx vitest run --coverage ' <<<"$body"; then
    pass "$label: runs vitest with --coverage"
  else
    fail "$label: no uncommented 'npx vitest run --coverage' invocation"
  fi
  # shellcheck disable=SC2016  # $EXIT_CODE is literal workflow text, not a shell expansion
  if grep -Eq 'check-vitest-exit\.sh" "\$EXIT_CODE" /tmp/vitest-output\.txt --coverage' <<<"$body"; then
    pass "$label: passes --coverage through to the gate"
  else
    fail "$label: gate invoked without the --coverage mode flag"
  fi
}

pin_coverage_wiring "$HERE/../../.github/workflows/quality-gates.yml" "quality-gates.yml"
pin_coverage_wiring "$HERE/../../.github/workflows/cd.yml" "cd.yml"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-vitest-exit.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
