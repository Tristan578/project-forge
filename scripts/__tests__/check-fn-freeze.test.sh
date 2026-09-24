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

# ---- 8b. a plain << heredoc ends only at a column-0 terminator ----------------
# Bash strips leading tabs before matching the delimiter ONLY for `<<-`. A
# tab-indented body line spelling the delimiter inside a plain `<<` heredoc is
# body text, so the definition that follows it is still fixture text: a lexer
# that stripped tabs unconditionally closed the heredoc early and reported a
# false violation on a correct suite.
d_hd_tab="$(mkfixture heredoc-tab <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cat > "$1" <<EOF
	EOF
bad() { echo hi; }
EOF
FIX
)"
expect_rc "8b. a tab-indented delimiter inside a plain << heredoc does not end it" 0 \
  "$(run_gate "$d_hd_tab")" "1 function(s) across 1 file(s) are frozen"
# ---- 8c. a <<- heredoc DOES end at a tab-indented terminator ------------------
d_hd_dash="$(mkfixture heredoc-dash <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cat > "$1" <<-EOF
	body
	EOF
bad() { echo hi; }
FIX
)"
expect_rc "8c. a tab-indented terminator ends a <<- heredoc, so the definition after it is real" 1 \
  "$(run_gate "$d_hd_dash")" "fixture.test.sh:6: bad() is not frozen"

# ---- 8d. a heredoc delimiter is any word, not only an identifier ---------------
# `<<1EOF`, `<<-ZEOF` and `<<.EOF` are real delimiters; when only identifiers
# were recognised the body was lexed as code, a decoy `name() {` inside it
# swallowed every later line, and a live `fail() { :; }` after the heredoc
# passed (seventh board round, infra seat). The runtime probe proves the
# neuter is real in this bash before the gate is asked to refuse it.
heredoc_word_probe="$(cd "$(mktemp -d)" && printf 'cat <<1EOF >/dev/null\ndecoy() {\n1EOF\nfail() { :; }\ntype -t fail\n' > p.sh && bash p.sh 2>&1)"
if [ "$heredoc_word_probe" = "function" ]; then
  pass "8d-probe. in this bash a digit-leading heredoc delimiter is honoured and the fail() after it is live"
else
  fail "8d-probe. the digit-leading heredoc probe did not behave like bash (got '$heredoc_word_probe')"
