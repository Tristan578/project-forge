#!/usr/bin/env bash
# ConfigChange hook: alert when settings.json is modified unexpectedly.
# Prints the diff to stdout (additionalContext).

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // .tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire on settings.json
if ! echo "$FILE_PATH" | grep -qE 'settings\.json$'; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

echo "SETTINGS DRIFT DETECTED: settings.json was modified."
echo ""

# Show the diff if we have a previous version in git
DIFF=$(git -C "$REPO_ROOT" diff HEAD -- "$FILE_PATH" 2>/dev/null || echo "(no diff available)")
if [ -n "$DIFF" ] && [ "$DIFF" != "(no diff available)" ]; then
  echo "--- Diff from last committed version ---"
  echo "$DIFF"
else
  echo "(No committed baseline to diff against — this may be a new file.)"
fi

echo ""
echo "Verify this change is intentional. Key settings to protect:"
echo "  - hooks configuration (do not disable lessons-learned or quality gates)"
echo "  - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var"
echo "  - permissions and tool allow-lists"

exit 0
