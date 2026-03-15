#!/bin/bash
# ============================================================================
# sync-from-github.sh — Pull GitHub Project changes to local taskboard
# ============================================================================
# Called by the SessionStart hook to import changes made by other contributors.
# Creates local tickets for new GitHub Project items and updates statuses.
#
# Usage:
#   bash sync-from-github.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Bail if running inside a git worktree (subagent)
if echo "$SCRIPT_DIR" | grep -q "/worktrees/"; then
    exit 0
fi

# Bail if gh CLI is not available or not authenticated
if ! command -v gh &>/dev/null; then
    echo "[SYNC] gh CLI not found — skipping GitHub pull"
    exit 0
fi
if ! gh auth status &>/dev/null 2>&1; then
    echo "[SYNC] gh not authenticated — skipping GitHub pull"
    exit 0
fi

# Bail if taskboard API isn't reachable
if ! curl -s --connect-timeout 2 "http://localhost:3010/api/board" >/dev/null 2>&1; then
    exit 0
fi

python3 "$SCRIPT_DIR/github_project_sync.py" pull 2>/dev/null

exit 0
