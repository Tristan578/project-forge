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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$PROJECT_ROOT/web/public"

# Validate environment
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"
: "${R2_BUCKET:=spawnforge-engine}"

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

uploaded=0

for variant in "${VARIANTS[@]}"; do
  dir="$PUBLIC_DIR/$variant"
  if [[ ! -d "$dir" ]]; then
    echo "⚠ Skipping $variant (directory not found: $dir)"
    continue
  fi

  echo "Uploading $variant..."

  # Upload .js with correct content type
  aws s3 cp "$dir/forge_engine.js" "s3://$R2_BUCKET/$variant/forge_engine.js" \
    --endpoint-url "$R2_ENDPOINT" \
    --content-type "application/javascript" \
    --cache-control "public, max-age=31536000, immutable" \
    --no-sign-request=false 2>/dev/null

  # Upload .wasm with correct content type
  aws s3 cp "$dir/forge_engine_bg.wasm" "s3://$R2_BUCKET/$variant/forge_engine_bg.wasm" \
    --endpoint-url "$R2_ENDPOINT" \
    --content-type "application/wasm" \
    --cache-control "public, max-age=31536000, immutable" \
    --no-sign-request=false 2>/dev/null

  echo "  ✓ $variant uploaded"
  uploaded=$((uploaded + 1))
done

echo ""
echo "Done — $uploaded variant(s) uploaded to s3://$R2_BUCKET"
echo "Set NEXT_PUBLIC_ENGINE_CDN_URL to your R2 public domain in Vercel."
