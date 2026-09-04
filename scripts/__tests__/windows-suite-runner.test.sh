#!/usr/bin/env bash
# Unit tests for the `Run every bash suite on Windows (Git Bash)` step in
# .github/workflows/ci.yml (#9611).
#
# The bug class this suite locks down: GitHub Actions runs a `shell: bash` step
# as `bash --noprofile --norc -eo pipefail {0}`, so ERREXIT IS ON. The step's
# loop was written as
#
#     bash "$suite"
#     code=$?
#
# which under errexit never reaches `code=$?` — the first suite to exit non-zero
# kills the whole step. That silently destroys both behaviours the loop exists
# for: the exit-3 UNSUPPORTED tolerance never fires (a suite that correctly
# declares itself unsupported on Windows fails the job), and a real failure
# stops the sweep, so the run reports one broken suite when several are broken.
# Nothing about that is visible by reading the block — it is valid shell either
# way, and the only difference is which shell flags the runner supplies.
#
# So this suite does not grep the YAML for a pattern. It EXTRACTS the step's
# real `run:` body out of ci.yml and executes it under the exact interpreter
# GitHub uses, against fixture suites whose exit codes are the three cases that
# matter. A structural pin would pass on any rewrite that happens to avoid the
# one spelling it knows; running the block cannot.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
STEP_NAME='Run every bash suite on Windows (Git Bash)'
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$CI_YML" ] || { echo "ci.yml not found: $CI_YML"; exit 1; }

echo "=== windows suite-runner step tests ==="

# ---------------------------------------------------------------------------
# Extract the step body. Walk to the named step, then to its `run: |`, then take
# every following line indented deeper than the `run:` key itself, dedenting by
# that key's indent + 2. A blank line inside the body is kept verbatim.
# ---------------------------------------------------------------------------
BLOCK="$TMPDIR_T/step.sh"
awk -v want="$STEP_NAME" '
  index($0, "- name: " want) { instep = 1; next }
  instep && !inrun {
    if ($0 ~ /^[[:space:]]*run:[[:space:]]*\|[[:space:]]*$/) {
      match($0, /^[[:space:]]*/)
      body_indent = RLENGTH + 2
      inrun = 1
    }
    next
  }
  inrun {
    if ($0 ~ /^[[:space:]]*$/) { print ""; next }
    match($0, /^[[:space:]]*/)
    if (RLENGTH < body_indent) exit
    print substr($0, body_indent + 1)
  }
' "$CI_YML" > "$BLOCK"

if [ ! -s "$BLOCK" ]; then
  echo "  FAIL: could not extract the '$STEP_NAME' step body from ci.yml"
  echo "        (the step was renamed or removed — update STEP_NAME)"
  exit 1
fi
pass "extracted the step body ($(wc -l < "$BLOCK" | tr -d ' ') lines)"

# A body that does not actually invoke the suites would extract fine and prove
# nothing, so assert the loop is in there before trusting any run below.
if grep -q 'for suite in' "$BLOCK" && grep -q 'suites: ' "$BLOCK"; then
  pass "extracted body contains the suite loop and its summary line"
else
  fail "extracted body does not look like the suite loop — extraction is wrong"
  exit 1
fi

# ---------------------------------------------------------------------------
# Fixtures. mkworld <name> <exitcode>... — one fixture suite per exit code,
# alternating between the two globbed directories so both are exercised.
# ---------------------------------------------------------------------------
mkworld() {
  local name="$1"; shift
  local dir="$TMPDIR_T/$name"
  mkdir -p "$dir/.claude/hooks/__tests__" "$dir/scripts/__tests__"
  local i=0 code
  for code in "$@"; do
    local target
    if [ $((i % 2)) -eq 0 ]; then
      target="$dir/.claude/hooks/__tests__/fixture${i}.test.sh"
    else
      target="$dir/scripts/__tests__/fixture${i}.test.sh"
    fi
    {
      echo '#!/usr/bin/env bash'
      echo "echo ran-fixture${i}"
      echo "exit ${code}"
    } > "$target"
    chmod +x "$target"
    i=$((i + 1))
  done
  echo "$dir"
}

# Run the extracted block exactly as the runner would: GitHub's documented
# invocation for `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`.
run_block() {
  local dir="$1"
  ( cd "$dir" && bash --noprofile --norc -eo pipefail "$BLOCK" 2>&1 )
}

