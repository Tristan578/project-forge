#!/usr/bin/env bash
# Verify that mcp-server/manifest/commands.json and web/src/data/commands.json
# are identical. Exit 2 if they differ.
#
# Usage:
#   bash scripts/manifest-sync-check.sh
#
# Exit codes:
#   0  — files are in sync
#   1  — one or both files are missing
#   2  — files exist but have diverged

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

SOURCE="$REPO_ROOT/mcp-server/manifest/commands.json"
COPY="$REPO_ROOT/web/src/data/commands.json"

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: Source manifest not found: $SOURCE" >&2
  exit 1
fi

if [[ ! -f "$COPY" ]]; then
  echo "ERROR: Web copy not found: $COPY" >&2
  echo "Copy the manifest: cp $SOURCE $COPY" >&2
  exit 1
fi

# Normalize JSON (remove whitespace differences) before comparing
SOURCE_NORM=$(python3 -c "import json,sys; print(json.dumps(json.load(open('$SOURCE')), sort_keys=True))" 2>/dev/null) || {
  echo "ERROR: $SOURCE is not valid JSON" >&2
  exit 1
}

COPY_NORM=$(python3 -c "import json,sys; print(json.dumps(json.load(open('$COPY')), sort_keys=True))" 2>/dev/null) || {
  echo "ERROR: $COPY is not valid JSON" >&2
  exit 1
}

if [[ "$SOURCE_NORM" == "$COPY_NORM" ]]; then
  # Count commands for informational output
  COUNT=$(python3 -c "import json; data=json.load(open('$SOURCE')); print(len(data.get('commands', [])))")
  echo "PASSED: Manifests are in sync ($COUNT commands)."
  exit 0
fi

echo "FAILED: Manifest files have diverged." >&2
echo "" >&2
echo "  Source: $SOURCE" >&2
echo "  Copy  : $COPY" >&2
echo "" >&2

# Show which commands exist in one but not the other
python3 - "$SOURCE" "$COPY" <<'PYEOF'
import json, sys

source = json.load(open(sys.argv[1]))
copy   = json.load(open(sys.argv[2]))

source_names = {c['name'] for c in source.get('commands', [])}
copy_names   = {c['name'] for c in copy.get('commands', [])}

only_in_source = sorted(source_names - copy_names)
only_in_copy   = sorted(copy_names - source_names)

if only_in_source:
    print(f"Commands in source but NOT in web copy ({len(only_in_source)}):")
    for n in only_in_source:
        print(f"  + {n}")

if only_in_copy:
    print(f"Commands in web copy but NOT in source ({len(only_in_copy)}):")
    for n in only_in_copy:
        print(f"  - {n}")

if not only_in_source and not only_in_copy:
    print("Command names match but content differs (description, parameters, or visibility).")
PYEOF

echo "" >&2
echo "Fix: after editing the source manifest, run:" >&2
echo "  cp $SOURCE $COPY" >&2
exit 2
