#!/usr/bin/env bash
# Build WASM engine variants and upload to Cloudflare R2 CDN.
# Usage: bash scripts/build-and-upload.sh [webgl2|webgpu|all]
#
# Requires: wasm-bindgen-cli =0.2.127, the aws CLI, and R2 credentials in
# R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (read by
# scripts/upload-wasm-to-r2.sh). Bucket: spawnforge-engine.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
VARIANT="${1:-all}"
BUCKET="spawnforge-engine"
CDN_URL="https://engine.spawnforge.ai"

echo "=== SpawnForge Engine Deploy ==="
echo ""

# Verify prerequisites
command -v wasm-bindgen &>/dev/null || { echo "ERROR: wasm-bindgen-cli not found"; exit 1; }
command -v aws &>/dev/null || { echo "ERROR: aws CLI not found (scripts/upload-wasm-to-r2.sh uses it)"; exit 1; }

WBVER=$(wasm-bindgen --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [[ "$WBVER" != "0.2.127" ]]; then
  echo "ERROR: wasm-bindgen version $WBVER != 0.2.127 (pinned)"
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

# Upload the way CD does (cd.yml upload-wasm-cdn): stage the packages, generate
# their manifests, then hand them to scripts/upload-wasm-to-r2.sh, which writes
# the versioned /<sha>/ prefix and the /latest/ alias. The client only ever
# loads those two prefixes (getWasmBasePaths in web/src/hooks/useEngine.ts), so
# an upload to the bucket root would never be served.
ENGINE_VERSION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
staged=0
for pkg_dir in "$REPO_ROOT"/web/public/engine-pkg-*; do
  [[ -d "$pkg_dir" ]] || continue
  cp -R "$pkg_dir" "$STAGE/"
  staged=$((staged + 1))
done
if [[ "$staged" -eq 0 ]]; then
  echo "ERROR: no web/public/engine-pkg-* directories to upload — did the build run?"
  exit 1
fi
bash "$REPO_ROOT/scripts/generate-wasm-manifests.sh" "$STAGE"

echo ""
echo "Uploading $staged package(s) to R2 bucket $BUCKET as version $ENGINE_VERSION"
WASM_SOURCE_DIR="$STAGE" ENGINE_VERSION="$ENGINE_VERSION" R2_BUCKET="$BUCKET" \
  bash "$REPO_ROOT/scripts/upload-wasm-to-r2.sh"

# Verify what a browser needs: HTTP 200 AND an application/wasm content type,
# at both prefixes the client reads (a 200 with no Content-Type is refused).
echo ""
echo "Verifying CDN..."
failed=0
for prefix in "$ENGINE_VERSION" latest; do
  for variant in webgl2 webgpu webgl2-runtime webgpu-runtime; do
    [[ -d "$STAGE/engine-pkg-$variant" ]] || continue
    url="$CDN_URL/$prefix/engine-pkg-$variant/forge_engine_bg.wasm"
    headers="$(curl -sI "$url" 2>/dev/null || true)"
    status="$(printf '%s\n' "$headers" | awk 'NR==1{print $2}')"
    ctype="$(printf '%s\n' "$headers" | tr -d '\r' | awk -F': *' 'tolower($1)=="content-type"{print tolower($2)}' | tail -1)"
    if [[ "$status" == "200" && "$ctype" == application/wasm* ]]; then
      echo "  OK: $prefix/engine-pkg-$variant"
    else
      echo "  FAIL: $prefix/engine-pkg-$variant (HTTP ${status:-none}, content-type ${ctype:-none})"
      failed=1
    fi
  done
done

if [[ "$failed" -ne 0 ]]; then
  echo ""
  echo "Deploy FAILED verification."
  exit 1
fi
echo ""
echo "Deploy complete."
