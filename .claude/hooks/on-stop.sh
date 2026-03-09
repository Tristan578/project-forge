#!/bin/bash
# ============================================================================
# on-stop.sh — Stop hook (all AI tools)
# ============================================================================
# Fires after the AI finishes responding.
# Lightweight: fires GitHub sync in background so it never blocks the CLI.
# Stale/consistency checks are done at session start and prompt submit only.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Fire-and-forget: sync in background so the hook returns immediately.
# Redirect all output to /dev/null to avoid blocking on stdout/stderr.
bash "$SCRIPT_DIR/sync-to-github.sh" >/dev/null 2>&1 &
disown

exit 0
