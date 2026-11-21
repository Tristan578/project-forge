#!/usr/bin/env bash
set -euo pipefail

# Assert the JSON emitted by `vercel deploy --dry --format=json` contains at
# least one non-empty file from every engine bundle copied into web/public.
# Checking Vercel's resolved upload manifest catches ignore-rule and root-path
# mistakes that a filesystem check immediately after `cp` cannot see.

manifest=${1:?usage: assert-vercel-engine-manifest.sh <manifest.json>}

if ! jq -e '.files | type == "array"' "$manifest" >/dev/null; then
  echo "Vercel dry-run output has no files array: $manifest" >&2
  exit 1
fi

variants=(webgl2 webgpu webgl2-runtime webgpu-runtime)
for variant in "${variants[@]}"; do
  repo_prefix="web/public/engine-pkg-${variant}/"
  root_prefix="public/engine-pkg-${variant}/"
  if ! jq -e --arg repo_prefix "$repo_prefix" --arg root_prefix "$root_prefix" \
    '.files | any(.path | startswith($repo_prefix) or startswith($root_prefix))' "$manifest" >/dev/null; then
    echo "Vercel upload is missing engine-pkg-${variant}" >&2
    exit 1
  fi

  if ! jq -e --arg repo_prefix "$repo_prefix" --arg root_prefix "$root_prefix" \
    '.files | any(((.path | startswith($repo_prefix)) or (.path | startswith($root_prefix))) and (.size > 0))' "$manifest" >/dev/null; then
    echo "Vercel upload contains no non-empty file under engine-pkg-${variant}" >&2
    exit 1
  fi
done

echo "Vercel upload contains all four non-empty engine bundles."
