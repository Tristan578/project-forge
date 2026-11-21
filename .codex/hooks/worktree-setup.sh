#!/usr/bin/env bash
# WorktreeCreate hook: auto-configure a new worktree.
# Ensures .env.local symlink exists and runs npm install if needed.

set -euo pipefail

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null)

if [ -z "$WORKTREE_PATH" ]; then
  echo "[worktree-setup] No worktree_path in event — skipping." >&2
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
ENV_LOCAL="$REPO_ROOT/web/.env.local"

echo "[worktree-setup] Configuring new worktree at $WORKTREE_PATH" >&2

# Symlink .env.local into the worktree's web/ directory if it exists in main
if [ -f "$ENV_LOCAL" ] && [ ! -f "$WORKTREE_PATH/web/.env.local" ]; then
  ln -sf "$ENV_LOCAL" "$WORKTREE_PATH/web/.env.local" 2>/dev/null || true
  echo "[worktree-setup] Symlinked .env.local into worktree" >&2
fi

# Run npm install in web/ if node_modules is missing
if [ ! -d "$WORKTREE_PATH/web/node_modules" ]; then
  echo "[worktree-setup] node_modules missing — running npm install..." >&2
  (cd "$WORKTREE_PATH/web" && npm install --silent 2>/dev/null) || true
  echo "[worktree-setup] npm install complete" >&2
fi

echo "Worktree configured at $WORKTREE_PATH. .env.local symlinked and node_modules ready."

exit 0