fi
d_hd_word="$(mkfixture heredoc-word <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cat <<1EOF >/dev/null
decoy() {
1EOF
cat <<-ZEOF >/dev/null
	decoy2() {
	ZEOF
cat <<'.EOF' >/dev/null
decoy3() {
.EOF
cat <<"-EOF-" >/dev/null
decoy4() {
-EOF-
fail() { :; }
real_after() {
  :
}
readonly -f real_after
FIX
)"
expect_rc "8d. digit-, dash- and dot-leading heredoc delimiters (bare, <<-, single- and double-quoted) close their bodies, so the live fail() after them is reported" 1 \
  "$(run_gate "$d_hd_word")" "1 violation(s)" "fixture.test.sh:15: fail() is not frozen"
hd_word_list="$(FN_FREEZE_DIRS="$d_hd_word" bash "$GATE" --list 2>&1 | cut -f2,5 | tr '\t\n' '  ')"
if [ "$hd_word_list" = "pass frozen fail unfrozen real_after frozen " ]; then
  pass "8e. --list derives exactly the three real definitions and none of the four decoys"
else
  fail "8e. --list derived: '$hd_word_list'"
fi

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

# ---- 10. nested definitions are out of scope ----------------------------------
# Nesting is counted by command word (a function body, `if`), not indentation.
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
expect_rc "10. definitions nested in a body or an if arm are not scanned" 0 \
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
# Every scanned directory must contribute: a derivation that silently dropped
# one directory would still clear the floor on the others. The list is READ
# FROM THE GATE'S OWN DEFAULT (lesson #18), so a directory added to or removed
# from `DIRS` changes this check with it; a hand-copied list stayed green when
# one of four directories was dropped.
real_list="$(bash "$GATE" --list 2>&1)"
gate_dirs="$(sed -nE 's/^DIRS="\$\{FN_FREEZE_DIRS:-(.*)\}"$/\1/p' "$GATE")"
# The floor is the CURRENT directory count: deriving the list makes the
# per-directory check follow a rename, but a directory silently dropped from
# `DIRS` would shrink this loop with it, so the count is pinned at a floor
# the way the function count is above. Raise it when a directory is added;
# never lower it.
gate_dir_count="$(wc -w <<<"$gate_dirs")"
if [ "${gate_dir_count:-0}" -ge 4 ]; then
  pass "15c. the gate's default DIRS parsed to $gate_dir_count directories (floor 4): $gate_dirs"
else
  fail "15c. the gate's default DIRS parsed to only ${gate_dir_count:-0} directories (floor 4; got '$gate_dirs') — a scanned directory has been dropped, or the DIRS line no longer parses"
fi
for dir in $gate_dirs; do
  n="$(grep -c "^${dir}/[^/]*	" <<<"$real_list" || true)"
  if [ "${n:-0}" -gt 0 ]; then
    pass "15c. $dir/ contributes $n definition(s) to the real derivation"
  else
    fail "15c. $dir/ contributes no definitions to the real derivation"
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

# ---- 19. an alias shadows a frozen name, so the gate refuses aliases ---------
# `readonly -f` binds the FUNCTION; with expand_aliases on, `alias fail=:`
# takes every later call of the frozen helper without an error (the security
# seat of the #9125 review board measured the same silent exit 0 as the
# pre-sweep neuter). Neither line is a definition or a freeze, so it is
# reported on its own.
d_alias="$(mkfixture alias <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
shopt -s expand_aliases
alias fail=:
FIX
)"
expect_rc "19. 'shopt -s expand_aliases' and 'alias NAME=' in executable text are violations" 1 \
  "$(run_gate "$d_alias")" "fixture.test.sh:3: 'shopt -s expand_aliases'" "fixture.test.sh:4: 'alias fail=:'" "2 violation(s)"
d_alias_body="$(mkfixture alias-body <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
neuter() {
  alias fail=:
}
readonly -f neuter
FIX
)"
expect_rc "19b. an alias inside a function body is still a violation" 1 \
  "$(run_gate "$d_alias_body")" "fixture.test.sh:4: 'alias fail=:'"
d_alias_text="$(mkfixture alias-text <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
echo "alias fail=:" > "$1"
printf '%s\n' 'shopt -s expand_aliases' >> "$1"
cat >> "$1" <<'EOF'
alias fail=:
shopt -s expand_aliases
EOF
# alias fail=: (a comment is not a statement)
FIX
)"
expect_rc "19c. alias text inside quotes, a heredoc fixture or a comment is not a violation" 0 \
  "$(run_gate "$d_alias_text")" "1 function(s) across 1 file(s) are frozen"
# Every spelling bash resolves to the same COMMAND WORD is the same violation:
# the review board measured `\alias`, `builtin alias`, `command alias`, then
# `X="1" alias`, then `\a\l\i\a\s` and a backslash continuation, then a decoy
# argument (`alias nothing fail=:`) and a second shopt option, as silent
# bypasses of the rules before this one. The rule is now on the tokenised
# words of the whole statement, so this fixture is one line per spelling and
# every line must report (line 24 reports twice, once per name bound).
d_alias_prefix="$(mkfixture alias-prefix <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
\shopt -s expand_aliases
builtin alias fail=:
command alias fail=:
time alias fail=:
if alias fail=:; then :; fi
X=1 alias fail=:
! alias fail=:
\builtin \alias fail=:
X="1" alias fail=:
X='has space' alias fail=:
time -p alias fail=:
"alias" fail=:
al"ias" fail=:
\a\l\i\a\s fail=:
\s\h\o\p\t -s expand_aliases
$'alias' fail=:
shopt -sq expand_aliases
'alias' fail=:
alias \
  fail=:
alias nothing fail=:
alias pass=: fail=:
shopt -s nocasematch expand_aliases
FIX
)"
expect_rc "19e. every spelling of the alias word — prefixes, quoted assignments, quoted or escaped letters, a line continuation — is a violation" 1 \
  "$(run_gate "$d_alias_prefix")" "23 violation(s)" \
  "fixture.test.sh:3: 'shopt -s expand_aliases'" "fixture.test.sh:4: 'alias fail=:'" \
  "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:6: 'alias fail=:'" \
  "fixture.test.sh:7: 'alias fail=:'" "fixture.test.sh:8: 'alias fail=:'" \
  "fixture.test.sh:9: 'alias fail=:'" "fixture.test.sh:10: 'alias fail=:'" \
  "fixture.test.sh:11: 'alias fail=:'" "fixture.test.sh:12: 'alias fail=:'" \
  "fixture.test.sh:13: 'alias fail=:'" "fixture.test.sh:14: 'alias fail=:'" \
  "fixture.test.sh:15: 'alias fail=:'" "fixture.test.sh:16: 'alias fail=:'" \
  "fixture.test.sh:17: 'shopt -s expand_aliases'" "fixture.test.sh:18: 'alias fail=:'" \
  "fixture.test.sh:19: 'shopt -sq expand_aliases'" "fixture.test.sh:20: 'alias fail=:'" \
  "fixture.test.sh:22: 'alias fail=:'" "fixture.test.sh:23: 'alias fail=:'" \
  "fixture.test.sh:24: 'alias pass=:'" "fixture.test.sh:24: 'alias fail=:'" \
  "fixture.test.sh:25: 'shopt -s expand_aliases'"
