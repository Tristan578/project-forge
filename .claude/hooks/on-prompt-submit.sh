#!/bin/bash
# ============================================================================
# on-prompt-submit.sh — UserPromptSubmit hook (all AI tools)
# ============================================================================
# Fires before the AI processes each user prompt.
# Enforces ticket-first development: blocks code-writing requests that
# don't have an active ticket.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# Read the user's prompt from stdin
INPUT=$(cat)

# If taskboard API isn't available, warn but don't block
if ! tb_api_available; then
    echo "[TASKBOARD] Server not reachable. Start it before doing development work."
    echo "  taskboard start --port 3010 --db .claude/taskboard.db"
    exit 0
fi

# Check for stale in-progress tickets
STALE=$(tb_check_stale)
if echo "$STALE" | grep -q "STALE_TICKETS_FOUND"; then
    echo "[TASKBOARD] Stale in-progress tickets detected:"
    echo "$STALE" | grep "^  "
    echo "Consider completing or updating these before starting new work."
    echo ""
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
    exit 0
fi

# ── No active ticket — check if the prompt looks like development work ────

# Detect development-intent keywords (case-insensitive)
DEV_MATCH=$(echo "$INPUT" | python3 -c "
import sys, re
prompt = sys.stdin.read().lower()
# Development keywords — things that imply code changes
dev_patterns = [
    r'\b(implement|fix|build|add|create|refactor|update|change|modify|write|delete|remove|rename|move)\b',
    r'\b(code|function|class|component|module|feature|bug|test|endpoint|route|api)\b',
    r'\b(pr|pull request|commit|branch|merge|deploy|release)\b',
    r'\b(install|upgrade|migrate|patch|hotfix)\b',
]
# Exceptions — things that are clearly not code work
safe_patterns = [
    r'\b(help|explain|show|list|what|how|why|describe|search|find|read|look|check|status|board|ticket|plan|spec)\b',
    r'\bsync.?(push|pull)\b',
    r'\b/\w+\b',  # slash commands
]
is_dev = any(re.search(p, prompt) for p in dev_patterns)
is_safe = any(re.search(p, prompt) for p in safe_patterns)
# Only flag if it looks like dev work AND doesn't look like a safe query
if is_dev and not is_safe:
    print('DEV_INTENT_DETECTED')
else:
    print('OK')
" 2>/dev/null)

if [ "$DEV_MATCH" = "DEV_INTENT_DETECTED" ]; then
    cat <<'EOF'
[TASKBOARD] NO ACTIVE TICKET — development work requires a ticket.

Before writing any code, you MUST:
  1. Check the board:  Review suggested work from session startup
  2. Pick a ticket:    Select an existing todo/in_progress ticket
  3. Or create one:    With user story, acceptance criteria, priority, team, subtasks
  4. Set it active:    Move to in_progress before beginning work

This ensures all contributors can track progress via the shared GitHub Project board.
Planning before development is mandatory for this project.
EOF
fi

exit 0
