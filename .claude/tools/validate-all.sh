#!/usr/bin/env bash
# Full project validation — runs all domain validators
# Used by: cycle skill, validator agent
# Usage: bash .claude/tools/validate-all.sh
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=============================================="
echo "  SpawnForge Full Validation Suite"
echo "=============================================="

FAILED=0

# 1. Rust / Architecture
echo ""
echo ">>>>>> RUST & ARCHITECTURE <<<<<<"
if bash "$TOOLS_DIR/validate-rust.sh" check; then
  echo ""
else
  FAILED=$((FAILED + 1))
fi

# 2. Frontend (lint + tsc + vitest)
echo ""
echo ">>>>>> FRONTEND <<<<<<"
if bash "$TOOLS_DIR/validate-frontend.sh" quick; then
  echo ""
else
  FAILED=$((FAILED + 1))
fi

# 3. MCP
echo ""
echo ">>>>>> MCP <<<<<<"
if bash "$TOOLS_DIR/validate-mcp.sh" full; then
  echo ""
else
  FAILED=$((FAILED + 1))
fi

# 4. Docs
echo ""
echo ">>>>>> DOCUMENTATION <<<<<<"
if bash "$TOOLS_DIR/validate-docs.sh"; then
  echo ""
else
  FAILED=$((FAILED + 1))
fi

echo "=============================================="
if [ "$FAILED" -eq 0 ]; then
  echo "  ALL VALIDATIONS PASSED"
else
  echo "  $FAILED DOMAIN(S) FAILED"
  exit 1
fi
echo "=============================================="
