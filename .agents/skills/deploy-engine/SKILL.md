---
name: deploy-engine
description: Build WASM engine (WebGL2 + WebGPU) and deploy to Cloudflare R2 CDN at engine.spawnforge.ai. Use when engine/ Rust code changes need to ship, or when asked to "deploy engine", "update CDN", or "publish WASM".
disable-model-invocation: true
---

# Deploy Engine to R2 CDN

Build both WASM variants and upload to the `spawnforge-engine` R2 bucket.

## Steps

1. **Build WASM** — `bash "${CLAUDE_SKILL_DIR}/scripts/build-and-upload.sh"`
2. **Verify** — the script checks `https://engine.spawnforge.ai/<sha>/engine-pkg-*/forge_engine_bg.wasm` and the same under `/latest/` for HTTP 200 and `content-type: application/wasm`, and exits 1 on any miss. Those are the only prefixes the client loads (`getWasmBasePaths` in `web/src/hooks/useEngine.ts`).

## Prerequisites
- Rust stable + `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` v0.2.127
- `aws` CLI, with R2 credentials in `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (the upload goes through `scripts/upload-wasm-to-r2.sh`, the same script CD uses)
- R2 bucket: `spawnforge-engine`

## Scripts
- `bash "${CLAUDE_SKILL_DIR}/scripts/build-and-upload.sh"` — Full build + upload pipeline
