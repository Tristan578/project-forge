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
fail() { echo "  FAIL: $1"; if [ -n "${2:-}" ]; then printf '%s\n' "$2" | sed 's/^/    /'; fi; failed=$((failed + 1)); }
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

# ---- 19l. posix mode turns expand_aliases on, so entering it is a violation ---
# `set -o posix` alone flips expand_aliases on in bash 5.2 (twenty-fourth
# board round, security seat: the gate passed that line while refusing
# `shopt -s expand_aliases`), and so does any assignment of POSIXLY_CORRECT.
# Lines 3 to 15 each enter posix mode and are reported (line 13 names the
# variable around an expansion that is empty; 14 and 15 assign it by
# arithmetic and as a loop variable). Line 16 ends the options before -o,
# line 17 ends them before posix, line 18 is an argument of another command,
# line 19 turns the mode off, and lines 20 to 22 put posix in a statement
# after a set statement, which ends it; none of those is. Line 23 repeats
# line 3 after all of them, so no state they set survives into the next
# statement. Round twenty-five: lines 24 to 28 assign the variable as an
# array, or name it inside an array literal (a default expansion, an
# arithmetic subscript), which the literal's fast path skipped; lines 29 to
# 31 interrupt a set statement with an empty substitution, which did not
# carry the set state across it; line 32 is line 27 in double quotes. All
# are reported; line 33, a plain array, is not. Round twenty-six: line 34
# nests an array literal inside a substitution inside another literal, which
# reset the outer literal's text; it is reported against the outer name.
# The variable rule is deliberately broad (any word naming it, text
# included), because bash can assign a variable from more positions than a
# list would stay complete for; so this file spells the name at run time
# from an expansion that contributes text ($px, which the gate cannot see
# through) wherever the words are executable; only the fixture writes it.
px_head=POSIXLY
px="${px_head}_CORRECT"
d_posix="$(mkfixture posix <<'FIX'
fail() { echo "  FAIL: $1"; }
readonly -f fail
set -o posix
set -eo posix
set -o errexit -o posix
builtin set -o po""six
shopt -s -o posix
POSIXLY_CORRECT=1 :
export POSIXLY_CORRECT=y
declare POSIXLY_CORRECT=
: "${POSIXLY_CORRECT:=1}"
printf -v POSIXLY_CORRECT x
declare POSIX$()LY_CORRECT=1
(( POSIXLY_CORRECT=1 ))
for POSIXLY_CORRECT in 1; do :; done
set -- -o posix
set -e -- posix
echo set -o posix
set +o posix
set -o errexit; echo posix
set -o nounset
echo posix
set -o posix
POSIXLY_CORRECT=(1)
POSIXLY_CORRECT+=(1)
declare -a POSIXLY_CORRECT=(1)
x=(${POSIXLY_CORRECT:=1})
x=([POSIXLY_CORRECT=1]=a)
set -o $() posix
set $() -eo posix
set -o `` posix
x=("${POSIXLY_CORRECT:=1}")
x=(a b)
x=(${POSIXLY_CORRECT:=1} $(y=(b)))
FIX
)"
out_posix="$(run_gate "$d_posix")"
expect_rc "19l. set -o posix in every flag spelling, shopt -s -o posix and any word naming the posix-mode variable are violations" 1 \
  "$out_posix" "24 violation(s)" \
  "fixture.test.sh:3: 'set -o posix'" "fixture.test.sh:4: 'set -eo posix'" "fixture.test.sh:5: 'set -o posix'" \
  "fixture.test.sh:6: 'set -o posix'" "fixture.test.sh:7: 'shopt -s posix'" "fixture.test.sh:8: '$px=1'" \
  "fixture.test.sh:9: '$px=y'" "fixture.test.sh:10: '$px='" \
  "fixture.test.sh:11: '\${$px:=1}'" "fixture.test.sh:12: '$px'" "fixture.test.sh:13: '${px_head%LY}\$()LY_CORRECT=1'" \
  "fixture.test.sh:14: '$px=1'" "fixture.test.sh:15: '$px'" "fixture.test.sh:23: 'set -o posix'" \
  "fixture.test.sh:24: '$px=('" "fixture.test.sh:25: '$px+=('" "fixture.test.sh:26: '$px=('" \
  "fixture.test.sh:27: 'x=(...)'" "fixture.test.sh:28: 'x=(...)'" \
  "fixture.test.sh:29: 'set -o posix'" "fixture.test.sh:30: 'set -eo posix'" "fixture.test.sh:31: 'set -o posix'" \
  "fixture.test.sh:32: 'x=(...)'" "fixture.test.sh:34: 'x=(...)'"
# The fixture's own lines are the subject: each is run in this bash and must
# be reported exactly when it turns expand_aliases on, so a spelling added
# to the fixture is checked against bash rather than against this comment.
posix_checked=0; posix_mismatch=""
for n in $(seq 3 "$(wc -l < "$d_posix/fixture.test.sh")"); do
  line="$(sed -n "${n}p" "$d_posix/fixture.test.sh")"
  [ "$line" = "FIX" ] && continue
  state="$(bash -c "$line"$'\n''shopt -p expand_aliases' 2>/dev/null | tail -n 1)"
  reported=0; grep -q "fixture.test.sh:$n: " <<<"$out_posix" && reported=1
  enables=0; [ "$state" = "shopt -s expand_aliases" ] && enables=1
  [ "$reported" = "$enables" ] || posix_mismatch="$posix_mismatch line $n ($line: bash $state, reported $reported);"
  posix_checked=$((posix_checked + 1))
done
if [ "$posix_checked" -ne 32 ]; then
  fail "19m. expected to check 32 fixture lines against bash, checked $posix_checked" "$out_posix"
elif [ -n "$posix_mismatch" ]; then
  fail "19m. the gate and bash disagree on which lines enter posix mode:$posix_mismatch" "$out_posix"
else
  pass "19m. every fixture line is reported exactly when this bash turns expand_aliases on after it"
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
  "$(run_gate "$d_fn_trap")" "2 violation(s)" "fixture.test.sh:5: 'trap cleanup ... EXIT (names cleanup(), which exits)'" "fixture.test.sh:6: 'trap teardown ... ERR (names teardown(), which exits)'"
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

# ---- 30. reserved words count only unquoted, in command position -----------------
# Twelfth board round, architect seat: a `"}"` case pattern closed the nesting
# count early (a case-arm helper was reported) and a `"{"` pattern left it one
# level high for the rest of the file (a later indented top-level definition
# was never reported). An unquoted `{)` or `if|do)` pattern is the same text.
d_pat="$(mkfixture case-patterns <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
case "$1" in "}") echo close ;; y) arm() { :; } ;; esac
case "$1" in "{") echo open ;; esac
case "$1" in
  {) echo open ;;
  }) echo close ;;
  if|do) echo word ;;
  $(shopt -s expand_aliases)) echo sub ;;
  x) inner() { :; } ;;
esac
depth() {
  case "$1" in
}) echo close ;;
  *) : ;;
  esac
}
readonly -f depth
for ((;;)); do break; done
"{" 2>/dev/null || true
"case" 2>/dev/null || true
"if" alias fail=: 2>/dev/null || true
if true; then
  "}" 2>/dev/null || true
  "fi" 2>/dev/null || true
  nested() { :; }
fi
 hidden() { :; }
FIX
)"
expect_rc "30. case patterns and quoted reserved words leave the count alone; code in a pattern is still lexed" 1 \
  "$(run_gate "$d_pat")" "2 violation(s)" "fixture.test.sh:9: 'shopt -s expand_aliases'" "fixture.test.sh:28: 'hidden()'"
pat_list="$(FN_FREEZE_DIRS="$d_pat" bash "$GATE" --list 2>&1 | awk -F'\t' '$5 == "frozen" { printf "%s ", $2 }')"
if [ "$pat_list" = "pass depth " ]; then
  pass "30b. a column-0 '})' pattern inside a body does not end the body"
else
  fail "30b. --list frozen rows: '$pat_list'"
fi
# Every arm after the first opens with `;;`, `;&` or `;;&`, and no definition
# follows the case, so a drifted count cannot be re-captured by a later one.
d_arms="$(mkfixture case-arms <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
case "$1" in
  x) : ;;
  {) : ;&
  if) : ;;&
  do) : ;;
  y) alias fail=: ;;
esac
 hidden() { :; }
FIX
)"
expect_rc "30c. patterns after ;;, ;& and ;;& are text, and an arm body after its ) is code" 1 \
  "$(run_gate "$d_arms")" "2 violation(s)" "fixture.test.sh:8: 'alias fail=:'" "fixture.test.sh:10: 'hidden()'"

# ---- 30d. extglob groups, a leading paren, and `in` on the next line ------------
# Thirteenth board round (architect, infra, security): an extglob group's own
# `)` ended the pattern early, and `in` on the line after `case WORD` never
# opened the pattern state, so `do)` / `if)` raised the count and hid the
# indented definition at the end. A pattern's optional leading `(` must not
# be taken for a group either, or the arm body would be read as pattern text
# and the alias in it missed.
d_ext="$(mkfixture case-extglob <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
shopt -s extglob
case "$1" in
  @(foo|bar)|do) echo hit ;;
  (if) alias fail=: ;;
  !(x)) : ;;
esac
case "$1"
in
  if) : ;;
  x) : ;;
esac
 hidden() { :; }
