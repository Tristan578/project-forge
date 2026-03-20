# Cloudflare R2 Integration Patterns

## Configuration
- Engine CDN bucket: `spawnforge-engine` (NOT `spawnforge-engine-assets`)
- Asset bucket: `spawnforge-assets` (server-side signed URL uploads)
- CDN Worker: `engine-cdn` at `engine.spawnforge.ai/*`
- Worker source: `infra/engine-cdn/worker.js` + `wrangler.toml`
- Account ID: `0b949ff499d179e24dde841f71d6134f`

## Upload Pattern
```bash
wrangler r2 object put <bucket>/<key> --file <path> --remote
```

## Gotchas
1. **R2 CORS rules only apply to S3 API**, NOT custom domain access. The Worker at `engine.spawnforge.ai` must set CORS headers manually in `worker.js`.
2. **Two buckets, two purposes**: `spawnforge-engine` is CDN-public (WASM binaries). `spawnforge-assets` is server-side only (signed URLs for user uploads).
3. **Vercel env var**: `NEXT_PUBLIC_ENGINE_CDN_URL=https://engine.spawnforge.ai` is build-time (set on Production + Preview).
4. **Consider OIDC federation** for CI uploads instead of long-lived API tokens (PF-639).

## Testing
- No direct R2 testing in unit tests -- mock the upload/fetch responses
- CDN availability verified by `/deploy-engine` skill
