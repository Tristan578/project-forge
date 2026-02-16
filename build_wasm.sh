#!/bin/bash

# Resolve project root (where this script lives)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"
ENGINE_DIR="$PROJECT_ROOT/engine"
WEB_PUBLIC="$PROJECT_ROOT/web/public"

# Ensure cargo is on PATH
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export PATH="$CARGO_HOME/bin:$PATH"

# Check for required tools
if ! command -v cargo &> /dev/null; then
    echo "ERROR: cargo not found. Please install Rust from https://rustup.rs/" >&2
    exit 1
fi

if ! command -v wasm-bindgen &> /dev/null; then
    echo "Installing wasm-bindgen-cli..."
    cargo install wasm-bindgen-cli
fi

WASM_TARGET="wasm32-unknown-unknown"
WASM_BINARY="$ENGINE_DIR/target/$WASM_TARGET/release/forge_engine.wasm"

cd "$ENGINE_DIR" || exit 1

# Build WebGL2 variant
echo "=== Building WebGL2 variant ==="
cargo build --target $WASM_TARGET --release --features webgl2
if [ $? -ne 0 ]; then
    echo "WebGL2 build FAILED" >&2
    exit 1
fi

# Run wasm-bindgen for WebGL2
echo "=== wasm-bindgen WebGL2 ==="
wasm-bindgen --target web --out-dir "pkg-webgl2" "$WASM_BINARY"
if [ $? -ne 0 ]; then
    echo "wasm-bindgen (webgl2) FAILED" >&2
    exit 1
fi

# Build WebGPU variant
echo "=== Building WebGPU variant ==="
cargo build --target $WASM_TARGET --release --features webgpu
if [ $? -ne 0 ]; then
    echo "WebGPU build FAILED" >&2
    exit 1
fi

# Run wasm-bindgen for WebGPU
echo "=== wasm-bindgen WebGPU ==="
wasm-bindgen --target web --out-dir "pkg-webgpu" "$WASM_BINARY"
if [ $? -ne 0 ]; then
    echo "wasm-bindgen (webgpu) FAILED" >&2
    exit 1
fi

# Optional wasm-opt pass
if command -v wasm-opt &> /dev/null; then
    echo "=== Running wasm-opt (Oz) ==="
    for pkg in "pkg-webgl2" "pkg-webgpu"; do
        WASM_FILE="$pkg/forge_engine_bg.wasm"
        if [ -f "$WASM_FILE" ]; then
            SIZE_BEFORE=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE" 2>/dev/null)
            SIZE_BEFORE_MB=$((SIZE_BEFORE / 1000000))

            wasm-opt -Oz --enable-bulk-memory -o "$WASM_FILE" "$WASM_FILE"
            if [ $? -eq 0 ]; then
                SIZE_AFTER=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE" 2>/dev/null)
                SIZE_AFTER_MB=$((SIZE_AFTER / 1000000))
                echo "  $pkg: ${SIZE_BEFORE_MB} MB -> ${SIZE_AFTER_MB} MB"
            else
                echo "  wasm-opt failed for $pkg (non-fatal)" >&2
            fi
        fi
    done
else
    echo "wasm-opt not found - skipping optimization. Install via: cargo install wasm-opt" >&2
fi

# Copy to web/public
echo "=== Copying to web/public ==="

mkdir -p "$WEB_PUBLIC/engine-pkg-webgl2"
mkdir -p "$WEB_PUBLIC/engine-pkg-webgpu"

cp -r pkg-webgl2/* "$WEB_PUBLIC/engine-pkg-webgl2/"
cp -r pkg-webgpu/* "$WEB_PUBLIC/engine-pkg-webgpu/"

echo "=== Both WASM variants built successfully ==="
