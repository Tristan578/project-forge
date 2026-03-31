#!/usr/bin/env bash
# TaskCompleted hook: verify deliverables are documented before a task is closed.
# Prints a reminder to stdout (additionalContext) if documentation is thin.

set -euo pipefail

INPUT=$(cat)
TITLE=$(echo "$INPUT" | jq -r '.task.title // "unknown task"' 2>/dev/null)
DESCRIPTION=$(echo "$INPUT" | jq -r '.task.description // ""' 2>/dev/null)
SUBTASKS=$(echo "$INPUT" | jq -r '.task.subtasks // [] | length' 2>/dev/null || echo "0")
COMPLETED_SUBTASKS=$(echo "$INPUT" | jq -r '[.task.subtasks // [] | .[] | select(.completed == true)] | length' 2>/dev/null || echo "0")

ISSUES=""

# Check that description mentions deliverables or outcome
if ! echo "$DESCRIPTION" | grep -qiE 'deliverable|outcome|result|completed|implemented|fixed|shipped|done'; then
  ISSUES="$ISSUES\n- Description does not mention deliverables or outcomes."
fi

# Check that subtasks were completed if any exist
if [ "$SUBTASKS" -gt 0 ] && [ "$COMPLETED_SUBTASKS" -lt "$SUBTASKS" ]; then
  REMAINING=$(( SUBTASKS - COMPLETED_SUBTASKS ))
  ISSUES="$ISSUES\n- $REMAINING of $SUBTASKS subtasks are still incomplete."
fi

if [ -n "$ISSUES" ]; then
  echo "REMINDER: Task '$TITLE' completed with potential documentation gaps:"
  echo -e "$ISSUES"
  echo "Update the task description with what was delivered before moving on."
fi

exit 0
