#!/usr/bin/env bash
# Post-merge hook: check if recently-changed source files are referenced in
# docs/features/ frontmatter, and flag any docs that may need updating.
#
# Install:  cp .claude/hooks/post-merge-doc-check.sh .git/hooks/post-merge
#           chmod +x .git/hooks/post-merge
#
# This hook is INFORMATIONAL — it never exits non-zero and never blocks a merge.
# Output goes to the terminal so developers see it right after the merge completes.
set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
  exit 0
fi

YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "=== SpawnForge: Post-merge doc freshness check ==="

# Files changed in the merge (HEAD~1 is the pre-merge state)
CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected — skipping doc check."
  echo ""
  exit 0
fi

STALE_COUNT=0

# Walk every doc in docs/features/ that has frontmatter
while IFS= read -r -d '' DOC_FILE; do
  DOC_RELATIVE="${DOC_FILE#"$PROJECT_ROOT/"}"

  # Extract frontmatter block between the first --- pair
  FRONTMATTER=$(awk '/^---/{if(NR==1){found=1;next}if(found){exit}}found{print}' "$DOC_FILE" 2>/dev/null || true)
  [ -z "$FRONTMATTER" ] && continue

  # Parse relatedFiles entries
  RELATED_FILES=$(echo "$FRONTMATTER" | awk '/^relatedFiles:/{found=1;next}/^[^ ]/{found=0}found && /^ *-/{gsub(/^ *- */,"",$0);print}' || true)
  [ -z "$RELATED_FILES" ] && continue

  # Check each relatedFile against changed files
  while IFS= read -r REL_FILE; do
    REL_FILE="$(echo "$REL_FILE" | xargs)"
    [ -z "$REL_FILE" ] && continue

    if echo "$CHANGED_FILES" | grep -qF "$REL_FILE"; then
      echo -e "${YELLOW}DOC UPDATE NEEDED${NC}: $DOC_RELATIVE ($REL_FILE was modified)"
      STALE_COUNT=$((STALE_COUNT + 1))
      break
    fi
  done <<< "$RELATED_FILES"

done < <(find "$PROJECT_ROOT/docs/features" -name "*.md" -print0 2>/dev/null)

if [ "$STALE_COUNT" -eq 0 ]; then
  echo "All docs appear fresh relative to this merge."
else
  echo ""
  echo "$STALE_COUNT doc(s) flagged. Update the relevant docs/features/ files and"
  echo "bump their 'lastVerified' frontmatter date to silence future warnings."
fi

echo "==================================================="
echo ""

# Always exit 0 — this hook is non-blocking
exit 0
