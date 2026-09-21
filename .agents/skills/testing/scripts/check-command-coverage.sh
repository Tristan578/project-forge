#!/usr/bin/env sh
# check-command-coverage.sh
# Check what percentage of MCP commands in commands.json have handler implementations.
#
# For each command name, searches:
#   - web/src/lib/chat/handlers/   (domain handler files)
#   - web/src/lib/chat/executor.legacy.ts
#
# Usage:
#   bash .claude/skills/testing/scripts/check-command-coverage.sh [threshold]
#
# Arguments:
#   threshold   Minimum coverage percentage required (default: 80)
#
# Exit codes:
#   0  Coverage meets or exceeds threshold
#   1  Coverage is below threshold, or commands.json not found
#
# POSIX-portable: no GNU-only grep flags, no bash arrays, no bashisms.

set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

THRESHOLD="${1:-80}"
COMMANDS_JSON="$PROJECT_ROOT/web/src/data/commands.json"
HANDLERS_DIR="$PROJECT_ROOT/web/src/lib/chat/handlers"
LEGACY_FILE="$PROJECT_ROOT/web/src/lib/chat/executor.legacy.ts"

# Validate inputs
if [ ! -f "$COMMANDS_JSON" ]; then
  printf 'ERROR: commands.json not found at: %s\n' "$COMMANDS_JSON" >&2
  exit 1
fi

printf '=== SpawnForge Command Handler Coverage ===\n'
printf '\n'
printf 'Commands manifest: %s\n' "$COMMANDS_JSON"
printf 'Handlers directory: %s\n' "$HANDLERS_DIR"
printf 'Legacy executor: %s\n' "$LEGACY_FILE"
printf 'Threshold: %s%%\n' "$THRESHOLD"
printf '\n'

# Extract all command names using python3 (POSIX-compatible alternative to jq)
TMPFILE="$(mktemp)"
COVERED_FILE="$(mktemp)"
UNCOVERED_FILE="$(mktemp)"
# shellcheck disable=SC2064
trap 'rm -f "$TMPFILE" "$COVERED_FILE" "$UNCOVERED_FILE"' EXIT INT TERM

python3 - "$COMMANDS_JSON" > "$TMPFILE" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
    cmds = data.get('commands', [])
    for cmd in cmds:
        name = cmd.get('name', '').strip()
        if name:
            print(name)
except Exception as e:
    sys.stderr.write('ERROR parsing commands.json: ' + str(e) + '\n')
    sys.exit(1)
PYEOF

TOTAL=0
while IFS= read -r _line; do
  TOTAL=$((TOTAL + 1))
done < "$TMPFILE"

if [ "$TOTAL" -eq 0 ]; then
  printf 'ERROR: No commands found in %s\n' "$COMMANDS_JSON" >&2
  exit 1
fi

printf 'Total commands: %d\n' "$TOTAL"
printf 'Scanning handlers...\n'
printf '\n'

COVERED=0

while IFS= read -r cmd; do
  # Search for command name as a literal string in the handlers directory
  # Use grep -r with -l (list files) and -F (fixed string) — both POSIX
  FOUND=0

  if [ -d "$HANDLERS_DIR" ]; then
    if grep -rqF "$cmd" "$HANDLERS_DIR" 2>/dev/null; then
      FOUND=1
    fi
  fi

  # Also check the legacy executor file
  if [ "$FOUND" -eq 0 ] && [ -f "$LEGACY_FILE" ]; then
    if grep -qF "$cmd" "$LEGACY_FILE" 2>/dev/null; then
      FOUND=1
    fi
  fi

  if [ "$FOUND" -eq 1 ]; then
    COVERED=$((COVERED + 1))
    printf '%s\n' "$cmd" >> "$COVERED_FILE"
  else
    printf '%s\n' "$cmd" >> "$UNCOVERED_FILE"
  fi
done < "$TMPFILE"

UNCOVERED=$((TOTAL - COVERED))

# Calculate coverage percentage using python3 (avoids non-POSIX arithmetic)
COVERAGE_STR="$(python3 -c "
covered = $COVERED
total = $TOTAL
pct = round(covered / total * 100, 1) if total > 0 else 0.0
print('{:.1f}'.format(pct))
")"
COVERAGE_INT="$(python3 -c "
covered = $COVERED
total = $TOTAL
pct = int(covered / total * 100) if total > 0 else 0
print(pct)
")"

printf '%s\n' '--- Results ---'
printf '\n'
printf 'Covered:    %d/%d (%s%%)\n' "$COVERED" "$TOTAL" "$COVERAGE_STR"
printf 'Uncovered:  %d/%d\n' "$UNCOVERED" "$TOTAL"
printf '\n'

if [ "$UNCOVERED" -gt 0 ]; then
  printf 'Uncovered commands (%d):\n' "$UNCOVERED"
  while IFS= read -r cmd; do
    printf '  %s\n' "$cmd"
  done < "$UNCOVERED_FILE"
  printf '\n'
fi

# Check threshold
if [ "$COVERAGE_INT" -ge "$THRESHOLD" ]; then
  printf 'PASS: Coverage %s%% meets threshold of %d%%\n' "$COVERAGE_STR" "$THRESHOLD"
  exit 0
else
  printf 'FAIL: Coverage %s%% is below threshold of %d%% (%d uncovered commands)\n' \
    "$COVERAGE_STR" "$THRESHOLD" "$UNCOVERED" >&2
  exit 1
fi
