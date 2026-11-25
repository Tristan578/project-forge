#!/usr/bin/env bash
# validate-pr-body.sh — Validate PR body for required sections
# Usage: bash scripts/validate-pr-body.sh <PR_NUMBER>
#        bash scripts/validate-pr-body.sh --stdin   (reads body from stdin)
# Exit 0: valid
# Exit 2: missing required sections (blocking)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

failures=()

if [[ "${1:-}" == "--stdin" ]]; then
  body="$(cat)"
elif [[ -n "${1:-}" ]]; then
  body="$(gh pr view "$1" --json body --jq '.body' 2>/dev/null || echo "")"
else
  echo "Usage: $0 <PR_NUMBER> | $0 --stdin" >&2
  exit 1
fi

if [[ -z "$body" ]]; then
  echo "ERROR: Could not retrieve PR body." >&2
  exit 2
fi

# Check for Closes #NNNN link (GitHub issue number)
if ! echo "$body" | grep -qiE 'closes\s+#[0-9]+'; then
  failures+=("Missing 'Closes #NNNN' link — required so CI can close the GitHub issue on merge")
fi

# Check for Test plan section
if ! echo "$body" | grep -qiE '#+\s*test\s+plan|## test'; then
  failures+=("Missing '## Test plan' section — list the test steps taken or automation added")
fi

if [[ ${#failures[@]} -gt 0 ]]; then
  echo "PR body validation FAILED:"
  echo ""
  for f in "${failures[@]}"; do
    echo "  [MISSING] $f"
  done
  echo ""
  echo "Required format:"
  echo "  - Include: Closes #NNNN (the GitHub issue number, not PF-XXX)"
  echo "  - Include: ## Test plan"
  echo "  - Run: python3 .claude/hooks/github_project_sync.py push  (to create GitHub issues)"
  exit 2
fi

echo "PR body validation PASSED."
exit 0
