#!/usr/bin/env bash
# developer-experience: Wrapper that runs the DX audit and summarizes results.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/run-dx-audit.sh" [audit|onboard]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
DX_AUDIT_SCRIPT="${REPO_ROOT}/.claude/tools/dx-audit.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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
# dx-audit.sh colours every label ("  <ESC>[0;32mPASS<ESC>[0m: ..."), so a
# plain "  PASS:" never matched: every count read 0 and the summary said
# "DX HEALTHY" over real failures. Strip the SGR codes first. The ESC byte comes
# from $'\033' because BSD sed has no \x1b escape.
ESC=$'\033'
PLAIN_OUTPUT=$(printf '%s\n' "$AUDIT_OUTPUT" | sed "s/${ESC}\[[0-9;]*m//g")
# grep -c prints 0 AND exits 1 on no match; `|| true` keeps that single 0
# (an `|| echo 0` fallback appended a second one).
FAIL_COUNT=$(printf '%s\n' "$PLAIN_OUTPUT" | grep -c "^  FAIL:" || true)
WARN_COUNT=$(printf '%s\n' "$PLAIN_OUTPUT" | grep -c "^  WARN:" || true)
PASS_COUNT=$(printf '%s\n' "$PLAIN_OUTPUT" | grep -c "^  PASS:" || true)

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
  printf '%s\n' "$PLAIN_OUTPUT" | sed -n '/^  FAIL:/{s/^/    /;p;}' | sed -n '1,10p'
  echo ""
  echo "  References:"
  echo "  - .claude/skills/developer-experience/references/dx-standards.md"
  echo "  - .claude/tools/dx-audit.sh (full audit)"
elif [ "$AUDIT_EXIT" -ne 0 ]; then
  echo -e "  ${RED}RESULT: AUDIT EXITED ${AUDIT_EXIT} with no FAIL line parsed; read the output above${NC}"
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}RESULT: DX OK with ${WARN_COUNT} warning(s) — review above${NC}"
else
  echo -e "  ${GREEN}RESULT: DX HEALTHY — all checks passed${NC}"
fi

echo "=============================================="

exit "$AUDIT_EXIT"
