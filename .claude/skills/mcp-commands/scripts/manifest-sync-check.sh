#!/usr/bin/env bash
# Verify that the canonical mcp-server/manifest/commands.json is identical to
# BOTH copies: web/src/data/commands.json and apps/docs/data/commands.json.
# THREE copies exist — each deploy root (web/, apps/docs/) needs its own, since
# a Next.js build cannot import above its rootDirectory. Exit 2 if any differ.
#
# Usage:
#   bash scripts/manifest-sync-check.sh
#
# Exit codes:
#   0  — all copies are in sync
#   1  — the source or one of the copies is missing
#   2  — files exist but at least one copy has diverged

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

SOURCE="$REPO_ROOT/mcp-server/manifest/commands.json"
WEB_COPY="$REPO_ROOT/web/src/data/commands.json"
DOCS_COPY="$REPO_ROOT/apps/docs/data/commands.json"

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: Source manifest not found: $SOURCE" >&2
  exit 1
fi

for copy in "$WEB_COPY" "$DOCS_COPY"; do
  if [[ ! -f "$copy" ]]; then
    echo "ERROR: Copy not found: $copy" >&2
    echo "Copy the manifest: cp $SOURCE $copy" >&2
    exit 1
  fi
done

# Normalize JSON (remove whitespace differences) before comparing.
# Paths are passed as argv, never interpolated into the program text.
normalize() {
  python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' "$1"
}

SOURCE_NORM=$(normalize "$SOURCE" 2>/dev/null) || {
  echo "ERROR: $SOURCE is not valid JSON" >&2
  exit 1
}

WEB_NORM=$(normalize "$WEB_COPY" 2>/dev/null) || {
  echo "ERROR: $WEB_COPY is not valid JSON" >&2
  exit 1
}

DOCS_NORM=$(normalize "$DOCS_COPY" 2>/dev/null) || {
  echo "ERROR: $DOCS_COPY is not valid JSON" >&2
  exit 1
}

if [[ "$SOURCE_NORM" == "$WEB_NORM" && "$SOURCE_NORM" == "$DOCS_NORM" ]]; then
  # Count commands for informational output
  COUNT=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1])).get("commands", [])))' "$SOURCE")
  echo "PASSED: All 3 manifests are in sync ($COUNT commands)."
  exit 0
fi

# Identify the drifted copy (or copies) by name rather than reporting "a copy".
DRIFTED=()
if [[ "$SOURCE_NORM" != "$WEB_NORM" ]]; then DRIFTED+=("$WEB_COPY"); fi
if [[ "$SOURCE_NORM" != "$DOCS_NORM" ]]; then DRIFTED+=("$DOCS_COPY"); fi

echo "FAILED: ${#DRIFTED[@]} of 2 manifest copies have diverged from the source." >&2
echo "" >&2
echo "  Source : $SOURCE" >&2
for d in "${DRIFTED[@]}"; do
  echo "  Drifted: $d" >&2
done
echo "" >&2

# Show which commands exist in the source but not in each drifted copy
for d in "${DRIFTED[@]}"; do
  echo "--- $d ---" >&2
  python3 - "$SOURCE" "$d" <<'PYEOF'
import json, sys

source = json.load(open(sys.argv[1]))
copy   = json.load(open(sys.argv[2]))

source_names = {c['name'] for c in source.get('commands', [])}
copy_names   = {c['name'] for c in copy.get('commands', [])}

only_in_source = sorted(source_names - copy_names)
only_in_copy   = sorted(copy_names - source_names)

if only_in_source:
    print(f"Commands in source but NOT in this copy ({len(only_in_source)}):")
    for n in only_in_source:
        print(f"  + {n}")

if only_in_copy:
    print(f"Commands in this copy but NOT in source ({len(only_in_copy)}):")
    for n in only_in_copy:
        print(f"  - {n}")

if not only_in_source and not only_in_copy:
    print("Command names match but content differs (description, parameters, or visibility).")
PYEOF
  echo "" >&2
done

echo "Fix: after editing the source manifest, copy it to BOTH destinations:" >&2
echo "  cp $SOURCE $WEB_COPY" >&2
echo "  cp $SOURCE $DOCS_COPY" >&2
exit 2
