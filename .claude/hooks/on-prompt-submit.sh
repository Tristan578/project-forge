#!/bin/bash
# ============================================================================
# on-prompt-submit.sh — UserPromptSubmit hook (all AI tools)
# ============================================================================
# Fires before the AI processes each user prompt.
# Enforces ticket-first development: when development work is detected without
# an active ticket, instructs the AI to find or create one before proceeding.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# Read the user's prompt from stdin
INPUT=$(cat)

# If taskboard API isn't available, warn but don't block
if ! tb_api_available; then
    echo "[TASKBOARD] Server not reachable. Start it before doing development work."
    echo "  taskboard start --port 3010    # NO --db flag — use OS default"
    exit 0
fi

# Health check: verify board has data (lesson #56)
BOARD_COUNT=$(curl -s --connect-timeout 2 "$TB_API/board" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(len(c.get('tickets',[])) for c in d.get('columns',[])) or len(d.get('tickets',[])))" 2>/dev/null || echo "0")
if [ "$BOARD_COUNT" = "0" ]; then
    echo "[TASKBOARD WARNING] Board has 0 tickets — wrong DB path or sync needed."
    echo "  Kill and restart: pkill taskboard && taskboard start --port 3010"
    echo "  Then sync: python3 .claude/hooks/github_project_sync.py pull"
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
    # Extract a summary of what the user wants to do (first 200 chars)
    PROMPT_SUMMARY=$(printf '%s' "$INPUT" | head -c 200)

    # Resolve dynamic values before the quoted heredoc (which prevents expansion)
    _HOOK_PROJECT_ID=$(tb_get_project_id)
    _HOOK_TEAM_ID=$(tb_get_team_id)

    # Use quoted heredoc to prevent shell expansion of user input
    printf '%s\n' "<user-prompt-submit-hook>"
    cat <<'HOOK'
[TASKBOARD] NO ACTIVE TICKET — development work requires tracking.

You MUST find or create a ticket before writing any code. Do this NOW:

1. SEARCH the taskboard for an existing ticket matching this work:
   curl -s 'http://localhost:3010/api/tickets?limit=50' | Search for keywords from the user's request

2. IF a matching ticket exists:
   - Move it to in_progress via: POST http://localhost:3010/api/tickets/{id}/move with {"status": "in_progress"}

3. IF no matching ticket exists, CREATE one with ALL required fields:
   - POST http://localhost:3010/api/tickets with:
     {
       "title": "<imperative description of the work>",
       "description": "**User Story:**\nAs a developer, I want <goal from prompt> so that <benefit>.\n\n**Description:**\n<technical context>\n\n**Acceptance Criteria:**\n- Given <precondition>, When <action>, Then <result>\n- Given <precondition>, When <action>, Then <result>\n- Given <precondition>, When <action>, Then <result>",
       "priority": "medium",
HOOK
    printf '       "projectId": "%s",\n' "$_HOOK_PROJECT_ID"
    printf '       "teamId": "%s"\n' "$_HOOK_TEAM_ID"
    cat <<'HOOK'
     }
   - Then add subtasks: POST http://localhost:3010/api/tickets/{id}/subtasks
   - Then move to in_progress

4. THEN proceed with the user's request.

HOOK
    printf 'User'\''s request context: %s\n' "$PROMPT_SUMMARY"
    printf '%s\n' "</user-prompt-submit-hook>"
    # Exit 0 so the prompt is NOT blocked — the AI should handle ticket creation inline
    exit 0
fi

exit 0
