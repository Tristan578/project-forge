#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$PROJECT_ROOT" ] && exit 0
YELLOW='\033[1;33m'
NC='\033[0m'
echo ""
echo "=== SpawnForge: Post-merge doc freshness check ==="
CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || true)
[ -z "$CHANGED_FILES" ] && echo "No changes." && exit 0
STALE_COUNT=0
while IFS= read -r -d '' DOC_FILE; do
  DOC_REL="${DOC_FILE#"$PROJECT_ROOT/"}"
  FM=$(awk '/^---/{if(NR==1){f=1;next}if(f){exit}}f{print}' "$DOC_FILE" 2>/dev/null || true)
  [ -z "$FM" ] && continue
  RF=$(echo "$FM" | awk '/^relatedFiles:/{f=1;next}/^[^ ]/{f=0}f && /^ *-/{gsub(/^ *- */,"",$0);print}' || true)
  [ -z "$RF" ] && continue
  while IFS= read -r REL_FILE; do
    REL_FILE="$(echo "$REL_FILE" | xargs)"
    [ -z "$REL_FILE" ] && continue
    # FIX (PF-456): grep -xF = exact full-line match, not -qF substring
    if echo "$CHANGED_FILES" | grep -qxF "$REL_FILE"; then
      echo -e "${YELLOW}DOC UPDATE NEEDED${NC}: $DOC_REL ($REL_FILE modified)"
      STALE_COUNT=$((STALE_COUNT + 1))
      break
    fi
  done <<< "$RF"
done < <(find "$PROJECT_ROOT/docs/features" -name "*.md" -print0 2>/dev/null)
[ "$STALE_COUNT" -eq 0 ] && echo "All docs fresh." || echo "$STALE_COUNT doc(s) flagged."
exit 0
