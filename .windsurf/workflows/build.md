---
description: Build the WASM engine (WebGL2 + WebGPU variants) and copy to web/public/
---

# Build WASM Engine

This workflow builds the Rust engine to WASM for both rendering backends.

## Prerequisites
- Rust stable with `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` v0.2.108

## Steps

1. Check that Rust toolchain is available:
// turbo
```bash
rustup target list --installed | grep wasm32
```

2. Build the WASM engine (this takes 5-10 minutes):
```bash
# macOS / Linux
./build_wasm.sh

# Windows (PowerShell)
# powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```
The script builds all 4 variants (WebGL2/WebGPU × editor/runtime), runs wasm-opt if available, and copies artifacts to `web/public/`.

3. Verify the build produced valid WASM files:
// turbo
```bash
ls -la web/public/engine-pkg-webgl2/forge_engine_bg.wasm web/public/engine-pkg-webgpu/forge_engine_bg.wasm
```
