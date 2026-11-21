#!/usr/bin/env bash
# Stop hook for the builder agent.
# Verifies the agent ran lint and tests before stopping.
# Exit 0 with a reminder if quality checks were not run — non-blocking but visible.

set -euo pipefail

INPUT=$(cat)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)

MISSING_CHECKS=""

# Check that eslint was run
if ! echo "$OUTPUT" | grep -qiE 'eslint|lint'; then
  MISSING_CHECKS="$MISSING_CHECKS\n  - ESLint (npx eslint --max-warnings 0 .)"
fi

# Check that tsc was run
if ! echo "$OUTPUT" | grep -qiE 'tsc --noEmit|TypeScript check|type check'; then
  MISSING_CHECKS="$MISSING_CHECKS\n  - TypeScript (npx tsc --noEmit)"
fi

# Check that vitest was run
if ! echo "$OUTPUT" | grep -qiE 'vitest|npx vitest|test run|tests passed'; then
  MISSING_CHECKS="$MISSING_CHECKS\n  - Unit tests (npx vitest run)"
fi

if [ -n "$MISSING_CHECKS" ]; then
  echo "QUALITY GATE REMINDER: The following checks were not confirmed in this session:"
  echo -e "$MISSING_CHECKS"
  echo ""
  echo "Before declaring work complete, run:"
  echo "  bash .claude/tools/validate-frontend.sh quick"
  echo ""
  echo "This is a reminder, not a block. Ensure checks pass before creating a PR."
fi

exit 0
