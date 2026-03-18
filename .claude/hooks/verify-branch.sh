#!/bin/bash
# Pre-edit hook: verify the current git branch matches the expected working context.
#
# Prevents the recurring issue where Claude edits files while on the wrong
# branch, causing commits to land on unrelated PRs or creating merge conflicts.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -z "$CURRENT_BRANCH" ]; then
  exit 0
fi

# Warn if editing test infrastructure files while on a feature branch
if echo "$FILE_PATH" | grep -qE "route\.test\.ts|negative-cases\.test\.ts|vitest\.setup"; then
  if echo "$CURRENT_BRANCH" | grep -qE "^feat/"; then
    echo "WARNING: Editing test infrastructure file while on feature branch '$CURRENT_BRANCH'" >&2
  fi
fi

exit 0
