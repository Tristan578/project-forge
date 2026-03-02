#!/bin/bash
# ============================================================================
# on-prompt-submit.sh — UserPromptSubmit hook
# ============================================================================
# Fires before Claude processes each user prompt.
# Checks board state and reminds Claude about active ticket and staleness.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# Read the user's prompt from stdin
INPUT=$(cat)

# If taskboard API isn't available, just pass through
if ! tb_api_available; then
    exit 0
fi

# Check for stale in-progress tickets and inject a reminder
STALE=$(tb_check_stale)
if echo "$STALE" | grep -q "STALE_TICKETS_FOUND"; then
    echo "[TASKBOARD] Stale in-progress tickets detected:"
    echo "$STALE" | grep "^  "
    echo "Consider completing or updating these before starting new work."
fi

# Inject active ticket context
ACTIVE=$(tb_get_active_ticket_id)
if [ -n "$ACTIVE" ]; then
    TICKET_JSON=$(tb_get_ticket "$ACTIVE")
    if [ -n "$TICKET_JSON" ]; then
        TITLE=$(echo "$TICKET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title',''))" 2>/dev/null)
        STATUS=$(echo "$TICKET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
        NUM=$(echo "$TICKET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('number',0))" 2>/dev/null)
        echo "[TASKBOARD] Active ticket: PF-$NUM \"$TITLE\" (status: $STATUS)"
    fi
fi

exit 0
