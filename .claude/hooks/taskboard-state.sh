#!/bin/bash
# ============================================================================
# taskboard-state.sh — Query taskboard state for use by other hooks
# ============================================================================
# Used as a library by other hook scripts via: source .claude/hooks/taskboard-state.sh
#
# Requires: curl, python3

# Derive paths from this script's location (works on macOS/Linux/WSL/Git Bash)
_TB_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_TB_PROJECT_ROOT="$(cd "$_TB_HOOKS_DIR/../.." && pwd)"

# Use the OS default database path — NOT .claude/taskboard.db (which creates an empty local copy)
TB_DB="$HOME/Library/Application Support/taskboard/taskboard.db"
# Try Portless URL first, fall back to direct port
if curl -s --connect-timeout 1 "http://taskboard.localhost:1355/api/board" > /dev/null 2>&1; then
    TB_API="http://taskboard.localhost:1355/api"
else
    TB_API="http://localhost:3010/api"
fi
TB_STATE_FILE="$_TB_HOOKS_DIR/.taskboard-active-ticket"
export PROJECT_ID="01KK974VMNC16ZAW7MW1NH3T3M"
export TEAM_ENGINEERING_ID="01KK9751NZ4HM7VQM0AQ5WGME3"

# Known locations for the taskboard binary
TB_BIN=""
for candidate in \
    "$_TB_PROJECT_ROOT/../taskboard/taskboard.exe" \
    "$_TB_PROJECT_ROOT/../taskboard/taskboard" \
    "$(command -v taskboard 2>/dev/null)" \
    "$HOME/.local/bin/taskboard" \
    "/usr/local/bin/taskboard"; do
    if [ -x "$candidate" ] 2>/dev/null; then
        TB_BIN="$candidate"
        break
    fi
done

# ---------------------------------------------------------------------------
# Installation & lifecycle
# ---------------------------------------------------------------------------

# Check if taskboard binary is installed
tb_check_installed() {
    if [ -n "$TB_BIN" ]; then
        return 0
    fi
    return 1
}

# Check if taskboard API is reachable
tb_api_available() {
    curl -s --connect-timeout 2 "$TB_API/board" > /dev/null 2>&1
}

# Auto-start taskboard if binary exists but server is not running
tb_auto_start() {
    if tb_api_available; then
        return 0  # already running
    fi
    if [ -z "$TB_BIN" ]; then
        return 1  # no binary
    fi
    # Note: don't check for DB file existence — the binary creates it on first start.
    # The OS default path is used (no --db flag), so the binary manages the DB location.

    # Start in background — the binary daemonizes by default
    # Start WITHOUT --db flag to use the OS default path (~/Library/Application Support/taskboard/)
    # Do NOT use --db .claude/taskboard.db — that creates an empty local copy
    (cd "$_TB_PROJECT_ROOT" && "$TB_BIN" start --port 3010) >/dev/null 2>&1

    # Wait up to 5 seconds for it to come up
    for i in 1 2 3 4 5; do
        sleep 1
        if tb_api_available; then
            # HEALTH CHECK: verify the board actually has data.
            # If ticket count is 0, the DB path is wrong (lesson #56).
            TICKET_COUNT=$(curl -s --connect-timeout 2 "$TB_API/board" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('tickets',[])))" 2>/dev/null || echo "0")
            if [ "$TICKET_COUNT" = "0" ]; then
                echo "[TASKBOARD WARNING] Board has 0 tickets — possible wrong DB path or sync needed." >&2
                echo "[TASKBOARD WARNING] Try: python3 .claude/hooks/github_project_sync.py pull" >&2
            fi
            return 0
        fi
    done
    return 1
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

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

# Get the current project ID (for use in hook messages)
tb_get_project_id() {
    echo "$PROJECT_ID"
}

# Get the engineering team ID (for use in hook messages)
tb_get_engineering_team_id() {
    echo "$TEAM_ENGINEERING_ID"
}
# Backward compat alias
tb_get_team_id() { tb_get_engineering_team_id; }

# ---------------------------------------------------------------------------
# Board summary
# ---------------------------------------------------------------------------

