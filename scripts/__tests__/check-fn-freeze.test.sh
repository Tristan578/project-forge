#!/usr/bin/env bash
# Tests for scripts/check-fn-freeze.sh — the readonly-function freeze gate
# (PF-1076 / #9125).
#
# Every state the gate can report is produced here by a real fixture and run
# through the real script (lesson 15: no state reachable only by a human
# remembering a command). Fixtures are written with QUOTED heredocs so their
# bodies reach the gate byte-for-byte (lesson 5).
#
# The suite also runs the gate against the REAL tree and asserts a volume floor,
# proves the freeze BINDS at runtime (a declaration is not an effect), and
# asserts that no workflow wires the gate's test-only FN_FREEZE_DIRS seam.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
GATE="$REPO_ROOT/scripts/check-fn-freeze.sh"
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
passed=0
failed=0

pass() { echo "  PASS: $1"; passed=$((passed + 1)); }
readonly -f pass
fail() { echo "  FAIL: $1"; failed=$((failed + 1)); }
readonly -f fail

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }
echo "=== check-fn-freeze.sh tests ==="

# mkfixture <dir-name> [<suite-basename>] — write one fixture suite from stdin
# into a fresh directory under the temp root; echo the directory.
mkfixture() {
  local dir="$TMPDIR_T/$1" base="${2:-fixture.test.sh}"
  mkdir -p "$dir"
  cat > "$dir/$base"
  echo "$dir"
}
readonly -f mkfixture

# run_gate <dir>... — run the gate over the given directories through the seam;
# echoes "<exit>|<output>".
run_gate() {
  local out rc
  out="$(FN_FREEZE_DIRS="$*" bash "$GATE" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_gate

# expect_rc <case> <expected-rc> <result> [<needle>...] — assert the exit code
# and that every needle appears in the output.
expect_rc() {
  local desc="$1" want="$2" res="$3"; shift 3
  local rc="${res%%|*}" out="${res#*|}" needle ok=1
  if [ "$rc" != "$want" ]; then
    fail "$desc — expected exit $want, got $rc: ${out}"
    return
  fi
  for needle in "$@"; do
    if ! grep -qF -- "$needle" <<<"$out"; then
      fail "$desc — exit $rc as expected but output lacks '$needle': ${out}"
      ok=0
    fi
  done
  [ "$ok" -eq 1 ] && pass "$desc"
}
readonly -f expect_rc

# ---- 1. every spelling, all frozen -> exit 0 ----------------------------------
d_clean="$(mkfixture clean <<'FIX'
#!/usr/bin/env bash
set -uo pipefail
pass() { echo "  PASS: $1"; }
readonly -f pass
fail() {
  echo "  FAIL: $1"
  FAILURES=$((FAILURES + 1))
}
readonly -f fail
function helper_a() {
  :
}
readonly -f helper_a
function helper_b {
  :
}
readonly -f helper_b
awk_wrapper() {
  awk '
    { print }
    END { print "done" }
  ' "$@"
}
readonly -f awk_wrapper
pass "clean"
FIX
)"
expect_rc "1. clean fixture with all four definition spellings is accepted" 0 \
  "$(run_gate "$d_clean")" "5 function(s) across 1 file(s) are frozen"

# ---- 2. a multi-line definition without a freeze -> exit 1, named -------------
d_unfrozen="$(mkfixture unfrozen <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
fail() {
  echo "  FAIL: $1"
}
pass "x"
FIX
)"
expect_rc "2. an unfrozen multi-line definition is a violation naming file, function and the line to add" 1 \
  "$(run_gate "$d_unfrozen")" "fixture.test.sh:3: fail() is not frozen" "add 'readonly -f fail' on line 6"

# ---- 3. a one-liner without a freeze -> exit 1 ---------------------------------
d_oneliner="$(mkfixture oneliner <<'FIX'
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; }
readonly -f fail
FIX
)"
expect_rc "3. an unfrozen one-line definition is a violation" 1 \
  "$(run_gate "$d_oneliner")" "fixture.test.sh:1: pass() is not frozen" "on line 2"

# ---- 4. a freeze separated from its definition by a blank line -> exit 1 -------
d_window="$(mkfixture window <<'FIX'
pass() { echo "  PASS: $1"; }

readonly -f pass
FIX
)"
res="$(run_gate "$d_window")"
expect_rc "4. a freeze one line below its definition leaves a window and is refused" 1 \
  "$res" "pass() is not frozen" "'readonly -f pass' does not directly follow"

