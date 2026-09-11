#!/usr/bin/env bash
# Tests for scripts/check-pin-strength.sh.
#
# Every state the gate can report is produced here by a real fixture and run
# through the real script — no state is reachable only by a human remembering a
# command (lesson 15).
#
# Fixtures are written with QUOTED heredocs so their contents are literal: the
# bodies are shell source containing `$VAR` and nested quotes that must reach the
# gate byte-for-byte. A quoted heredoc is also what keeps this file free of the
# backslash-mangling described in lesson 5.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GATE="${ROOT}/scripts/check-pin-strength.sh"
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_T}"' EXIT

passed=0
failed=0
pass() { echo "  PASS: $1"; passed=$((passed + 1)); }
fail() { echo "  FAIL: $1"; failed=$((failed + 1)); }

# Make a suite directory named $1 holding one fixture suite read from stdin.
mkfixture() {
  local dir="${TMPDIR_T}/$1"
  mkdir -p "${dir}"
  cat > "${dir}/fixture.test.sh"
  echo "${dir}"
}

run_gate() {
  bash "${GATE}" "$1" >/dev/null 2>&1
  echo "$?"
}

echo "=== the weak pin the gate exists for ==="

dir="$(mkfixture weak <<'FIXTURE'
cfg_exec="$(grep -v '^[[:space:]]*#' <<<"$cfg")"
line="$(grep -nF 'Enable pgvector extension' "$CD_YML" | head -1)"
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "1" ]; then
  pass "unanchored prose grep against the raw file is flagged (exit 1)"
else
  fail "weak pin not flagged — expected 1, got ${rc}"
fi

echo ""
echo "=== shapes that must NOT be flagged, or the gate becomes noise ==="

# A suite that never strips comments has made no claim to contradict.
dir="$(mkfixture nostrip <<'FIXTURE'
line="$(grep -nF 'some step' "$CD_YML" | head -1)"
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "0" ]; then
  pass "a suite that does not strip comments is not flagged"
else
  fail "suite without the strip idiom — expected 0, got ${rc}"
fi

# The stripping line itself reads the raw file BY DESIGN. Flagging the fix would
# make the gate unsatisfiable.
dir="$(mkfixture stripper <<'FIXTURE'
cfg_exec="$(grep -v '^[[:space:]]*#' "$CD_YML" || true)"
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "0" ]; then
  pass "the comment-stripping line itself is not flagged"
else
  fail "stripping line — expected 0, got ${rc}"
fi

# A pattern anchored to line start cannot be satisfied by a comment, because the
# comment marker is in the way. Anchoring IS the fix.
dir="$(mkfixture anchored <<'FIXTURE'
cfg_exec="$(grep -v '^[[:space:]]*#' <<<"$cfg")"
line="$(grep -nE '^[[:space:]]*id:[[:space:]]*db-snapshot$' "$CD_YML" | head -1)"
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "0" ]; then
  pass "a pattern anchored to line start is not flagged"
else
  fail "anchored pattern — expected 0, got ${rc}"
fi

# Asserting that a COMMENT exists is legitimate and needs the raw text.
dir="$(mkfixture optout <<'FIXTURE'
cfg_exec="$(grep -v '^[[:space:]]*#' <<<"$cfg")"
# raw-grep-ok: the required rationale lives in a comment by design
line="$(grep -nF 'WHY THIS EXISTS' "$CD_YML" | head -1)"
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "0" ]; then
  pass "an explicit '# raw-grep-ok' opt-out suppresses the finding"
else
  fail "raw-grep-ok opt-out — expected 0, got ${rc}"
fi

# A here-string reads a variable whose contents were stripped upstream.
dir="$(mkfixture herestring <<'FIXTURE'
cfg_exec="$(grep -v '^[[:space:]]*#' <<<"$cfg")"
if grep -qF 'some step' <<<"$cfg_exec"; then :; fi
FIXTURE
)"
rc="$(run_gate "${dir}")"
if [ "${rc}" = "0" ]; then
  pass "a here-string against the stripped copy is not flagged"
else
  fail "here-string — expected 0, got ${rc}"
fi

echo ""
echo "=== vacuity (lesson 9) ==="

empty="${TMPDIR_T}/empty"
mkdir -p "${empty}"
rc="$(run_gate "${empty}")"
if [ "${rc}" = "2" ]; then
  pass "a directory with no suites exits 2 rather than passing vacuously"
else
  fail "empty suite dir — expected 2, got ${rc}"
fi

rc="$(run_gate "${TMPDIR_T}/does-not-exist")"
if [ "${rc}" = "2" ]; then
  pass "a missing suite directory exits 2"
else
  fail "missing dir — expected 2, got ${rc}"
fi

echo ""
echo "=== the real tree ==="

# The gate must be clean against the repository it ships in — a gate that lands
# red is one everybody immediately learns to route around.
rc="$(run_gate "${ROOT}/scripts/__tests__")"
if [ "${rc}" = "0" ]; then
  pass "the repository's own suites pass the gate"
else
  fail "the repo's suites do not pass the gate (exit ${rc}) — run: bash scripts/check-pin-strength.sh"
fi

echo ""
echo "passed: ${passed}  failed: ${failed}"
[ "${failed}" -eq 0 ] || exit 1
exit 0
