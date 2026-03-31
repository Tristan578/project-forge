#!/usr/bin/env bash
# pr-green-machine: Auto-fix common CI failures: lint and type errors.
# Runs eslint --fix, then tsc to surface type errors for agent to resolve.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/fix-common-ci.sh"

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
WEB_DIR="${REPO_ROOT}/web"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ISSUES=0

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; }
section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

echo "=============================================="
echo "  PR CI Auto-Fix"
echo "  Working in: ${WEB_DIR}"
echo "=============================================="

if [ ! -d "$WEB_DIR" ]; then
  echo -e "${RED}ERROR: web/ directory not found at ${WEB_DIR}${NC}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. ESLint auto-fix
# ---------------------------------------------------------------------------
section "ESLint Auto-Fix"

echo "  Running: npx eslint --fix ."
set +e
LINT_FIX_OUTPUT=$(cd "$WEB_DIR" && npx eslint --fix . 2>&1)
LINT_FIX_EXIT=$?
set -e

if [ "$LINT_FIX_EXIT" -eq 0 ]; then
  pass "ESLint auto-fix completed successfully"
else
  echo "  ESLint fix output:"
  echo "$LINT_FIX_OUTPUT" | head -50 | sed 's/^/    /'
  warn "ESLint auto-fix completed with some remaining issues (see above)"
fi

# Now check what's left
echo ""
echo "  Checking remaining lint issues..."
set +e
LINT_CHECK_OUTPUT=$(cd "$WEB_DIR" && npx eslint --max-warnings 0 . 2>&1)
LINT_CHECK_EXIT=$?
set -e

if [ "$LINT_CHECK_EXIT" -eq 0 ]; then
  pass "Zero lint warnings/errors remaining"
else
  fail "Lint issues remain after auto-fix — requires manual fix"
  echo ""
  echo "  Remaining lint issues:"
  echo "$LINT_CHECK_OUTPUT" | head -60 | sed 's/^/    /'
  echo ""
  echo "  Common manual fixes:"
  echo "    - Unused vars: prefix with _ or remove"
  echo "    - Missing deps in useEffect: add them or wrap in useCallback"
  echo "    - no-img-element: use next/image instead of <img>"
  echo "    - no-explicit-any: add proper types"
fi

# ---------------------------------------------------------------------------
# 2. TypeScript check
# ---------------------------------------------------------------------------
section "TypeScript Errors"

echo "  Running: npx tsc --noEmit"
set +e
TSC_OUTPUT=$(cd "$WEB_DIR" && npx tsc --noEmit 2>&1)
TSC_EXIT=$?
set -e

if [ "$TSC_EXIT" -eq 0 ]; then
  pass "Zero TypeScript errors"
else
  fail "TypeScript errors found"
  echo ""
  echo "  TypeScript errors:"
  echo "$TSC_OUTPUT" | head -80 | sed 's/^/    /'
  echo ""
  echo "  Common type error patterns:"
  echo "    - 'Type X is not assignable to Y': check the types match, add proper types"
  echo "    - 'Object possibly undefined': add null check before access"
  echo "    - 'Property does not exist': verify the property name is correct"
  echo "    - 'any' type issues: import or define proper interfaces"
fi

# ---------------------------------------------------------------------------
# 3. MCP tests (fast, catches manifest sync issues)
# ---------------------------------------------------------------------------
section "MCP Server Tests"

MCP_DIR="${REPO_ROOT}/mcp-server"
if [ -d "$MCP_DIR" ]; then
  echo "  Running: npx vitest run (mcp-server)"
  set +e
  MCP_OUTPUT=$(cd "$MCP_DIR" && npx vitest run 2>&1)
  MCP_EXIT=$?
  set -e

  if [ "$MCP_EXIT" -eq 0 ]; then
    pass "MCP server tests passing"
  else
    fail "MCP server tests failing"
    echo ""
    echo "  MCP test output (last 40 lines):"
    echo "$MCP_OUTPUT" | tail -40 | sed 's/^/    /'
    echo ""
    echo "  Common cause: mcp-server/manifest/commands.json out of sync with web/src/data/commands.json"
    echo "  Fix: ensure both files have identical content"
  fi
else
  warn "mcp-server/ directory not found — skipping MCP tests"
fi

# ---------------------------------------------------------------------------
# 4. Quick unit test check on recently changed files
# ---------------------------------------------------------------------------
section "Changed File Tests"

CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null | grep -E "\.ts$|\.tsx$" | grep -v "__tests__" | head -20 || echo "")

if [ -n "$CHANGED_FILES" ]; then
  echo "  Changed source files:"
  echo "$CHANGED_FILES" | sed 's/^/    /'
  echo ""

  # Find test files for changed source files
  TEST_DIRS=""
  while IFS= read -r f; do
    dir=$(dirname "$f")
    if [[ "$f" == web/src/* ]]; then
      TEST_DIRS="$TEST_DIRS $dir"
    fi
  done <<< "$CHANGED_FILES"

  if [ -n "$TEST_DIRS" ]; then
    # Deduplicate dirs
    UNIQUE_DIRS=$(echo "$TEST_DIRS" | tr ' ' '\n' | sort -u | tr '\n' ' ')
    echo "  Running targeted tests for changed directories..."
    set +e
    VITEST_OUTPUT=$(cd "$WEB_DIR" && npx vitest run $UNIQUE_DIRS 2>&1)
    VITEST_EXIT=$?
    set -e

    if [ "$VITEST_EXIT" -eq 0 ]; then
      pass "Targeted unit tests passing"
    else
      fail "Unit tests failing for changed files"
      echo ""
      echo "  Test output (last 40 lines):"
      echo "$VITEST_OUTPUT" | tail -40 | sed 's/^/    /'
    fi
  fi
else
  warn "No changed TypeScript files detected — skipping targeted unit tests"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
if [ "$ISSUES" -gt 0 ]; then
  echo -e "  ${RED}RESULT: ${ISSUES} issue(s) require manual fix${NC}"
  echo ""
  echo "  Next steps:"
  echo "  1. Fix the issues listed above"
  echo "  2. Run this script again to verify"
  echo "  3. See: .claude/skills/pr-green-machine/references/ci-fix-playbook.md"
else
  echo -e "  ${GREEN}RESULT: LOCAL CHECKS PASSING — safe to push${NC}"
fi
echo "=============================================="

exit "$ISSUES"