FIX
)"
expect_rc "30d. extglob groups, a leading paren and a next-line in keep the pattern state right" 1 \
  "$(run_gate "$d_ext")" "2 violation(s)" "fixture.test.sh:6: 'alias fail=:'" "fixture.test.sh:14: 'hidden()'"
# A `$( )` inside a pattern returns to the pattern when it closes: `|if)`
# after it is still pattern text (thirteenth round, test seat: no fixture
# put pattern text after the subshell, so dropping the restore stayed green).
d_subpat="$(mkfixture case-subshell-pattern <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
case "$1" in
  $(true)|if) : ;;
  *) : ;;
esac
 hidden() { :; }
FIX
)"
expect_rc "30e. pattern text after a subshell inside a pattern is still pattern text" 1 \
  "$(run_gate "$d_subpat")" "1 violation(s)" "fixture.test.sh:7: 'hidden()'"

# ---- 30f. a substitution inside a word keeps the statement it sits in ----------
# Fourteenth board round (architect): `case "$(cmd)" in` reset the statement
# when the substitution opened, so `in` never opened the pattern state and an
# `if)` arm raised the nesting count, hiding the indented definition. The
# shape is in the scanned tree (scripts/__tests__/lib/platform.sh).
d_casesub="$(mkfixture case-substitution <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
case "$(compute_verb)" in
  if) : ;;
  other) : ;;
esac
case $(a)$(b) in
  do) : ;;
esac
 hidden() { :; }
FIX
)"
expect_rc "30f. a case word built from command substitutions still opens the pattern state" 1 \
  "$(run_gate "$d_casesub")" "1 violation(s)" "fixture.test.sh:10: 'hidden()'"

# A trap statement with a substitution among its signals is judged once, when
# it really ends, not also when the substitution opens (valid bash: the
# substitution expands to a further signal name).
d_trapsub="$(mkfixture trap-substitution <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
trap 'exit 0' EXIT $(echo INT)
alias x=$(echo y) fail=:
trap 'exit 0' EXIT $(trap ':' INT; echo TERM)
shopt -s $(echo nullglob) expand_aliases
FIX
)"
expect_rc "30g. a trap or alias statement holding a substitution is judged once, as the whole statement" 1 \
  "$(run_gate "$d_trapsub")" "5 violation(s)" "fixture.test.sh:4: 'alias x=\$()'" "fixture.test.sh:4: 'alias fail=:'" "fixture.test.sh:5: 'trap" "fixture.test.sh:6: 'shopt -s expand_aliases'"

# ---- 30h. every substitution opener resumes the statement it sits in ------------
# Fifteenth board round (test): only the top-level and double-quoted `$(`
# openers were pinned; the other five could lose the statement unnoticed.
# Each line sends one opener through a case word or an array literal whose
# statement goes on to an `if` argument. If the statement is lost at the
# opener, `if` or the pattern opens a nesting level no `fi` closes, and the
# indented definition at the end is hidden.
d_openers="$(mkfixture openers <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
case $((1+1)) in
  if) : ;;
esac
case $[1+1] in
  if) : ;;
esac
case "pre$((1+1))post" in
  if) : ;;
esac
declare -a arr=($((1+1))) if
declare -a arr=($(true)) if
 hidden() { :; }
FIX
)"
expect_rc "30h. \$((, \$[, a quoted \$(( and both array-literal openers keep the statement" 1 \
  "$(run_gate "$d_openers")" "1 violation(s)" "fixture.test.sh:14: 'hidden()'"

# ---- 30i. a substitution that can expand to nothing hides no keyword ---------
# Fifteenth board round (security): `ali$()as` is `alias` to bash, and
# `$(true)` expands to nothing at run time, so a word is judged with its
# substitutions removed. Each line is a real neuter (the round reproduced
# the alias and the DEBUG trap against a frozen `fail` in bash).
d_emptysub="$(mkfixture empty-substitution <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
shopt -s expand$()_aliases
ali$()as fail=:
al$(true)ias fail=:
alias fail$()=:
shopt -s extdeb`true`ug
trap '[[ $BASH_COMMAND != fail\ * ]]' DEBU$()G
trap 'ex$()it 0' EXIT
sh$()opt -s expand_aliases
tr$()ap ':' DEBUG
en$()able -n fail
FIX
)"
expect_rc "30i. a word spelled around an empty substitution is still the guarded word" 1 \
  "$(run_gate "$d_emptysub")" "10 violation(s)" "fixture.test.sh:3: 'shopt -s expand\$()_aliases'" "fixture.test.sh:4: 'alias fail=:'" "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:6: 'alias fail\$()=:'" "fixture.test.sh:7: 'shopt -s extdeb" "fixture.test.sh:8: 'trap ... DEBU\$()G'" "fixture.test.sh:9: 'trap ex" "fixture.test.sh:10: 'shopt -s expand_aliases'" "fixture.test.sh:11: 'trap ... DEBUG'" "fixture.test.sh:12: 'enable'"

# ---- 30j. every kind of expansion, in every guarded position ----------------
# Sixteenth board round (security, test): `${x:+Q}` and an unset `$1` expand
# to nothing just as `$()` does, a comment inside a trap action's `$( )` is
# still an empty substitution when the trap fires, and a trap action's own
# quotes are removed then too. The round also found four positions no case
# exercised: the `-s` flag, the trap signal, the body of a function a trap
# calls, and an empty backtick pair in a trap action.
# Twenty-sixth round: line 4 is also a split violation, because its
# alternate text holds a blank and bash splits it into two words when x is
# set, which no word rule can place (see 30o).
d_expansions="$(mkfixture expansions <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
ali${x:+Q}as fail=:
ali${x:+ Q}as fail=:
shopt -s expand${x:+Q}_aliases
shopt -$()s expand_aliases
trap 'exit 0' EXI$()T
trap 'ex$(#c
)it 0' EXIT
trap 'ex``it 0' EXIT
trap 'e"x"it 0' EXIT
alias fail$1=:
cleanup() { ex$()it 0; }
readonly -f cleanup
trap cleanup EXIT
ali$x"as" fail=:
shopt -s "expand$x"_aliases
trap 'ex$x"it" 0' EXIT
helper() { exit 0; }
readonly -f helper
wrap() { hel$()per; }
readonly -f wrap
trap wrap EXIT
trap 'ex$1it 0' EXIT
FIX
)"
expect_rc "30j. every expansion that can be empty, in every guarded position, is still the guarded word" 1 \
  "$(run_gate "$d_expansions")" "16 violation(s)" "fixture.test.sh:3: 'alias fail=:'" "fixture.test.sh:4: 'alias fail=:'" \
  "fixture.test.sh:4: 'ali\${x:+ Q}as'" \
  "fixture.test.sh:5: 'shopt -s expand\${x:+Q}_aliases'" "fixture.test.sh:6: 'shopt -\$()s expand_aliases'" \
  "fixture.test.sh:7: 'trap exit 0 ... EXIT'" "fixture.test.sh:9: 'trap exit 0 ... EXIT'" "fixture.test.sh:10: 'trap exit 0 ... EXIT'" \
  "fixture.test.sh:11: 'trap exit 0 ... EXIT'" "fixture.test.sh:12: 'alias fail\${1}=:'" "fixture.test.sh:15: 'trap cleanup ... EXIT (names cleanup(), which exits)'" \
  "fixture.test.sh:16: 'alias fail=:'" "fixture.test.sh:17: 'shopt -s expand\${x}_aliases'" "fixture.test.sh:18: 'trap exit 0 ... EXIT'" \
  "fixture.test.sh:23: 'trap wrap ... EXIT (names wrap(), which exits)'" "fixture.test.sh:24: 'trap exit 0 ... EXIT'"

