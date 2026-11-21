#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): auto-regenerate lockfile when package.json changes
# Prevents the #1 blast-radius CI failure: stale lockfile after dependency edits.
# See CLAUDE.md gotcha: "Cherry-pick + lockfile"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only trigger on package.json edits (any workspace)
[[ "$FILE_PATH" == *package.json ]] || exit 0
# Skip package-lock.json itself
[[ "$FILE_PATH" != *package-lock.json ]] || exit 0

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$REPO_ROOT" ] || exit 0

# Check if lockfile is now out of sync
cd "$REPO_ROOT"
DRIFT=$(npm install --dry-run 2>&1 | grep -cE "added|removed|changed" || true)

if [ "$DRIFT" -gt 0 ]; then
  echo "LOCKFILE DRIFT: package.json was modified — running npm install to sync lockfile."
  npm install --ignore-scripts 2>&1 | tail -3
  echo "Done. Remember to stage package-lock.json in your next commit."
fi

exit 0