# The words as ARGUMENTS of another command define nothing: a diagnostic that
# prints them unquoted is text, not a violation (the round-4 architect seat
# measured the word-adjacency rule flagging exactly this).
d_alias_arg="$(mkfixture alias-argument <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
echo alias fail=: is only printed here
printf %s shopt -s expand_aliases
nice alias fail=:
FIX
)"
expect_rc "19g. alias and shopt as arguments of another command (echo, printf, nice) are not violations" 0 \
  "$(run_gate "$d_alias_arg")" "1 function(s) across 1 file(s) are frozen"
# The three spellings that defeated the previous rounds bind for real in this
# bash, so the rule guards measured bypasses (lessons-learned #19 in reverse).
alias_spellings_probe="$(bash -c 'fail() { echo REAL; }; readonly -f fail; \s\h\o\p\t -s expand_aliases; X="1" \a\l\i\a\s fail="echo ALIASED"; eval fail' 2>&1)"
if [ "$alias_spellings_probe" = "ALIASED" ]; then
  pass "19f. '\\s\\h\\o\\p\\t', a quoted assignment prefix and '\\a\\l\\i\\a\\s' define the alias for real in this bash"
else
  fail "19f. spelling probe did not shadow the frozen function (got '$alias_spellings_probe')"
fi
# The refusal is the whole point: prove the alias really does shadow a frozen
# function in this bash, so the rule guards a real bypass and not a theory.
alias_probe="$(bash -c 'fail() { echo REAL; }; readonly -f fail; shopt -s expand_aliases; alias fail="echo ALIASED"; eval fail' 2>&1)"
if [ "$alias_probe" = "ALIASED" ]; then
  pass "19d. an alias shadows a readonly function at call time in this bash (the bypass the rule closes is real)"
else
  fail "19d. alias probe did not shadow the frozen function (got '$alias_probe') — re-examine whether the alias rule is still needed"
fi

# ---- 19j. a DEBUG trap under extdebug skips the next command ------------------
# Neither line redefines, aliases or unfreezes anything, and the suite prints
# no FAIL (seventh board round, security seat). First prove in this bash that
# the shape really silences a frozen helper, then that the gate reports both
# words in every spelling and never as an argument of another command.
debug_trap_probe="$(bash -c 'shopt -s extdebug; fail() { echo "FAIL: $1"; }; readonly -f fail; trap "[[ \$BASH_COMMAND != fail\\ * ]]" DEBUG; fail "silenced"; echo after' 2>&1)"
if [ "$debug_trap_probe" = "after" ]; then
  pass "19j-probe. in this bash a DEBUG trap under extdebug skips a call of a frozen helper (the gate must refuse it)"
else
  fail "19j-probe. the DEBUG-trap probe did not skip the frozen call (got '$debug_trap_probe')"
fi
d_debug_trap="$(mkfixture debug-trap <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
shopt -s extdebug
trap '[[ $BASH_COMMAND != fail\ * ]]' DEBUG
\trap ':' debug
X="1" builtin trap -- ':' Debug
shopt -s nocasematch extdebug
fail "never printed"
FIX
)"
expect_rc "19j. 'trap ... DEBUG' in any case or spelling and 'shopt -s extdebug' in executable text are violations" 1 \
  "$(run_gate "$d_debug_trap")" "5 violation(s)" "fixture.test.sh:3: 'shopt -s extdebug'" "fixture.test.sh:4: 'trap ... DEBUG'" "fixture.test.sh:5: 'trap ... debug'" "fixture.test.sh:6: 'trap ... Debug'" "fixture.test.sh:7: 'shopt -s extdebug'"
d_debug_words="$(mkfixture debug-words <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
echo trap DEBUG extdebug
printf '%s\n' "shopt -s extdebug"
trap 'echo bye' EXIT
trap - ERR
shopt -u extdebug
pass "the words as arguments, an EXIT trap and shopt -u are not violations"
FIX
)"
expect_rc "19j-b. DEBUG/extdebug as arguments of another command, a cleanup EXIT trap, 'trap - ERR' and 'shopt -u extdebug' are not violations" 0 \
  "$(run_gate "$d_debug_words")" "1 function(s) across 1 file(s) are frozen"

