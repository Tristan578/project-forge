#!/usr/bin/env bash
# PreToolUse hook: fires on `gh pr create` commands.
# Validates that the command includes --milestone and Closes #NNNN in the body.
# Exits 1 to BLOCK the command if metadata is missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/hook-utils.sh"

COMMAND=$(get_bash_command)

# Only check gh pr create commands
if [[ "$COMMAND" != *"gh pr create"* ]]; then
  exit 0
fi

# Bypass for automated PRs (autoforge scripts use their own metadata)
if echo "$COMMAND" | grep -qE 'autoforge:'; then
  exit 0
fi

ERRORS=()

# Best-effort check: grep the command string for Closes #NNNN.
# This catches inline --body but not --body-file (not used by our automation).
if ! echo "$COMMAND" | grep -qiE 'Closes #[0-9]+'; then
  ERRORS+=("PR body must contain 'Closes #NNNN' linking to a GitHub issue.")
fi

# Check for --milestone flag
if ! echo "$COMMAND" | grep -qE '\-\-milestone'; then
  ERRORS+=("PR must specify --milestone (e.g. --milestone 'P1: User Workflow Blockers').")
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "================================================================"
  echo "  PR METADATA CHECK — MISSING REQUIRED FIELDS"
  echo "================================================================"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo ""
  echo "  Available milestones:"
  echo "    P0: Production Blockers"
  echo "    P1: User Workflow Blockers"
  echo "    P2: Degraded Experience"
  echo "    P3: Tech Debt"
  echo "================================================================"
  exit 1
fi

exit 0
