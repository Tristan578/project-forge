#!/usr/bin/env bash
# Test coverage validation script for SpawnForge
# Used by: testing skill, validator agent
# Usage: bash .claude/tools/validate-tests.sh [coverage|count|full]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

MODE="${1:-count}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC}: $1"; }

echo "=== SpawnForge Test Validation (mode: $MODE) ==="

# 1. Test file count
echo ""
echo "--- Test Inventory ---"
WEB_TEST_FILES=$(find "$PROJECT_ROOT/web/src" -name "*.test.ts" -o -name "*.test.tsx" 2>/dev/null | wc -l | tr -d ' ')
E2E_TEST_FILES=$(find "$PROJECT_ROOT/web/e2e" -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')
MCP_TEST_FILES=$(find "$PROJECT_ROOT/mcp-server/src" -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')
echo "  Web unit/integration test files: $WEB_TEST_FILES"
echo "  E2E spec files: $E2E_TEST_FILES"
echo "  MCP test files: $MCP_TEST_FILES"
echo "  Total: $((WEB_TEST_FILES + E2E_TEST_FILES + MCP_TEST_FILES))"

# 2. Run tests and count
if [ "$MODE" = "count" ] || [ "$MODE" = "full" ]; then
  echo ""
  echo "--- Web Tests ---"
  cd "$PROJECT_ROOT/web"
  npx vitest run 2>&1 | tail -5

  echo ""
  echo "--- MCP Tests ---"
  cd "$PROJECT_ROOT/mcp-server"
  npx vitest run 2>&1 | tail -5
fi

# 3. Coverage report
if [ "$MODE" = "coverage" ] || [ "$MODE" = "full" ]; then
  echo ""
  echo "--- Coverage Report ---"
  cd "$PROJECT_ROOT/web"
  npx vitest run --coverage 2>&1 | grep -E "^(All files|Statements|Branches|Functions|Lines|%)" | head -10

  echo ""
  echo "Coverage thresholds (current): statements 50, branches 42, functions 42, lines 51"
  echo "Coverage target (goal): 100/100/100/100"
fi

echo ""
echo "=== Test validation complete ==="