# ---- 19k. an EXIT/ERR/RETURN trap that exits replaces the verdict --------------
# `trap 'exit 0' EXIT` turns a suite that set FAILED=1 and reached `exit 1`
# into exit 0 (ninth board round, security seat). Prove it in this bash, then
# that the gate reports the shape and leaves signal traps and cleanup alone.
exit_trap_probe="$(bash -c 'trap "exit 0" EXIT; echo "FAIL: seen"; exit 1' >/dev/null 2>&1; echo "rc=$?")"
if [ "$exit_trap_probe" = "rc=0" ]; then
  pass "19k-probe. in this bash an EXIT trap that exits 0 overrides a script that reached 'exit 1' (the gate must refuse it)"
else
  fail "19k-probe. the EXIT-trap probe did not override the exit status (got '$exit_trap_probe')"
fi
d_exit_trap="$(mkfixture exit-trap <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
trap 'exit 0' EXIT
trap 'exit 0' ERR
trap 'cleanup; \exit 0' 0
trap -- 'exec true' exit
trap 'e\xit 1' RETURN
FIX
)"
expect_rc "19k. a trap on EXIT, ERR, RETURN or 0 whose action exits or execs, in any spelling, is a violation" 1 \
  "$(run_gate "$d_exit_trap")" "5 violation(s)" "fixture.test.sh:3: 'trap exit 0 ... EXIT'" "fixture.test.sh:4: 'trap exit 0 ... ERR'" "fixture.test.sh:5: 'trap cleanup; exit 0 ... 0'" "fixture.test.sh:6: 'trap exec true ... EXIT'" "fixture.test.sh:7: 'trap exit 1 ... RETURN'"
d_signal_trap="$(mkfixture signal-trap <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'rm -rf "$TMP"; echo exited' EXIT
trap cleanup EXIT
trap - ERR
trap -p EXIT
pass "signal traps and cleanup traps are not violations"
FIX
)"
expect_rc "19k-b. exit in a trap on a real signal, a cleanup EXIT trap (even one whose text contains the letters exit), 'trap - ERR' and 'trap -p' are not violations" 0 \
  "$(run_gate "$d_signal_trap")" "1 function(s) across 1 file(s) are frozen"

# ---- 19k-c. a trap action that is a function which exits ----------------------
# `cleanup() { exit 0; }` + `trap cleanup EXIT` overrides the verdict exactly
# like `trap 'exit 0' EXIT` (tenth board round, security seat), and so does a
# chain of functions. Prove it in this bash, then that the gate follows the
# action into the bodies this file defines, before or after the trap line.
fn_trap_probe="$(bash -c 'inner() { exit 0; }; outer() { inner; }; trap outer EXIT; exit 1' >/dev/null 2>&1; echo "rc=$?")"
if [ "$fn_trap_probe" = "rc=0" ]; then
  pass "19k-c-probe. in this bash an EXIT trap calling a function that exits 0 overrides 'exit 1' (the gate must refuse it)"
else
  fail "19k-c-probe. the function-trap probe did not override the exit status (got '$fn_trap_probe')"
fi
d_fn_trap="$(mkfixture function-trap <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
cleanup() { exit 0; }
readonly -f cleanup
trap cleanup EXIT
trap 'rm -f x; teardown' ERR
teardown() {
  finish
}
readonly -f teardown
finish() {
  exec true
}
readonly -f finish
FIX
)"
expect_rc "19k-c. an EXIT or ERR trap whose action calls a function of this file that exits or execs, directly or through another function, is a violation" 1 \
  "$(run_gate "$d_fn_trap")" "2 violation(s)" "fixture.test.sh:5: 'trap cleanup ... EXIT (cleanup() exits)'" "fixture.test.sh:6: 'trap teardown ... ERR (teardown() exits)'"
d_fn_trap_ok="$(mkfixture function-trap-ok <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cleanup() { rm -rf "$TMP"; loop_a; }
readonly -f cleanup
loop_a() { loop_b; }
readonly -f loop_a
loop_b() { loop_a; }
readonly -f loop_b
trap cleanup EXIT
trap on_term TERM
on_term() { exit 143; }
readonly -f on_term
trap external_helper EXIT
FIX
)"
# The third negative holds without a guard of its own: fn_exits reads no
# body facts for a name this file does not define, so it answers no.
expect_rc "19k-d. a trap function that never exits (even through a call cycle), a TERM trap function that exits, and a function this file does not define are not violations" 0 \
  "$(run_gate "$d_fn_trap_ok")" "5 function(s) across 1 file(s) are frozen"

