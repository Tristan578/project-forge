#!/usr/bin/env bash
# Documentation validation script for SpawnForge
# Used by: docs skill, builder agent
# Usage: bash .claude/tools/validate-docs.sh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; }
warn() { echo -e "${YELLOW}WARN${NC}: $1"; }

echo "=== SpawnForge Documentation Validation ==="

ISSUES=0

# 1. Check that key docs exist
echo ""
echo "--- Required Files ---"
for f in README.md TESTING.md docs/known-limitations.md .claude/CLAUDE.md; do
  if [ -f "$PROJECT_ROOT/$f" ]; then
    pass "$f exists"
  else
    fail "$f missing"
    ISSUES=$((ISSUES + 1))
  fi
done

# 2. Check rules files exist
echo ""
echo "--- Rules Files ---"
for f in bevy-api.md entity-snapshot.md web-quality.md library-apis.md file-map.md; do
  if [ -f "$PROJECT_ROOT/.claude/rules/$f" ]; then
    pass ".claude/rules/$f exists"
  else
    fail ".claude/rules/$f missing"
    ISSUES=$((ISSUES + 1))
  fi
done

# 3. MCP manifest sync
echo ""
echo "--- Manifest Sync ---"
if diff -q "$PROJECT_ROOT/mcp-server/manifest/commands.json" "$PROJECT_ROOT/web/src/data/commands.json" > /dev/null 2>&1; then
  pass "MCP manifests in sync"
else
  warn "MCP manifests out of sync"
  ISSUES=$((ISSUES + 1))
fi

# 4. Check for stale version references
echo ""
echo "--- Version References ---"
BEVY_REFS=$(grep -rn "Bevy 0\." "$PROJECT_ROOT/README.md" "$PROJECT_ROOT/.claude/CLAUDE.md" "$PROJECT_ROOT/docs/known-limitations.md" 2>/dev/null | grep -v "0\.18" | head -5 || true)
if [ -n "$BEVY_REFS" ]; then
  warn "Stale Bevy version references found (not 0.18):"
  echo "$BEVY_REFS"
  ISSUES=$((ISSUES + 1))
else
  pass "Bevy version references are current (0.18)"
fi

echo ""
if [ "$ISSUES" -eq 0 ]; then
  echo "=== Documentation validation passed ==="
else
  echo "=== Documentation validation: $ISSUES issue(s) found ==="
  exit 1
fi
