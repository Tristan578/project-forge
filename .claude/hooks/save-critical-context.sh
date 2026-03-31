#!/usr/bin/env bash
# PreCompact hook: dump current branch, recent commits, and working state to a
# temp file so PostCompact can restore context hints after memory is compacted.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
CONTEXT_FILE="/tmp/spawnforge-context-snapshot.txt"

{
  echo "=== SpawnForge Context Snapshot ==="
  echo "Saved: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""

  echo "--- Current Branch ---"
  git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "(unknown)"
  echo ""

  echo "--- Recent Commits (last 10) ---"
  git -C "$REPO_ROOT" log --oneline -10 2>/dev/null || echo "(no commits)"
  echo ""

  echo "--- Uncommitted Changes ---"
  git -C "$REPO_ROOT" status --short 2>/dev/null || echo "(clean)"
  echo ""

  echo "--- Open PRs (this branch) ---"
  BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null)
  if [ -n "$BRANCH" ]; then
    gh pr list --head "$BRANCH" --json number,title,url 2>/dev/null \
      | jq -r '.[] | "#\(.number) \(.title) — \(.url)"' 2>/dev/null || echo "(none or gh not available)"
  fi
  echo ""

  echo "--- Active Worktrees ---"
  git -C "$REPO_ROOT" worktree list 2>/dev/null || echo "(none)"
} > "$CONTEXT_FILE" 2>/dev/null

echo "[save-critical-context] Snapshot saved to $CONTEXT_FILE" >&2

exit 0
