#!/bin/bash
# ============================================================================
# on-session-start.sh — SessionStart hook
# ============================================================================
# Fires when a Claude Code session starts or resumes.
# Injects current taskboard state into Claude's context so it knows what
# work exists, what's in progress, and what's stale.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# Try to reach the API; if not available, print a soft warning
if ! tb_api_available; then
    cat <<'EOF'
[TASKBOARD] Server not running. Start it with:
  D:/repos/into-rust/taskboard/taskboard.exe start --port 3010 --db D:/repos/into-rust/project-forge/.claude/taskboard.db
All work MUST be tracked on the taskboard. See CLAUDE.md "Taskboard Rules".
EOF
    exit 0
fi

# Get board summary
echo "═══════════════════════════════════════════════════════"
echo " TASKBOARD STATUS (http://localhost:3010)"
echo "═══════════════════════════════════════════════════════"
tb_board_summary
echo ""

# Check for stale tickets
STALE=$(tb_check_stale)
if echo "$STALE" | grep -q "STALE_TICKETS_FOUND"; then
    echo "⚠ STALE IN-PROGRESS TICKETS:"
    echo "$STALE" | grep "^  "
    echo ""
    echo "ACTION REQUIRED: Update or complete stale tickets before starting new work."
    echo ""
fi

# Show active ticket if one is set
ACTIVE=$(tb_get_active_ticket_id)
if [ -n "$ACTIVE" ]; then
    echo "Active ticket: $ACTIVE"
    VALID=$(tb_validate_ticket "$ACTIVE")
    if echo "$VALID" | grep -q "VALIDATION_FAILED"; then
        echo "⚠ Active ticket has documentation issues:"
        echo "$VALID" | grep "^  "
    fi
fi

# Check open ticket consistency (team, priority, subtasks)
CONSISTENCY=$(tb_check_consistency)
if echo "$CONSISTENCY" | grep -q "CONSISTENCY_ISSUES_FOUND"; then
    echo ""
    echo "⚠ TICKET CONSISTENCY ISSUES (open tickets):"
    echo "$CONSISTENCY" | grep "^  "
    echo ""
    echo "ACTION REQUIRED: Fix missing team/priority/subtasks before starting work."
fi

echo "═══════════════════════════════════════════════════════"
echo "RULES:"
echo "  - All work must have a taskboard ticket BEFORE starting"
echo "  - Every ticket must have: team, priority, subtasks, user story, acceptance criteria"
echo "  - Use the taskboard MCP tools to create/manage tickets"
echo "═══════════════════════════════════════════════════════"

exit 0
