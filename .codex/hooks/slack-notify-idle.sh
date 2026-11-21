#!/usr/bin/env bash
# Notification(idle_prompt) hook: placeholder for Slack idle notification.
# Logs that an idle event was detected. No actual Slack integration yet.

set -euo pipefail

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[slack-notify-idle] timestamp=$TIMESTAMP event=idle_prompt" >&2
echo "[slack-notify-idle] Slack integration not yet configured — idle event logged only." >&2

# Future: POST to Slack webhook when SLACK_WEBHOOK_URL is set
# if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
#   curl -s -X POST "$SLACK_WEBHOOK_URL" \
#     -H "Content-Type: application/json" \
#     -d "{\"text\": \"SpawnForge agent idle at $TIMESTAMP. Check for stuck operations.\"}"
# fi

exit 0
