#!/usr/bin/env bash
# Keep the vulnerability scanner reproducible and reject stale cache entries.
set -euo pipefail
expected="${CARGO_AUDIT_VERSION:-0.22.2}"
if command -v cargo-audit >/dev/null 2>&1; then
  actual="$(cargo audit --version 2>/dev/null | awk '{print $NF}')" || actual=""
  if [[ "$actual" == "$expected" ]]; then exit 0; fi
  echo "::warning::Rejecting cached cargo-audit $actual; expected $expected"
  rm -f "$(command -v cargo-audit)"
fi
cargo install --force --locked cargo-audit --version "$expected"
actual="$(cargo audit --version 2>/dev/null | awk '{print $NF}')" || actual=""
[[ "$actual" == "$expected" ]] || { echo "::error::cargo-audit version $actual does not match $expected" >&2; exit 1; }
