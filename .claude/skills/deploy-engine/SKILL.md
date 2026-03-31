---
name: deploy-engine
description: Build WASM engine (WebGL2 + WebGPU) and deploy to Cloudflare R2 CDN at engine.spawnforge.ai. Use when engine/ Rust code changes need to ship, or when asked to "deploy engine", "update CDN", or "publish WASM".
disable-model-invocation: true
---

# Deploy Engine to R2 CDN

Build both WASM variants and upload to the `spawnforge-engine` R2 bucket.

## Steps

1. **Build WASM** — `bash "${CLAUDE_SKILL_DIR}/scripts/build-and-upload.sh"`
2. **Verify** — curl `https://engine.spawnforge.ai/engine-pkg-webgl2/spawnforge_engine_bg.wasm` returns 200

## Prerequisites
- Rust stable + `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` v0.2.108
- `wrangler` CLI authenticated to Cloudflare account `0b949ff499d179e24dde841f71d6134f`
- R2 bucket: `spawnforge-engine`

## Scripts
- `bash "${CLAUDE_SKILL_DIR}/scripts/build-and-upload.sh"` — Full build + upload pipeline
