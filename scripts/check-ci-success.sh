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
drift=""
check_triggered() {
  local job="$1"; shift
  local trig result fired=""
  result="$(jq -r --arg j "$job" '.[$j].result // "absent"' "$needs_file")"
  for trigger in "$@"; do
    # Fail CLOSED on a missing trigger output. `.outputs[$t] // empty` reads a
    # RENAMED or REMOVED ci-gate output as "did not fire", which silently
    # disarms this gate's anti-tamper arm — the exact class of drift this
    # script exists to catch. A mapped trigger the workflow no longer emits is
    # config drift, not a legitimate skip: refuse to certify.
    if [ "$(jq -r --arg t "$trigger" '(."ci-gate".outputs // {}) | has($t)' "$needs_file")" != "true" ]; then
      drift="$drift"$'\n'"  - $job: trigger output '$trigger' missing from ci-gate outputs"
      continue
    fi
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
# (see lines 23-29); the multi-arm entries below (test-e2e-engine-smoke,
# command-parity) name every arm of their job's `if:`; the rest, including
# hook-tests, name the single trigger their job is gated on (hook-tests <->
# needs-hooks, ci.yml hook-tests `if:`).
#
# EVERY job in ci-success's `needs:` list must appear here, with ci-gate the sole
# exemption — it is the SOURCE of these trigger outputs, not a gate with an `if:`
# of its own, and it fails closed anyway: a skipped or absent ci-gate leaves
# `.ci-gate.outputs` empty, which sends every mapped trigger down the `drift`
# branch below. This map is hand-maintained and it HAS drifted behind the `needs:`
# list before (#9437 — command-parity, build-nextjs and test-e2e-ui each sat in
# `needs:` with no entry here, i.e. three silent `if: false` vectors). The suite
# now asserts the map covers the real `needs:` list, so a newly added job that is
# never mapped fails check-ci-success.test.sh instead of shipping as a hole.
check_triggered "lockfile-sync"             "needs-deps"
check_triggered "lockfile-sync-tests"       "needs-ci" "needs-agentic" "needs-onboarding" "needs-codex"
check_triggered "agentic-sync"              "needs-agentic"
check_triggered "taskboard-onboarding-guard" "needs-onboarding"
check_triggered "codex-config-guard"        "needs-codex"
check_triggered "hook-tests"                "needs-hooks"
check_triggered "hook-tests-windows"        "needs-hooks" "needs-ci"
check_triggered "skills-lint"               "needs-skills"
check_triggered "ghaw-lock-sync"            "needs-ghaw"
check_triggered "openapi-route-sync"        "needs-api"
check_triggered "actions-pin-check"         "needs-ci"
# quality-gates is `workflow_call`-only, and ci.yml's `quality-gates:` job is its
# SOLE caller — cd.yml does not run on `pull_request`, so on the PR path that one
# job is the only execution site for all three npm audits (web, mcp-server, and
# the repo root) plus the cargo audit. Two one-line unwires previously certified
# green here: `if: false` on the caller (the job still EXISTS, so ci-success's
# `needs:` resolves and the job merely SKIPS — and this script fails only on
# failure/cancelled), and dropping `- quality-gates` from that `needs:` list
# (valid YAML, no dangling reference, caller still runs, aggregate stops
# observing it — an absent job resolves to result="absent" above, which is only
# flagged for jobs THIS map lists). needs-any-code is the single trigger in the
# caller's own `if:` (ci.yml), so this entry is one-armed by construction, and a
# docs-only PR leaves it unfired rather than false-positive. PF-1010.
check_triggered "quality-gates"             "needs-any-code"
# The docs gate is the only required PR proof that the docs Vitest suite,
# internal-command MDX gate, and manifest sync ran for docs changes.
check_triggered "docs-internal-gate"        "needs-docs"
# The design gate (PF-1003) is the ONLY per-PR job that runs the @spawnforge/ui
# unit suite for a packages/ui-only PR — quality-gates' test-web runs that suite
# only when web/ci changed, so a UI-only PR relies entirely on this gate for its
# unit tests. Protect it from a silent `if: false` skip like the gates above.
check_triggered "design-internal-gate"      "needs-design"
# The journey gate is the ONLY runtime proof that the E2E store-exposure flag
# (NEXT_PUBLIC_E2E_HOOKS) gates correctly on a real prod build, and the required
# proof that the core new-user journey stays winnable + exportable. Protect it
# from a silent `if: false` skip like the self-defending gates above.
check_triggered "test-e2e-journey"          "needs-web"
# The request-only API gate is the only pre-merge execution of billing and
# token-guard endpoint coverage. It must run on every web-touching PR.
check_triggered "test-e2e-api"              "needs-web"
# The engine-smoke gate is the ONLY per-PR job that boots the real WASM engine
# (load -> spawn -> play -> export under SwiftShader software WebGL2), closing the
# F10 gap where rendering/ECS journeys ran only post-merge. It fires on
# `needs-web || needs-engine` (an engine-only PR must still run it), so BOTH arms
# are mapped — guarding only one would leave the other as a silent `if: false`
# skip vector. Protect it from unwiring like the other self-defending gates.
check_triggered "test-e2e-engine-smoke"     "needs-web" "needs-engine"
# command-parity is the ONLY per-PR proof that the three commands.json copies stay
# in sync and that every MCP command has a handler (web/scripts/check-command-parity.js
# over mcp-server/manifest, web/src/data and apps/docs/data — one manifest per
# deploy root). It fires on `needs-web || needs-mcp` (an mcp-server-only PR must
# still run it), so BOTH arms are mapped — guarding only one would leave the other
# as a silent `if: false` skip vector, exactly as for test-e2e-engine-smoke above.
check_triggered "command-parity"            "needs-web" "needs-mcp"
# build-nextjs is the ONLY per-PR job that compiles the app: the Next.js production
# build, the native-swc-binding assertion (scripts/check-native-bindings.sh) and
# bundle-size enforcement all run there and NOWHERE else on the PR path. A silent
# `if: false` skip would ship an app that does not build with every required check
# green. needs-web is the single trigger in its own `if:` (ci.yml build-nextjs).
check_triggered "build-nextjs"              "needs-web"
# test-e2e-ui is the ONLY per-PR run of the Playwright UI suite (the @ui specs,
# sharded 3 ways — the engine-dependent @engine specs are covered separately by
# test-e2e-engine-smoke). Protect it from a silent `if: false` skip like the gates
# above. needs-web is the single trigger in its own `if:` (ci.yml test-e2e-ui).
check_triggered "test-e2e-ui"               "needs-web"
if [ -n "$drift" ]; then
  echo "::error::Anti-tamper trigger output(s) missing from ci-gate outputs (map/workflow drift — renamed or removed trigger?):"
  echo "$drift"
  exit 1
fi
if [ -n "$tamper" ]; then
  echo "::error::Self-defending gate skipped despite its trigger firing (possible unwiring):"
  echo "$tamper"
  exit 1
fi

echo "All required gates passed (or were correctly skipped via path filter)."
