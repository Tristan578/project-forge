#!/usr/bin/env bash
# Build WASM engine variants and upload to Cloudflare R2 CDN.
# Usage: bash scripts/build-and-upload.sh [webgl2|webgpu|all]
#
# Requires: wasm-bindgen-cli =0.2.108, wrangler CLI, R2 bucket spawnforge-engine

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
VARIANT="${1:-all}"
BUCKET="spawnforge-engine"
CDN_URL="https://engine.spawnforge.ai"

echo "=== SpawnForge Engine Deploy ==="
echo ""

# Verify prerequisites
command -v wasm-bindgen &>/dev/null || { echo "ERROR: wasm-bindgen-cli not found"; exit 1; }
command -v wrangler &>/dev/null || { echo "ERROR: wrangler CLI not found"; exit 1; }

WBVER=$(wasm-bindgen --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [[ "$WBVER" != "0.2.108" ]]; then
  echo "ERROR: wasm-bindgen version $WBVER != 0.2.108 (pinned)"
  exit 1
fi

# Build
echo "Building WASM ($VARIANT)..."
if [[ -f "$REPO_ROOT/build_wasm.ps1" ]] && command -v powershell.exe &>/dev/null; then
  powershell.exe -ExecutionPolicy Bypass -File "$REPO_ROOT/build_wasm.ps1"
elif [[ -f "$REPO_ROOT/.claude/skills/build/scripts/build-wasm.sh" ]]; then
  bash "$REPO_ROOT/.claude/skills/build/scripts/build-wasm.sh" "$VARIANT"
else
  echo "ERROR: No build script found (build_wasm.ps1 or build-wasm.sh)"
  exit 1
fi

echo ""
echo "Uploading to R2 bucket: $BUCKET"

for pkg_dir in "$REPO_ROOT"/web/public/engine-pkg-*; do
  pkg_name=$(basename "$pkg_dir")
  echo "  Uploading $pkg_name..."
  for file in "$pkg_dir"/*; do
    fname=$(basename "$file")
    wrangler r2 object put "$BUCKET/$pkg_name/$fname" --file "$file" --remote 2>/dev/null
  done
done

echo ""
echo "Verifying CDN..."
for variant in webgl2 webgpu webgl2-runtime webgpu-runtime; do
  url="$CDN_URL/engine-pkg-$variant/spawnforge_engine_bg.wasm"
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    echo "  OK: engine-pkg-$variant"
  else
    echo "  FAIL: engine-pkg-$variant (HTTP $status)"
  fi
done

echo ""
echo "Deploy complete."
