#!/usr/bin/env bash
# InstructionsLoaded hook: inject branch name and recent PR context into the session.
# Runs at session start when instructions are loaded.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "unknown")
RECENT_COMMITS=$(git -C "$REPO_ROOT" log --oneline -5 2>/dev/null || echo "(none)")

echo "=== Dynamic Session Context ==="
echo "Branch: $BRANCH"
echo ""
echo "Recent commits:"
echo "$RECENT_COMMITS"
echo ""

# Check for an open PR on this branch
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "unknown" ]; then
  PR_INFO=$(gh pr list --head "$BRANCH" --json number,title,url,state 2>/dev/null \
    | jq -r '.[] | "#\(.number) [\(.state)] \(.title) — \(.url)"' 2>/dev/null || echo "")
  if [ -n "$PR_INFO" ]; then
    echo "Open PR for this branch:"
    echo "$PR_INFO"
    echo ""
  fi
fi

echo "Taskboard: http://taskboard.localhost:1355"
echo "Dev URL: http://spawnforge.localhost:1355/dev"

exit 0
