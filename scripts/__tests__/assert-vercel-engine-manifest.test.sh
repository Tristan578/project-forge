#!/usr/bin/env bash
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../assert-vercel-engine-manifest.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

write_manifest() {
  local path=$1
  local webgl2_size=${2:-10}
  cat >"$path" <<JSON
{"files":[
  {"path":"web/public/engine-pkg-webgl2/engine.js","size":$webgl2_size},
  {"path":"web/public/engine-pkg-webgpu/engine.js","size":10},
  {"path":"web/public/engine-pkg-webgl2-runtime/engine.js","size":10},
  {"path":"web/public/engine-pkg-webgpu-runtime/engine.js","size":10}
]}
JSON
}

write_manifest "$TMP/complete.json"
"$SCRIPT" "$TMP/complete.json"

jq 'del(.files[] | select(.path | contains("engine-pkg-webgpu-runtime")))' \
  "$TMP/complete.json" >"$TMP/missing.json"
if "$SCRIPT" "$TMP/missing.json"; then
  echo "expected a missing runtime bundle to fail" >&2
  exit 1
fi

write_manifest "$TMP/empty.json" 0
if "$SCRIPT" "$TMP/empty.json"; then
  echo "expected an empty bundle to fail" >&2
  exit 1
fi

printf '%s\n' 'assert-vercel-engine-manifest tests passed'