# ---- 30n. a numeric signal is read as its value -----------------------------
# Twenty-first board round (security): bash reads a numeric trap signal as an
# optionally signed decimal between blanks, so every spelling on lines 3 to
# 17 is signal 0 (EXIT) and replaces the exit status (checked in bash 5.2:
# `trap 'echo FIRED' 00; exit 3` prints FIRED). Round twenty-two added the
# minus sign; round twenty-three the blanks bash's legal_number() accepts:
# any whitespace before the number (a space on lines 7, 8 and 11, then line
# 16 a vertical tab, 17 a newline, 18 a tab, 19 a form feed and 20 a
# carriage return: round twenty-four found tab, form feed and carriage
# return unexercised, so dropping any of them from the gate passed) and a
# space or tab after it (lines 12 to 15). After the digits, Linux bash 5.2
# stops there, but the Git for Windows bash on the Windows runner also takes
# a newline (line 21 exited 0 there, job 107713633065), so the gate reads
# every whitespace class as a trailing blank and reports lines 21 to 24 (a
# newline, vertical tab, form feed and carriage return after the zero) on
# every platform. Lines 25 and 26 (signal 10, and signal 1 spelled 01) are
# real signals; line 27, a bare sign, is not a number; line 28 has a blank
# inside it and line 29 is a name with a blank before it, and bash rejects
# both (the gate joins signal words with blanks, so a blank inside a word
# must not split it). None of lines 25 to 29 is reported, and 30n-c runs
# every line in the bash running the suite to check the split against it.
d_numsig="$(mkfixture numeric-signals <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
trap 'exit 0' 00
trap 'exit 0' 000
trap 'exit 0' +0
trap 'exit 0' +00
trap 'exit 0' ' 0'
trap 'exit 0' ' 00'
trap 'exit 0' -0
trap 'exit 0' -00
trap 'exit 0' ' -0'
trap 'exit 0' '0 '
trap 'exit 0' '+0 '
trap 'exit 0' '-00 '
trap 'exit 0' $'0\t'
trap 'exit 0' $'\v0'
trap 'exit 0' $'\n0'
trap 'exit 0' $'\t0'
trap 'exit 0' $'\f0'
trap 'exit 0' $'\r0'
trap 'exit 0' $'0\n'
trap 'exit 0' $'0\v'
trap 'exit 0' $'0\f'
trap 'exit 0' $'0\r'
trap 'exit 0' 10
trap 'exit 0' 01
trap 'exit 0' +
trap 'exit 0' '0 0'
trap 'exit 0' ' EXIT'
FIX
)"
out_numsig="$(run_gate "$d_numsig")"
expect_rc "30n. every signed, zero-padded or blank-surrounded spelling of 0 bash accepts is signal 0" 1 "$out_numsig" "22 violation(s)" \
  "fixture.test.sh:3: 'trap exit 0 ..." "fixture.test.sh:4: 'trap exit 0 ..." "fixture.test.sh:5: 'trap exit 0 ..." \
  "fixture.test.sh:6: 'trap exit 0 ..." "fixture.test.sh:7: 'trap exit 0 ..." "fixture.test.sh:8: 'trap exit 0 ..." \
  "fixture.test.sh:9: 'trap exit 0 ..." "fixture.test.sh:10: 'trap exit 0 ..." "fixture.test.sh:11: 'trap exit 0 ..." \
  "fixture.test.sh:12: 'trap exit 0 ..." "fixture.test.sh:13: 'trap exit 0 ..." "fixture.test.sh:14: 'trap exit 0 ..." \
  "fixture.test.sh:15: 'trap exit 0 ..." "fixture.test.sh:16: 'trap exit 0 ..." "fixture.test.sh:17: 'trap exit 0 ..." \
  "fixture.test.sh:18: 'trap exit 0 ..." "fixture.test.sh:19: 'trap exit 0 ..." "fixture.test.sh:20: 'trap exit 0 ..." \
  "fixture.test.sh:21: 'trap exit 0 ..." "fixture.test.sh:22: 'trap exit 0 ..." "fixture.test.sh:23: 'trap exit 0 ..." \
  "fixture.test.sh:24: 'trap exit 0 ..."
if grep -Eq 'fixture.test.sh:(25|26|27|28|29):' <<<"$out_numsig"; then
  fail "30n-b. real signals and spellings bash rejects are not signal 0" "$out_numsig"
else
  pass "30n-b. real signals and spellings bash rejects are not signal 0"
