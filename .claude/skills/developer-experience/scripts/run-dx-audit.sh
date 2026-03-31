#!/usr/bin/env bash
# developer-experience: Wrapper that runs the DX audit and summarizes results.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/run-dx-audit.sh" [audit|onboard]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
DX_AUDIT_SCRIPT="${REPO_ROOT}/.claude/tools/dx-audit.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE="${1:-audit}"

echo "=============================================="
echo "  SpawnForge DX Audit Wrapper"
echo "  Mode: ${MODE}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

if [ ! -f "$DX_AUDIT_SCRIPT" ]; then
  echo -e "${RED}ERROR: dx-audit.sh not found at ${DX_AUDIT_SCRIPT}${NC}"
  echo "Expected path: .claude/tools/dx-audit.sh"
  exit 1
fi

if [ ! -x "$DX_AUDIT_SCRIPT" ]; then
  chmod +x "$DX_AUDIT_SCRIPT"
fi

# Run the audit and capture output
echo ""
echo "Running audit..."
echo ""

set +e
AUDIT_OUTPUT=$(bash "$DX_AUDIT_SCRIPT" "$MODE" 2>&1)
AUDIT_EXIT=$?
set -e

echo "$AUDIT_OUTPUT"

# ---------------------------------------------------------------------------
# Parse and summarize results
# ---------------------------------------------------------------------------
FAIL_COUNT=$(echo "$AUDIT_OUTPUT" | grep -c "  FAIL:" 2>/dev/null || echo "0")
WARN_COUNT=$(echo "$AUDIT_OUTPUT" | grep -c "  WARN:" 2>/dev/null || echo "0")
PASS_COUNT=$(echo "$AUDIT_OUTPUT" | grep -c "  PASS:" 2>/dev/null || echo "0")

echo ""
echo "=============================================="
echo "  DX AUDIT SUMMARY"
echo "=============================================="
echo -e "  ${GREEN}PASS${NC}: ${PASS_COUNT}"
echo -e "  ${YELLOW}WARN${NC}: ${WARN_COUNT}"
echo -e "  ${RED}FAIL${NC}: ${FAIL_COUNT}"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "  ${RED}RESULT: DX ISSUES FOUND — ${FAIL_COUNT} failure(s)${NC}"
  echo ""
  echo "  Top issues to fix:"
  echo "$AUDIT_OUTPUT" | grep "  FAIL:" | head -10 | sed 's/^/    /'
  echo ""
  echo "  References:"
  echo "  - .claude/skills/developer-experience/references/dx-standards.md"
  echo "  - .claude/tools/dx-audit.sh (full audit)"
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}RESULT: DX OK with ${WARN_COUNT} warning(s) — review above${NC}"
else
  echo -e "  ${GREEN}RESULT: DX HEALTHY — all checks passed${NC}"
fi

echo "=============================================="

exit "$AUDIT_EXIT"
