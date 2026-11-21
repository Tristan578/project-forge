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

# Kill switch. This script is fired by the Stop hook after EVERY assistant
# response, so when the sync misbehaves there is no interactive moment in which
# to stop it — the only lever anyone had was to hold its flock from a detached
# process and remember to kill that pid later. Checked here (before gh, curl or
# python3 are even probed) and again inside github_project_sync.py, so it works
# from every entry point.
#   Disable: touch .claude/hooks/.sync-disabled   (or export SPAWNFORGE_SYNC_DISABLED=1)
#   Enable:  rm .claude/hooks/.sync-disabled
if [ -f "$SCRIPT_DIR/.sync-disabled" ] ||
    { [ -n "${SPAWNFORGE_SYNC_DISABLED:-}" ] && [ "${SPAWNFORGE_SYNC_DISABLED}" != "0" ]; }; then
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

# Log rather than discard. This ran as `2>/dev/null` inside a caller that
# already redirects to /dev/null, so a failing sync was invisible from both
# sides — which is how 240 tickets drifted out of alignment with their GitHub
# issues without anything ever reporting it. Still exits 0: a sync failure
# must not block the CLI.
LOG="$SCRIPT_DIR/.sync.log"
{
    echo "--- $(date '+%Y-%m-%d %H:%M:%S') $MODE ---"
    python3 "$SCRIPT_DIR/github_project_sync.py" "$MODE" 2>&1
    echo "--- exit $? ---"
} >>"$LOG" 2>&1

# Keep the log bounded (last 2000 lines).
if [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
    tail -n 1000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit 0
