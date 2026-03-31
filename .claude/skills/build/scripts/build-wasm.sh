#!/usr/bin/env bash
# Cross-platform WASM build wrapper for SpawnForge engine.
#
# On macOS/Linux: translates the PowerShell build_wasm.ps1 steps to bash.
# On Windows: delegates to PowerShell (build_wasm.ps1 is the canonical script).
#
# Produces 4 build variants in web/public/:
#   engine-pkg-webgl2/     — Editor, WebGL2 backend
#   engine-pkg-webgpu/     — Editor, WebGPU backend
#   engine-pkg-webgl2-runtime/  — Runtime (exported game), WebGL2
#   engine-pkg-webgpu-runtime/  — Runtime (exported game), WebGPU
#
# Requirements:
#   - Rust stable with wasm32-unknown-unknown target
#   - wasm-bindgen-cli 0.2.108 (PINNED — must match Cargo.lock)
#   - ~5-10 minutes build time
#
# Usage:
#   bash scripts/build-wasm.sh            # all 4 variants
#   bash scripts/build-wasm.sh webgl2     # editor WebGL2 only
#   bash scripts/build-wasm.sh webgpu     # editor WebGPU only
#
# Install prerequisites:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.108

set -euo pipefail

REQUESTED="${1:-all}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/engine"
WEB_PUBLIC="$REPO_ROOT/web/public"
TARGET="wasm32-unknown-unknown"
WASM_BINARY="$ENGINE_DIR/target/$TARGET/release/forge_engine.wasm"

# On Windows, delegate to PowerShell
if [[ "${OS:-}" == "Windows_NT" ]]; then
  echo "Detected Windows — delegating to build_wasm.ps1"
  powershell -ExecutionPolicy Bypass -File "$REPO_ROOT/build_wasm.ps1"
  exit $?
fi

# Verify prerequisites
if ! command -v cargo &>/dev/null; then
  echo "ERROR: cargo not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

if ! rustup target list --installed | grep -q "$TARGET"; then
  echo "ERROR: wasm32-unknown-unknown target not installed." >&2
  echo "Run: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

if ! command -v wasm-bindgen &>/dev/null; then
  echo "ERROR: wasm-bindgen not found." >&2
  echo "Run: cargo install wasm-bindgen-cli --version 0.2.108" >&2
  exit 1
fi

WB_VERSION=$(wasm-bindgen --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
if [[ "$WB_VERSION" != "0.2.108" ]]; then
  echo "ERROR: wasm-bindgen version mismatch. Found $WB_VERSION, required 0.2.108." >&2
  echo "Run: cargo install wasm-bindgen-cli --version 0.2.108 --force" >&2
  exit 1
fi

mkdir -p "$WEB_PUBLIC"

build_variant() {
  local features="$1"
  local out_dir="$2"

  echo ""
  echo "=== Building $out_dir ($features) ==="
  (cd "$ENGINE_DIR" && cargo build --target "$TARGET" --release --features "$features")

  echo "=== wasm-bindgen: $out_dir ==="
  wasm-bindgen --target web --out-dir "$WEB_PUBLIC/$out_dir" "$WASM_BINARY"

  echo "DONE: $WEB_PUBLIC/$out_dir"
}

case "$REQUESTED" in
  webgl2)
    build_variant "webgl2" "engine-pkg-webgl2"
    ;;
  webgpu)
    build_variant "webgpu" "engine-pkg-webgpu"
    ;;
  all)
    build_variant "webgl2"         "engine-pkg-webgl2"
    build_variant "webgpu"         "engine-pkg-webgpu"
    build_variant "webgl2,runtime" "engine-pkg-webgl2-runtime"
    build_variant "webgpu,runtime" "engine-pkg-webgpu-runtime"
    ;;
  *)
    echo "ERROR: Unknown variant '$REQUESTED'. Use: webgl2 | webgpu | all" >&2
    exit 1
    ;;
esac

echo ""
echo "Build complete. Output in $WEB_PUBLIC/"
ls "$WEB_PUBLIC/" | grep engine-pkg
