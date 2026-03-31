#!/usr/bin/env bash
# get-failure-logs.sh — Get failed CI run logs for a given PR number
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/get-failure-logs.sh" <PR_NUMBER>
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "${REPO_ROOT}"

PR_NUMBER="${1:-}"
if [ -z "${PR_NUMBER}" ]; then
  echo "Usage: $0 <PR_NUMBER>"
  echo "Example: $0 1234"
  exit 0
fi

echo "=== PR #${PR_NUMBER} — Failure Logs ==="
echo ""

# Get branch name for this PR
BRANCH=$(gh pr view "${PR_NUMBER}" --json headRefName --jq '.headRefName' 2>/dev/null || echo "")
if [ -z "${BRANCH}" ]; then
  echo "ERROR: Could not find PR #${PR_NUMBER} — check the number and try again."
  exit 0
fi

echo "Branch: ${BRANCH}"
echo ""

# Find the most recent failed run on this branch
RUN_ID=$(gh run list --branch "${BRANCH}" --status failure --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")

if [ -z "${RUN_ID}" ] || [ "${RUN_ID}" = "null" ]; then
  # Try looking for in-progress or other states that might have failed jobs
  RUN_ID=$(gh run list --branch "${BRANCH}" --limit 5 --json databaseId,conclusion --jq '.[] | select(.conclusion == "failure") | .databaseId' 2>/dev/null | head -1 || echo "")
fi

if [ -z "${RUN_ID}" ] || [ "${RUN_ID}" = "null" ]; then
  echo "No failed runs found for branch '${BRANCH}'."
  echo ""
  echo "Checking recent runs on this branch:"
  gh run list --branch "${BRANCH}" --limit 5 2>/dev/null || echo "No runs found."
  exit 0
fi

echo "Failed run ID: ${RUN_ID}"
echo "Fetching failure logs (last 80 lines)..."
echo "---"
gh run view "${RUN_ID}" --log-failed 2>/dev/null | tail -80 || echo "Could not fetch logs for run ${RUN_ID}"

echo ""
echo "=== Full run summary ==="
gh run view "${RUN_ID}" 2>/dev/null || echo "Could not fetch run summary."

exit 0
