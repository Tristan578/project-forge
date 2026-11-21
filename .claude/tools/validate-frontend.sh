#!/usr/bin/env bash
# Frontend validation script for SpawnForge web development
# Used by: frontend skill, builder agent, validator agent
# Usage: bash .claude/tools/validate-frontend.sh [lint|tsc|test|quick|full]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT/web"

MODE="${1:-quick}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }

echo "=== SpawnForge Frontend Validation (mode: $MODE) ==="

run_lint() {
  echo ""
  echo "--- ESLint (zero warnings) ---"
  if npx eslint --max-warnings 0 . 2>&1; then
    pass "ESLint: zero warnings"
  else
    fail "ESLint: warnings or errors found"
  fi
}

run_tsc() {
  echo ""
  echo "--- TypeScript ---"
  if npx tsc --noEmit 2>&1; then
    pass "TypeScript: no type errors"
  else
    fail "TypeScript: type errors found"
  fi
}

run_test() {
  echo ""
  echo "--- Vitest ---"
  if npx vitest run 2>&1; then
    pass "Vitest: all tests passed"
  else
    fail "Vitest: test failures"
  fi
}

run_e2e() {
  echo ""
  echo "--- Playwright E2E ---"
  if [ -d "public/engine-pkg-webgl2" ]; then
    if npx playwright test 2>&1; then
      pass "Playwright: all E2E tests passed"
    else
      fail "Playwright: E2E test failures"
    fi
  else
    echo "SKIP: WASM build not found (run /build first)"
  fi
}

case "$MODE" in
  lint)  run_lint ;;
  tsc)   run_tsc ;;
  test)  run_test ;;
  quick) run_lint; run_tsc; run_test ;;
  full)  run_lint; run_tsc; run_test; run_e2e ;;
  *)     echo "Usage: validate-frontend.sh [lint|tsc|test|quick|full]"; exit 1 ;;
esac

echo ""
echo "=== Frontend validation complete ==="
