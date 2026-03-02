---
name: build
description: Build the WASM engine (WebGL2 + WebGPU variants) and copy to web/public/
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[variant: all|webgl2|webgpu]"
---

# Build WASM Engine

Build the Bevy engine as WebAssembly for the browser. This produces 4 variants:
- `engine-pkg-webgl2` — WebGL2 editor build
- `engine-pkg-webgpu` — WebGPU editor build
- `engine-pkg-webgl2-runtime` — WebGL2 game runtime (no editor features)
- `engine-pkg-webgpu-runtime` — WebGPU game runtime (no editor features)

## Prerequisites

Verify these are available before building:
- `rustc` (stable)
- `wasm32-unknown-unknown` target installed (`rustup target list --installed`)
- `wasm-bindgen` CLI v0.2.108 (`wasm-bindgen --version`) — must match Cargo.lock

## Build Steps

### Full build (default when $ARGUMENTS is empty or "all")

Run the PowerShell build script from the project root:

```bash
# From project root:
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```

This handles:
1. Setting `LIB` env for Windows SDK (proc-macro native linking)
2. Building 4 cargo variants (webgl2, webgpu, webgl2 runtime, webgpu runtime)
3. Running `wasm-bindgen` on each
4. Optionally running `wasm-opt -Oz` for size reduction
5. Copying output to `web/public/engine-pkg-*`

### Single variant build

If $ARGUMENTS is "webgl2" or "webgpu", build only that variant:

```bash
cd engine
cargo build --target wasm32-unknown-unknown --release --features $ARGUMENTS
wasm-bindgen --target web --out-dir pkg-$ARGUMENTS target/wasm32-unknown-unknown/release/forge_engine.wasm
```

## Verification

After building, verify the output exists:

```bash
ls -la web/public/engine-pkg-webgl2/forge_engine_bg.wasm
ls -la web/public/engine-pkg-webgpu/forge_engine_bg.wasm
```

## Common Issues

- **wasm-bindgen version mismatch**: Must be 0.2.108. Install with `cargo install wasm-bindgen-cli --version 0.2.108`
- **Missing LIB env**: Proc-macro crates (e.g., doc-image-embed) need Windows SDK libs for native host compilation
- **Build time**: Full build takes ~5-10 minutes depending on hardware