tb_board_summary() {
    local board
    board=$(tb_get_board)
    if [ -z "$board" ]; then
        echo "BOARD_UNAVAILABLE"
        return 1
    fi

    echo "$board" | python3 -c "
import sys, json, os
try:
    project_id = os.environ.get('PROJECT_ID', '')
    data = json.load(sys.stdin)
    for col in data.get('columns', []):
        status = col['status']
        tickets = [t for t in col.get('tickets', []) if not project_id or t.get('projectId') == project_id]
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

# ---------------------------------------------------------------------------
# Staleness check
# ---------------------------------------------------------------------------

tb_check_stale() {
    local board
    board=$(tb_get_board)
    if [ -z "$board" ]; then
        return 1
    fi

    echo "$board" | python3 -c "
import sys, json, os
from datetime import datetime, timezone

project_id = os.environ.get('PROJECT_ID', '')
data = json.load(sys.stdin)
stale = []
for col in data.get('columns', []):
    if col['status'] != 'in_progress':
        continue
    for t in col.get('tickets', []):
        if project_id and t.get('projectId') != project_id:
            continue
        updated = t.get('updatedAt', '')
        try:
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

# ---------------------------------------------------------------------------
# Ticket validation
# ---------------------------------------------------------------------------

tb_validate_ticket() {
    local ticket_id="$1"
    local ticket
    ticket=$(tb_get_ticket "$ticket_id")
    if [ -z "$ticket" ]; then
        echo "TICKET_NOT_FOUND"
        return 1
    fi

    echo "$ticket" | python3 -c "
import sys, json, re

t = json.load(sys.stdin)
desc = t.get('description', '') or ''
title = t.get('title', '') or ''
status = t.get('status', '')
issues = []

if not desc.strip():
    issues.append('Missing description')
else:
    # --- User story format: As a(n) ..., I want ... so that ... ---
    user_story_re = re.compile(r'As an?\s+.+,\s+I want\s+.+\s+so that\s+.+', re.IGNORECASE)
    if not user_story_re.search(desc):
        issues.append('Missing or malformed user story — must match: As a [persona], I want [goal] so that [benefit]')

    # --- Gherkin AC: count complete Given/When/Then scenarios ---
    given_re = re.compile(r'^\s*[-*]?\s*Given\s+', re.MULTILINE | re.IGNORECASE)
    when_re = re.compile(r'^\s*[-*]?\s*When\s+', re.MULTILINE | re.IGNORECASE)
    then_re = re.compile(r'^\s*[-*]?\s*Then\s+', re.MULTILINE | re.IGNORECASE)
    given_count = len(given_re.findall(desc))
    when_count = len(when_re.findall(desc))
    then_count = len(then_re.findall(desc))
    scenario_count = min(given_count, when_count, then_count)
    if scenario_count < 3:
        issues.append(f'Insufficient acceptance criteria — need 3+ Given/When/Then scenarios (happy/edge/negative), found {scenario_count}')

    # --- Description substance: strip user story + AC lines, check remainder ---
    stripped = desc
    # Remove user story line
    stripped = user_story_re.sub('', stripped)
    # Remove GWT lines
    stripped = given_re.sub('', stripped)
    stripped = when_re.sub('', stripped)
    stripped = then_re.sub('', stripped)
    # Remove section headers
    stripped = re.sub(r'^\s*\*\*.*?\*\*:?\s*$', '', stripped, flags=re.MULTILINE)
    stripped = re.sub(r'^\s*#+\s+.*$', '', stripped, flags=re.MULTILINE)
    remaining = stripped.strip()
    if len(remaining) < 20:
        issues.append('Description lacks substance — add technical context, affected files, and scope beyond user story and AC')

priority = t.get('priority', '')
valid_priorities = ('urgent', 'high', 'medium', 'low')
if not priority:
    issues.append('Missing priority (urgent/high/medium/low)')
elif priority not in valid_priorities:
    issues.append(f'Invalid priority \"{priority}\" — must be one of: urgent, high, medium, low')
if not t.get('teamId'):
    issues.append('Missing team assignment')

subtasks = t.get('subtasks', [])
if status in ('todo', 'in_progress') and len(subtasks) < 3:
    issues.append(f'Need at least 3 subtasks (implementation steps), found {len(subtasks)}')

if issues:
    print('VALIDATION_FAILED')
    for i in issues:
        print(f'  - {i}')
else:
    print('VALIDATION_PASSED')
" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Consistency check
# ---------------------------------------------------------------------------

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
    if len(subtasks) < 3:
        ticket_issues.append(f'needs 3+ subtasks (has {len(subtasks)})')

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

# ---------------------------------------------------------------------------
# Suggest work — prioritized backlog for session startup
# ---------------------------------------------------------------------------

tb_suggest_work() {
    local board
    board=$(tb_get_board)
    if [ -z "$board" ]; then
        return 1
    fi

    echo "$board" | python3 -c "
import sys, json, os

project_id = os.environ.get('PROJECT_ID', '')
data = json.load(sys.stdin)
in_progress = []
todo = []

priority_order = {'urgent': 0, 'high': 1, 'medium': 2, 'low': 3, '': 4}

for col in data.get('columns', []):
    status = col['status']
    for t in col.get('tickets', []):
        if project_id and t.get('projectId') != project_id:
            continue
        entry = {
            'number': t.get('number', 0),
            'title': t.get('title', ''),
            'priority': t.get('priority', 'medium'),
            'id': t.get('id', ''),
            'subtasks': t.get('subtasks', []),
        }
        if status == 'in_progress':
            in_progress.append(entry)
        elif status == 'todo':
            todo.append(entry)

# Sort by priority
in_progress.sort(key=lambda x: priority_order.get(x['priority'], 4))
todo.sort(key=lambda x: priority_order.get(x['priority'], 4))

print('SUGGESTED_WORK')

if in_progress:
    print('')
    print('RESUME IN-PROGRESS (complete these first):')
    for t in in_progress[:5]:
        done = sum(1 for s in t['subtasks'] if s.get('completed'))
        total = len(t['subtasks'])
        progress = f' ({done}/{total} subtasks)' if total else ''
        print(f'  [{t[\"priority\"]}] PF-{t[\"number\"]}: {t[\"title\"][:65]}{progress}')
        print(f'         id: {t[\"id\"]}')
    if len(in_progress) > 5:
        print(f'  ... and {len(in_progress) - 5} more in progress')

if todo:
    print('')
    print('PICK FROM BACKLOG (by priority):')
    for t in todo[:8]:
        print(f'  [{t[\"priority\"]}] PF-{t[\"number\"]}: {t[\"title\"][:65]}')
        print(f'         id: {t[\"id\"]}')
    if len(todo) > 8:
        print(f'  ... and {len(todo) - 8} more in backlog')

if not in_progress and not todo:
    print('  No open tickets. Create one before starting work.')
" 2>/dev/null
}
