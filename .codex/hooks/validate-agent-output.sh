#!/usr/bin/env bash
# SubagentStop hook: verify reviewer agent output contains a PASS or FAIL verdict.
# Observability only — exits 0 always. Verdict enforcement is in review-quality-gate.sh.

set -euo pipefail

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Only validate reviewer agents
if ! echo "$AGENT_TYPE" | grep -qiE "reviewer|guardian|validator"; then
  exit 0
fi

# Check for PASS or FAIL verdict
if echo "$OUTPUT" | grep -qiE '\bPASS\b|\bFAIL\b'; then
  VERDICT=$(echo "$OUTPUT" | grep -oiE '\bPASS\b|\bFAIL\b' | head -1 | tr '[:lower:]' '[:upper:]')
  echo "[validate-agent-output] timestamp=$TIMESTAMP agent=$AGENT_TYPE verdict=$VERDICT" >&2
else
  echo "[validate-agent-output] timestamp=$TIMESTAMP agent=$AGENT_TYPE verdict=MISSING — reviewer did not post PASS or FAIL" >&2
  echo "WARNING: Reviewer agent '$AGENT_TYPE' completed without a clear PASS or FAIL verdict."
  echo "Review output may be incomplete. Inspect the agent's response before proceeding."
fi

exit 0
