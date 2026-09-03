#!/usr/bin/env bash
# deploy-drift-dispatch.sh
#
# A merge can land on main with ZERO workflow runs (#9640): a merge that GitHub
# performs on a bot's behalf (Dependabot auto-merge, `@dependabot merge`) is a
# GITHUB_TOKEN-class event, and "events triggered by the GITHUB_TOKEN will not
# create a new workflow run" — so neither the push-CI verification of the
# merged tree (#9596) nor cd.yml runs, production silently stays on the
# previous commit, and the next unrelated merge deploys the accumulated diff
# with no per-commit blame. a65b1c99 (#9590, 32 dependency updates) shipped
# that way on 2026-09-02.
#
# This runs on a schedule (deploy-drift.yml) and asks, for main's head:
#   - does ci.yml have ANY run for this SHA?   if not, dispatch it
#   - does cd.yml have ANY run for this SHA?   if not, dispatch it — unless
#     production already reports this commit (a hand deploy, or a run that was
#     re-attributed), in which case there is nothing to deploy
#
# "Any run" is the signal, not "a successful run": a failed cd.yml run has
# already rolled back and opened its incident, and re-dispatching it every
# fifteen minutes would retry a failing build forever. workflow_dispatch is the
# documented exception to the GITHUB_TOKEN rule, so the runs this creates are
# real runs with real checks.
#
# Every dispatch is verified: the script polls for a workflow_dispatch run on
# the SHA and fails loudly when none appears (lessons #1/#2 — the exit code of
# `gh workflow run` says the request was accepted, not that a run exists).
#
# Environment:
#   GH_TOKEN                required (actions: write)
#   GITHUB_REPOSITORY       required, owner/repo
#   DRIFT_BRANCH            default main
#   DRIFT_HEALTH_URL        default https://www.spawnforge.ai/api/health
#   DRIFT_DISPATCH_ATTEMPTS default 3
#   DRIFT_VERIFY_ATTEMPTS   default 6   (polls for the created run)
#   DRIFT_SLEEP_S           default 10  (between dispatch retries and polls)
#   GITHUB_OUTPUT           when set, appends dispatched=<space-separated
#                           workflow files, or none> and head=<sha>
#
# Exit codes: 0 nothing to do or every needed run was created; 1 a needed run
# could not be created or the head could not be read.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
export GH_TOKEN

repo="$GITHUB_REPOSITORY"
branch="${DRIFT_BRANCH:-main}"
health_url="${DRIFT_HEALTH_URL:-https://www.spawnforge.ai/api/health}"
dispatch_attempts="${DRIFT_DISPATCH_ATTEMPTS:-3}"
verify_attempts="${DRIFT_VERIFY_ATTEMPTS:-6}"
sleep_s="${DRIFT_SLEEP_S:-10}"

emit_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1=$2" >> "$GITHUB_OUTPUT"
  fi
}

# gh api that fails closed: a non-JSON or failed answer reads as empty.
api_json() {
  gh api "$1" 2>/dev/null || true
}

head=$(api_json "repos/${repo}/branches/${branch}" | jq -r '.commit.sha // empty')
if [ -z "$head" ]; then
  echo "::error::Could not read the head of ${branch} on ${repo}"
  exit 1
fi
echo "${branch} head: ${head}"
emit_output head "$head"

# Count of runs of one workflow for the head SHA, any event, any conclusion.
runs_for() {
  local workflow="$1"
  api_json "repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${head}&per_page=100" \
    | jq -r '.total_count // empty'
}

# The commit production reports, first 8 chars, or empty when unreadable.
production_commit() {
  curl -sS --max-time 10 "$health_url" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null | cut -c1-8 || true
}

dispatch_and_verify() {
  local workflow="$1" attempt
  for attempt in $(seq 1 "$dispatch_attempts"); do
    if gh workflow run "$workflow" --ref "$branch" --repo "$repo"; then
      echo "Dispatched ${workflow} on ${branch} (attempt ${attempt})"
      break
    fi
    echo "Dispatch of ${workflow} failed (attempt ${attempt}/${dispatch_attempts})"
    if [ "$attempt" -eq "$dispatch_attempts" ]; then
      echo "::error::Could not dispatch ${workflow} for ${head} after ${dispatch_attempts} attempts"
      return 1
    fi
    sleep "$sleep_s"
  done
  # The request being accepted is not a run existing. Wait for one.
  for attempt in $(seq 1 "$verify_attempts"); do
    local run_id
    run_id=$(api_json "repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${head}&event=workflow_dispatch&per_page=1" \
      | jq -r '.workflow_runs[0].id // empty')
    if [ -n "$run_id" ]; then
      echo "Verified: ${workflow} run ${run_id} exists for ${head} (https://github.com/${repo}/actions/runs/${run_id})"
      return 0
    fi
    sleep "$sleep_s"
  done
  echo "::error::${workflow} was dispatched for ${head} but no workflow_dispatch run appeared after ${verify_attempts} polls"
  return 1
}

dispatched=()
failed=0

for workflow in ci.yml cd.yml; do
  count=$(runs_for "$workflow")
  if [ -z "$count" ]; then
    echo "::error::Could not list ${workflow} runs for ${head}"
    failed=1
    continue
  fi
  if [ "$count" -gt 0 ]; then
    echo "${workflow}: ${count} run(s) already exist for ${head} — nothing to do"
    continue
  fi
  if [ "$workflow" = "cd.yml" ]; then
    live=$(production_commit)
    if [ -n "$live" ] && [ "$live" = "$(printf '%s' "$head" | cut -c1-8)" ]; then
      echo "cd.yml: no run for ${head}, but production already reports ${live} — nothing to deploy"
      continue
    fi
    echo "cd.yml: no run for ${head}; production reports ${live:-<unreadable>}"
  else
    echo "ci.yml: no run for ${head} — the merged tree was never verified"
  fi
  if dispatch_and_verify "$workflow"; then
    dispatched+=("$workflow")
  else
    failed=1
  fi
done

if [ ${#dispatched[@]} -gt 0 ]; then
  emit_output dispatched "${dispatched[*]}"
else
  emit_output dispatched none
fi

exit "$failed"
