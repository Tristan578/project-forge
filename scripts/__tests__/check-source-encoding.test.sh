#!/usr/bin/env bash
# Contract test for scripts/check-source-encoding.sh.
#
# The gate's whole value is catching bytes that are invisible everywhere else,
# so the fixtures below embed real control bytes rather than describing them.
# They are built with printf at runtime; committing a corrupt fixture would trip
# the gate this suite is testing.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-source-encoding.sh"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

# Run the gate against one fixture file whose bytes are produced by printf.
# $1 = printf format producing the file's content. Returns "<output>|<rc>".
run_on() {
  local content_fmt="$1" ext="${2:-ts}"
  local dir out rc
  dir="$(mktemp -d)"
  # shellcheck disable=SC2059  # the format IS the fixture under test
  printf "$content_fmt" > "$dir/fixture.$ext"
  printf '%s\n' "$dir/fixture.$ext" > "$dir/list"
  out="$(SOURCE_ENCODING_FILE_LIST="$dir/list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  rm -rf "$dir"
  printf '%s|%s' "$out" "$rc"
}
rc_of() { printf '%s' "${1##*|}"; }

echo "=== control bytes must be rejected ==="

# The exact byte that made a MIME regex match nothing while every test passed.
RES="$(run_on 'const re = /^application\\/wasm\bx/;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a BACKSPACE (0x08) inside a regex is rejected (exit $(rc_of "$RES"))"
else
  fail "a backspace byte passed -- this is the bug the gate exists for"
fi
if grep -q "0x08" <<<"$RES"; then
  pass "the report names the byte in hex"
else
  fail "the report did not identify the byte: $RES"
fi
if grep -qE "fixture\.ts:1:[0-9]+" <<<"$RES"; then
  pass "the report gives file, line and column (actionable without cat -A)"
else
  fail "the report lacks a file:line:column locator: $RES"
fi

# A NUL is the dangerous case: it is what makes git call a file binary.
# shellcheck disable=SC2016  # single quotes are deliberate: this is a printf
# format producing fixture bytes, not shell to be expanded.
RES="$(run_on 'const sig = `a\0b`;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a NUL (0x00) is rejected"
else
  fail "a NUL byte passed"
fi

# THE TRAP. A NUL in the first bytes makes git treat the file as binary, so an
# implementation enumerating with `git grep -I` would skip exactly this file --
# the worst case, silently. Scanning must not depend on git's binary heuristic.
RES="$(run_on '\0\0\0 const x = 1;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a file whose NUL is in the FIRST bytes is still scanned and rejected (a git-grep -I implementation would skip it)"
else
  fail "a leading-NUL file was skipped -- the gate depends on git's binary heuristic, which this class of bug defeats"
fi

for spec in '0x0B:\v' '0x0C:\f' '0x1B:\033'; do
  code="${spec%%:*}"; esc="${spec##*:}"
  RES="$(run_on "const x = 'a${esc}b';\n")"
  if [ "$(rc_of "$RES")" != "0" ]; then
    pass "a ${code} byte is rejected"
  else
    fail "a ${code} byte passed"
  fi
done

echo ""
echo "=== legitimate whitespace must pass ==="

RES="$(run_on 'const a = 1;\n\tconst b = 2;\n\n')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "TAB and LF pass (they are ordinary source whitespace)"
else
  fail "tabs or newlines were rejected: $RES"
fi

# A CR is left alone deliberately: this repo has Windows contributors and git
# handles line endings via .gitattributes. Flagging CR here would produce noise
# that has nothing to do with the corruption class being caught.
RES="$(run_on 'const a = 1;\r\n')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "a CR is left alone (line endings are git's job, not this gate's)"
else
  fail "a CR was rejected -- that is line-ending policy, not control-byte corruption: $RES"
fi

echo ""
echo "=== the gate must not pass vacuously ==="

# A gate that scans nothing and exits 0 reads as coverage while asserting
# nothing. That is the failure mode behind several bugs this milestone.
d="$(mktemp -d)"; : > "$d/empty-list"
out="$(SOURCE_ENCODING_FILE_LIST="$d/empty-list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ]; then
  pass "an empty file list fails rather than reporting success (exit $rc)"
else
  fail "the gate reported success having scanned nothing: $out"
fi

d="$(mktemp -d)"
out="$(SOURCE_ENCODING_FILE_LIST="$d/does-not-exist" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ]; then
  pass "a missing file list is a usage error, not a verdict (exit $rc)"
else
  fail "a missing file list was tolerated"
fi

echo ""
echo "=== the real tree is clean ==="
out="$(bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "the tracked tree has no control bytes ($(grep -oE '[0-9]+ file' <<<"$out" | head -1))"
else
  fail "control bytes present in tracked source:"
  printf '%s\n' "$out" | head -10 | sed 's/^/      /'
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