# ---- 5. a commented-out freeze does not count (lesson 16) ---------------------
d_commented="$(mkfixture commented <<'FIX'
pass() { echo "  PASS: $1"; }
# readonly -f pass
fail() { echo "  FAIL: $1"; }
readonly -f fail
FIX
)"
expect_rc "5. a commented-out freeze is not a freeze" 1 \
  "$(run_gate "$d_commented")" "pass() is not frozen"

# ---- 6. a freeze BEFORE the definition (pre-declaration) -> exit 1 -------------
d_predeclare="$(mkfixture predeclare <<'FIX'
readonly -f pass
pass() { echo "  PASS: $1"; }
FIX
)"
res="$(run_gate "$d_predeclare")"
expect_rc "6. a freeze that precedes its definition is a stray AND the definition is unfrozen" 1 \
  "$res" "fixture.test.sh:1: 'readonly -f pass' does not directly follow" "fixture.test.sh:2: pass() is not frozen"

# ---- 7. a freeze naming a function the file never defines -> exit 1 ------------
d_ghost="$(mkfixture ghost <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
readonly -f ghost
FIX
)"
expect_rc "7. a freeze naming an undefined function is a stray" 1 \
  "$(run_gate "$d_ghost")" "'readonly -f ghost' does not directly follow"

# ---- 8. definitions inside a heredoc are fixture text, not suite code ----------
d_heredoc="$(mkfixture heredoc <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
write_fixture() {
  cat > "$1" <<'EOF'
fail() { :; }
helper() {
  :
}
EOF
  cat > "$2" <<EOF
other() { :; }
EOF
}
readonly -f write_fixture
FIX
)"
expect_rc "8. function definitions inside quoted and unquoted heredocs are ignored" 0 \
  "$(run_gate "$d_heredoc")" "2 function(s) across 1 file(s) are frozen"

# ---- 9. a commented-out definition is ignored ---------------------------------
d_cdef="$(mkfixture commented-def <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
# old() { :; }
#fail() {
#  :
#}
FIX
)"
expect_rc "9. a commented-out definition is not a definition" 0 \
  "$(run_gate "$d_cdef")" "1 function(s) across 1 file(s) are frozen"

# ---- 10. indented (nested) definitions are out of scope ------------------------
d_nested="$(mkfixture nested <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
outer() {
  inner() { :; }
  inner
}
readonly -f outer
if true; then
  chosen() { :; }
fi
FIX
)"
expect_rc "10. indented definitions (nested in a body, an if arm or a subshell) are not scanned" 0 \
  "$(run_gate "$d_nested")" "2 function(s) across 1 file(s) are frozen"

# ---- 11. a multi-line body whose braces are unbalanced in quoted text ----------
d_braces="$(mkfixture braces <<'FIX'
count() {
  awk -v n="$1" '
    { if ($0 ~ n) c++ }
    END { print c + 0 }'
}
readonly -f count
grep_brace() {
  grep -E '\{' "$1"
}
readonly -f grep_brace
FIX
)"
expect_rc "11. the end of a definition is its column-0 closing brace, not a brace count" 0 \
  "$(run_gate "$d_braces")" "2 function(s) across 1 file(s) are frozen"

# ---- 12. vacuity: no suites, and suites with no definitions --------------------
mkdir -p "$TMPDIR_T/empty"
expect_rc "12a. a directory with no suites is a tooling error (exit 2), not a pass" 2 \
  "$(run_gate "$TMPDIR_T/empty")" "no shell suites found"
d_nofn="$(mkfixture nofn <<'FIX'
#!/usr/bin/env bash
echo "no functions here"
exit 0
FIX
)"
expect_rc "12b. suites that define no function at all are a tooling error (exit 2), not a pass" 2 \
  "$(run_gate "$d_nofn")" "no function definition derived"
expect_rc "12c. a missing directory is a tooling error (exit 2)" 2 \
  "$(run_gate "$TMPDIR_T/does-not-exist")" "scanned directory not found"

# ---- 12d. a file the lexer cannot parse to EOF is a tooling error --------------
# An unterminated heredoc (or quote) would hide every definition after it; the
# gate must refuse rather than report the visible prefix as fully frozen.
d_unterminated="$(mkfixture unterminated <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cat > "$1" <<'EOF'
never terminated
fail() { :; }
FIX
)"
expect_rc "12d. an unterminated heredoc is a parse failure (exit 2), never a pass over the visible prefix" 2 \
  "$(run_gate "$d_unterminated")" "unterminated heredoc <<EOF still open"
d_unquoted="$(mkfixture unquoted <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
PROGRAM='
function flush() {
FIX
)"
expect_rc "12e. an unterminated quoted string is a parse failure (exit 2)" 2 \
  "$(run_gate "$d_unquoted")" "unterminated quoted string still open"

