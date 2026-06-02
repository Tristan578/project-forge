#!/usr/bin/env bash
# Verify the "CI Success" aggregate — THE required status check on `main`.
#
# Reads $NEEDS_JSON (the `toJSON(needs)` the ci-success job passes in) and runs
# two checks:
#
#   1. HARD FAILURE — fail if any required gate ended in `failure` or
#      `cancelled`. A path-gated gate that was LEGITIMATELY skipped (its ci-gate
#      trigger output was false) is allowed; `skipped` is not a failure.
#
#   2. ANTI-TAMPER — a self-defending gate must NOT be `skipped` while its OWN
#      trigger fired. ci-success tolerates legitimate skips, so without this a
#      one-line `if: false` slipped onto `lockfile-sync-tests` — in a PR that, by
#      editing ci.yml, necessarily sets needs-ci=true — would skip the lockfile
#      gate's self-tests while every required check stayed green. Requiring
#      success-when-triggered RAISES THE COST of that unwiring: a single `if:
#      false` no longer suffices. This is defense-in-depth, NOT an airtight
#      proof — a determined actor could still coordinate edits across the gate's
#      `if:`, this script, and its suite in one PR. The ultimate backstop is
#      human review of any ci.yml / scripts/ change; what automation closes here
#      is the *silent, single-line* slip that no reviewer would notice.
#
# Unit-tested by scripts/__tests__/check-ci-success.test.sh (run in CI by the
# lockfile-sync-tests job, gated on needs-ci so any edit here re-runs it).
set -uo pipefail

NEEDS_JSON="${NEEDS_JSON:-}"
if [ -z "$NEEDS_JSON" ]; then
  echo "::error::NEEDS_JSON is empty — cannot verify CI gates"
  exit 1
fi

needs_file="$(mktemp)"
trap 'rm -f "$needs_file"' EXIT
printf '%s' "$NEEDS_JSON" > "$needs_file"

# Fail safe on malformed input. This script has no `set -e`, so a jq parse error
# inside the $(...) queries below is swallowed — `failed` and the anti-tamper
# lookups both come back empty and the verifier would fall through to "all
# passed" (exit 0) on a non-empty but invalid blob. Reject invalid JSON up front
# so a broken NEEDS_JSON can never read as a green CI.
if ! jq empty "$needs_file" >/dev/null 2>&1; then
  echo "::error::NEEDS_JSON is not valid JSON — cannot verify CI gates"
  exit 1
fi

# 1. Hard failures (failure / cancelled). Legitimate path-filter skips pass.
failed="$(jq -r 'to_entries[] | select(.value.result == "failure" or .value.result == "cancelled") | .key' "$needs_file")"
if [ -n "$failed" ]; then
  echo "::error::Required CI gate(s) failed or were cancelled:"
  while IFS= read -r line; do
    echo "  - $line"
  done <<< "$failed"
  exit 1
fi

# 2. Anti-tamper: a self-defending gate skipped while its trigger fired is an
#    unwiring signal. Map each gate job to the ci-gate output that triggers it.
tamper=""
check_triggered() {
  local job="$1" trigger="$2" trig result
  trig="$(jq -r --arg t "$trigger" '."ci-gate".outputs[$t] // empty' "$needs_file")"
  result="$(jq -r --arg j "$job" '.[$j].result // "absent"' "$needs_file")"
  if [ "$trig" = "true" ] && [ "$result" != "success" ]; then
    tamper="$tamper"$'\n'"  - $job (trigger $trigger=true but result=$result)"
  fi
}
check_triggered "lockfile-sync"       "needs-deps"
check_triggered "lockfile-sync-tests" "needs-ci"
if [ -n "$tamper" ]; then
  echo "::error::Self-defending gate skipped despite its trigger firing (possible unwiring):"
  echo "$tamper"
  exit 1
fi

echo "All required gates passed (or were correctly skipped via path filter)."
