#!/usr/bin/env bash
# MCP command validation script for SpawnForge
# Used by: mcp-commands skill, builder agent, validator agent
# Usage: bash .claude/tools/validate-mcp.sh [test|sync|audit|full]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

MODE="${1:-full}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC}: $1"; }

echo "=== SpawnForge MCP Validation (mode: $MODE) ==="

# 1. Manifest sync check (always runs)
echo ""
echo "--- Manifest Sync ---"
MCP_MANIFEST="$PROJECT_ROOT/mcp-server/manifest/commands.json"
WEB_MANIFEST="$PROJECT_ROOT/web/src/data/commands.json"

if [ -f "$MCP_MANIFEST" ] && [ -f "$WEB_MANIFEST" ]; then
  if diff -q "$MCP_MANIFEST" "$WEB_MANIFEST" > /dev/null 2>&1; then
    pass "MCP and web manifests are in sync"
  else
    fail "MCP manifest out of sync with web/src/data/commands.json — copy mcp-server/manifest/commands.json to web/src/data/"
  fi
else
  warn "One or both manifest files missing"
fi

# 2. Command count
echo ""
echo "--- Command Count ---"
CMD_COUNT="?"
CAT_COUNT="?"
if [ -f "$MCP_MANIFEST" ]; then
  CMD_COUNT=$(python3 -c "import json; data=json.load(open('$MCP_MANIFEST')); print(sum(len(cat.get('commands',[])) for cat in data.get('categories',[])))" 2>/dev/null || echo "?")
  CAT_COUNT=$(python3 -c "import json; data=json.load(open('$MCP_MANIFEST')); print(len(data.get('categories',[])))" 2>/dev/null || echo "?")
  echo "  Commands: $CMD_COUNT across $CAT_COUNT categories"
fi

# 3. MCP server tests
if [ "$MODE" = "test" ] || [ "$MODE" = "full" ]; then
  echo ""
  echo "--- MCP Server Tests ---"
  cd "$PROJECT_ROOT/mcp-server"
  if npx vitest run 2>&1; then
    pass "MCP server tests passed"
  else
    fail "MCP server tests failed"
  fi
fi

# 4. AI parity audit (check for commands without chat handlers)
if [ "$MODE" = "audit" ] || [ "$MODE" = "full" ]; then
  echo ""
  echo "--- AI Parity Audit ---"
  HANDLER_DIR="$PROJECT_ROOT/web/src/lib/chat/handlers"
  if [ -d "$HANDLER_DIR" ]; then
    HANDLER_COUNT=$(grep -rn "case " "$HANDLER_DIR"/*.ts 2>/dev/null | wc -l | tr -d ' ')
    echo "  Chat handler case branches: $HANDLER_COUNT"
    echo "  (Compare against $CMD_COUNT MCP commands for parity gaps)"
  fi
fi

echo ""
echo "=== MCP validation complete ==="
