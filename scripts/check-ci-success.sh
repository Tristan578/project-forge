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
# lockfile-sync-tests job, gated on needs-ci || needs-agentic || needs-onboarding
# || needs-codex so any edit to a gate script, an onboarding surface, OR the Codex
# config re-runs the suite — the job's `if:` and the lockfile-sync-tests entry in
# the anti-tamper map below name the SAME four triggers, so the suite re-runs on
# any signal that fires it without depending on one trigger being a subset of
# another).
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

# 2. Anti-tamper: a self-defending gate skipped while ANY of its triggers fired
#    is an unwiring signal. A job gated on `needs-ci || needs-agentic` must run if
#    EITHER output is true, so each gate is mapped to ALL the ci-gate outputs in
#    its `if:` — guarding only one arm would leave the other as a silent
#    single-line `if: false` skip vector.
tamper=""
check_triggered() {
  local job="$1"; shift
  local trig result fired=""
  result="$(jq -r --arg j "$job" '.[$j].result // "absent"' "$needs_file")"
  for trigger in "$@"; do
    trig="$(jq -r --arg t "$trigger" '."ci-gate".outputs[$t] // empty' "$needs_file")"
    if [ "$trig" = "true" ]; then
      fired="${fired:+$fired,}$trigger"
    fi
  done
  if [ -n "$fired" ] && [ "$result" != "success" ]; then
    tamper="$tamper"$'\n'"  - $job (trigger $fired=true but result=$result)"
  fi
}
# Each entry maps a gate JOB to the ci-gate trigger(s) in its OWN `if:`. Note this
# whole anti-tamper pass runs inside the ci-success aggregate (ci.yml: `if:
# always()`), so every entry is evaluated on EVERY PR — it is NOT scoped to the
# lockfile-sync-tests job (that job only runs the *unit test* of this script). The
# lockfile-sync-tests ENTRY needs four triggers because its job `if:` has four arms
# (see lines 23-29); the others, including hook-tests, each name the single trigger
# their job is gated on (hook-tests <-> needs-hooks, ci.yml hook-tests `if:`).
check_triggered "lockfile-sync"             "needs-deps"
check_triggered "lockfile-sync-tests"       "needs-ci" "needs-agentic" "needs-onboarding" "needs-codex"
check_triggered "agentic-sync"              "needs-agentic"
check_triggered "taskboard-onboarding-guard" "needs-onboarding"
check_triggered "codex-config-guard"        "needs-codex"
check_triggered "hook-tests"                "needs-hooks"
check_triggered "skills-lint"               "needs-skills"
check_triggered "ghaw-lock-sync"            "needs-ghaw"
check_triggered "openapi-route-sync"        "needs-api"
# The journey gate is the ONLY runtime proof that the E2E store-exposure flag
# (NEXT_PUBLIC_E2E_HOOKS) gates correctly on a real prod build, and the required
# proof that the core new-user journey stays winnable + exportable. Protect it
# from a silent `if: false` skip like the self-defending gates above.
check_triggered "test-e2e-journey"          "needs-web"
if [ -n "$tamper" ]; then
  echo "::error::Self-defending gate skipped despite its trigger firing (possible unwiring):"
  echo "$tamper"
  exit 1
fi

echo "All required gates passed (or were correctly skipped via path filter)."
