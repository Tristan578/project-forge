#!/usr/bin/env bash
set -euo pipefail
# Require every browser dependency in Vercel's resolved upload manifest.
# This catches ignore rules and root-path mistakes after fallback packaging.
manifest=${1:?usage: assert-vercel-engine-manifest.sh <manifest.json>}
if ! jq -e '.files | type == "array"' "$manifest" >/dev/null; then
  echo "Vercel dry-run output has no files array: $manifest" >&2
  exit 1
fi
variants=(webgl2 webgpu webgl2-runtime webgpu-runtime)
for variant in "${variants[@]}"; do
  for dependency in forge_engine.js forge_engine_bg.wasm wasm-manifest.json; do
    repo_path="web/public/engine-pkg-${variant}/${dependency}"
    root_path="public/engine-pkg-${variant}/${dependency}"
    if ! jq -e --arg repo_path "$repo_path" --arg root_path "$root_path" \
      '.files | any((.path == $repo_path or .path == $root_path) and (.size | type == "number") and (.size > 0))' "$manifest" >/dev/null; then
      echo "Vercel upload is missing a non-empty engine-pkg-${variant}/${dependency}" >&2
      exit 1
    fi
  done
done
echo "Vercel upload contains all twelve required engine fallback files."