fi
# The fixture's own lines are the subject: each runs in this bash before an
# exit 3, and a line whose trap replaces that status must be reported. A
# reported line bash rejects is a mismatch too, unless its signal is a zero
# followed by a whitespace escape: those are the gate's deliberate superset
# (the bashes differ there), derived from the line itself, so a spelling
# added above is checked against bash, not a comment.
numsig_checked=0; numsig_mismatch=""; numsig_wide=0
for n in $(seq 3 "$(wc -l < "$d_numsig/fixture.test.sh")"); do
  line="$(sed -n "${n}p" "$d_numsig/fixture.test.sh")"
  bash -c "$line"$'\n''exit 3' >/dev/null 2>&1; rc=$?
  reported=0; grep -q "fixture.test.sh:$n: " <<<"$out_numsig" && reported=1
  overrides=0; [ "$rc" -eq 0 ] && overrides=1
  wide=0; [[ "$line" =~ \$\'[-+]?0+\\[nvfr]\'$ ]] && wide=1
  numsig_wide=$((numsig_wide + wide))
  if [ "$overrides" = 1 ] && [ "$reported" = 0 ]; then
    numsig_mismatch="$numsig_mismatch line $n ($line: bash exit $rc, not reported);"
  elif [ "$overrides" = 0 ] && [ "$reported" = 1 ] && [ "$wide" = 0 ]; then
    numsig_mismatch="$numsig_mismatch line $n ($line: bash exit $rc, reported);"
  fi
  numsig_checked=$((numsig_checked + 1))
done
if [ "$numsig_checked" -ne 27 ]; then
  fail "30n-c. expected to check 27 fixture lines against bash, checked $numsig_checked" "$out_numsig"
elif [ "$numsig_wide" -ne 4 ]; then
  fail "30n-c. expected 4 trailing-whitespace lines in the fixture, found $numsig_wide" "$out_numsig"
elif [ -n "$numsig_mismatch" ]; then
  fail "30n-c. the gate and bash disagree on which traps replace the exit status:$numsig_mismatch" "$out_numsig"
else
  pass "30n-c. every fixture line whose trap replaces the exit status in this bash is reported, and no other outside the trailing-whitespace superset"
fi

# ---- 30o. text a parameter expansion carries is judged ------------------------
# Twenty-sixth board round (security): a default (:- - := =), an alternate
# (:+ +) or a replacement (/pat/TEXT) yields its literal TEXT in some state
# the gate cannot see, so it is judged both ways, empty and TEXT (30o-b
# proves in bash that the shapes bind). Lines 3 to 15 spell a guarded word
# that way, nested (11), after a subscript (12), quoted inside (13) or as a
# replacement (6, 14). Line 16 holds a blank, which bash splits into words
# (a split violation), and line 17 is a set statement whose brace group
# passes the enumeration cap (a brace violation). Lines 18 to 21 are an
# argument, an assignment, a trap action with a blank and a quoted argument,
# and none is reported. Line 24 calls a function that exits through a trap
# action whose candidates repeat the call, and is reported once; line 25 is
# a trap action with more alternatives than the gate enumerates (a brace
# violation). Round twenty-seven: lines 26 to 28 escape or quote a slash in
# a replacement pattern (all three bind in bash), which the first-slash
# split read as part of the text; line 29 opens a multi-line array whose
# element names the posix-mode variable on line 30, and the report is on
# line 29, where the array is named. Lines 32 to 35 put a quoted or escaped
# closing brace in the operand (the lexer counted it and closed the group
# early, and the stray quote swallowed the real alias); the decoy quote in
# each comment is what let the file still parse. Line 36 puts a quoted brace
# in one operand, which must stay literal so the default after it is still
# judged. Lines 37 and 38 escape a quote outside quotes and inside an
# ANSI-C string, where miscounting would open a string that swallows the
# alias; line 39 is replacement text that is only the word after its
# quotes are removed. Line 40 escapes the dollar, so its braces are text,
# and bash runs a command literally named ${y:-alias}: not reported (30o-e).
# Line 41 has a comma in the operand, which bash keeps (it runs a command
# named a,alias): a comma read as alternation would invent the word alias,
# so it too is not reported (30o-e), nor is line 44, the same comma escaped
# with a backslash. Lines 42 and 43 put a bracket inside a
# nested expansion in an array subscript (round twenty-eight), which cut the
# subscript short and dropped the whole operand. Lines 45 to 50 open an
# array whose element, after a substitution that opens its own array on
# line 46, names the posix-mode variable: the report names line 45, the
# outer array, so the line survives the substitution. Lines 51 to 54 hold a
# closing brace inside a command substitution (lines 55 and 56 add a
# single-quoted and an escaped paren, line 54 an escaped backtick), which
# ends nothing to bash: each operand holds a blank, so each
# is a split violation named by the whole word, not cut at the inner brace.
# Line 57 puts an ANSI-C string with an escaped quote and a paren inside a
# substitution in an array subscript (round twenty-nine): read as a plain
# single quote, the escaped quote closed it, the paren after it ended the
# substitution early, and the stray quote swallowed the alias statement.
# Lines 58 and 59 nest a substitution (then a backtick span) inside double
# quotes inside it, holding one double quote: read as quote text rather
# than as its own unit, that quote closed the string and swallowed the rest.
d_pexp="$(mkfixture param-expansion <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
shopt -s ${n:-expand_aliases}
${n:-alias} fail=:
shopt -s ${HOME:+expand_aliases}
${x/*/alias} fail=:
trap 'exit 0' ${n:-EXIT}
trap '${n:-exit} 0' EXIT
set -o ${n:=posix}
${a:-al}${b:+ias} fail=:
al${a:-${b:-i}}as fail=:
${a[0]:-alias} fail=:
shopt -s ${x:-"expand_aliases"}
shopt -s ${x//a/extdebug}
trap : ${n-DEBUG}
${x:- alias} fail=:
set -o {z0,z1,z2,z3,z4,z5,z6,z7,z8,z9,z10,z11,z12,z13,z14,z15,z16,z17,z18,z19,z20,z21,z22,z23,z24,z25,z26,z27,z28,z29,z30,z31,z32,z33,z34,z35,z36,z37,z38,z39,z40,z41,z42,z43,z44,z45,z46,z47,z48,z49,z50,z51,z52,z53,z54,z55,z56,z57,z58,z59,z60,z61,z62,z63,posix}
echo ${1:-alias} fail=:
x=${n:-alias}
trap 'rm -f "${TMP:-/tmp/a b}"' EXIT
cp "${src:-a b}" x
finish() { exit 0; }
readonly -f finish
trap 'finish ${x:-y}' EXIT
trap '${a:-x}${b:-x}${c:-x}${d:-x}${e:-x}${f:-x}${g:-x} 0' EXIT
${x/a\/b/alias} fail=:
${x/"a/b"/alias} fail=:
${x//a\/b/alias} fail=:
y=(
  ${POSIXLY_CORRECT:=1}
)
: ${x:-"}"}; shopt -s expand_aliases # decoy: "
: ${x:-'}'}; alias fail=: # decoy: '
: ${x:-\}}; alias fail=: # decoy: "
: ${x:-$'}'}; alias fail=: # decoy: '
${x:-"}"}${y:-alias} fail=:
: ${x:-\"}; alias fail=: # decoy: "
: ${x:-$'\''}; alias fail=: # decoy: '
${x/a/"alias"} fail=:
${x:-\${y:-alias}} fail=:
${x:-a,alias} fail=:
${arr1[${y:-0]0}]:-shopt -s expand_aliases}
${arr2[${y:-0]0}]:-alias fail=:}
${x:-a\,alias} fail=:
x=(
$(y=(
1
))
${POSIXLY_CORRECT:=1}
)
${x:-$(echo }) alias}
${x:-`echo }` alias}
${x:-$(echo ")}") alias}
${x:-`echo a\`b}` alias}
${x:-$(echo ')}') alias}
${x:-$(echo \)}) alias}
: ${arr[$(echo $'a\'bc)de')]}; alias fail=:
: ${arr[$(echo "$(echo '"')")]}; alias fail=:
: ${arr[$(echo "`echo '"'`")]}; alias fail=:
FIX
)"
out_pexp="$(run_gate "$d_pexp")"
expect_rc "30o. a default, alternate or replacement that can spell a guarded word is judged as that word" 1 "$out_pexp" "41 violation(s)" \
  "fixture.test.sh:3: 'shopt -s \${n:-expand_aliases}'" "fixture.test.sh:4: 'alias fail=:'" \
  "fixture.test.sh:5: 'shopt -s \${HOME:+expand_aliases}'" "fixture.test.sh:6: 'alias fail=:'" \
  "fixture.test.sh:7: 'trap exit 0 ... EXIT'" "fixture.test.sh:8: 'trap exit 0 ... EXIT'" \
  "fixture.test.sh:9: 'set -o \${n:=posix}'" "fixture.test.sh:10: 'alias fail=:'" "fixture.test.sh:11: 'alias fail=:'" \
  "fixture.test.sh:12: 'alias fail=:'" "fixture.test.sh:13: 'shopt -s \${x:-\"expand_aliases\"}'" \
  "fixture.test.sh:14: 'shopt -s \${x//a/extdebug}'" "fixture.test.sh:15: 'trap ... \${n-DEBUG}'" \
  "fixture.test.sh:16: '\${x:- alias}' — this parameter expansion" "fixture.test.sh:17: '{z0,z1," \
  "fixture.test.sh:24: 'trap finish" "fixture.test.sh:25: '\${a:-x}\${b:-x}" \
  "fixture.test.sh:26: 'alias fail=:'" "fixture.test.sh:27: 'alias fail=:'" "fixture.test.sh:28: 'alias fail=:'" \
  "fixture.test.sh:29: 'y=(...)'" "fixture.test.sh:32: 'shopt -s expand_aliases'" \
  "fixture.test.sh:33: 'alias fail=:'" "fixture.test.sh:34: 'alias fail=:'" "fixture.test.sh:35: 'alias fail=:'" \
  "fixture.test.sh:36: 'alias fail=:'" "fixture.test.sh:37: 'alias fail=:'" "fixture.test.sh:38: 'alias fail=:'" \
  "fixture.test.sh:39: 'alias fail=:'" "fixture.test.sh:42: '\${arr1[" "fixture.test.sh:43: '\${arr2[" "fixture.test.sh:45: 'x=(...)'" \
  "fixture.test.sh:51: '\${x:-\$(echo }) alias}'" "fixture.test.sh:52: '\${x:-\`echo }\` alias}'" \
  "fixture.test.sh:53: '\${x:-\$(echo \")}\") alias}'" "fixture.test.sh:54: '\${x:-\`echo a\\\`b}\` alias}'" \
  "fixture.test.sh:55: '\${x:-\$(echo ')}') alias}'" "fixture.test.sh:56: '\${x:-\$(echo \\)}) alias}'" \
  "fixture.test.sh:57: 'alias fail=:'" "fixture.test.sh:58: 'alias fail=:'" "fixture.test.sh:59: 'alias fail=:'"
if grep -Eq 'fixture.test.sh:(18|19|20|21):' <<<"$out_pexp"; then
  fail "30o-c. an argument, an assignment, a trap action and a quoted argument with expansion text are not reported" "$out_pexp"
else
  pass "30o-c. an argument, an assignment, a trap action and a quoted argument with expansion text are not reported"
fi
if grep -Eq 'fixture.test.sh:(40|41|44): ' <<<"$out_pexp"; then
  fail "30o-e. an escaped dollar and a comma in an operand are text, not a nested expansion or alternation" "$out_pexp"
else
  pass "30o-e. an escaped dollar and a comma in an operand are text, not a nested expansion or alternation"
fi
if [ "$(grep -c 'fixture.test.sh:24: ' <<<"$out_pexp")" -eq 1 ]; then
  pass "30o-d. a trap whose action candidates repeat a call reports that call once"
else
  fail "30o-d. a trap whose action candidates repeat a call reports that call once" "$out_pexp"
fi
# The shapes bind for real in this bash, so the rule guards measured bypasses.
pexp_alias="$(bash -c 'fail() { echo REAL; }; readonly -f fail; shopt -s ${n:-expand_aliases}; ${HOME:+alias} fail="echo ALIASED"; eval fail' 2>&1)"
pexp_split="$(bash -c 'fail() { echo REAL; }; readonly -f fail; shopt -s expand_aliases; ${x:- alias} fail="echo ALIASED"; eval fail' 2>&1)"
bash -c 'trap "exit 0" ${n:-EXIT}; exit 3' >/dev/null 2>&1; pexp_trap=$?
pexp_posix="$(bash -c 'set -o ${n:=posix}; shopt -p expand_aliases' 2>&1)"
pexp_quote="$(bash -c 'fail() { echo REAL; }; readonly -f fail; : ${x:-"}"}; shopt -s expand_aliases; alias fail="echo ALIASED"
eval fail' 2>&1)"
pexp_ansi="$(bash 2>&1 <<'PROBE'
fail() { echo REAL; }
readonly -f fail
declare -A arr
shopt -s expand_aliases
: ${arr[$(echo $'a\'bc)de')]}; alias fail="echo ALIASED"
eval fail
PROBE
)"
if [ "$pexp_alias" = "ALIASED" ] && [ "$pexp_split" = "ALIASED" ] && [ "$pexp_trap" -eq 0 ] && [ "$pexp_posix" = "shopt -s expand_aliases" ] && [ "$pexp_quote" = "ALIASED" ] && [ "$pexp_ansi" = "ALIASED" ]; then
  pass "30o-b. a default, an alternate and a split default bind an alias, trap EXIT and enter posix mode in this bash"
else
  fail "30o-b. a probe did not reproduce (alias '$pexp_alias', split '$pexp_split', trap rc $pexp_trap, posix '$pexp_posix', quoted brace '$pexp_quote', ANSI-C in a subscript '$pexp_ansi')"
fi

# ---- 30p. a parameter expansion that closes on a later line is refused ------
# Thirtieth board round (architect): the gate reads a ${...} group one line at
# a time, and bash lets the closing brace sit on a later line. Line 3 enabled
# alias expansion with the gate green. A group left open at the end of its
# line is now a multiline violation wherever it stands (line 5 is an argument
# of :), since the text past the line end cannot be judged. Lines 7 and 8 are
# the same group on one line, and in quotes across two lines (judged whole,
# since a quote carries across lines), so neither is a multiline violation.
d_multi="$(mkfixture multiline-expansion <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
shopt -s ${x:-expand_aliases
}
: ${x:-a
}
: ${x:-a}
: "${x:-a
}"
FIX
)"
out_multi="$(run_gate "$d_multi")"
expect_rc "30p. a \${...} group that closes on a later line is a multiline violation" 1 "$out_multi" "2 violation(s)" \
  "fixture.test.sh:3: '\${x:-expand_aliases' — this \${...} group does not close on the line it opens on" \
  "fixture.test.sh:5: '\${x:-a' — this \${...} group does not close"
multi_bash="$(bash -c 'shopt -s ${x:-expand_aliases
}; shopt -p expand_aliases' 2>&1)"
if [ "$multi_bash" = "shopt -s expand_aliases" ]; then
  pass "30p-b. a default whose closing brace is on the next line enables alias expansion in this bash"
else
  fail "30p-b. the multi-line default did not reproduce in this bash (got '$multi_bash')"
fi

# ---- 30q. a definition line closes where bash closes its brace group --------
# Thirty-second board round (security): a one-line body followed by more code
# (line 3) did not end in a brace, so the definition stayed open until a later
# column-0 brace and every definition in between (evil, lines 4 to 6) was never
# derived. A group now closes on its line when its brace closes in command
# position, whatever follows. The reverse also holds: a brace that is only an
# argument (line 8, echo }) closes nothing, so the freeze on line 9 runs inside
# f and f is unfrozen, as it is in bash. Line 11 closes its group and then
# opens an if on the same line. 30q-b checks the line-8 shape in bash.
d_close="$(mkfixture definition-close <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
noop() { :; }; true
evil() {
  echo pwned
}
readonly -f evil
f() { echo }
readonly -f f
}
g() { :; }; if true; then
  :
fi
readonly -f g
FIX
)"
out_close="$(run_gate "$d_close")"
expect_rc "30q. a definition closes where its brace closes in command position, whatever follows it" 1 "$out_close" \
  "4 violation(s)" "(5 definition(s) derived)" \
  "fixture.test.sh:3: noop() is not frozen" "fixture.test.sh:8: f() is not frozen" \
  "fixture.test.sh:11: g() is not frozen" "fixture.test.sh:14: 'readonly -f g'"
close_bash="$(bash -c $'f() { echo }\nreadonly -f f\n}\nf() { echo REDEFINED; }\nf' 2>&1)"
if [ "$close_bash" = "REDEFINED" ]; then
  pass "30q-b. in this bash a brace that is only an argument does not close the group, so the freeze after it never runs"
else
  fail "30q-b. the argument-brace probe did not reproduce in this bash (got '$close_bash')"
fi

# ---- 30s. the brace after fi, done or esac closes a one-line definition -----
# Thirty-third board round (architect): after fi, done or esac the next word
# is in command position, so the brace in h1() { if true; then :; fi } closes
# h1, as bash reads it. The lexer read it as an argument, h1 stayed open, and
# a redefinition of pass after it (as on line 12) was never derived. Lines 3
# to 10 close through fi, done, esac after a double semicolon, and esac after
# a last clause without one; lines 11 to 13 show the swallow is gone. 30s-b
# checks in bash that the brace closes the group.
d_fiesac="$(mkfixture fi-done-esac <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
h1() { if true; then :; fi }
readonly -f h1
h2() { for x in 1; do :; done }
readonly -f h2
h3() { case x in a) :;; esac }
readonly -f h3
h5() { case x in a) :; esac }
readonly -f h5
h4() { if true; then :; fi }
pass() { :; }
readonly -f h4
FIX
)"
out_fiesac="$(run_gate "$d_fiesac")"
expect_rc "30s. the brace after fi, done or esac closes a one-line definition" 1 "$out_fiesac" \
  "3 violation(s)" "(7 definition(s) derived)" \
  "fixture.test.sh:11: h4() is not frozen" "fixture.test.sh:12: pass() is not frozen" \
  "fixture.test.sh:13: 'readonly -f h4'"
fiesac_bash="$(bash -c $'h() { if true; then :; fi }\ng() { echo TOPLEVEL; }\ng' 2>&1)"
if [ "$fiesac_bash" = "TOPLEVEL" ]; then
  pass "30s-b. in this bash the brace after fi closes the group, so the next line is top level"
else
  fail "30s-b. the fi-brace probe did not reproduce in this bash (got '$fiesac_bash')"
fi

# ---- 30t. a bare brace group hides no definition ----------------------------
# Thirty-third board round (security): nesting was counted alike for every
# compound, so a helper defined inside a bare { } group was never derived and
# never had to be frozen, although the group runs its contents once and
# unconditionally, as top level does. Each nesting level now records what
# opened it, and only a function body or a conditional or repeated compound
# hides a definition. Lines 4 and 6 are reported as shape (define at column
# 0, then freeze), and so are the indented definitions on lines 25, 28 and
# 31, one per spelling. A definition nested in each spelling of a function
# body, at column 0 (lines 8, 12, 16) or indented (lines 26, 29, 32), an if
# arm (line 20), a case arm (line 22) and a loop (line 23) is still out of
# scope and not reported: the indented bodies are what tell a function body
# brace from a bare one, since a column-0 body is excluded before its
# nesting is read.
d_bare="$(mkfixture bare-group <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
{
  fail() { :; }
}
{ helper() { :; }; }
outer() {
  inner() { :; }
}
readonly -f outer
function outer2 {
  inner2() { :; }
}
readonly -f outer2
outer3 () {
  inner3() { :; }
}
readonly -f outer3
if true; then
  cond() { :; }
fi
case x in a) incase() { :; } ;; esac
for x in 1; do inloop() { :; }; done
{
  outer4() {
    inner4() { :; }
  }
  function outer5 {
    inner5() { :; }
  }
  outer6 () {
    inner6() { :; }
  }
}
FIX
)"
out_bare="$(run_gate "$d_bare")"
expect_rc "30t. a definition inside a bare brace group is judged as at top level" 1 "$out_bare" \
  "5 violation(s)" "fixture.test.sh:4: 'fail()'" "fixture.test.sh:6: 'helper()'" \
  "fixture.test.sh:25: 'outer4()'" "fixture.test.sh:28: 'function outer5'" \
  "fixture.test.sh:31: 'outer6()'"
if grep -Eq 'fixture.test.sh:(8|12|16|20|22|23|26|29|32):' <<<"$out_bare"; then
  fail "30t-b. a definition nested in a function body, an if or case arm or a loop is not reported" "$out_bare"
else
  pass "30t-b. a definition nested in a function body, an if or case arm or a loop is not reported"
fi

# ---- 30u. the brace and split messages name every statement their guard covers
# Thirty-fourth board round (ux): the brace report said "an alias, shopt or
# trap statement" while its guard also fires in a set statement (30o line 17
# is one), so a contributor hit by it in set -o read an explanation that never
# named set. Both lists are derived from the gate at run time: the in_ flags
# on each guard line, and the statement list in each report line. Each flag
# must be named in its message, and the walk must find at least one flag.
# Thirty-fifth round (dx): the same list, restated in the gate comment above
# the guard and in gotchas-build-ci.md, still lacked set. 30u-b sweeps every
# "alias, shopt ... trap" statement list in the gate and the three docs (line
# breaks and comment markers joined first) and requires every guard flag in
# each; it fails when it finds fewer lists than the five it was written with.
for pair in "brace bx_trunc" "split px_split"; do
  st="${pair%% *}"; fv="${pair#* }"
  # A subshell, so each early exit ends only this pair's check.
  res="$(
    guard="$(grep -E "^[[:space:]]*if \\($fv && " "$GATE")"
    msg="$(grep -E "^[[:space:]]*$st\\)[[:space:]]+echo " "$GATE")"
    if [ "$(grep -c . <<<"$guard")" != 1 ] || [ "$(grep -c . <<<"$msg")" != 1 ]; then
      echo "no unique guard or message for $st"; exit 0
    fi
    msg="$(sed -n 's/.*in a command name or an \([a-z, ]*\) statement.*/\1/p' <<<"$msg")"
    [ -n "$msg" ] || { echo "no statement list in the $st message"; exit 0; }
    n=0; missing=""
    while read -r flag; do
      n=$((n + 1))
      grep -qw "$flag" <<<"$msg" || missing="$missing $flag"
    done < <(grep -oE '\|\| in_[a-z]+' <<<"$guard" | sed 's/.*in_//')
    [ "$n" -gt 0 ] || { echo "no in_ flag found on the $st guard"; exit 0; }
    [ -z "$missing" ] || echo "$st message omits:$missing"
  )"
  if [ -z "$res" ]; then
    pass "30u. the $st message names every statement its guard fires in"
  else
    fail "30u. the $st message names every statement its guard fires in" "$res"
  fi
done
sweep_flags="$(grep -E '^[[:space:]]*if \((bx_trunc|px_split) && ' "$GATE" | grep -oE '\|\| in_[a-z]+' | sed 's/.*in_//' | sort -u)"
sweep_n=0; sweep_bad=""
for doc in "$GATE" "$REPO_ROOT/.claude/rules/hook-testing.md" \
    "$REPO_ROOT/.claude/rules/gotchas-build-ci.md" \
    "$REPO_ROOT/docs/guides/npm-audit-gate-hardening.md"; do
  while read -r list; do
    sweep_n=$((sweep_n + 1))
    while read -r flag; do
      grep -qw "$flag" <<<"$list" || sweep_bad="$sweep_bad ${doc#"$REPO_ROOT"/}: '$list' omits $flag;"
    done <<<"$sweep_flags"
  done < <(tr '\n' ' ' <"$doc" | sed 's/[[:space:]]#[[:space:]]/ /g; s/[[:space:]][[:space:]]*/ /g' |
    grep -oE 'alias, shopt[a-z, ]* (or|and) trap')
done
if [ -z "$sweep_flags" ]; then
  fail "30u-b. every restated guard list names every guard flag" "no in_ flag found on either guard line"
elif [ "$sweep_n" -lt 5 ]; then
  fail "30u-b. every restated guard list names every guard flag" "found $sweep_n lists, fewer than the 5 written"
elif [ -n "$sweep_bad" ]; then
  fail "30u-b. every restated guard list names every guard flag" "$sweep_bad"
else
  pass "30u-b. every restated guard list names every guard flag ($sweep_n lists)"
fi

# ---- 30v. a multi-line body that closes off column 0 is a close violation --
# Thirty-fifth board round (ux): foo closed with an indented brace (line 5),
# so the gate kept it open until the next column-0 brace, which was bar's
# (line 8). It then said foo needed its freeze on line 9 and that bar's own
# freeze was stray, both false. The lexer now sees the group close on any
# body line: off column 0 it is a close violation, and the definition ends
# there, so foo's missing freeze names line 6 and bar is judged alone. The
# same close rule replaces the old ends-in-a-brace test on a line that opens
# a pending brace group: baz (lines 10-11) closes on its brace line although
# code follows, while in qux (lines 13-14) the brace is an argument, so the
# freeze on line 15 is still body and the column-0 brace on line 16 closes
# it. A body still open at EOF (line 18) is a close violation of its own.
d_close2="$(mkfixture close-off-column <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
foo() {
  echo "hi"
  }
bar() {
  echo "bye"
}
readonly -f bar
baz()
{ :; }; true
readonly -f baz
qux()
{ echo }
readonly -f qux
}
readonly -f qux
open() {
  :
FIX
)"
out_close2="$(run_gate "$d_close2")"
expect_rc "30v. a multi-line body that closes off column 0, or never, is a close violation" 1 "$out_close2" \
  "3 violation(s)" "fixture.test.sh:3: foo() closes on line 5, but not with a '}' at column 0" \
  "fixture.test.sh:3: foo() is not frozen — add 'readonly -f foo' on line 6" \
  "fixture.test.sh:18: open() opens a brace group that never closes before the end of the file"
if grep -Eq "readonly -f (bar|baz|qux)' does not|(bar|baz|qux)\(\) is not frozen" <<<"$out_close2"; then
  fail "30v-b. the definitions after an off-column close are judged alone" "$out_close2"
else
  pass "30v-b. the definitions after an off-column close are judged alone"
fi

# ---- 30w. an assignment word is NAME=, NAME+= or a subscripted NAME[...]= ---
# Thirty-fifth board round (architect): only NAME= was skipped as a prefix
# assignment, so in X+=2 alias fail=: the word X+=2 was read as the command
# word and the alias went unreported, while bash binds it (30w-b). The same
# held for a subscripted prefix (bash refuses the subscript and still runs
# the command) and for a trap action whose handler call follows such a
# prefix. Lines 5 to 10 are reported; line 11 was already. Lines 12 to 14,
# 16 and 17 are assignment VALUES, which bash never brace-expands or splits
# into words, so neither a long expansion nor a blank in a default there is
# a violation; line 15 is one in command position.
d_assign="$(mkfixture assignment-words <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
cleanup() { exit 0; }
readonly -f cleanup
X+=2 alias fail=:
a[0]=1 alias f1=:
a[1]+=1 shopt -s expand_aliases
X+=1 set -o posix
trap 'X+=1 cleanup' EXIT
trap 'a[0]=1 cleanup' ERR
X=1 alias ok=:
X+={0..99}{0..9} true
a[0]={0..99}{0..9} true
a[1]+={0..99}{0..9} true
{0..99}{0..9} true
X+=${n:-a b} true
a[0]+=${n:-a b} true
FIX
)"
out_assign="$(run_gate "$d_assign")"
expect_rc "30w. a command after an append or subscripted prefix assignment is judged as the command" 1 "$out_assign" \
  "8 violation(s)" "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:6: 'alias f1=:'" \
  "fixture.test.sh:7: 'shopt -s expand_aliases'" "fixture.test.sh:8: 'set -o posix'" \
  "fixture.test.sh:9: 'trap cleanup ... EXIT" "fixture.test.sh:10: 'trap cleanup ... ERR" \
  "fixture.test.sh:11: 'alias ok=:'" "fixture.test.sh:15: '{0..99}{0..9}'"
