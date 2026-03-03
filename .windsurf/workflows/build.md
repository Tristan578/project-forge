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
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```

If on Mac/Linux without PowerShell, build manually:
```bash
cd engine && cargo build --target wasm32-unknown-unknown --release --features webgl2
cd engine && cargo build --target wasm32-unknown-unknown --release --features webgpu
wasm-bindgen --target web --out-dir pkg-webgl2 target/wasm32-unknown-unknown/release/forge_engine.wasm
wasm-bindgen --target web --out-dir pkg-webgpu target/wasm32-unknown-unknown/release/forge_engine.wasm
```

3. Copy WASM artifacts to web/public/:
```bash
mkdir -p web/public/engine-pkg-webgl2 web/public/engine-pkg-webgpu
cp engine/pkg-webgl2/* web/public/engine-pkg-webgl2/
cp engine/pkg-webgpu/* web/public/engine-pkg-webgpu/
```

4. Verify the build produced valid WASM files:
// turbo
```bash
ls -la web/public/engine-pkg-webgl2/forge_engine_bg.wasm web/public/engine-pkg-webgpu/forge_engine_bg.wasm
```
