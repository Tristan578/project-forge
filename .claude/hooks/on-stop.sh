#!/bin/bash
# ============================================================================
# on-stop.sh — Stop hook (all AI tools)
# ============================================================================
# Fires after the AI finishes responding.
# Validates ticket documentation, checks consistency, pushes to GitHub.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# If taskboard API isn't available, skip
if ! tb_api_available; then
    exit 0
fi

WARNINGS=""

# Check for stale in-progress tickets
STALE=$(tb_check_stale)
if echo "$STALE" | grep -q "STALE_TICKETS_FOUND"; then
    WARNINGS="$WARNINGS\n[TASKBOARD] Stale in-progress tickets need attention:\n$(echo "$STALE" | grep "^  ")"
fi

# Validate active ticket documentation
ACTIVE=$(tb_get_active_ticket_id)
if [ -n "$ACTIVE" ]; then
    VALID=$(tb_validate_ticket "$ACTIVE")
    if echo "$VALID" | grep -q "VALIDATION_FAILED"; then
        WARNINGS="$WARNINGS\n[TASKBOARD] Active ticket incomplete:\n$(echo "$VALID" | grep "^  ")"
        WARNINGS="$WARNINGS\nFix: ensure ticket has user story, acceptance criteria, team, priority, and subtasks."
    fi
fi

# Count in-progress tickets — warn if too many
IN_PROGRESS=$(tb_get_tickets "in_progress")
if [ -n "$IN_PROGRESS" ]; then
    COUNT=$(echo "$IN_PROGRESS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
    if [ "$COUNT" -gt 2 ] 2>/dev/null; then
        WARNINGS="$WARNINGS\n[TASKBOARD] $COUNT tickets in progress — complete some before starting more."
    fi
fi

# Check open ticket consistency
CONSISTENCY=$(tb_check_consistency)
if echo "$CONSISTENCY" | grep -q "CONSISTENCY_ISSUES_FOUND"; then
    COUNT=$(echo "$CONSISTENCY" | grep -c "^  ")
    WARNINGS="$WARNINGS\n[TASKBOARD] $COUNT open tickets have consistency issues (missing team/priority/subtasks)."
fi

if [ -n "$WARNINGS" ]; then
    echo -e "$WARNINGS"
fi

# Push any local ticket changes to GitHub Project
bash "$SCRIPT_DIR/sync-to-github.sh"

exit 0
