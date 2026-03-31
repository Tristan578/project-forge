#!/usr/bin/env bash
# TeammateIdle hook: if a reviewer goes idle without posting a PASS/FAIL verdict,
# exit code 2 to send them back to work.
#
# Exit code 2 = block (Claude Code re-activates the agent with the rejection message).

set -euo pipefail

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)

# Only enforce on reviewer agents
if ! echo "$AGENT_TYPE" | grep -qiE "reviewer|guardian"; then
  exit 0
fi

# Check for a clear PASS or FAIL verdict
if echo "$OUTPUT" | grep -qiE '\bPASS\b|\bFAIL\b'; then
  exit 0
fi

# No verdict found — send reviewer back to work
echo "REVIEW INCOMPLETE: You have not posted a clear PASS or FAIL verdict."
echo ""
echo "You MUST end your review with one of:"
echo "  VERDICT: PASS — followed by a summary of what was checked."
echo "  VERDICT: FAIL — followed by specific, actionable findings with file references."
echo ""
echo "Partial analysis without a verdict is not acceptable. Continue your review."

exit 2