# ---- 19h. an array literal holds words, it does not run them ------------------
# `arr=(alias fail=1)` stores two strings; nothing is aliased (the fifth board
# round's architect seat measured the word rule flagging exactly this).
d_array="$(mkfixture array-literal <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
build() {
  local -a arr=(alias fail=1 "x)" 'y)')
  arr+=(shopt -s expand_aliases)
  declare -a nested=( (alias) fail=: )
  echo "${arr[@]}" "${nested[@]}"
}
readonly -f build
FIX
)"
expect_rc "19h. words inside an array literal (NAME=( ), NAME+=( ), with quoted parens inside) are not violations" 0 \
  "$(run_gate "$d_array")" "2 function(s) across 1 file(s) are frozen"

# ---- 19i. a command substitution inside an array element still runs -----------
# `arr=($(alias fail=:))` stores the output of a command that executes; the
# sixth board round found the array-literal skip swallowing it (and a quoted
# `"$( )"` element corrupting the quote stack into a parse error).
d_array_sub="$(mkfixture array-substitution <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
build() {
  local -a arr=($(alias fail=:))
  local -a quoted=("$(alias pass=:)" "x)" 'y)')
  echo "${arr[@]}" "${quoted[@]}"
}
readonly -f build
FIX
)"
expect_rc "19i. an alias inside a \$( ) array element, bare or double-quoted, is reported and the array still closes" 1 \
  "$(run_gate "$d_array_sub")" "2 violation(s)" "'alias fail=:'" "'alias pass=:'"

# ---- 20. whitespace inside the parens is still a definition ---------------------
# `fail ( ) {` is a real, freezable function; a derivation that only matched
# `()` left it invisible, and an invisible helper is an unfrozen one the gate
# reports as fine (fifth board round, security seat).
d_spaced="$(mkfixture spaced-parens <<'FIX'
pass ( ) { echo "  PASS: $1"; }
readonly -f pass
function bad ( ) {
  echo "  FAIL: $1"
}
readonly -f bad
fail (	) {
  echo "  FAIL: $1"
}
FIX
)"
expect_rc "20. 'name ( ) {' and 'function name ( ) {' are derived like 'name() {' — the unfrozen one is reported" 1 \
  "$(run_gate "$d_spaced")" "1 violation(s)" "fixture.test.sh:7: fail() is not frozen"
spaced_list="$(FN_FREEZE_DIRS="$d_spaced" bash "$GATE" --list 2>&1 | cut -f2,5 | tr '\t\n' '  ')"
if [ "$spaced_list" = "pass frozen bad frozen fail unfrozen " ]; then
  pass "20b. --list derives all three spaced spellings with their names"
else
  fail "20b. --list derived: '$spaced_list'"
fi

# ---- 21. the brace group may open on the next line ----------------------------
# `fail()` newline `{` is a real definition (sixth board round: it was invisible,
# so an unfrozen helper written that way passed). Blank and comment lines may
# sit between the opener and the brace; a one-line `{ ...; }` closes at once.
d_brace_next="$(mkfixture brace-next-line <<'FIX'
pass()
{
  echo "  PASS: $1"
}
readonly -f pass
helper() # the brace follows a comment and a blank line

{ :; }
readonly -f helper
function bad
{
  echo "  FAIL: $1"
}
FIX
)"
expect_rc "21. a definition whose brace opens on a later line is derived; the unfrozen one is reported with its real lines" 1 \
  "$(run_gate "$d_brace_next")" "1 violation(s)" "fixture.test.sh:10: bad() is not frozen — add 'readonly -f bad' on line 14"

# ---- 22. a trailing comment does not keep a one-line definition open ----------
# `fail() { ...; } # note` closes on its own line. When the comment text was
# taken as the line's end the definition stayed open, and every real
# definition after it was swallowed into a phantom body (sixth board round).
d_trailing="$(mkfixture trailing-comment <<'FIX'
pass() { echo "  PASS: $1"; } # counts; the "}" in this string is text
readonly -f pass
helper() {
  :
}
FIX
)"
expect_rc "22. a one-liner with a trailing comment closes on its line, so the helper after it is derived and reported" 1 \
  "$(run_gate "$d_trailing")" "1 violation(s)" "fixture.test.sh:3: helper() is not frozen"

