#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../assert-vercel-engine-manifest.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP/complete.json" <<'PY'
import json, sys
variants = ['webgl2', 'webgpu', 'webgl2-runtime', 'webgpu-runtime']
files = ['forge_engine.js', 'forge_engine_bg.wasm', 'wasm-manifest.json']
json.dump({'files': [{'path': f'web/public/engine-pkg-{v}/{f}', 'size': 10} for v in variants for f in files]}, open(sys.argv[1], 'w'))
PY
bash "$SCRIPT" "$TMP/complete.json"
sed 's#web/public/#public/#g' "$TMP/complete.json" >"$TMP/root-relative.json"
bash "$SCRIPT" "$TMP/root-relative.json"
for variant in webgl2 webgpu webgl2-runtime webgpu-runtime; do
  for dependency in forge_engine.js forge_engine_bg.wasm wasm-manifest.json; do
    path="web/public/engine-pkg-${variant}/${dependency}"
    jq --arg path "$path" 'del(.files[] | select(.path == $path))' "$TMP/complete.json" >"$TMP/missing.json"
    if bash "$SCRIPT" "$TMP/missing.json"; then
      echo "expected missing $path to fail" >&2
      exit 1
    fi
    jq --arg path "$path" '(.files[] | select(.path == $path) | .size) = 0' "$TMP/complete.json" >"$TMP/empty.json"
    if bash "$SCRIPT" "$TMP/empty.json"; then
      echo "expected empty $path to fail" >&2
      exit 1
    fi
  done
done
jq '(.files[] | select(.path | endswith("forge_engine_bg.wasm")) | .path) |= sub("forge_engine_bg.wasm$"; "other.wasm")' "$TMP/complete.json" >"$TMP/unrelated.json"
if bash "$SCRIPT" "$TMP/unrelated.json"; then
  echo "an unrelated wasm filename must not substitute for the browser dependency" >&2
  exit 1
fi
printf '%s\n' 'assert-vercel-engine-manifest tests passed'
