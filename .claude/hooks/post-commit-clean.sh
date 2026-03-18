#!/bin/bash
# ============================================================================
# post-commit-clean.sh — PostToolUse hook for Bash commands containing git commit or gh pr
# ============================================================================
# Strips robot emojis, "Generated with Claude Code", and Co-Authored-By
# trailers from commit messages and PR bodies AFTER they're created.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

# Only trigger on git commit or gh pr create commands
echo "$COMMAND" | grep -qE "git commit|gh pr create" || exit 0

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && exit 0

# Check if the last commit message has the attribution
LAST_MSG=$(git log -1 --format="%B" 2>/dev/null)
if echo "$LAST_MSG" | grep -qE "Generated with|Claude Code|Co-Authored-By.*Claude|🤖"; then
  # Amend the commit message to remove attribution
  CLEAN_MSG=$(echo "$LAST_MSG" | \
    sed '/🤖 Generated with \[Claude Code\]/d' | \
    sed '/Generated with \[Claude Code\]/d' | \
    sed '/Co-Authored-By:.*Claude/d' | \
    sed '/Co-Authored-By:.*noreply@anthropic/d' | \
    sed 's/🤖//g' | \
    sed -e :a -e '/^\n*$/{$d;N;ba}')

  git commit --amend -m "$CLEAN_MSG" --no-verify 2>/dev/null
  echo "[CLEAN] Removed attribution from commit message"
fi

exit 0