if grep -Eq 'fixture.test.sh:(12|13|14|16|17):' <<<"$out_assign"; then
  fail "30w-c. an assignment value is neither brace-expanded nor split, so it is not judged" "$out_assign"
else
  pass "30w-c. an assignment value is neither brace-expanded nor split, so it is not judged"
fi
assign_bash="$(bash -c 'shopt -s expand_aliases; X+=2 alias fail=:; a[0]=1 alias f1=: 2>/dev/null; alias; trap "X+=1 cleanup" EXIT; cleanup() { echo CLEANUP-RAN; }' 2>&1)"
if grep -q "^alias fail=':'$" <<<"$assign_bash" && grep -q "^alias f1=':'$" <<<"$assign_bash" &&
   grep -q '^CLEANUP-RAN$' <<<"$assign_bash"; then
  pass "30w-b. in this bash an append or subscripted prefix still runs the command after it"
else
  fail "30w-b. the prefix-assignment probe did not reproduce in this bash (got '$assign_bash')"
fi

# ---- 30x. the lexer alone decides where a definition ends -------------------
# Thirty-sixth board round. security and architect: a column-0 brace that
# closes only a group nested in the body (line 6) ended foo, so the rest of
# its body, the nested fail() on line 8 included, was read as top level and
# the real closing brace and freeze were misreported; bash closes foo on
# line 9. ux: the definition ended only once its whole closing line was
# lexed, so a definition after the brace on that line (baz on line 13, quux
# on line 15 after a brace-line group) was neither derived nor reported. Now
# the definition ends where its brace closes, mid-line, and the rest of the
# line is judged as top level: baz and quux are shape. 30x-b runs the
# fixture in bash.
d_lexclose="$(mkfixture lexer-close <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
foo() {
{
  echo "inner"
}
echo "after inner group"
fail() { :; }
}
readonly -f foo
bar() {
  :
  }; baz() { :; }