# ---------------------------------------------------------------------------
# Case 1 — a suite exiting 3 (UNSUPPORTED) must be tolerated, counted, warned
# about, and must not stop the ones after it.
# ---------------------------------------------------------------------------
echo "-- case: exit 3 is tolerated and does not abort the sweep"
DIR="$(mkworld unsupported 3 0 0)"
OUT="$(run_block "$DIR")"; RC=$?

if [ "$RC" -eq 0 ]; then
  pass "step succeeds when the only non-zero suite exited 3"
else
  fail "step exited $RC; an UNSUPPORTED suite must not fail the job"
fi

# NOT `GROUPS` — that is a bash special array (the caller's group ids); an
# assignment to it is silently discarded and the read returns ${GROUPS[0]},
# so the check would compare a gid against the expected count.
GROUP_COUNT="$(printf '%s\n' "$OUT" | grep -c '::group::')"
if [ "$GROUP_COUNT" -eq 3 ]; then
  pass "all 3 suites ran (found $GROUP_COUNT ::group:: markers)"
else
  fail "only $GROUP_COUNT of 3 suites ran — the sweep aborted early"
fi

if printf '%s\n' "$OUT" | grep -q '::warning::.*UNSUPPORTED on windows (exit 3)'; then
  pass "the exit-3 suite produced an UNSUPPORTED warning"
else
  fail "no UNSUPPORTED warning emitted for the exit-3 suite"
fi

if printf '%s\n' "$OUT" | grep -q 'suites: 3, unsupported on windows: 1'; then
  pass "summary line counts 3 suites and 1 unsupported"
else
  fail "summary line missing or miscounted; got: $(printf '%s\n' "$OUT" | tail -1)"
fi

if ! printf '%s\n' "$OUT" | grep -q '::error::'; then
  pass "no error emitted for a merely-unsupported suite"
else
  fail "an ::error:: was emitted for an exit-3 suite"
fi

# ---------------------------------------------------------------------------
# Case 2 — a genuinely failing suite fails the step, but only AFTER every other
# suite has run. Reporting one broken suite when three are broken is the second
# half of the same bug.
# ---------------------------------------------------------------------------
echo "-- case: a failing suite fails the step without truncating the sweep"
DIR="$(mkworld failing 1 0 1 3)"
OUT="$(run_block "$DIR")"; RC=$?

if [ "$RC" -eq 1 ]; then
  pass "step exits 1 when a suite fails"
else
  fail "step exited $RC, expected 1"
fi

GROUP_COUNT="$(printf '%s\n' "$OUT" | grep -c '::group::')"
if [ "$GROUP_COUNT" -eq 4 ]; then
  pass "all 4 suites ran despite the FIRST one failing (found $GROUP_COUNT groups)"
else
  fail "only $GROUP_COUNT of 4 suites ran — the sweep stopped at the first failure"
fi

ERRORS="$(printf '%s\n' "$OUT" | grep -c '::error::.*failed on windows (exit 1)')"
if [ "$ERRORS" -eq 2 ]; then
  pass "both failing suites were reported, not just the first"
else
  fail "reported $ERRORS failing suites, expected 2"
fi

if printf '%s\n' "$OUT" | grep -q 'suites: 4, unsupported on windows: 1'; then
  pass "summary still printed after failures (4 suites, 1 unsupported)"
else
  fail "summary line missing — the step died before reaching it"
fi

# ---------------------------------------------------------------------------
# Case 3 — the no-suites guard. A glob that matches nothing must fail loudly:
# zero suites inspected is not zero problems found.
# ---------------------------------------------------------------------------
echo "-- case: an empty suite set fails instead of passing vacuously"
DIR="$(mkworld empty)"
OUT="$(run_block "$DIR")"; RC=$?

if [ "$RC" -ne 0 ]; then
  pass "step fails (exit $RC) when no suites are found"
else
  fail "step passed with zero suites — a vacuous green"
fi

if printf '%s\n' "$OUT" | grep -q '::error::No test suites found'; then
  pass "empty suite set is reported as an error"
else
  fail "no diagnostic emitted for an empty suite set"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All windows suite-runner tests passed."
  exit 0
fi
echo "$FAILURES test(s) FAILED."
exit 1
