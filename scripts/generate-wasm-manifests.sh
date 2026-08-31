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

# SHA-256 tool, resolved once at startup rather than hardcoded.
#
# `shasum` is a Perl script that ships with macOS and most Linux images but is
# ABSENT from Git-for-Windows and from slim/distroless containers, where only
# `sha256sum` (coreutils) or `openssl` exists. Hardcoding it made this script
# die with "shasum: command not found" anywhere Perl's shasum is missing. All
# three implementations emit the same SHA-256 digest in field 1, so the
# manifests this produces are byte-identical whichever one is selected.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1"; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1"; }
elif command -v openssl >/dev/null 2>&1; then
  sha256_of() { openssl dgst -sha256 -r "$1"; }
else
  echo "ERROR: no SHA-256 tool found (need one of: sha256sum, shasum, openssl)" >&2
  exit 1
fi

# First 16 hex chars of the file's SHA-256. Validates the digest before
# returning it: a truncated or empty hash must abort the build, never end up
# baked into a manifest that clients then use as a cache key.
hash16() {
  local digest
  digest="$(sha256_of "$1" | awk '{print $1}')"
  if ! printf '%s' "$digest" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    echo "ERROR: could not hash $1 (got '$digest')" >&2
    exit 1
  fi
  printf '%s\n' "${digest:0:16}"
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
