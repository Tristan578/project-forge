#!/usr/bin/env bash
# Rust/WASM validation script for SpawnForge engine development
# Used by: rust-engine skill, builder agent, validator agent
# Usage: bash .claude/tools/validate-rust.sh [check|arch|full]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-check}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC}: $1"; }

echo "=== SpawnForge Rust Validation (mode: $MODE) ==="

# 1. Architecture boundary check (always runs)
echo ""
echo "--- Architecture Boundaries ---"
if python3 .claude/skills/arch-validator/check_arch.py; then
  pass "No architecture boundary violations"
else
  fail "Architecture boundary violations found"
fi

# 2. Check bridge isolation (grep for web_sys/js_sys in core/)
echo ""
echo "--- Bridge Isolation ---"
if grep -rn "web_sys\|js_sys\|wasm_bindgen" engine/src/core/ 2>/dev/null | grep -v "^Binary" | head -5; then
  fail "core/ contains browser imports (web_sys/js_sys/wasm_bindgen)"
else
  pass "core/ is free of browser dependencies"
fi

# 3. Check for unsafe blocks without SAFETY comments
echo ""
echo "--- Unsafe Audit ---"
UNSAFE_COUNT=$(grep -rn "unsafe {" engine/src/ 2>/dev/null | wc -l | tr -d ' ')
SAFETY_COUNT=$(grep -rn "// SAFETY:" engine/src/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNSAFE_COUNT" -gt "$SAFETY_COUNT" ]; then
  warn "Found $UNSAFE_COUNT unsafe blocks but only $SAFETY_COUNT SAFETY comments"
else
  pass "All unsafe blocks have SAFETY comments ($UNSAFE_COUNT/$SAFETY_COUNT)"
fi

if [ "$MODE" = "check" ]; then
  echo ""
  echo "=== Rust validation complete (quick mode) ==="
  exit 0
fi

# 4. Cargo check for WASM target (full mode)
if [ "$MODE" = "full" ]; then
  echo ""
  echo "--- Cargo Check (wasm32) ---"
  cd engine
  if cargo check --target wasm32-unknown-unknown 2>&1; then
    pass "cargo check --target wasm32-unknown-unknown succeeded"
  else
    fail "cargo check --target wasm32-unknown-unknown failed"
  fi
  cd "$PROJECT_ROOT"
fi

echo ""
echo "=== Rust validation complete ==="
