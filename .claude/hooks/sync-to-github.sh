#!/bin/bash
# ============================================================================
# sync-to-github.sh — Push local taskboard changes to GitHub Project
# ============================================================================
# Called by the Stop hook after each Claude response.
# Only syncs tickets whose status changed since last sync (fast no-op otherwise).
#
# Usage:
#   bash sync-to-github.sh          # Incremental push (todo + in_progress + newly done)
#   bash sync-to-github.sh --all    # Full push including all done tickets

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Bail if running inside a git worktree (subagent)
if echo "$SCRIPT_DIR" | grep -q "/worktrees/"; then
    exit 0
fi

# Bail if gh CLI is not available or not authenticated
if ! command -v gh &>/dev/null; then
    exit 0
fi
if ! gh auth status &>/dev/null 2>&1; then
    exit 0
fi

# Bail if taskboard API isn't reachable
if ! curl -s --connect-timeout 2 "http://localhost:3010/api/board" >/dev/null 2>&1; then
    exit 0
fi

MODE="push"
if [ "$1" = "--all" ]; then
    MODE="push-all"
fi

python3 "$SCRIPT_DIR/github_project_sync.py" "$MODE" 2>/dev/null

exit 0
