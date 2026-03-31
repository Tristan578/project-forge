#!/usr/bin/env bash
# PreToolUse(Bash) hook for reviewer agents.
# Blocks any Bash commands that write to the repository or publish artifacts.
# Reviewers are read-only — they check code, they do not change it.
#
# Exit code 2 = block the command.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only apply to Bash tool
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block write operations
BLOCKED_PATTERNS=(
  'git commit'
  'git push'
  'git add'
  'git merge'
  'git rebase'
  'git reset'
  'git checkout'
  'git stash'
  'npm publish'
  'npm install'
  'npx.*write'
  'vercel deploy'
  'wrangler deploy'
  'rm -rf'
  'rm -f'
  '> [^/]'    # stdout redirect to file
  'tee '
  'cp '
  'mv '
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: Reviewer agents are read-only."
    echo "The following command is not permitted:"
    echo "  $COMMAND"
    echo ""
    echo "Reviewers may only read files (Read, Grep, Glob) and run read-only Bash commands."
    echo "If you need to fix code, report the finding in your review — do not modify code directly."
    exit 2
  fi
done

exit 0
