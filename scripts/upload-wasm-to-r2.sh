#!/usr/bin/env bash
# upload-wasm-to-r2.sh — Upload WASM engine binaries to Cloudflare R2
#
# Prerequisites:
#   - AWS CLI v2 (R2 is S3-compatible)
#   - R2 credentials configured:
#       export R2_ACCOUNT_ID=<your-account-id>
#       export R2_ACCESS_KEY_ID=<your-access-key>
#       export R2_SECRET_ACCESS_KEY=<your-secret-key>
#       export R2_BUCKET=spawnforge-engine
#
# Usage:
#   ./scripts/upload-wasm-to-r2.sh              # Upload all 4 variants
#   ./scripts/upload-wasm-to-r2.sh webgl2       # Upload only webgl2 editor variant
#
# Environment:
#   WASM_SOURCE_DIR  — Override source dir (default: web/public)
#   ENGINE_VERSION   — Version tag for uploads (default: "latest")
#                      In CI this is set to the short git SHA for cache-busting.
#                      Files upload to both /<variant>/ (latest) and /v/<version>/<variant>/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${WASM_SOURCE_DIR:-$PROJECT_ROOT/web/public}"
ENGINE_VERSION="${ENGINE_VERSION:-latest}"

# Validate environment
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"
: "${R2_BUCKET:=spawnforge-engine}"

# Map R2 credentials to AWS CLI env vars (R2 is S3-compatible)
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

VARIANTS=(
  engine-pkg-webgl2
  engine-pkg-webgpu
  engine-pkg-webgl2-runtime
  engine-pkg-webgpu-runtime
)

# Filter to specific variant if argument provided
if [[ ${1:-} ]]; then
  VARIANTS=("engine-pkg-$1")
fi

upload_file() {
  local src="$1" dest="$2" content_type="$3"
  aws s3 cp "$src" "s3://$R2_BUCKET/$dest" \
    --endpoint-url "$R2_ENDPOINT" \
    --content-type "$content_type" \
    --cache-control "public, max-age=31536000, immutable" \
    --no-cli-pager
}

uploaded=0

for variant in "${VARIANTS[@]}"; do
  dir="$SOURCE_DIR/$variant"
  if [[ ! -d "$dir" ]]; then
    echo "Skipping $variant (directory not found: $dir)"
    continue
  fi

  echo "Uploading $variant (version: $ENGINE_VERSION)..."

  # Upload to latest path (what NEXT_PUBLIC_ENGINE_CDN_URL points to)
  upload_file "$dir/forge_engine.js"      "$variant/forge_engine.js"      "application/javascript"
  upload_file "$dir/forge_engine_bg.wasm" "$variant/forge_engine_bg.wasm" "application/wasm"

  # Also upload to versioned path for rollback capability
  if [[ "$ENGINE_VERSION" != "latest" ]]; then
    upload_file "$dir/forge_engine.js"      "v/$ENGINE_VERSION/$variant/forge_engine.js"      "application/javascript"
    upload_file "$dir/forge_engine_bg.wasm" "v/$ENGINE_VERSION/$variant/forge_engine_bg.wasm" "application/wasm"
  fi

  echo "  Done: $variant"
  uploaded=$((uploaded + 1))
done

echo ""
echo "Uploaded $uploaded variant(s) to s3://$R2_BUCKET"
if [[ "$ENGINE_VERSION" != "latest" ]]; then
  echo "Versioned path: v/$ENGINE_VERSION/"
fi
echo "Set NEXT_PUBLIC_ENGINE_CDN_URL to your R2 public domain in Vercel."