qux()
{ :; }; quux() { :; }
FIX
)"
out_lexclose="$(run_gate "$d_lexclose")"
expect_rc "30x. a definition ends where its brace closes, not at the first column-0 brace" 1 "$out_lexclose" \
  "5 violation(s)" "fixture.test.sh:13: 'baz()'" \
  "fixture.test.sh:11: bar() closes on line 13, but not with a '}' at column 0" \
  "fixture.test.sh:11: bar() is not frozen — add 'readonly -f bar' on line 14" \
  "fixture.test.sh:15: 'quux()'" "fixture.test.sh:14: qux() is not frozen — add 'readonly -f qux' on line 16"
if grep -Eq "fixture.test.sh:(3|8|10):|foo\(\)" <<<"$out_lexclose"; then
  fail "30x-c. a column-0 brace that closes a nested group does not end the definition" "$out_lexclose"
else
  pass "30x-c. a column-0 brace that closes a nested group does not end the definition"
fi
lexclose_bash="$(bash "$d_lexclose/fixture.test.sh" 2>&1; echo "rc=$?")"
if [ "$lexclose_bash" = "rc=0" ]; then
  pass "30x-b. the fixture is valid bash (the nested group and both mid-line closes parse)"
else
  fail "30x-b. the fixture did not run cleanly in this bash (got '$lexclose_bash')"
fi

# ---- 30y. a prefix assignment may carry a nested subscript ------------------
# Thirty-sixth board round (security, architect): the assignment pattern read
# a subscript up to its first closing bracket, so a[b[2]]=1 was taken for the
# command word and the alias after it passed, while bash warns about the
# subscript and still binds the alias (30y-b). The subscript is now matched
# by bracket depth, at every site: lines 3 to 5 and 9 (names holding digits)
# are reported, and line 8, an assignment value, is not.
d_nestsub="$(mkfixture nested-subscript <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
a[b[2]]=1 alias fail=:
a[b[c[0]]]+=1 shopt -s expand_aliases
trap 'a[b[0]]=1 cleanup' EXIT
cleanup() { exit 0; }
readonly -f cleanup
a[b[0]]={0..99}{0..9} true
x2[y3[0]]=1 alias f2=:
FIX
)"
out_nestsub="$(run_gate "$d_nestsub")"
expect_rc "30y. a prefix assignment with a nested subscript is skipped to the command word" 1 "$out_nestsub" \
  "4 violation(s)" "fixture.test.sh:3: 'alias fail=:'" "fixture.test.sh:4: 'shopt -s expand_aliases'" \
  "fixture.test.sh:5: 'trap cleanup ... EXIT" "fixture.test.sh:9: 'alias f2=:'"
nestsub_bash="$(bash -c 'shopt -s expand_aliases; a[b[2]]=1 alias fail=: 2>/dev/null; alias' 2>&1)"
if grep -q "^alias fail=':'$" <<<"$nestsub_bash"; then
  pass "30y-b. in this bash a nested-subscript prefix still runs the command after it"
else
  fail "30y-b. the nested-subscript probe did not reproduce in this bash (got '$nestsub_bash')"
fi

# ---- 30z. a subscript is not parsed ------------------------------------------
# Thirty-seventh board round (security, architect): the bracket-depth scan
# counted brackets in the dequoted word, so a quoted or escaped bracket
# (lines 4 to 7) unbalanced it and the command after the prefix passed, and
# bash also reads a subscript across blanks (line 3), which the lexer splits
# into words. A word starting NAME[ that holds ]= is now an assignment, so
# lines 4 to 7 are judged at their real command word; a command word
# starting NAME[ with more words after it is a subscript violation (line 3,
# and line 12, a harmless assignment the rule reports anyway); and every
# word of an EXIT trap action is a possible call (line 8). Lines 13 and 14
# are an assignment alone and a prefix to true, and line 15 is a command
# named x]=1 to bash (a subscript needs a name before it): none is
# reported. 30z-b runs lines 3 to 7 of the fixture itself in bash and
# checks that each binds.
d_subscr="$(mkfixture subscript <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
a[1 + 1]=5 alias f1=:
a["x]"]=1 alias f2=:
a[']']=1 shopt -s expand_aliases
a[\]]=1 alias f4=:
a['[']=1 alias f5=:
trap 'a[1 + 1]=5 cleanup' EXIT
cleanup() { exit 0; }
readonly -f cleanup
b=1
c[i + 1]=2
c[0]=x
c[1]=y true
x]=1 alias q=:
FIX
)"
out_subscr="$(run_gate "$d_subscr")"
expect_rc "30z. a subscripted prefix is judged at its command word or reported" 1 "$out_subscr" \
  "7 violation(s)" "fixture.test.sh:3: 'a[1' — this statement starts with a subscripted name" \
  "fixture.test.sh:4: 'alias f2=:'" "fixture.test.sh:5: 'shopt -s expand_aliases'" \
  "fixture.test.sh:6: 'alias f4=:'" "fixture.test.sh:7: 'alias f5=:'" \
  "fixture.test.sh:8: 'trap cleanup ... EXIT" "fixture.test.sh:12: 'c[i'"
