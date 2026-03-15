#!/usr/bin/env bash
# Validate that docs/features/ files with relatedFiles frontmatter are fresh
# relative to recent git history.
#
# Frontmatter format (YAML block between --- delimiters at top of file):
#   ---
#   lastVerified: 2026-03-14
#   relatedFiles:
#     - web/src/stores/slices/physicsSlice.ts
#     - engine/src/core/physics.rs
#   ---
#
# Exit 0 always — output is informational only.
# Used by: post-merge-doc-check.sh, doc-freshness GitHub Actions workflow
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== SpawnForge Docs Freshness Check ==="
echo ""

# Collect list of recently-changed source files from git history
# Default: look back 30 commits (covers typical merge windows)
LOOKBACK="${LOOKBACK_COMMITS:-30}"
RECENT_CHANGED=$(git -C "$PROJECT_ROOT" diff --name-only "HEAD~${LOOKBACK}" HEAD 2>/dev/null || true)

if [ -z "$RECENT_CHANGED" ]; then
  # Fallback: compare with previous commit only
  RECENT_CHANGED=$(git -C "$PROJECT_ROOT" diff --name-only HEAD~1 HEAD 2>/dev/null || true)
fi

STALE_COUNT=0
CHECKED_COUNT=0

# Walk every doc in docs/features/
while IFS= read -r -d '' DOC_FILE; do
  DOC_RELATIVE="${DOC_FILE#"$PROJECT_ROOT/"}"

  # Extract frontmatter block (content between first --- pair)
  FRONTMATTER=$(awk '/^---/{if(NR==1){found=1;next}if(found){exit}}found{print}' "$DOC_FILE" 2>/dev/null || true)

  # Skip docs without frontmatter
  if [ -z "$FRONTMATTER" ]; then
    continue
  fi

  # Parse relatedFiles list (lines starting with "  - ")
  RELATED_FILES=$(echo "$FRONTMATTER" | awk '/^relatedFiles:/{found=1;next}/^[^ ]/{found=0}found && /^ *-/{gsub(/^ *- */,"",$0);print}' || true)

  if [ -z "$RELATED_FILES" ]; then
    continue
  fi

  CHECKED_COUNT=$((CHECKED_COUNT + 1))

  # Check each related file against the recent-changed list
  while IFS= read -r REL_FILE; do
    REL_FILE="$(echo "$REL_FILE" | xargs)"  # trim whitespace
    [ -z "$REL_FILE" ] && continue

    if echo "$RECENT_CHANGED" | grep -qF "$REL_FILE"; then
      echo -e "${YELLOW}DOC UPDATE NEEDED${NC}: $DOC_RELATIVE ($REL_FILE was modified)"
      STALE_COUNT=$((STALE_COUNT + 1))
      break  # One match per doc is enough to flag it
    fi
  done <<< "$RELATED_FILES"

done < <(find "$PROJECT_ROOT/docs/features" -name "*.md" -print0 2>/dev/null)

echo ""
if [ "$CHECKED_COUNT" -eq 0 ]; then
  echo "No docs with relatedFiles frontmatter found — nothing to check."
  echo "(Add frontmatter to docs/features/*.md files to enable staleness tracking.)"
elif [ "$STALE_COUNT" -eq 0 ]; then
  echo -e "${GREEN}All $CHECKED_COUNT checked doc(s) appear fresh.${NC}"
else
  echo "$STALE_COUNT doc(s) may need updating (source files changed in last $LOOKBACK commits)."
fi

echo ""
echo "=== Docs freshness check complete ==="
