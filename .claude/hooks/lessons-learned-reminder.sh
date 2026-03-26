#!/bin/bash
# ============================================================================
# lessons-learned-reminder.sh — Stop hook
# ============================================================================
# Periodically reminds the agent to consider logging lessons learned.
# Uses a counter file to avoid reminding on every single response.
# Fires every N responses (default: 15) to balance signal vs noise.
#
# Output is injected as context into the conversation. If the agent has
# nothing to log, it simply continues. If it does, it writes to the
# lessons learned file.

REMINDER_INTERVAL=15

# Use session_id from input if available, fall back to a hash of the project dir.
# This keeps the counter stable across hook invocations within one Claude session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(echo "$PWD" | shasum | cut -c1-12)
fi
COUNTER_FILE="/tmp/claude-lessons-reminder-${SESSION_ID}"

# Increment counter
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# Only remind every N responses
if [ $((COUNT % REMINDER_INTERVAL)) -ne 0 ]; then
  exit 0
fi

# Check if there have been any tool uses (indicates real work, not just chat)
# The Stop hook doesn't receive tool info, so we just use the counter as proxy

cat << 'EOF'
LESSONS LEARNED CHECK — You have completed a significant chunk of work in this session. Before continuing, briefly consider:

1. Did you encounter any bugs, gotchas, or surprising behavior that future sessions should know about?
2. Did you discover a pattern that worked well and should be repeated?
3. Did you find documentation that was wrong or misleading?
4. Did you make a mistake that a lesson could prevent next time?

If yes to any: add the lesson to ~/.claude/projects/-Users-tristannolan-project-forge/memory/project_lessons_learned.md following the existing format (### N. title, What happens, Why, Prevention, Ticket).

If nothing to log, continue with your work.
EOF

exit 0
