#!/usr/bin/env bash
# Install a pinned Vercel CLI in the job-local prefix. Never trust a cache by
# presence alone: a cache key collision or a manually damaged entry must rebuild.
set -euo pipefail

version="${VERCEL_CLI_VERSION:?VERCEL_CLI_VERSION is required}"
prefix="${VERCEL_CLI_PREFIX:?VERCEL_CLI_PREFIX is required}"
bin_dir="$prefix/node_modules/.bin"
bin="$bin_dir/vercel"

if [[ -x "$bin" ]]; then
  actual="$("$bin" --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//')" || actual=""
  if [[ "$actual" == "$version" ]]; then
    echo "$bin_dir" >> "$GITHUB_PATH"
    exit 0
  fi
  echo "::warning::Rejecting cached Vercel CLI $actual; expected $version"
  rm -rf "$prefix"
fi

mkdir -p "$prefix"
npm install --ignore-scripts --prefix "$prefix" "vercel@$version"
actual="$("$bin" --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//')" || actual=""
[[ "$actual" == "$version" ]] || { echo "::error::Vercel CLI $actual does not match $version" >&2; exit 1; }
echo "$bin_dir" >> "$GITHUB_PATH"
