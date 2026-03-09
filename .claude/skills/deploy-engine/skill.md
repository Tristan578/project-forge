---
name: deploy-engine
description: Deploy WASM engine files to Cloudflare R2 CDN. Use after building the engine or when production shows engine loading errors.
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[variant: all|webgl2|webgpu] or 'status' to check current state"
---

# Deploy WASM Engine to R2 CDN

Upload built WASM engine files to the Cloudflare R2 bucket that serves `engine.spawnforge.ai`.

## Architecture

```
web/public/engine-pkg-*    (local build output)
        ↓  wrangler r2 object put --remote
R2 bucket: spawnforge-engine
        ↓  Cloudflare Worker: engine-cdn
https://engine.spawnforge.ai/engine-pkg-*/forge_engine.js
```

- **R2 Bucket**: `spawnforge-engine` — stores the raw WASM/JS files
- **Worker**: `engine-cdn` — serves from R2 with CORS headers (required for cross-origin browser fetch)
- **Custom domain**: `engine.spawnforge.ai` routes through the Worker
- **Vercel env var**: `NEXT_PUBLIC_ENGINE_CDN_URL=https://engine.spawnforge.ai` (build-time, set in both Production and Preview)

## Storage Rules

**Do NOT create duplicate files.** The R2 bucket should contain exactly one copy of each engine variant at the root path. Versioned paths (`v/<sha>/`) are only created in CI for rollback.

Expected bucket contents (4 variants x 2 files = 8 files):
```
engine-pkg-webgl2/forge_engine.js
engine-pkg-webgl2/forge_engine_bg.wasm
engine-pkg-webgpu/forge_engine.js
engine-pkg-webgpu/forge_engine_bg.wasm
engine-pkg-webgl2-runtime/forge_engine.js      (if runtime builds exist)
engine-pkg-webgl2-runtime/forge_engine_bg.wasm
engine-pkg-webgpu-runtime/forge_engine.js
engine-pkg-webgpu-runtime/forge_engine_bg.wasm
```

**Never** upload the same files under multiple paths unless versioning for rollback.

## Manual Deploy (when $ARGUMENTS is not "status")

### Step 1: Verify local build exists

```bash
ls -la web/public/engine-pkg-webgl2/forge_engine_bg.wasm
ls -la web/public/engine-pkg-webgpu/forge_engine_bg.wasm
```

If files don't exist, run `/build` first.

### Step 2: Upload to R2

Use `wrangler r2 object put` with `--remote` flag:

```bash
for variant in webgl2 webgpu; do
  for file in forge_engine.js forge_engine_bg.wasm; do
    local_path="web/public/engine-pkg-${variant}/${file}"
    content_type="application/javascript"
    [[ "$file" == *.wasm ]] && content_type="application/wasm"

    echo "Uploading engine-pkg-${variant}/${file}..."
    wrangler r2 object put "spawnforge-engine/engine-pkg-${variant}/${file}" \
      --file "$local_path" \
      --content-type "$content_type" \
      --remote
  done
done
```

For runtime variants, add `webgl2-runtime` and `webgpu-runtime` to the loop if they exist in `web/public/`.

### Step 3: Verify deployment

```bash
# Check files are accessible with CORS
curl -sI -H "Origin: https://www.spawnforge.ai" \
  "https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine.js" | \
  grep -i "HTTP\|access-control\|content-type"
```

Expected: HTTP 200, `access-control-allow-origin: https://www.spawnforge.ai`, `content-type: application/javascript`

## Status Check (when $ARGUMENTS is "status")

Verify the current deployment:

```bash
# 1. Check R2 bucket contents
wrangler r2 object list spawnforge-engine --remote 2>/dev/null | head -20

# 2. Verify CORS from browser origin
curl -sI -H "Origin: https://www.spawnforge.ai" \
  "https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine.js" | \
  grep -i "HTTP\|access-control"

# 3. Verify WASM file
curl -sI -H "Origin: https://www.spawnforge.ai" \
  "https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine_bg.wasm" | \
  grep -i "HTTP\|content-type"

# 4. Check Vercel env var is set
echo "NEXT_PUBLIC_ENGINE_CDN_URL must be set to https://engine.spawnforge.ai in Vercel (Production + Preview)"
```

## CI Automation

The script `scripts/upload-wasm-to-r2.sh` handles CI uploads. It requires these GitHub Secrets:
- `R2_ACCOUNT_ID` — Cloudflare account ID (`0b949ff499d179e24dde841f71d6134f`)
- `R2_ACCESS_KEY_ID` — R2 API token access key
- `R2_SECRET_ACCESS_KEY` — R2 API token secret key

And this GitHub Actions variable:
- `R2_CDN_ENABLED=true` — gates the upload job

The CI script uploads to both root path (latest) and versioned path (`v/<git-sha>/`) for rollback.

## Worker Configuration

The `engine-cdn` Worker is deployed at `engine.spawnforge.ai/*` (zone: `spawnforge.ai`).

Source: `/tmp/engine-worker/worker.js` (deployed via `wrangler deploy`)

It adds these headers to all R2 responses:
- `Access-Control-Allow-Origin` — matches against allowed origins list
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Cache-Control: public, max-age=31536000, immutable`

Allowed origins: `spawnforge.ai`, `www.spawnforge.ai`, `localhost:3000`, `localhost:3001`

To update the Worker, create a `wrangler.toml` with:
```toml
name = "engine-cdn"
main = "worker.js"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "ENGINE_BUCKET"
bucket_name = "spawnforge-engine"

[[routes]]
pattern = "engine.spawnforge.ai/*"
zone_name = "spawnforge.ai"
```

Then: `wrangler deploy`

## Assets CDN (spawnforge-assets)

The `spawnforge-assets` bucket does NOT need a CORS Worker. It's accessed server-side via the S3 API with signed URLs (see `web/src/lib/storage/r2.ts`). Browser never fetches from it directly.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Failed to fetch dynamically imported module` | Files not in R2 or CORS blocked | Run this skill to upload + verify CORS |
| CORS error in browser but curl works | Cloudflare edge cache serving stale pre-CORS response | Re-upload files to bust cache |
| Engine loads locally but not in production | `NEXT_PUBLIC_ENGINE_CDN_URL` not set or not rebuilt after setting | Set in Vercel, trigger new deployment |
| 404 on engine files | Files never uploaded to R2 | Run upload steps above |
| Worker not serving CORS | Worker not deployed or route misconfigured | Re-deploy Worker with `wrangler deploy` |