# ---- 12f. a column-0 definition inside a quoted program is string content ------
# The sweep that introduced this gate froze `function flush() {` inside a
# single-quoted awk program held in a variable, which broke the program. The
# same shape inside $( ... ) within double quotes must also be skipped, and a
# freeze line found inside such a string must be reported as a stray.
d_quoted="$(mkfixture quoted <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
PROGRAM='
function flush() {
  print "x"
}
/^jobs:/ { next }
'
derived="$(awk '
function helper() {
  return 1
}
{ print }
' "$1")"
fail() { echo "  FAIL: $1"; }
readonly -f fail
FIX
)"
expect_rc "12f. column-0 definitions inside single-quoted programs (bare or inside \$( ) in double quotes) are not bash definitions" 0 \
  "$(run_gate "$d_quoted")" "2 function(s) across 1 file(s) are frozen"
d_quoted_freeze="$(mkfixture quoted-freeze <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
PROGRAM='
function flush() {
  print "x"
}
readonly -f flush
'
FIX
)"
expect_rc "12g. a freeze line inside a quoted program is reported as a stray, not silently ignored" 1 \
  "$(run_gate "$d_quoted_freeze")" "fixture.test.sh:7: 'readonly -f flush' does not directly follow"

# ---- 13. several directories; a lib/ directory scans plain .sh -----------------
mkdir -p "$TMPDIR_T/multi/lib"
cat > "$TMPDIR_T/multi/lib/platform.sh" <<'FIX'
platform_name() { echo linux; }
readonly -f platform_name
probe_skip() {
  echo "SKIP: $1"
}
FIX
cat > "$TMPDIR_T/multi/ignored.sh" <<'FIX'
not_a_suite() { :; }
FIX
res="$(run_gate "$d_clean" "$TMPDIR_T/multi/lib" "$TMPDIR_T/multi")"
expect_rc "13. a lib/ directory contributes its .sh files and a non-lib directory only its *.test.sh" 1 \
  "$res" "platform.sh:3: probe_skip() is not frozen"
if grep -q 'not_a_suite' <<<"${res#*|}"; then
  fail "13. a plain .sh outside lib/ was scanned"
else
  pass "13. a plain .sh outside lib/ is not scanned"
fi

# ---- 14. --list prints the derivation the sweep tool and the check share -------
list_out="$(FN_FREEZE_DIRS="$d_unfrozen" bash "$GATE" --list 2>&1)"
list_rc=$?
row_pass="$(awk -F'\t' '$1 ~ /fixture\.test\.sh$/ && $2 == "pass" && $3 == 1 && $4 == 1 && $5 == "frozen"' <<<"$list_out")"
row_fail="$(awk -F'\t' '$1 ~ /fixture\.test\.sh$/ && $2 == "fail" && $3 == 3 && $4 == 5 && $5 == "unfrozen"' <<<"$list_out")"
if [ "$list_rc" -eq 0 ] && [ -n "$row_pass" ] && [ -n "$row_fail" ]; then
  pass "14. --list prints one TSV row per definition with its def line, end line and status"
else
  fail "14. --list output unexpected (rc=$list_rc): $list_out"
fi
if bash "$GATE" --bogus >/dev/null 2>&1; then
  fail "14b. an unknown flag is accepted"
else
  pass "14b. an unknown flag is refused"
fi

# ---- 15. the REAL tree passes, and the derivation is not vacuous --------------
real="$(bash "$GATE" 2>&1)"
real_rc=$?
if [ "$real_rc" -eq 0 ]; then
  pass "15. every function defined by the real suites is frozen (gate exit 0 on the tree)"
else
  fail "15. the real tree has unfrozen functions (exit $real_rc): $real"
fi
# The floor is a volume pin, not a list: the count is DERIVED, and the floor
# only guards against the derivation silently collapsing (an awk edit that
# stops matching definitions would report 0 frozen, 0 violations, exit 0
# without this). Raise it as the tree grows; never lower it.
real_count="$(grep -oE '^check-fn-freeze: [0-9]+ function' <<<"$real" | grep -oE '[0-9]+' || echo 0)"
if [ "${real_count:-0}" -ge 300 ]; then
  pass "15b. the real derivation found $real_count function(s) (floor 300)"
else
  fail "15b. the real derivation found only ${real_count:-0} function(s) — below the 300 floor, so the scan has collapsed"
fi
# Both suite directories must contribute: a derivation that silently dropped
# one directory would still clear the floor on the other.
real_list="$(bash "$GATE" --list 2>&1)"
for dir in scripts/__tests__/ .claude/hooks/__tests__/ scripts/__tests__/lib/; do
  n="$(grep -c "^${dir}[^/]*	" <<<"$real_list" || true)"
  if [ "${n:-0}" -gt 0 ]; then
    pass "15c. $dir contributes $n definition(s) to the real derivation"
  else
    fail "15c. $dir contributes no definitions to the real derivation"
  fi
