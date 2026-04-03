#!/usr/bin/env bash
# PostToolUseFailure hook: log hook failures with context.
#
# With 49 hooks across 19 events, a broken hook (bad jq path, missing binary,
# timeout) silently degrades the pipeline. This logs failures to a rotating
# file so they can be diagnosed.

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
ERROR=$(echo "$INPUT" | jq -r '.error // .reason // "unknown"' 2>/dev/null)
HOOK_NAME=$(echo "$INPUT" | jq -r '.hook_command // "unknown"' 2>/dev/null)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LOG_DIR="${HOME}/.claude/logs"
LOG_FILE="${LOG_DIR}/hook-failures.log"

mkdir -p "$LOG_DIR"

# Rotate if over 100KB
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 102400 ]; then
  mv "$LOG_FILE" "${LOG_FILE}.old"
fi

echo "[$TIMESTAMP] tool=$TOOL hook=$HOOK_NAME error=$ERROR" >> "$LOG_FILE"

# Output to additionalContext so the user sees it
echo "[hook-failure] A hook failed during $TOOL: $ERROR"
echo "  Hook: $HOOK_NAME"
echo "  Log: $LOG_FILE"

exit 0
