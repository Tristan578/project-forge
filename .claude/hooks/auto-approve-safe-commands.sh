#!/usr/bin/env bash
# PermissionRequest hook: auto-approve known-safe read/build/test commands.
# Blocks anything not on the safe list (exit code 2).
#
# Safe commands: npm, npx, git status/diff/log/branch/worktree (read-only),
# vitest, eslint, tsc, cargo check, python (read-only scripts).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Strip leading whitespace
COMMAND_TRIMMED="${COMMAND#"${COMMAND%%[![:space:]]*}"}"

# Check against the safe-command allow list
is_safe() {
  local cmd="$1"

  # npm — only specific safe subcommands
  if echo "$cmd" | grep -qE '^npm (install|ci|run|test|ls|outdated|view|explain|exec|why|pkg|cache clean|audit)( |$)'; then
    return 0
  fi

  # npx — only known-safe tools (vitest, eslint, tsc, playwright, drizzle-kit, skills)
  if echo "$cmd" | grep -qE '^npx (vitest|eslint|tsc|playwright|drizzle-kit|skills|@axe-core)( |$)'; then
    return 0
  fi

  # Git read-only commands
  if echo "$cmd" | grep -qE '^git (status|diff|log|branch|worktree list|show|shortlog|describe|tag|remote -v|ls-files|rev-parse|stash list)'; then
    return 0
  fi

  # Cargo check (WASM target)
  if echo "$cmd" | grep -qE '^cargo check'; then
    return 0
  fi

  # Python read-only scripts (arch validator, sync scripts)
  if echo "$cmd" | grep -qE '^python3? .claude/(skills|hooks)/.*\.(py|sh)'; then
    return 0
  fi

  # Bash validation scripts
  if echo "$cmd" | grep -qE '^bash .claude/tools/validate'; then
    return 0
  fi

  return 1
}

if is_safe "$COMMAND_TRIMMED"; then
  echo "[auto-approve-safe-commands] approved: $COMMAND_TRIMMED" >&2
  exit 0
fi

# Not on the safe list — block and explain
echo "PERMISSION DENIED: The following command requires explicit user approval:"
echo "  $COMMAND_TRIMMED"
echo ""
echo "This command is not on the auto-approve list. Safe commands (npm, npx, git read-only,"
echo "vitest, eslint, tsc, cargo check) are approved automatically."
echo "Request user permission before running write/deploy/publish operations."

exit 2
