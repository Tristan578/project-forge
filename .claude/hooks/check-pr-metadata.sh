#!/usr/bin/env bash
# PreToolUse hook: fires on `gh pr create` commands.
# Validates that the command includes --milestone and Closes #NNNN in the body.
# Exits 1 to BLOCK the command if metadata is missing.

set -euo pipefail

# Read tool input from stdin (JSON) — same pattern as pre-push-quality-gate.sh
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Fallback: try env var convention (TOOL_INPUT_command)
if [ -z "$COMMAND" ]; then
  COMMAND="${TOOL_INPUT_command:-}"
fi

# Only check gh pr create commands
if [[ "$COMMAND" != *"gh pr create"* ]]; then
  exit 0
fi

ERRORS=()

# Check for Closes #NNNN in the body
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
