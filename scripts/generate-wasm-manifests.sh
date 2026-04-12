#!/usr/bin/env bash
# generate-wasm-manifests.sh
#
# Generates wasm-manifest.json for each engine-pkg-* variant under a given
# base directory. The manifest includes content hashes for both the WASM
# binary and JS glue file, plus a compound buildId for cache-busting.
#
# Usage:
#   bash scripts/generate-wasm-manifests.sh <base_dir>
#   bash scripts/generate-wasm-manifests.sh web/public
#
# Manifest format:
#   {
#     "wasmFile": "forge_engine_bg.wasm",
#     "jsFile": "forge_engine.js",
#     "wasmHash": "<sha256-first-16-hex>",
#     "jsHash": "<sha256-first-16-hex>",
#     "buildId": "<xor-of-wasmHash-and-jsHash>",
#     "hash": "<wasmHash>"   ← backward compat with legacy clients
#   }
set -euo pipefail

BASE_DIR="${1:?Usage: generate-wasm-manifests.sh <base_dir>}"

if [ ! -d "$BASE_DIR" ]; then
  echo "ERROR: Directory $BASE_DIR does not exist" >&2
  exit 1
fi

hash16() {
  shasum -a 256 "$1" | awk '{print substr($1, 1, 16)}'
}

xor_hex() {
  python3 -c "print(format(int('$1',16) ^ int('$2',16), '016x'))"
}

generated=0

for variant_dir in "$BASE_DIR"/engine-pkg-*; do
  [ -d "$variant_dir" ] || continue
  variant_name="$(basename "$variant_dir")"

  wasm_path="$variant_dir/forge_engine_bg.wasm"
  js_path="$variant_dir/forge_engine.js"

  if [ ! -f "$wasm_path" ]; then
    echo "  WARNING: $wasm_path not found, skipping $variant_name"
    continue
  fi
  if [ ! -f "$js_path" ]; then
    echo "  WARNING: $js_path not found, skipping $variant_name"
    continue
  fi

  wasm_hash=$(hash16 "$wasm_path")
  js_hash=$(hash16 "$js_path")
  build_id=$(xor_hex "$wasm_hash" "$js_hash")

  printf '{"wasmFile":"forge_engine_bg.wasm","jsFile":"forge_engine.js","wasmHash":"%s","jsHash":"%s","buildId":"%s","hash":"%s"}' \
    "$wasm_hash" "$js_hash" "$build_id" "$wasm_hash" \
    > "$variant_dir/wasm-manifest.json"

  echo "  $variant_name: wasmHash=$wasm_hash jsHash=$js_hash buildId=$build_id"
  generated=$((generated + 1))
done

if [ "$generated" -eq 0 ]; then
  echo "WARNING: No engine-pkg-* directories with WASM files found in $BASE_DIR"
  exit 1
fi

echo "Generated $generated manifests in $BASE_DIR"