done

# ---- 16. the freeze BINDS at runtime (a declaration is not an effect) ---------
# Rebind pass() inside a command substitution with a fake that prints a marker,
# then call it. If the freeze holds, bash refuses the redefinition and the call
# reaches the real function, so the marker can never appear. The positive half
# keeps this non-vacuous: the capture must ALSO show the shell's refusal and the
# real function's own output, so an empty capture from unrelated breakage fails.
fn_freeze_probe="$( { pass() { echo "FN-FREEZE-FAKE-BOUND"; }; pass "fn-freeze effect probe"; } 2>&1 )"
if [[ "$fn_freeze_probe" == *"FN-FREEZE-FAKE-BOUND"* ]]; then
  fail "16. a 'readonly -f' freeze does not bind: redefining pass() inside the probe replaced it"
elif [[ "$fn_freeze_probe" == *"readonly function"* && "$fn_freeze_probe" == *"fn-freeze effect probe"* ]]; then
  pass "16. 'readonly -f' binds at runtime (the redefinition is refused and the real function still runs)"
else
  fail "16. the 'readonly -f' effect probe was inconclusive — expected both the refusal and the real pass() output, got: ${fn_freeze_probe}"
fi

# ---- 17. the neuter this gate exists for is refused on a frozen suite ---------
# Build a frozen suite, append the one-line rebind of its fail helper plus a
# forced failure, and run it: the rebind must be refused and the forced failure
# must count, so the suite exits non-zero. On an UNFROZEN copy of the same suite
# the same two lines exit 0 — the measured before-state of this sweep.
cat > "$TMPDIR_T/neuter-frozen.sh" <<'FIX'
FAILURES=0
pass() { echo "  PASS: $1"; }
readonly -f pass
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
readonly -f fail
fail() { :; }
fail "forced failure after the rebind"
[ "$FAILURES" -eq 0 ]
FIX
cat > "$TMPDIR_T/neuter-unfrozen.sh" <<'FIX'
FAILURES=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
fail() { :; }
fail "forced failure after the rebind"
[ "$FAILURES" -eq 0 ]
FIX
if bash "$TMPDIR_T/neuter-frozen.sh" >/dev/null 2>&1; then
  fail "17a. a frozen suite with 'fail() { :; }' inserted still exited 0"
else
  pass "17a. a frozen suite refuses 'fail() { :; }' and the forced failure counts (exit non-zero)"
fi
if bash "$TMPDIR_T/neuter-unfrozen.sh" >/dev/null 2>&1; then
  pass "17b. the same insertion on an unfrozen copy exits 0 (the defect this gate closes, reproduced)"
else
  fail "17b. the unfrozen control did not reproduce the defect — the measurement in 17a proves nothing"
fi

# ---- 18. the test-only seam must not be wired from any workflow ----------------
# Same posture as check-suite-wiring.test.sh: comment-stripped scan of every
# workflow and composite action, fail closed on a missing dir or a grep error.
wf_dir="$REPO_ROOT/.github/workflows"
if [ ! -d "$wf_dir" ]; then
  fail "18. workflow directory missing: $wf_dir (cannot verify the seam is unwired)"
else
  wf_all="$(cat "$wf_dir"/*.yml "$wf_dir"/*.yaml 2>/dev/null | awk '{ sub(/[[:space:]]*#.*/, ""); print }')"
  if [ -d "$REPO_ROOT/.github/actions" ]; then
    wf_all="$wf_all"$'\n'"$(find "$REPO_ROOT/.github/actions" -type f \( -name '*.yml' -o -name '*.yaml' \) -exec cat {} + | awk '{ sub(/[[:space:]]*#.*/, ""); print }')"
  fi
  if [ -z "$wf_all" ]; then
    fail "18. comment-strip of the workflows produced no output — the seam check cannot be verified"
  elif grep -q 'FN_FREEZE_DIRS' <<<"$wf_all"; then
    fail "18. a workflow or action sets FN_FREEZE_DIRS — the gate can be pointed at an empty tree from CI config"
  else
    pass "18. no workflow or composite action wires the test-only FN_FREEZE_DIRS seam"
  fi
fi
if [ -n "${FN_FREEZE_DIRS:-}" ]; then
  fail "18b. FN_FREEZE_DIRS is set in this suite's own environment — a CI-side export would redirect the gate silently"
else
  pass "18b. FN_FREEZE_DIRS is unset in this suite's environment"
fi

echo
echo "check-fn-freeze.test.sh: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
