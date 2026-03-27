#!/bin/bash
# PreToolUse hook for Bash: block git commit on main/master.
# Agents (especially worktree agents) must use feature branches.
# Direct commits to main bypass CI/CD and Sentry review.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# If the command also checks out a new branch before committing, allow it
# (e.g., "git checkout -b feat/xxx && git add . && git commit")
if echo "$COMMAND" | grep -qE 'git\s+(checkout\s+-b|switch\s+-c)'; then
  exit 0
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)

if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "BLOCKED: git commit on '$CURRENT_BRANCH' is not allowed."
  echo "Create a feature branch first: git checkout -b feat/your-feature"
  echo "Direct commits to main bypass CI/CD, Sentry review, and code review."
  exit 2
fi

exit 0
