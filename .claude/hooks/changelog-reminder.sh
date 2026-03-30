#!/usr/bin/env bash
# SessionStart hook: remind about changelog review for upgrade/migration sessions.
# Lightweight — just checks if any deps are significantly behind and prints a nudge.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
PKG="$ROOT/web/package.json"

if [ ! -f "$PKG" ]; then
  exit 0
fi

# Check how long since last changelog review (stored in a timestamp file)
LAST_REVIEW_FILE="$ROOT/.claude/.changelog-last-review"
NOW=$(date +%s)
STALE_THRESHOLD=259200  # 3 days in seconds

if [ -f "$LAST_REVIEW_FILE" ]; then
  LAST_REVIEW=$(cat "$LAST_REVIEW_FILE" 2>/dev/null || echo "0")
  AGE=$((NOW - LAST_REVIEW))
  if [ "$AGE" -lt "$STALE_THRESHOLD" ]; then
    # Reviewed recently — no nudge needed
    exit 0
  fi
  DAYS_AGO=$((AGE / 86400))
  echo "CHANGELOG REVIEW: Last run ${DAYS_AGO} days ago. Consider running /changelog-review before framework-level work."
else
  echo "CHANGELOG REVIEW: Never run in this project. Run /changelog-review to check for breaking changes in dependencies."
fi
