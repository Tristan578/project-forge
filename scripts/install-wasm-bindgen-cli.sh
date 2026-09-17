#!/usr/bin/env bash
# Install only the wasm-bindgen CLI version locked by engine/Cargo.lock.
set -euo pipefail
LOCKFILE="${1:-engine/Cargo.lock}"
expected="$(awk '/^name = "wasm-bindgen"$/ { found=1; next } found && /^version = / { gsub(/"/, "", $3); print $3; exit }' "$LOCKFILE")"
if [[ ! "$expected" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Could not derive a wasm-bindgen version from $LOCKFILE" >&2
  exit 1
fi
if [[ "${VALIDATE_ONLY:-false}" == true ]]; then
  echo "$expected"
  exit 0
fi
if command -v wasm-bindgen >/dev/null 2>&1; then
  actual="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" || actual=""
  if [[ "$actual" == "$expected" ]]; then exit 0; fi
  echo "::warning::Rejecting cached wasm-bindgen $actual; expected $expected"
  rm -f "$(command -v wasm-bindgen)"
fi
cargo install --force --locked wasm-bindgen-cli --version "$expected"
actual="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" || actual=""
[[ "$actual" == "$expected" ]] || { echo "::error::wasm-bindgen version $actual does not match lockfile $expected" >&2; exit 1; }
