#!/usr/bin/env bash
# Stop hook for all 5 reviewer agents.
# Validates the agent's output contains:
#   1. A clear PASS or FAIL verdict
#   2. At least one file reference (path or filename)
#   3. Actionable findings (not just a summary)
#
# Exit code 2 = block (sends the reviewer back to complete the review).

set -euo pipefail

INPUT=$(cat)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)

# --- 1. Verdict check ---
if ! echo "$OUTPUT" | grep -qiE '\bPASS\b|\bFAIL\b'; then
  echo "REVIEW INCOMPLETE: No PASS or FAIL verdict found in your output."
  echo ""
  echo "Your review MUST end with one of:"
  echo "  VERDICT: PASS — summary of what was verified."
  echo "  VERDICT: FAIL — list of specific issues with file references."
  echo ""
  echo "Rewrite your review to include an explicit verdict."
  exit 2
fi

VERDICT=$(echo "$OUTPUT" | grep -oiE '\bPASS\b|\bFAIL\b' | tail -1 | tr '[:lower:]' '[:upper:]')

# On FAIL, verify there are actionable findings
if [ "$VERDICT" = "FAIL" ]; then
  # Check for file references (e.g. src/lib/foo.ts, engine/src/bridge.rs)
  if ! echo "$OUTPUT" | grep -qE '[a-zA-Z0-9_/-]+\.(ts|tsx|rs|sh|json|md|py|js|jsx)'; then
    echo "REVIEW INCOMPLETE: FAIL verdict requires at least one file reference."
    echo ""
    echo "Specify the exact file(s) affected by each finding."
    echo "Example: 'web/src/lib/tokens/creditManager.ts line 42: missing await on async call'"
    exit 2
  fi

  # Check that the word "fix" or an imperative action appears (actionable)
  if ! echo "$OUTPUT" | grep -qiE '\b(fix|update|add|remove|replace|rename|move|refactor|change|ensure|verify|check)\b'; then
    echo "REVIEW INCOMPLETE: FAIL findings must be actionable."
    echo ""
    echo "Each finding must describe what needs to be done to resolve it."
    echo "Example: 'Fix: add missing await to rateLimitPublicRoute() call on line 12'"
    exit 2
  fi
fi

echo "[review-quality-gate] verdict=$VERDICT — review accepted" >&2
exit 0
