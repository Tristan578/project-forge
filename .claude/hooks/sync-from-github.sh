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

python3 "$SCRIPT_DIR/github_project_sync.py" pull 2>&1

# Then a state-based sweep. `pull` only sees the 100 most recently closed
# issues and only acts when the map's remembered status differs, so a ticket
# whose update failed once — or whose issue was closed outside that window —
# is invisible to it forever. `reconcile` compares the two systems' ACTUAL
# states, so it cannot latch and is safe to re-run. It applies the same rule
# push already applies (a done ticket closes its issue); the difference is
# that it is driven by observation rather than by a memo.
#
# Detached, because it lists EVERY issue in the repo (~8k) and this script runs
# on the SessionStart path: inline, it made the user wait on that listing
# before the session could start. Nothing downstream reads its result, so it
# only needs to be started. It takes the same exclusive lock push does, so a
# sweep still running when the next sync fires skips itself rather than
# interleaving. Output goes to the shared sync log, bounded like the others.
SYNC_LOG="$SCRIPT_DIR/.sync.log"
nohup python3 "$SCRIPT_DIR/github_project_sync.py" reconcile-apply >>"$SYNC_LOG" 2>&1 &
echo "[SYNC] reconcile sweep started in background (log: .sync.log)"

exit 0
