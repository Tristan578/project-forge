#!/usr/bin/env bash
# Run cargo check against the wasm32-unknown-unknown target for the SpawnForge engine.
#
# This script is a standalone wrapper around the hook at
# .claude/hooks/cargo-check-wasm.sh. Use it to manually check the engine
# for WASM compilation errors without waiting for a PostToolUse hook to fire.
#
# Usage:
#   bash scripts/cargo-check-wasm.sh [features]
#
# Arguments:
#   features   Cargo feature flags to enable (default: checks both webgl2 and webgpu)
#
# Examples:
#   bash scripts/cargo-check-wasm.sh             # check both variants
#   bash scripts/cargo-check-wasm.sh webgl2      # check WebGL2 only
#   bash scripts/cargo-check-wasm.sh webgpu      # check WebGPU only

set -euo pipefail

REQUESTED_FEATURE="${1:-all}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/engine"

if [[ ! -d "$ENGINE_DIR" ]]; then
  echo "ERROR: engine/ directory not found at $ENGINE_DIR" >&2
  exit 1
fi

TARGET="wasm32-unknown-unknown"

run_check() {
  local features="$1"
  echo ""
  echo ">>> cargo check --target $TARGET --features $features"
  if (cd "$ENGINE_DIR" && cargo check --target "$TARGET" --features "$features" --message-format=short 2>&1); then
    echo "PASSED: $features"
  else
    echo "FAILED: $features" >&2
    return 1
  fi
}

FAILED=0

case "$REQUESTED_FEATURE" in
  all)
    run_check "webgl2" || FAILED=1
    run_check "webgpu" || FAILED=1
    ;;
  *)
    run_check "$REQUESTED_FEATURE" || FAILED=1
    ;;
esac

if [[ $FAILED -ne 0 ]]; then
  echo ""
  echo "One or more cargo checks FAILED. Fix the errors above before proceeding." >&2
  exit 1
fi

echo ""
echo "All cargo checks PASSED."