if grep -Eq 'fixture.test.sh:(11|13|14|15):' <<<"$out_subscr"; then
  fail "30z-c. a subscripted assignment alone or before a plain command, or a ]= word with no name, is not reported" "$out_subscr"
else
  pass "30z-c. a subscripted assignment alone or before a plain command, or a ]= word with no name, is not reported"
fi
subscr_bash="$({ echo 'shopt -u expand_aliases'; sed -n '3,7p' "$d_subscr/fixture.test.sh"
  echo 'shopt -q expand_aliases && echo EXPAND-ON; alias'; } | bash 2>/dev/null)"
if grep -q '^EXPAND-ON$' <<<"$subscr_bash" && grep -q "^alias f1=':'$" <<<"$subscr_bash" &&
   grep -q "^alias f2=':'$" <<<"$subscr_bash" && grep -q "^alias f4=':'$" <<<"$subscr_bash" &&
   grep -q "^alias f5=':'$" <<<"$subscr_bash"; then
  pass "30z-b. in this bash lines 3 to 7 of the fixture (a subscript with a blank, a quoted or an escaped bracket) run the command after it"
else
  fail "30z-b. the subscript probe did not reproduce in this bash (got '$subscr_bash')"
fi

# ---- 30ab. a redirection and its target are not the command word -----------
# Thirty-eighth board round (security): the lexer read a redirection only as
# a word break, so the target of a leading one (lines 3, 6, 7, 9), an fd
# prefix (lines 4 and 8) and the 2 of >&2, which also ended the statement at
# its & (line 5), were each taken for the command word and the guarded
# command after them passed. The operator and its target are now skipped as
# bash skips them, and a substitution in the target (line 9) is lexed as the
# command it is. Lines 10 to 12 are ordinary redirections, and on line 13
# the quoted 2 is a command word to bash, so the alias after it is text:
# none of them is reported. Lines 17 to 24 pin each operator form: a
# substitution in the target (17), an fd before a here-string (18) and a
# heredoc (19), >| (23) and <& (24); on line 22 &> follows echo, so the
# alias words are its arguments and are not reported. In a trap action a
# redirection ends a word too
# (line 16: cleanup>/dev/null calls cleanup, the architect seat). 30ab-b runs
# lines 3 to 8, 13 and 17 to 24 in bash (posix mode, which line 8 enables, lists an
# alias without the word alias).
d_redir="$(mkfixture redirection <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
>/dev/null alias f1=:
2>/dev/null shopt -s expand_aliases
>&2 alias f3=:
&>/dev/null alias f4=:
<<<x alias f5=:
{fd}>/dev/null set -o posix
>$(alias f7=:) true
echo hi >/dev/null
echo ok 2>&1
cat <(echo x) >/dev/null
"2">/dev/null alias f8=:
cleanup() { exit 0; }
readonly -f cleanup
trap 'cleanup>/dev/null' EXIT
>$(echo /dev/null) alias f9=:
0<<<x alias f10=:
0<<EOF alias f11=:
body
EOF
echo &>/dev/null alias f12=:
>|/dev/null alias f13=:
<&0 alias f14=:
FIX
)"
out_redir="$(run_gate "$d_redir")"
expect_rc "30ab. a redirection and its target in front of a guarded command do not hide it" 1 "$out_redir" \
  "13 violation(s)" "fixture.test.sh:3: 'alias f1=:'" "fixture.test.sh:4: 'shopt -s expand_aliases'" \
  "fixture.test.sh:5: 'alias f3=:'" "fixture.test.sh:6: 'alias f4=:'" "fixture.test.sh:7: 'alias f5=:'" \
  "fixture.test.sh:8: 'set -o posix'" "fixture.test.sh:9: 'alias f7=:'" \
  "fixture.test.sh:16: 'trap cleanup ... EXIT" "fixture.test.sh:17: 'alias f9=:'" \
  "fixture.test.sh:18: 'alias f10=:'" "fixture.test.sh:19: 'alias f11=:'" \
  "fixture.test.sh:23: 'alias f13=:'" "fixture.test.sh:24: 'alias f14=:'"
if grep -Eq 'fixture.test.sh:(10|11|12|13|20|21|22):' <<<"$out_redir"; then
  fail "30ab-c. an ordinary redirection, and a quoted 2 that is a command word, are not reported" "$out_redir"
else
  pass "30ab-c. an ordinary redirection, and a quoted 2 that is a command word, are not reported"
fi
redir_bash="$({ echo 'shopt -u expand_aliases'; sed -n '3,8p;13p;17,24p' "$d_redir/fixture.test.sh"
  echo 'shopt -q expand_aliases && echo EXPAND-ON; shopt -qo posix && echo POSIX-ON; alias'; } | bash 2>/dev/null)"
if grep -q '^EXPAND-ON$' <<<"$redir_bash" && grep -q '^POSIX-ON$' <<<"$redir_bash" &&
   grep -Eq "^(alias )?f1=':'$" <<<"$redir_bash" && grep -Eq "^(alias )?f3=':'$" <<<"$redir_bash" &&
   grep -Eq "^(alias )?f4=':'$" <<<"$redir_bash" && grep -Eq "^(alias )?f5=':'$" <<<"$redir_bash" &&
   grep -Eq "^(alias )?f9=':'$" <<<"$redir_bash" && grep -Eq "^(alias )?f10=':'$" <<<"$redir_bash" &&
   grep -Eq "^(alias )?f11=':'$" <<<"$redir_bash" && grep -Eq "^(alias )?f13=':'$" <<<"$redir_bash" &&
   grep -Eq "^(alias )?f14=':'$" <<<"$redir_bash" &&
   ! grep -Eq '^(alias )?f(8|12)=' <<<"$redir_bash"; then
  pass "30ab-b. in this bash lines 3 to 8 and 17 to 24 of the fixture bind, except the arguments on lines 13 and 22"
else
  fail "30ab-b. the redirection probe did not reproduce in this bash (got '$redir_bash')"
fi

# ---- 30r. inside double quotes a backslash escapes only five characters -----
# Thirty-second board round (architect): the lexer dropped every backslash in
# a double-quoted word, while bash keeps one before anything but a dollar, a
# backtick, a double quote, a backslash or the newline. So "al\ias" (line 3)
# is the command al\ias to bash, not alias, and "expand\_aliases" (line 4) is
# not an option name: neither is reported. Line 5, quotes split around the
# word with no backslash, is still alias. Lines 6 to 10 pin each of the five
# escapes through the reported word: an escaped dollar, backtick, double
# quote and backslash lose the backslash, an ordinary letter keeps it. Lines
# 11 and 12 continue a double-quoted word over a backslash-newline, which bash
# removes, so the word is alias. 30r-b runs line 3 in bash.
d_dqbs="$(mkfixture dq-backslash <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
"al\ias" fail=:
shopt -s "expand\_aliases"
"al"ias fail=:
alias "fail=a\$b"
alias "fail=a\`b"
alias "fail=a\"b"
alias "fail=a\\b"
alias "fail=a\qb"
"ali\
as" fail=:
FIX
)"
out_dqbs="$(run_gate "$d_dqbs")"
expect_rc "30r. a double-quoted backslash escapes a dollar, backtick, quote, backslash or newline and is kept before anything else" 1 "$out_dqbs" \
  "7 violation(s)" "fixture.test.sh:5: 'alias fail=:'" \
  "fixture.test.sh:6: 'alias fail=a\$b'" "fixture.test.sh:7: 'alias fail=a\`b'" \
  "fixture.test.sh:8: 'alias fail=a\"b'" "fixture.test.sh:9: 'alias fail=a\\b'" \
  "fixture.test.sh:10: 'alias fail=a\\qb'" "fixture.test.sh:12: 'alias fail=:'"
dqbs_bash="$(bash -c 'shopt -s expand_aliases; "al\ias" fail=: 2>/dev/null; echo "rc=$?"' 2>&1)"
if [ "$dqbs_bash" = "rc=127" ]; then
  pass "30r-b. in this bash \"al\\ias\" is a command named al\\ias, not alias"
else
  fail "30r-b. the double-quoted backslash probe did not reproduce in this bash (got '$dqbs_bash')"
fi

