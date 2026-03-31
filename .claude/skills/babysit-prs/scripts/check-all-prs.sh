#!/usr/bin/env bash
# check-all-prs.sh — List all open PRs with CI status
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-all-prs.sh"
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "${REPO_ROOT}"

printf "%-6s %-50s %-12s %-20s %s\n" "PR" "TITLE" "CI STATUS" "LAST UPDATED" "BRANCH"
printf "%-6s %-50s %-12s %-20s %s\n" "------" "--------------------------------------------------" "------------" "--------------------" "------"

# Fetch open PRs with status rollup
prs=$(gh pr list --state open --json number,title,headRefName,updatedAt,statusCheckRollup --limit 30 2>/dev/null || echo "[]")

if [ "$prs" = "[]" ] || [ -z "$prs" ]; then
  echo "No open PRs found (or gh not authenticated)."
  exit 0
fi

echo "$prs" | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
for pr in data:
    number = pr.get("number", "?")
    title = pr.get("title", "")[:50]
    branch = pr.get("headRefName", "")[:30]
    updated = pr.get("updatedAt", "")[:16].replace("T", " ")

    rollup = pr.get("statusCheckRollup") or []
    if not rollup:
        ci_status = "PENDING"
    else:
        states = [c.get("state", c.get("conclusion", "PENDING")).upper() for c in rollup]
        if any(s in ("FAILURE", "FAILED", "ERROR", "TIMED_OUT") for s in states):
            ci_status = "FAIL"
        elif all(s in ("SUCCESS", "SKIPPED", "NEUTRAL") for s in states):
            ci_status = "PASS"
        else:
            ci_status = "PENDING"

    print(f"#{number:<5} {title:<50} {ci_status:<12} {updated:<20} {branch}")
PYEOF

echo ""
echo "Run 'bash \"\${CLAUDE_SKILL_DIR}/scripts/get-failure-logs.sh\" <PR_NUMBER>' for failure details."
exit 0
