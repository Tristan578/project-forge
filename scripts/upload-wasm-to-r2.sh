#!/usr/bin/env bash
# upload-wasm-to-r2.sh
# Uploads WASM engine artifacts to Cloudflare R2 via S3-compatible API.
#
# Versioned paths (/<sha>/engine-pkg-*/) get immutable cache headers so
# browsers and CDN edge nodes cache them forever — the SHA guarantees
# uniqueness.  The /latest/ alias uses a short-lived header so clients
# always pick up the newest version pointer.
set -euo pipefail

: "${WASM_SOURCE_DIR:?WASM_SOURCE_DIR is required}"
: "${ENGINE_VERSION:?ENGINE_VERSION is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
R2_BUCKET="${R2_BUCKET:-spawnforge-engine}"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Uploading WASM artifacts to R2..."
echo "  Source: ${WASM_SOURCE_DIR}"
echo "  Bucket: ${R2_BUCKET}"
echo "  Version: ${ENGINE_VERSION}"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="auto"

uploaded=0

# --- Versioned upload (immutable cache) ---
for pkg_dir in "${WASM_SOURCE_DIR}"/engine-pkg-*; do
  [ -d "${pkg_dir}" ] || continue
  pkg_name="$(basename "${pkg_dir}")"
  echo "  Uploading ${pkg_name} (versioned)..."
  aws s3 sync "${pkg_dir}" "s3://${R2_BUCKET}/${ENGINE_VERSION}/${pkg_name}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --no-progress \
    --exclude "*.d.ts" \
    --cache-control "max-age=31536000, immutable"
  uploaded=$((uploaded + 1))
done

if [ ${uploaded} -eq 0 ]; then
  echo "WARNING: No engine-pkg-* directories found in ${WASM_SOURCE_DIR}"
  exit 1
fi

echo "Uploaded ${uploaded} packages to R2 at version ${ENGINE_VERSION}"

# --- Latest alias (short-lived cache so clients always resolve to newest) ---
for pkg_dir in "${WASM_SOURCE_DIR}"/engine-pkg-*; do
  [ -d "${pkg_dir}" ] || continue
  pkg_name="$(basename "${pkg_dir}")"
  echo "  Uploading ${pkg_name} (latest alias)..."
  aws s3 sync "${pkg_dir}" "s3://${R2_BUCKET}/latest/${pkg_name}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --no-progress \
    --exclude "*.d.ts" \
    --cache-control "max-age=60, must-revalidate"
done

echo "Also uploaded as 'latest'. Done."
