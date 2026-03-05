#!/usr/bin/env bash
# Architecture validation hook for Copilot coding agent sessions.
# Runs after each tool use to catch boundary violations early.
set -euo pipefail

ERRORS=0

# 1. Check bridge isolation: no web_sys/js_sys/wasm_bindgen imports outside engine/src/bridge/
if grep -rn --include='*.rs' 'use web_sys\|use js_sys\|use wasm_bindgen' engine/src/core/ 2>/dev/null; then
  echo "::error::Bridge isolation violated: web_sys/js_sys/wasm_bindgen found in engine/src/core/"
  ERRORS=$((ERRORS + 1))
fi

# 2. Check WASM boundary: no direct WASM imports outside useEngine.ts
WASM_IMPORTS=$(grep -rn --include='*.ts' --include='*.tsx' \
  "from.*forge_engine\|from.*pkg-webgl\|from.*pkg-webgpu" \
  web/src/ 2>/dev/null \
  | grep -v 'useEngine.ts' \
  | grep -v '__tests__' \
  | grep -v '.test.' \
  || true)

if [ -n "$WASM_IMPORTS" ]; then
  echo "::error::WASM boundary violated: direct engine imports found outside useEngine.ts:"
  echo "$WASM_IMPORTS"
  ERRORS=$((ERRORS + 1))
fi

# 3. Run ESLint on changed files (if any staged/modified TS/TSX files exist)
CHANGED_TS=$(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null \
  | grep -E '\.(ts|tsx)$' \
  | grep '^web/' \
  || true)

if [ -n "$CHANGED_TS" ]; then
  echo "Running ESLint on changed files..."
  cd web
  if ! printf '%s\n' "$CHANGED_TS" | xargs -r npx eslint --max-warnings 0 2>/dev/null; then
    echo "::error::ESLint found issues in changed files"
    ERRORS=$((ERRORS + 1))
  fi
  cd ..
fi

# 4. TypeScript check (only if web/ files changed)
if [ -n "$CHANGED_TS" ]; then
  echo "Running TypeScript check..."
  cd web
  if ! npx tsc --noEmit 2>/dev/null; then
    echo "::error::TypeScript errors found"
    ERRORS=$((ERRORS + 1))
  fi
  cd ..
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "Architecture check failed with $ERRORS error(s)"
  exit 1
fi

echo "Architecture check passed"
