#!/usr/bin/env bash
# SubagentStart hook: log timestamp + agent type for observability.
# Writes to stderr only — no additionalContext injection needed.

set -euo pipefail

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[subagent-start] timestamp=$TIMESTAMP agent_type=$AGENT_TYPE" >&2

exit 0
