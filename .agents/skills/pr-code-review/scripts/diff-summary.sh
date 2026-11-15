#!/usr/bin/env bash
# diff-summary.sh — Extract changed files + line counts from git diff
# Usage: bash scripts/diff-summary.sh [base-branch]
# Output: filename, lines-added, lines-deleted — one entry per changed file
# Exit 0: informational only

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

BASE="${1:-main}"

echo "Changed files vs ${BASE}:"
echo ""

git diff --numstat "${BASE}...HEAD" | while IFS=$'\t' read -r added deleted file; do
  # Skip binary files (reported as - -)
  if [[ "$added" == "-" ]]; then
    printf "  %-60s  [binary]\n" "$file"
  else
    printf "  %-60s  +%-6s -%-6s\n" "$file" "$added" "$deleted"
  fi
done

echo ""
echo "Summary:"
git diff --shortstat "${BASE}...HEAD" || true
