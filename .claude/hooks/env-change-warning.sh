#!/usr/bin/env bash
# FileChanged(.env*) hook: warn when an env file is created or modified.
# Stdout is injected as additionalContext into the conversation.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire on .env* files
if ! echo "$FILE_PATH" | grep -qE '\.env(\.|$)'; then
  exit 0
fi

echo "WARNING: Environment file modified — '$FILE_PATH'."
echo "Verify no secrets are committed to git. Run 'git diff --name-only HEAD' to confirm."
echo "If this is intentional, ensure .env* is in .gitignore and .env.example is up-to-date."

exit 0