# ---- 23. a body that is not a brace group is reported, never skipped ----------
# Bash accepts any compound command as a function body. The derivation follows
# brace groups only; a subshell body or a bare `if` is a definition it cannot
# see the end of, and a definition it cannot see is one it must report.
d_unsupported="$(mkfixture unsupported-body <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
fail() ( echo "  FAIL: $1" )
function guard if true; then :; fi
FIX
)"
expect_rc "23. a subshell body and a bare compound body are reported as unsupported, not lost" 1 \
  "$(run_gate "$d_unsupported")" "2 violation(s)" "fixture.test.sh:3: fail() has a body this gate cannot follow" "fixture.test.sh:4: guard() has a body this gate cannot follow"
unsupported_list="$(FN_FREEZE_DIRS="$d_unsupported" bash "$GATE" --list 2>&1 | cut -f2,5 | tr '\t\n' '  ')"
if [ "$unsupported_list" = "pass frozen fail unsupported guard unsupported " ]; then
  pass "23b. --list carries the unsupported rows"
else
  fail "23b. --list derived: '$unsupported_list'"
fi

# ---- 24. an escaped quote inside $'...' does not end the string ----------------
# `$'it\'s a # test'` is one ANSI-C string; when the comment strip read the
# `\'` as the closing quote, the later `#` became a comment, the one-liner
# stayed open, and every definition after it was swallowed (seventh board
# round, architect seat). The correctly frozen helper after it must be derived.
d_ansi="$(mkfixture ansi-c-quote <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
weird() { echo $'it\'s a # test'; }
readonly -f weird
fail() { echo "  FAIL: $1"; }
readonly -f fail
plain() { echo 'no escapes here \' "#"; }
readonly -f plain
FIX
)"
expect_rc "24. a one-liner holding \$'...' with an escaped quote and a later # closes on its line, and the helpers after it are derived" 0 \
  "$(run_gate "$d_ansi")" "4 function(s) across 1 file(s) are frozen"

# ---- 25. a column-0 definition inside a multi-line ( ) or $( ) is not top-level --
# It defines a subshell-local function nothing in the enclosing script can
# freeze; reporting it as unfrozen was a false positive (seventh board round,
# infra seat). The freeze after the block still resolves the real definition.
d_subshell="$(mkfixture subshell-def <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
out="$(
foo() {
  echo hi
}
foo
)"
(
bar() { echo "$out"; }
bar
)
fail() { echo "  FAIL: $1"; }
readonly -f fail
FIX
)"
expect_rc "25. definitions at column 0 inside a multi-line \$( ) or ( ) block are subshell-local and not derived; the real helpers around them are" 0 \
  "$(run_gate "$d_subshell")" "2 function(s) across 1 file(s) are frozen"

# ---- 24b. a $( ) nested in a double-quoted string is one string to the body rule --
# `decoy() { echo "a $(echo "b #c") d"; }` closes on its line. A second,
# narrower scanner read the nested quote as the end of the outer string, took
# the # as a comment, and left the one-liner open; the helper after it was
# never derived (eighth board round, architect seat). The body rule now reads
# the same lexer the rest of the gate uses.
d_nested_dq="$(mkfixture nested-dq <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
decoy() { echo "a $(echo "b #c") d"; }
readonly -f decoy
real_helper() {
  :
}
FIX
)"
expect_rc "24b. a one-liner holding \"\$( )\" with a nested quote and a # closes on its line, and the unfrozen helper after it is reported" 1 \
  "$(run_gate "$d_nested_dq")" "1 violation(s)" "fixture.test.sh:5: real_helper() is not frozen"
nested_dq_list="$(FN_FREEZE_DIRS="$d_nested_dq" bash "$GATE" --list 2>&1 | cut -f2,5 | tr '\t\n' '  ')"
if [ "$nested_dq_list" = "pass frozen decoy frozen real_helper unfrozen " ]; then
  pass "24c. --list derives all three definitions around the nested-quote one-liner"
else
  fail "24c. --list derived: '$nested_dq_list'"
fi

# ---- 26. a function named after a builtin shadows it; enable switches it off --
# `readonly() { return 0; }` makes every later freeze a no-op and `exit() {
# return 0; }` makes the final verdict a no-op (eighth board round, security
# seat). Prove both in this bash, then that the gate reports every spelling
# at any depth, and never the names as arguments.
readonly_probe="$(bash -c 'readonly() { return 0; }; f() { echo REAL; }; readonly -f f; f() { echo FAKE; }; f' 2>&1)"
if [ "$readonly_probe" = "FAKE" ]; then
  pass "26-probe-a. in this bash a readonly() function makes a later 'readonly -f' a no-op (the gate must refuse it)"
else
  fail "26-probe-a. the readonly() shadow probe did not neuter the freeze (got '$readonly_probe')"
