#!/usr/bin/env bash
# game-engine: Verify all 4 WASM engine binaries exist and are not stale.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-engine-binaries.sh"

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
ENGINE_DIR="${REPO_ROOT}/web/public"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

MIN_SIZE_BYTES=1048576  # 1MB minimum — a real WASM binary is 5-20MB

# The 4 variants that must exist
declare -A VARIANTS=(
  ["engine-pkg-webgl2"]="WebGL2 editor (fallback renderer)"
  ["engine-pkg-webgl2-runtime"]="WebGL2 runtime (exported games, fallback)"
  ["engine-pkg-webgpu"]="WebGPU editor (primary renderer)"
  ["engine-pkg-webgpu-runtime"]="WebGPU runtime (exported games, primary)"
)

# Key files that must exist in each variant package
KEY_FILES=(
  "forge_engine.js"
  "forge_engine_bg.wasm"
)

echo "=============================================="
echo "  SpawnForge WASM Engine Binary Check"
echo "  Dir: ${ENGINE_DIR}"
echo "=============================================="

section "Binary Package Presence"

for pkg in "${!VARIANTS[@]}"; do
  desc="${VARIANTS[$pkg]}"
  pkg_dir="${ENGINE_DIR}/${pkg}"

  if [ ! -d "$pkg_dir" ]; then
    fail "${pkg}/ — MISSING (${desc})"
    continue
  fi

  # Check key files
  all_files_ok=true
  for f in "${KEY_FILES[@]}"; do
    fpath="${pkg_dir}/${f}"
    if [ ! -f "$fpath" ]; then
      fail "${pkg}/${f} — FILE MISSING"
      all_files_ok=false
    fi
  done

  if [ "$all_files_ok" = true ]; then
    # Check WASM file size
    wasm_file="${pkg_dir}/forge_engine_bg.wasm"
    wasm_size=$(wc -c < "$wasm_file" 2>/dev/null || echo "0")
    if [ "$wasm_size" -lt "$MIN_SIZE_BYTES" ]; then
      fail "${pkg}/forge_engine_bg.wasm — TOO SMALL (${wasm_size} bytes, expected >1MB). Rebuild with build_wasm.ps1"
    else
      wasm_mb=$(echo "scale=1; ${wasm_size} / 1048576" | bc 2>/dev/null || echo "${wasm_size}B")
      pass "${pkg}/ — OK (WASM: ${wasm_mb}MB) — ${desc}"
    fi
  fi
done

section "Binary Staleness Check"

# Check if any Rust source files are newer than the WASM binaries
NEWEST_WASM=""
for pkg in "${!VARIANTS[@]}"; do
  wasm="${ENGINE_DIR}/${pkg}/forge_engine_bg.wasm"
  if [ -f "$wasm" ]; then
    # Track the newest WASM file
    if [ -z "$NEWEST_WASM" ] || [ "$wasm" -nt "$NEWEST_WASM" ]; then
      NEWEST_WASM="$wasm"
    fi
  fi
done

if [ -n "$NEWEST_WASM" ]; then
  # Find any Rust source files newer than the WASM
  STALE_COUNT=0
  if [ -d "${REPO_ROOT}/engine/src" ]; then
    while IFS= read -r -d '' rs_file; do
      if [ "$rs_file" -nt "$NEWEST_WASM" ]; then
        STALE_COUNT=$((STALE_COUNT + 1))
      fi
    done < <(find "${REPO_ROOT}/engine/src" -name "*.rs" -print0 2>/dev/null)
  fi

  if [ "$STALE_COUNT" -gt 0 ]; then
    warn "${STALE_COUNT} Rust source file(s) are newer than the WASM binaries"
    warn "Consider rebuilding: powershell -ExecutionPolicy Bypass -File build_wasm.ps1"
  else
    pass "WASM binaries are up to date with Rust sources"
  fi

  # Show the modification time of the newest WASM
  WASM_MOD=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$NEWEST_WASM" 2>/dev/null || \
             stat --format="%y" "$NEWEST_WASM" 2>/dev/null | cut -d'.' -f1 || \
             echo "unknown")
  echo "  Newest WASM binary: ${WASM_MOD}"
else
  fail "No WASM binaries found — run: powershell -ExecutionPolicy Bypass -File build_wasm.ps1"
fi

section "Cargo.toml Feature Check"

CARGO_TOML="${REPO_ROOT}/engine/Cargo.toml"
if [ -f "$CARGO_TOML" ]; then
  if grep -q 'webgl2' "$CARGO_TOML" && grep -q 'webgpu' "$CARGO_TOML"; then
    pass "Cargo.toml has both webgl2 and webgpu features defined"
  else
    warn "Cargo.toml may be missing webgl2 or webgpu feature definitions"
  fi
  if grep -q 'runtime' "$CARGO_TOML"; then
    pass "Cargo.toml has runtime feature defined"
  else
    warn "Cargo.toml missing runtime feature — exported games won't strip editor systems"
  fi
else
  warn "engine/Cargo.toml not found"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
if [ "$ISSUES" -gt 0 ]; then
  echo -e "  ${RED}RESULT: ${ISSUES} missing/broken binary package(s)${NC}"
  echo ""
  echo "  Rebuild command (from project root):"
  echo "    powershell -ExecutionPolicy Bypass -File build_wasm.ps1"
  echo ""
  echo "  Build requirements:"
  echo "    - Rust stable + wasm32-unknown-unknown target"
  echo "    - wasm-bindgen-cli v0.2.108 (must match Cargo.lock)"
  echo "    - Takes 5-10 minutes"
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}RESULT: ${WARNINGS} warning(s) — binaries present but may be stale${NC}"
else
  echo -e "  ${GREEN}RESULT: ALL 4 WASM ENGINE BINARIES PRESENT AND CURRENT${NC}"
fi
echo "=============================================="

exit "$ISSUES"
