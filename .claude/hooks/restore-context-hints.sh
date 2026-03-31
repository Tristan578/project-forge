#!/usr/bin/env bash
# PostCompact hook: read the snapshot saved by PreCompact and inject it as
# additionalContext so the agent recovers key working state after compaction.

set -euo pipefail

CONTEXT_FILE="/tmp/spawnforge-context-snapshot.txt"

if [ ! -f "$CONTEXT_FILE" ]; then
  echo "[restore-context-hints] No snapshot found at $CONTEXT_FILE — nothing to restore." >&2
  exit 0
fi

# Check that the snapshot is recent (within 2 hours)
SNAPSHOT_AGE=$(( $(date +%s) - $(stat -f %m "$CONTEXT_FILE" 2>/dev/null || stat -c %Y "$CONTEXT_FILE" 2>/dev/null || echo 0) ))
if [ "$SNAPSHOT_AGE" -gt 7200 ]; then
  echo "[restore-context-hints] Snapshot is older than 2 hours — skipping restore." >&2
  exit 0
fi

echo "=== Context Restored After Compaction ==="
cat "$CONTEXT_FILE"
echo ""
echo "This context was saved just before memory compaction. Resume from where you left off."

exit 0
