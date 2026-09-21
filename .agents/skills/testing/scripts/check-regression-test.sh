#!/usr/bin/env bash
# check-regression-test.sh
# Usage: bash check-regression-test.sh <PR_NUMBER_OR_BRANCH>
#
# For bug-fix PRs (label: "bug" OR body contains "Fixes"/"Closes"), verifies that
# the PR diff includes at least one new or modified test file (.test.ts / .test.tsx).
# Exit 0 = pass, Exit 1 = violation.

set -euo pipefail

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <pr_number_or_branch>" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine if the target is a PR number (all digits) or a branch name.
# ---------------------------------------------------------------------------
IS_BUG_FIX=0

if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  PR_NUMBER="$TARGET"

  # Check for "bug" label
  LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null || true)
  if echo "$LABELS" | grep -qw "bug"; then
    IS_BUG_FIX=1
  fi

  # Check PR body for Fixes / Closes references
  if [[ "$IS_BUG_FIX" -eq 0 ]]; then
    BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body' 2>/dev/null || true)
    if echo "$BODY" | grep -qiE '(Fixes|Closes)\s+#?[0-9]+'; then
      IS_BUG_FIX=1
    fi
  fi

  if [[ "$IS_BUG_FIX" -eq 0 ]]; then
    echo "Not a bug fix PR — regression test check skipped"
    exit 0
  fi

  # Bug fix confirmed — check diff for test files
  DIFF_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null || true)

else
  # Branch name — inspect commit messages / branch name heuristic, then check diff
  BRANCH="$TARGET"

  # Heuristic: branch name contains "fix", "bug", or "hotfix"
  if echo "$BRANCH" | grep -qiE '(fix|bug|hotfix)'; then
    IS_BUG_FIX=1
  fi

  if [[ "$IS_BUG_FIX" -eq 0 ]]; then
    echo "Not a bug fix PR — regression test check skipped"
    exit 0
  fi

  # Get list of changed files relative to the default branch
  DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
  DIFF_FILES=$(git diff --name-only "origin/${DEFAULT_BRANCH}...${BRANCH}" 2>/dev/null || git diff --name-only HEAD 2>/dev/null || true)
fi

# ---------------------------------------------------------------------------
# Check whether any test files appear in the diff
# ---------------------------------------------------------------------------
TEST_FILES=$(echo "$DIFF_FILES" | grep -E '\.(test|spec)\.(ts|tsx)$' || true)

if [[ -z "$TEST_FILES" ]]; then
  echo "Bug fix PR missing regression test" >&2
  echo "" >&2
  echo "Changed files in diff:" >&2
  echo "$DIFF_FILES" | sed 's/^/  /' >&2
  echo "" >&2
  echo "Every bug fix must include a test that would have caught the bug." >&2
  echo "Add a .test.ts or .test.tsx file to the diff to pass this check." >&2
  exit 1
fi

echo "Regression test found"
echo ""
echo "Test files in diff:"
echo "$TEST_FILES" | sed 's/^/  /'
exit 0
