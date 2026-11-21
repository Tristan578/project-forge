#!/usr/bin/env bash
# Elicitation hook: basic input validation for MCP tool inputs.
# Checks for obviously invalid inputs (empty required fields, suspicious injection patterns).

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // {}' 2>/dev/null)

if [ -z "$TOOL_NAME" ]; then
  exit 0
fi

# Check for empty tool input on commands that require params
if [ "$TOOL_INPUT" = "{}" ] || [ "$TOOL_INPUT" = "null" ] || [ -z "$TOOL_INPUT" ]; then
  echo "[validate-mcp-input] tool=$TOOL_NAME input=empty" >&2
  exit 0
fi

# Check for prompt injection patterns in string fields
INJECTION_PATTERNS='ignore previous|disregard|system prompt|override instructions|act as|you are now'
ALL_VALUES=$(echo "$TOOL_INPUT" | jq -r '[.. | strings] | join(" ")' 2>/dev/null || echo "")

if echo "$ALL_VALUES" | grep -qiE "$INJECTION_PATTERNS"; then
  echo "WARNING: MCP tool input for '$TOOL_NAME' contains patterns that resemble prompt injection."
  echo "Review the input carefully before proceeding."
  echo "Input: $TOOL_INPUT"
fi

exit 0