# ---- 30k. an ANSI-C quoted string is decoded before the word is judged -------
# Seventeenth board round (security): bash decodes octal, hex, \u, \U and
# named escapes inside an ANSI-C quoted string, and a NUL ends its value, so
# each line below is the guarded word to bash (the round reproduced a live
# alias shadow and a trap exit override). `\ca` is control-A, not `a`, so
# line 10 is NOT a guarded word and must not be reported. Line 11 pins the
# single-quote removal in a trap action (test round seventeen); line 12
# pins that the control escape for @ is NUL, which also ends the value.
# Eighteenth round (test, architect), each checked against bash 5.2: the
# control escape is toupper AND 31 for any operand, so a space (line 13)
# and a backtick (line 14) are NUL too; an escape after a NUL is dropped
# with the rest of the value (line 15: decoding it would give aliaslzz);
# a doubled backslash operand is consumed whole, so the quote on line 16
# closes and line 17 is read as code. Lines 18 to 21 are NOT guarded words
# and must not be reported: a named escape is a control character, and a
# code point past ASCII is not the letter it equals modulo 128. Line 22
# ends in a control escape whose operand is the newline, which bash turns
# into a newline, not a NUL, so the value is alias plus a newline.
d_ansic="$(mkfixture ansi-c <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
$'\141lias' fail=:
$'\x61lias' fail=:
$'\u0061lias' fail=:
$'\U00000061lias' fail=:
$'\163hopt' -s $'\145xpand_aliases'
trap $'\145xit 0' EXIT
$'alias\0zz' fail=:
$'\ca'lias fail=:
trap "e'x'it 0" EXIT
$'alias\c@zz' fail=:
$'alias\c zz' fail=:
$'alias\c`zz' fail=:
$'alias\0\154zz' fail=:
x=$'\c\\'
alias fail=:
$'alias\azz' fail=:
$'alias\tzz' fail=:
$'\xE1lias' fail=:
$'\u00E1lias' fail=:
$'alias\c
' fail=:
FIX
)"
out_ansic="$(run_gate "$d_ansic")"
expect_rc "30k. octal, hex, \\u, \\U and NUL-terminated ANSI-C spellings are the guarded word" 1 \
  "$out_ansic" "13 violation(s)" "fixture.test.sh:13: 'alias fail=:'" "fixture.test.sh:14: 'alias fail=:'" \
  "fixture.test.sh:15: 'alias fail=:'" "fixture.test.sh:17: 'alias fail=:'" "fixture.test.sh:3: 'alias fail=:'" "fixture.test.sh:4: 'alias fail=:'" \
  "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:6: 'alias fail=:'" "fixture.test.sh:7: 'shopt -s expand_aliases'" \
  "fixture.test.sh:8: 'trap exit 0 ... EXIT'" "fixture.test.sh:9: 'alias fail=:'" "fixture.test.sh:11: 'trap exit 0 ... EXIT'" \
  "fixture.test.sh:12: 'alias fail=:'"
if grep -Eq 'fixture.test.sh:(10|18|19|20|21|22|23):' <<<"$out_ansic"; then
  fail "30k-b. control, named and non-ASCII escapes are not letters" "a line that is not a guarded word was reported: $out_ansic"
else
  pass "30k-b. control, named and non-ASCII escapes are not letters"
fi

# ---- 30l. locale strings and brace expansion are static spellings ------------
# Eighteenth board round (security): a dollar-double-quoted string is its own
# text to bash, and brace expansion happens before a command is looked up, so
# each line below enables aliases or defines one in real bash (each was
# reproduced silencing a frozen `fail`). Line 9 expands to `shopt -s
# expand_aliases expand` and line 10 to `alias fail=: x`. Lines 11 to 14
# put the guarded word in a LATER expansion (`trap 'exit 0' INT EXIT`,
# `alias x fail=:`, `trap : INT DEBUG`, `shopt -p -s expand_aliases`), so
# a check that judged only the first expansion would miss each of them.
# Lines 15 to 17 pin the numeric range (nineteenth round, test): signal 0
# is EXIT, reached by a one-element range, a descending stepped range and
# a range from a negative bound; each exits 3 from `trap 'exit 3' ...` in
# bash 5.2, while `{1..3}` (HUP INT QUIT, real signals) does not, which
# 30l-b pins.
d_static="$(mkfixture static-spellings <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
$"alias" fail=:
shopt -s $"expand_aliases"
al{i,}as fail=:
{a..a}lias fail=:
{a..e..4}lias fail=:
{x,alias} fail=:
shopt -s expand{_aliases,}
alias {fail=:,x}
trap 'exit 0' {INT,EXIT}
alias {x,fail=:}
trap : {INT,DEBUG}
shopt {-p,-s} expand_aliases
trap 'exit 0' {0..0}
trap 'exit 0' {2..0..2}
trap 'exit 0' {-1..0}
FIX
)"
expect_rc "30l. locale strings and brace expansions that produce a guarded word are that word" 1 \
  "$(run_gate "$d_static")" "15 violation(s)" "fixture.test.sh:3: 'alias fail=:'" "fixture.test.sh:4: 'shopt -s expand_aliases'" \
  "fixture.test.sh:5: 'alias fail=:'" "fixture.test.sh:6: 'alias fail=:'" "fixture.test.sh:7: 'alias fail=:'" \
  "fixture.test.sh:8: 'alias fail=:'" "fixture.test.sh:9: 'shopt -s expand{_aliases,}'" "fixture.test.sh:10: 'alias {fail=:,x}'" \
  "fixture.test.sh:11: 'trap exit 0 ..." "fixture.test.sh:12: 'alias {x,fail=:}'" "fixture.test.sh:13: 'trap ... {INT,DEBUG}'" \
  "fixture.test.sh:14: 'shopt {-p,-s} expand_aliases'" "fixture.test.sh:15: 'trap exit 0 ..." \
  "fixture.test.sh:16: 'trap exit 0 ..." "fixture.test.sh:17: 'trap exit 0 ..."
d_nobrace="$(mkfixture plain-braces <<'FIX'
pass() { echo "  PASS: $1"; }
readonly -f pass
echo {alias,x} fail=:
echo {a..c}
trap 'exit 0' {1..3}
FIX
)"
expect_rc "30l-b. brace expansion in an argument position is still text" 0 "$(run_gate "$d_nobrace")" "frozen"

# ---- 30m. a brace expansion past the enumeration cap fails closed -----------
# Nineteenth board round (security): the enumeration stopped at 64 words, so
# `alias {z0,...,z63,fail=:}` defined an alias in bash and passed the gate.
# A word cut short in a guarded position (command name, alias, shopt, set or
# trap statement; set joined in the twenty-sixth round), or nested more than 8 expansions deep (line 7), is now a
# `brace` violation; the same length in an argument of
# any other command is text, as `printf 'a%.0s' {1..65}` in the real tree is,
# and so is an assignment word before the command name (line 10), which bash
# never brace-expands.
# Lines 11 to 13 reach the cap inside each range loop that can hit it (round
# twenty, test): a descending numeric range, and a letter range, ascending
# and descending, after a comma group has already produced words.
d_cap="$({
  printf 'pass() { :; }\nreadonly -f pass\n'
  printf 'alias {'; for i in $(seq 0 63); do printf 'z%d,' "$i"; done; printf 'fail=:}\n'
  printf 'shopt -s {'; for i in $(seq 0 63); do printf 'q%d,' "$i"; done; printf 'expand_aliases}\n'
  printf 'trap : {'; for i in $(seq 0 63); do printf 'q%d,' "$i"; done; printf 'DEBUG}\n'
  printf '{1..70}alias fail=:\n'
  printf 'alias '; for i in $(seq 1 10); do printf '{x,'; done; printf 'fail=:'; for i in $(seq 1 10); do printf '}'; done; printf '\n'
  printf 'printf %%s {1..70}\n'
  printf 'echo {'; for i in $(seq 0 70); do printf 'e%d,' "$i"; done; printf 'x}\n'
  printf 'X={1..70} true\n'
  printf '{70..1}alias fail=:\n'
  printf '{a,b}{A..z}alias fail=:\n'
  printf '{a,b}{z..A}alias fail=:\n'
} | mkfixture brace-cap)"
out_cap="$(run_gate "$d_cap")"
expect_rc "30m. a brace expansion cut short in a guarded position is a violation" 1 "$out_cap" "8 violation(s)" \
  "fixture.test.sh:3: '" "fixture.test.sh:4: '" "fixture.test.sh:5: '" "fixture.test.sh:6: '{1..70}alias'" "fixture.test.sh:7: '{x," \
  "fixture.test.sh:11: '{70..1}alias'" "fixture.test.sh:12: '{a,b}{A..z}alias'" "fixture.test.sh:13: '{a,b}{z..A}alias'"
if grep -Eq 'fixture.test.sh:(8|9|10):' <<<"$out_cap"; then
  fail "30m-b. a long brace expansion in an argument of another command is text" "$out_cap"
else
  pass "30m-b. a long brace expansion in an argument of another command is text"
fi

# ---- 12c. a file whose only definition is malformed gets that report --------------
# Fourteenth board round (ux): the vacuity guard counted only frozen and
# unfrozen rows, so a file holding just ` fail() { :; }` (the eleventh round's
# own example) or just a stray freeze reported "nothing derived".
d_onlyshape="$(mkfixture only-shape <<'FIX'
 fail() { :; }
FIX
)"
expect_rc "12c. a file whose only definition is a shape violation reports it" 1 \
  "$(run_gate "$d_onlyshape")" "1 violation(s)" "fixture.test.sh:1: 'fail()'"
d_onlystray="$(mkfixture only-stray <<'FIX'
readonly -f ghost
FIX
)"
expect_rc "12c-b. a file whose only row is a stray freeze reports it" 1 \
  "$(run_gate "$d_onlystray")" "1 violation(s)" "'readonly -f ghost' does not directly follow"

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
