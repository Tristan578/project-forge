#!/bin/bash
# verify-local-dev.sh
#
# Lightweight smoke check that the local dev environment is functional.
# Runs in ~60 seconds — faster than the full validation suite.
#
# Checks:
#   1. TypeScript compiles cleanly (tsc --noEmit)
#   2. ESLint passes with zero warnings
#   3. First 100 vitest tests pass (smoke check)
#   4. Taskboard API responds on http://localhost:3010/api
#
# Usage:
#   bash scripts/verify-local-dev.sh
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$(( PASS + 1 )); }
fail() { echo "FAIL: $1"; FAIL=$(( FAIL + 1 )); }

echo "=== SpawnForge Local Dev Verification ==="
echo ""

# ---------- TypeScript ----------------------------------------------------

echo "--- TypeScript ---"
if cd "$REPO_ROOT/web" && node_modules/.bin/tsc --noEmit 2>&1; then
  pass "tsc --noEmit"
else
  fail "tsc --noEmit (fix type errors before starting dev)"
fi
cd "$REPO_ROOT"

# ---------- ESLint --------------------------------------------------------

echo ""
echo "--- ESLint ---"
if cd "$REPO_ROOT/web" && node_modules/.bin/eslint --max-warnings 0 . 2>&1; then
  pass "eslint --max-warnings 0"
else
  fail "eslint (zero-warning policy — fix all warnings)"
fi
cd "$REPO_ROOT"

# ---------- Vitest smoke (first 100 tests) --------------------------------

echo ""
echo "--- Vitest (smoke: first 100 tests) ---"

# Run a representative subset of store tests (fast, ~10s, validates vitest works)
if cd "$REPO_ROOT/web" && \
   node_modules/.bin/vitest run src/stores/__tests__/ --reporter=dot 2>&1 | tail -5 | \
   grep -qE "passed"; then
  pass "vitest smoke run (store tests)"
else
  fail "vitest (check test output above for failures)"
fi
cd "$REPO_ROOT"

# ---------- Taskboard API -------------------------------------------------

echo ""
echo "--- Taskboard API ---"
TASKBOARD_URL="http://localhost:3010/api"

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE=$(curl --silent \
    --output /dev/null \
    --write-out "%{http_code}" \
    --max-time 5 \
    "$TASKBOARD_URL") || HTTP_CODE="000"

  if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 404 ]; then
    # 404 is acceptable — the /api root may not exist, but the server is up
    pass "Taskboard API responding (HTTP $HTTP_CODE)"
  elif [ "$HTTP_CODE" = "000" ]; then
    fail "Taskboard not running — start with: taskboard start --port 3010"
  else
    fail "Taskboard API returned HTTP $HTTP_CODE"
  fi
else
  echo "SKIP: Taskboard check (curl not available)"
fi

# ---------- summary -------------------------------------------------------

echo ""
echo "=== Verification Summary ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Local dev environment has issues. Fix the failures above before starting work."
  exit 1
else
  echo "Local dev environment is healthy."
  echo "Run: cd web && npm run dev"
fi
