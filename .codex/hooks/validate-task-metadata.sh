#!/usr/bin/env bash
# TaskCreated hook: verify the new task has required fields (title, description).
# Prints a warning to stdout (additionalContext) if fields are missing.

set -euo pipefail

INPUT=$(cat)
TITLE=$(echo "$INPUT" | jq -r '.task.title // empty' 2>/dev/null)
DESCRIPTION=$(echo "$INPUT" | jq -r '.task.description // empty' 2>/dev/null)

MISSING=""

if [ -z "$TITLE" ]; then
  MISSING="$MISSING title"
fi

if [ -z "$DESCRIPTION" ]; then
  MISSING="$MISSING description"
fi

if [ -n "$MISSING" ]; then
  echo "WARNING: Newly created task is missing required fields:$MISSING."
  echo "Every task MUST have a title and description before work begins."
  echo "Update the task now to avoid tracking issues downstream."
fi

exit 0