fi
exit_probe="$(bash -c 'exit() { return 0; }; exit 3; echo "still-here rc=$?"' 2>&1)"
if [ "$exit_probe" = "still-here rc=0" ]; then
  pass "26-probe-b. in this bash an exit() function makes 'exit 3' a no-op (the gate must refuse it)"
else
  fail "26-probe-b. the exit() shadow probe did not neuter exit (got '$exit_probe')"
fi
d_builtin="$(mkfixture builtin-shadow <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
readonly() { return 0; }
readonly -f readonly
function exit { return 0; }
readonly -f exit
wrap() {
  test ( ) { :; }
  [() { :; }
  enable -n readonly
  \enable exit
}
readonly -f wrap
FIX
)"
expect_rc "26. a definition named after a builtin — name(), name ( ), function name, at column 0 or nested — and an enable command are violations" 1 \
  "$(run_gate "$d_builtin")" "6 violation(s)" "fixture.test.sh:3: 'readonly()'" "fixture.test.sh:5: 'function exit'" "fixture.test.sh:8: 'test()'" "fixture.test.sh:9: '[()'" "fixture.test.sh:10: 'enable'" "fixture.test.sh:11: 'enable'"
d_builtin_words="$(mkfixture builtin-words <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
helper_exit() { :; }
readonly -f helper_exit
echo enable readonly exit "test()" 'readonly() { :; }'
readonly -a NAMES=(enable exit)
FIX
)"
expect_rc "26b. builtin names as arguments, in strings, in an array literal, or as a prefix of a longer name are not violations" 0 \
  "$(run_gate "$d_builtin_words")" "2 function(s) across 1 file(s) are frozen"

# ---- 27. << inside (( )) and $(( )) is a shift, not a heredoc --------------------
# `if (( 1 << 2 == 4 ))` read the 2 as a heredoc delimiter and swallowed the
# rest of the file, so the frozen helper was reported unfrozen and the run
# ended in a bogus parse error (eighth board round, infra seat).
d_arith="$(mkfixture arithmetic-shift <<'FIX'
fail() {
  if (( 1 << 2 == 4 )); then :; fi
  local x=1; (( x <<= 1 )); (( x >>= 1 ))
  y=$(( (x >> 1) << 2 ))
  echo "$(( 1 << 3 ))" "$1"
}
readonly -f fail
decoy5() { echo bad; }
fail "boom"
FIX
)"
expect_rc "27. shift operators inside (( )), \$(( )) and a nested ( ) are not heredocs, so the frozen helper stays frozen and the decoy after it is reported" 1 \
  "$(run_gate "$d_arith")" "1 violation(s)" "fixture.test.sh:8: decoy5() is not frozen"

# ---- 27b. << inside the deprecated $[ ] is a shift too ------------------------
# `x=$[1 << 2]` opened a phantom heredoc with delimiter `2]`; a later
# column-0 `2]` closed it, so an `alias fail=:` between them was heredoc text
# and the file passed (ninth board round, infra seat).
d_arith_br="$(mkfixture arithmetic-bracket <<'FIX'
fail() {
  local x=$[1 << 2]
  echo "$x $1"
}
readonly -f fail
alias fail=:
2]
fail "boom"
FIX
)"
expect_rc "27b. a shift inside \$[ ] is not a heredoc, so the alias after it is reported" 1 \
  "$(run_gate "$d_arith_br")" "1 violation(s)" "fixture.test.sh:6: 'alias fail=:'"

# ---- 27c. $(( )) inside an array literal is arithmetic too -----------------------
# Without its own opener in the array branch, `$((` would be read as `$(`
# followed by a plain `(` in a command context, where `<<` opens a heredoc.
d_arith_arr="$(mkfixture arithmetic-array <<'FIX'
fail() {
  local -a sizes=($(( 1 << 2 )) 8)
  echo "${sizes[@]} $1"
}
readonly -f fail
decoy6() { echo bad; }
fail "boom"
FIX
)"
expect_rc "27c. a shift inside \$(( )) in an array literal is not a heredoc, so the decoy after it is reported" 1 \
  "$(run_gate "$d_arith_arr")" "1 violation(s)" "fixture.test.sh:6: decoy6() is not frozen"

# ---- 28. every top-level definition the freeze rule cannot see is reported ----
# ` fail() { :; }` indented by one space, with nothing enclosing it, redefines
# fail exactly like a column-0 line; the gate saw neither definition (eleventh
# board round, security seat). Prove it in this bash, then that the lexer
# reports every placement the column-0 rule cannot tie to a freeze line.
indent_probe="$(bash -c ' fail() { echo REAL; }
 fail() { echo FAKE; }
