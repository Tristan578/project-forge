#!/usr/bin/env bash
# SessionStart hook: remind about pending changesets and changelog review.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"

# Check for pending changeset files (not yet consumed by `changeset version`)
CHANGESET_DIR="$ROOT/.changeset"
if [ -d "$CHANGESET_DIR" ]; then
  PENDING=$(find "$CHANGESET_DIR" -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PENDING" -gt 0 ]; then
    echo "CHANGESETS: ${PENDING} pending changeset(s) found. Run 'npm run changeset:version' to consume them before release."
  fi
fi

# Check how long since last changelog review (for dependency upgrade sessions)
LAST_REVIEW_FILE="$ROOT/.claude/.changelog-last-review"
NOW=$(date +%s)
STALE_THRESHOLD=259200  # 3 days in seconds

if [ -f "$LAST_REVIEW_FILE" ]; then
  LAST_REVIEW=$(cat "$LAST_REVIEW_FILE" 2>/dev/null || echo "0")
  AGE=$((NOW - LAST_REVIEW))
  if [ "$AGE" -lt "$STALE_THRESHOLD" ]; then
    exit 0
  fi
  DAYS_AGO=$((AGE / 86400))
  echo "CHANGELOG REVIEW: Last run ${DAYS_AGO} days ago. Consider running /changelog-review before framework-level work."
else
  echo "CHANGELOG REVIEW: Never run in this project. Run /changelog-review to check for breaking changes in dependencies."
fi
