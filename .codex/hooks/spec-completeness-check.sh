#!/usr/bin/env bash
# Stop hook for the planner agent.
# Checks that output contains required spec sections.
# Exit 0 with a warning if sections are missing — non-blocking but visible.

set -euo pipefail

INPUT=$(cat)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)

MISSING_SECTIONS=""

# Required spec sections
if ! echo "$OUTPUT" | grep -qiE '^#+.*summary|## summary'; then
  MISSING_SECTIONS="$MISSING_SECTIONS\n  - Summary section (## Summary)"
fi

if ! echo "$OUTPUT" | grep -qiE 'acceptance criteria|## acceptance'; then
  MISSING_SECTIONS="$MISSING_SECTIONS\n  - Acceptance Criteria section"
fi

if ! echo "$OUTPUT" | grep -qiE 'test plan|## test'; then
  MISSING_SECTIONS="$MISSING_SECTIONS\n  - Test Plan section"
fi

if [ -n "$MISSING_SECTIONS" ]; then
  echo "SPEC INCOMPLETE: The following required sections are missing from the spec output:"
  echo -e "$MISSING_SECTIONS"
  echo ""
  echo "Every spec in specs/ MUST include:"
  echo "  - ## Summary — what and why"
  echo "  - ## Acceptance Criteria — testable Given/When/Then conditions"
  echo "  - ## Test Plan — how to verify the implementation"
  echo ""
  echo "Add the missing sections before saving the spec file."
fi

exit 0
