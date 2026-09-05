#!/bin/bash
# ============================================================================
# taskboard-state.sh — Query taskboard state for use by other hooks
# ============================================================================
# Returns JSON with board state, active tickets, and staleness warnings.
# Used as a library by other hook scripts via: source .claude/hooks/taskboard-state.sh
#
# Requires: curl, jq (or python for JSON parsing)

# Derive paths from this script's location (works on macOS/Linux/WSL)
_TB_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_TB_PROJECT_ROOT="$(cd "$_TB_HOOKS_DIR/../.." && pwd)"

TB_DB="$_TB_PROJECT_ROOT/.claude/taskboard.db"
TB_API="http://localhost:3010/api"
TB_STATE_FILE="$_TB_HOOKS_DIR/.taskboard-active-ticket"
PROJECT_ID="01KJEE8R1XXFF0CZT1WCSTGRDP"

# Check if taskboard API is reachable
tb_api_available() {
    curl -s --connect-timeout 2 "$TB_API/board" > /dev/null 2>&1
}

# Get the full board as JSON
tb_get_board() {
    curl -s --connect-timeout 3 "$TB_API/board" 2>/dev/null
}

# Get tickets by status
tb_get_tickets() {
    local status="${1:-}"
    local url="$TB_API/tickets?project=$PROJECT_ID"
    if [ -n "$status" ]; then
        url="$url&status=$status"
    fi
    curl -s --connect-timeout 3 "$url" 2>/dev/null
}

# Get a single ticket
tb_get_ticket() {
    local ticket_id="$1"
    curl -s --connect-timeout 3 "$TB_API/tickets/$ticket_id" 2>/dev/null
}

# Move a ticket to a new status
tb_move_ticket() {
    local ticket_id="$1"
    local status="$2"
    curl -s -X POST "$TB_API/tickets/$ticket_id/move" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"$status\"}" 2>/dev/null
}

# Read the currently active ticket ID from state file
tb_get_active_ticket_id() {
    if [ -f "$TB_STATE_FILE" ]; then
        cat "$TB_STATE_FILE" 2>/dev/null
    fi
}

# Set the active ticket ID
tb_set_active_ticket() {
    echo "$1" > "$TB_STATE_FILE"
}

# Clear the active ticket
tb_clear_active_ticket() {
    rm -f "$TB_STATE_FILE"
}

# Count tickets in each status column
tb_board_summary() {
    local board
    board=$(tb_get_board)
    if [ -z "$board" ]; then
        echo "BOARD_UNAVAILABLE"
        return 1
    fi

    echo "$board" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for col in data.get('columns', []):
        status = col['status']
        tickets = col.get('tickets', [])
        count = len(tickets)
        print(f'{status}:{count}')
        for t in tickets:
            priority = t.get('priority', 'medium')
            title = t.get('title', 'untitled')[:60]
            tid = t.get('id', '')
            num = t.get('number', 0)
            print(f'  PF-{num} [{priority}] {title} ({tid})')
except:
    print('PARSE_ERROR')
" 2>/dev/null
}

# Check for stale in_progress tickets (no update in last N hours)
tb_check_stale() {
    local board
    board=$(tb_get_board)
    if [ -z "$board" ]; then
        return 1
    fi

    echo "$board" | python3 -c "
import sys, json
from datetime import datetime, timezone

data = json.load(sys.stdin)
stale = []
for col in data.get('columns', []):
    if col['status'] != 'in_progress':
        continue
    for t in col.get('tickets', []):
        updated = t.get('updatedAt', '')
        try:
            # Parse ISO datetime
            dt = datetime.fromisoformat(updated.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            hours = (now - dt).total_seconds() / 3600
            if hours > 4:
                stale.append({
                    'number': t.get('number', 0),
                    'title': t.get('title', ''),
                    'hours_stale': round(hours, 1),
                    'id': t.get('id', '')
                })
        except:
            pass

if stale:
    print('STALE_TICKETS_FOUND')
    for s in stale:
        print(f\"  PF-{s['number']}: \\\"{s['title']}\\\" — stale for {s['hours_stale']}h (id: {s['id']})\")
else:
    print('NO_STALE_TICKETS')
" 2>/dev/null
}

# Validate a ticket has required fields (user story, acceptance criteria, team, priority, subtasks)
tb_validate_ticket() {
    local ticket_id="$1"
    local ticket
    ticket=$(tb_get_ticket "$ticket_id")
    if [ -z "$ticket" ]; then
        echo "TICKET_NOT_FOUND"
        return 1
    fi

    echo "$ticket" | python3 -c "
import sys, json

t = json.load(sys.stdin)
desc = t.get('description', '') or ''
title = t.get('title', '') or ''
status = t.get('status', '')
issues = []

# Content validation
if not desc.strip():
    issues.append('Missing description')
if 'User Story' not in desc and 'As a' not in desc:
    issues.append('Missing user story (As a..., I want..., so that...)')
if 'Acceptance Criteria' not in desc and 'Given' not in desc:
    issues.append('Missing acceptance criteria (Given/When/Then)')

# Metadata validation
priority = t.get('priority', '')
valid_priorities = ('urgent', 'high', 'medium', 'low')
if not priority:
    issues.append('Missing priority (urgent/high/medium/low)')
elif priority not in valid_priorities:
    issues.append(f'Invalid priority \"{priority}\" — must be one of: urgent, high, medium, low')
if not t.get('teamId'):
    issues.append('Missing team assignment')

# Subtask validation (required for todo and in_progress)
subtasks = t.get('subtasks', [])
if status in ('todo', 'in_progress') and len(subtasks) == 0:
    issues.append('Missing subtasks — tickets must have implementation steps before work begins')

if issues:
    print('VALIDATION_FAILED')
    for i in issues:
        print(f'  - {i}')
else:
    print('VALIDATION_PASSED')
" 2>/dev/null
}

# Check all open tickets for consistency issues (team, priority, subtasks)
tb_check_consistency() {
    local tickets
    tickets=$(tb_get_tickets)
    if [ -z "$tickets" ]; then
        return 1
    fi

    echo "$tickets" | python3 -c "
import sys, json

tickets = json.load(sys.stdin)
issues = []

for t in tickets:
    status = t.get('status', '')
    if status == 'done':
        continue
    num = t.get('number', 0)
    title = t.get('title', '')[:50]
    ticket_issues = []

    priority = t.get('priority', '')
    valid_priorities = ('urgent', 'high', 'medium', 'low')
    if not priority:
        ticket_issues.append('no priority')
    elif priority not in valid_priorities:
        ticket_issues.append(f'invalid priority: {priority}')
    if not t.get('teamId'):
        ticket_issues.append('no team')
    subtasks = t.get('subtasks', [])
    if len(subtasks) == 0:
        ticket_issues.append('no subtasks')

    if ticket_issues:
        detail = ', '.join(ticket_issues)
        issues.append(f'PF-{num}: {detail}')

if issues:
    print('CONSISTENCY_ISSUES_FOUND')
    for i in issues:
        print(f'  {i}')
else:
    print('ALL_TICKETS_CONSISTENT')
" 2>/dev/null
}
