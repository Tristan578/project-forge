#!/usr/bin/env bash
# Command coverage audit script for SpawnForge
# Checks which MCP commands have corresponding integration or handler tests.
# Used by: testing skill, validator agent
# Compatible with bash 3+ (macOS system bash)
#
# Usage: bash .claude/skills/testing/scripts/audit-command-coverage.sh [threshold]
#   threshold: minimum coverage percentage required (default: 0)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

THRESHOLD="${1:-0}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC}: $1"; }
info() { echo -e "${CYAN}INFO${NC}: $1"; }

echo "=== SpawnForge Command Coverage Audit ==="
echo ""

COMMANDS_JSON="$PROJECT_ROOT/web/src/data/commands.json"

# Exit 1 if commands.json can't be found
if [ ! -f "$COMMANDS_JSON" ]; then
  fail "commands.json not found at: $COMMANDS_JSON"
fi

# Directories to search for tests
INTEGRATION_DIR="$PROJECT_ROOT/web/src/__integration__/commands"
HANDLER_TEST_DIR="$PROJECT_ROOT/web/src/lib/chat/handlers/__tests__"

echo "--- Configuration ---"
info "Commands manifest: $COMMANDS_JSON"
info "Integration tests: $INTEGRATION_DIR"
info "Handler tests:     $HANDLER_TEST_DIR"
info "Coverage threshold: ${THRESHOLD}%"
echo ""

# Extract all command names into a temp file (bash 3 compatible)
echo "--- Extracting Commands ---"
TMPFILE="$(mktemp)"
UNTESTED_FILE="$(mktemp)"
trap 'rm -f "$TMPFILE" "$UNTESTED_FILE"' EXIT

python3 -c "
import json, sys
try:
    data = json.load(open('$COMMANDS_JSON'))
    cmds = data.get('commands', [])
    for cmd in cmds:
        name = cmd.get('name', '')
        if name:
            print(name)
except Exception as e:
    sys.stderr.write('Error parsing commands.json: ' + str(e) + '\n')
    sys.exit(1)
" > "$TMPFILE"

TOTAL=$(wc -l < "$TMPFILE" | tr -d ' ')

if [ "$TOTAL" -eq 0 ]; then
  fail "No commands found in $COMMANDS_JSON"
fi

echo "Total commands in manifest: $TOTAL"
echo ""

# Search for a command name in test files
# Returns 0 (found) or 1 (not found)
command_has_test() {
  local cmd="$1"

  # Check integration tests directory (if it exists)
  if [ -d "$INTEGRATION_DIR" ]; then
    if grep -rql "$cmd" "$INTEGRATION_DIR" 2>/dev/null; then
      return 0
    fi
  fi

  # Check handler unit tests directory (if it exists)
  if [ -d "$HANDLER_TEST_DIR" ]; then
    if grep -rql "$cmd" "$HANDLER_TEST_DIR" 2>/dev/null; then
      return 0
    fi
  fi

  return 1
}

# Audit every command
TESTED=0

echo "--- Scanning Test Files ---"

while IFS= read -r cmd; do
  if command_has_test "$cmd"; then
    TESTED=$((TESTED + 1))
  else
    echo "$cmd" >> "$UNTESTED_FILE"
  fi
done < "$TMPFILE"

UNTESTED_COUNT=$(wc -l < "$UNTESTED_FILE" | tr -d ' ')

# Calculate coverage percentage (integer arithmetic, scaled for one decimal place)
if [ "$TOTAL" -gt 0 ]; then
  COVERAGE_SCALED=$(( (TESTED * 1000) / TOTAL ))
  COVERAGE_INT=$(( COVERAGE_SCALED / 10 ))
  COVERAGE_FRAC=$(( COVERAGE_SCALED % 10 ))
  COVERAGE_STR="${COVERAGE_INT}.${COVERAGE_FRAC}"
else
  COVERAGE_STR="0.0"
  COVERAGE_INT=0
fi

echo ""
echo "--- Results ---"
echo ""
echo "Command Coverage: ${TESTED}/${TOTAL} (${COVERAGE_STR}%)"
echo ""

if [ "$UNTESTED_COUNT" -gt 0 ]; then
  echo "Untested commands (${UNTESTED_COUNT}):"
  while IFS= read -r cmd; do
    echo "  $cmd"
  done < "$UNTESTED_FILE"
else
  echo "All commands have test coverage."
fi

echo ""

# Check threshold
if [ "$THRESHOLD" -gt 0 ]; then
  if [ "$COVERAGE_INT" -ge "$THRESHOLD" ]; then
    pass "Coverage ${COVERAGE_STR}% meets threshold of ${THRESHOLD}%"
  else
    fail "Coverage ${COVERAGE_STR}% is below threshold of ${THRESHOLD}% (${UNTESTED_COUNT} untested commands)"
  fi
else
  echo "=== Audit complete (threshold: ${THRESHOLD}% — always passes) ==="
fi
