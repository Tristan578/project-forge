#!/usr/bin/env bash
# StopFailure(rate_limit) hook: log the rate limit hit with timestamp and
# suggest retry delay to stdout (additionalContext).

set -euo pipefail

INPUT=$(cat)
REASON=$(echo "$INPUT" | jq -r '.reason // "unknown"' 2>/dev/null)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[rate-limit-backoff] timestamp=$TIMESTAMP reason=$REASON" >&2

echo "RATE LIMIT HIT at $TIMESTAMP."
echo ""
echo "Suggested actions:"
echo "  1. Wait 60 seconds before retrying the last operation."
echo "  2. If running multiple agents concurrently, reduce to 2-3 max."
echo "  3. Break large operations into smaller logical chunks and commit between each."
echo "  4. If rate limits are persistent, check API usage at console.anthropic.com."

exit 0
