#!/usr/bin/env bash
set -euo pipefail

# Resolve project root (where this script lives)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$PROJECT_ROOT/engine"
WEB_PUBLIC="$PROJECT_ROOT/web/public"

# Ensure cargo is on PATH
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export PATH="$CARGO_HOME/bin:$PATH"

WASM_TARGET="wasm32-unknown-unknown"
WASM_BINARY="$ENGINE_DIR/target/$WASM_TARGET/release/forge_engine.wasm"

cd "$ENGINE_DIR"

echo "=== Building WebGL2 variant ==="
cargo build --target "$WASM_TARGET" --release --features webgl2

echo "=== wasm-bindgen WebGL2 ==="
wasm-bindgen --target web --out-dir pkg-webgl2 "$WASM_BINARY"

echo "=== Building WebGPU variant ==="
cargo build --target "$WASM_TARGET" --release --features webgpu

echo "=== wasm-bindgen WebGPU ==="
wasm-bindgen --target web --out-dir pkg-webgpu "$WASM_BINARY"

# --- Runtime variants (stripped editor systems for exported games) ---

echo "=== Building WebGL2 Runtime variant ==="
cargo build --target "$WASM_TARGET" --release --features webgl2,runtime

echo "=== wasm-bindgen WebGL2 Runtime ==="
wasm-bindgen --target web --out-dir pkg-webgl2-runtime "$WASM_BINARY"

echo "=== Building WebGPU Runtime variant ==="
cargo build --target "$WASM_TARGET" --release --features webgpu,runtime

echo "=== wasm-bindgen WebGPU Runtime ==="
wasm-bindgen --target web --out-dir pkg-webgpu-runtime "$WASM_BINARY"

# --- wasm-opt pass (optional, warn if not found) ---

if command -v wasm-opt &>/dev/null; then
    echo "=== Running wasm-opt (Oz) ==="
    for pkg in pkg-webgl2 pkg-webgpu pkg-webgl2-runtime pkg-webgpu-runtime; do
        wasm_file="$pkg/forge_engine_bg.wasm"
        if [ -f "$wasm_file" ]; then
            size_before=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file")
            wasm-opt -Oz --enable-bulk-memory -o "$wasm_file" "$wasm_file" && {
                size_after=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file")
                echo "  $pkg: $((size_before / 1048576)) MB -> $((size_after / 1048576)) MB"
            } || echo "  wasm-opt failed for $pkg (non-fatal)"
        fi
    done
else
    echo "wasm-opt not found — skipping optimization. Install via: cargo install wasm-opt"
fi

echo "=== Copying to web/public ==="

for dir in engine-pkg-webgl2 engine-pkg-webgpu engine-pkg-webgl2-runtime engine-pkg-webgpu-runtime; do
    mkdir -p "$WEB_PUBLIC/$dir"
done

cp pkg-webgl2/*          "$WEB_PUBLIC/engine-pkg-webgl2/"
cp pkg-webgpu/*          "$WEB_PUBLIC/engine-pkg-webgpu/"
cp pkg-webgl2-runtime/*  "$WEB_PUBLIC/engine-pkg-webgl2-runtime/"
cp pkg-webgpu-runtime/*  "$WEB_PUBLIC/engine-pkg-webgpu-runtime/"

# --- Generate content-hash manifests for cache-busting ---
# useEngine.ts reads wasm-manifest.json to append ?v=<hash> to WASM URLs,
# preventing browsers from serving stale binaries after a deployment.
echo "=== Generating WASM content-hash manifests ==="
for variant in engine-pkg-webgl2 engine-pkg-webgpu engine-pkg-webgl2-runtime engine-pkg-webgpu-runtime; do
    dest_dir="$WEB_PUBLIC/$variant"
    wasm_path="$dest_dir/forge_engine_bg.wasm"
    if [ -f "$wasm_path" ]; then
        # First 16 hex chars of SHA-256 (64 bits — sufficient for cache-busting)
        short_hash=$(shasum -a 256 "$wasm_path" | awk '{print substr($1, 1, 16)}')
        printf '{"wasmFile":"forge_engine_bg.wasm","jsFile":"forge_engine.js","hash":"%s"}' "$short_hash" \
            > "$dest_dir/wasm-manifest.json"
        echo "  $variant hash: $short_hash"
    else
        echo "  WARNING: $wasm_path not found, skipping manifest"
    fi
done

echo "=== All WASM variants built successfully (editor + runtime) ==="