fail' 2>&1)"
if [ "$indent_probe" = "FAKE" ]; then
  pass "28-probe. in this bash an indented top-level redefinition takes the name"
else
  fail "28-probe. the indented redefinition probe did not rebind (got '$indent_probe')"
fi
d_shape="$(mkfixture def-shape <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
 fail() { echo "  FAIL: $1"; }
 fail() { :; }
true; helper() { :; }
one() { :; }; two() { :; }
readonly -f one
my-helper() { :; }
case "$1" in
  x) arm() { :; } ;;
esac
	function tabbed { :; }
wrap() {
  inner() { :; }
}
readonly -f wrap
out="$(sub() { :; }; sub)"
( scoped() { :; }; scoped )
FIX
)"
expect_rc "28. top-level indented, after-a-command, second-on-a-line and dashed definitions are reported; case-arm, body- and subshell-local ones are not" 1 \
  "$(run_gate "$d_shape")" "6 violation(s)" "fixture.test.sh:3: 'fail()'" "fixture.test.sh:4: 'fail()'" "fixture.test.sh:5: 'helper()'" "fixture.test.sh:6: 'two()'" "fixture.test.sh:8: 'my-helper()'" "fixture.test.sh:12: 'function tabbed'"
if printf '%s' "$(run_gate "$d_shape")" | grep -q "'arm()'"; then
  fail "28c. the definition inside a case arm was reported, but a case arm is nested"
else
  pass "28c. the definition inside a case arm is nested, so it is not reported"
fi
shape_list="$(FN_FREEZE_DIRS="$d_shape" bash "$GATE" --list 2>&1 | awk -F'\t' '$5 == "frozen" { printf "%s ", $2 }')"
if [ "$shape_list" = "pass one wrap " ]; then
  pass "28b. --list still derives the three column-0 definitions around them as frozen"
else
  fail "28b. --list frozen rows: '$shape_list'"
fi

# ---- 28d. nesting is counted by command word, not by layout ---------------------
# A block closed on the same line, a keyword used as an argument, and a
# one-line function body must all leave the depth where it was, or a later
# top-level indented definition would be wrongly treated as nested.
d_depth="$(mkfixture nesting-depth <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
if true; then :; fi
for x in a b; do :; done
case "$1" in *) : ;; esac
{ :; }
echo if do case {
one() { if true; then :; fi; }
readonly -f one
two() {
  if true; then
    :
  fi
}
readonly -f two
 hidden() { :; }
FIX
)"
expect_rc "28d. after same-line blocks, keywords as arguments, a one-line body and a multi-line body, an indented top-level definition is still reported" 1 \
  "$(run_gate "$d_depth")" "1 violation(s)" "fixture.test.sh:16: 'hidden()'"

# ---- 29. text after a closing brace, and a same-name second definition ------
# Twelfth board round, security seat: the rest of a column-0 closing-brace
# line was never lexed, so `}; alias fail=:` and `}; decoy() { ...; }` were
# invisible; and a second `fail()` on the line of a one-line `fail()` shared
# its name with the derived definition, so it was excused as that one. Prove
# the redefinition takes the name in this bash first, so the case cannot pass
# against a shape bash would not honour.
redef_probe="$(bash -c 'fail() { echo REAL; }; fail() { echo FAKE; }; readonly -f fail; fail' 2>&1)"
if [ "$redef_probe" = "FAKE" ]; then
  pass "29-probe. in this bash a same-line second definition takes the name before the freeze"
else
  fail "29-probe. the same-line redefinition probe did not rebind (got '$redef_probe')"
fi
d_after="$(mkfixture after-brace <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
fail() {
  echo "  FAIL: $1"
}; shopt -s expand_aliases; alias fail=:
readonly -f fail
ok() {
  :
}; decoy() { :; }
readonly -f ok
bad() { echo "  BAD: $1"; }; bad() { :; }
readonly -f bad
FIX
)"
expect_rc "29. an alias and a definition after a closing brace, and a same-name second definition on one line, are reported" 1 \
  "$(run_gate "$d_after")" "4 violation(s)" "fixture.test.sh:5: 'shopt -s expand_aliases'" "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:9: 'decoy()'" "fixture.test.sh:11: 'bad()'"
after_list="$(FN_FREEZE_DIRS="$d_after" bash "$GATE" --list 2>&1 | awk -F'\t' '$5 == "frozen" { printf "%s ", $2 }')"
if [ "$after_list" = "pass fail ok bad " ]; then
  pass "29b. the four column-0 definitions are still derived and frozen around them"
else
  fail "29b. --list frozen rows: '$after_list'"
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
