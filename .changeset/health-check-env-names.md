---
"web": patch
---

Fix two permanent false outages on the public status page. The health check
probed environment variables that nothing in the tree reads and no environment
sets: `CLOUDFLARE_ACCOUNT_ID` / `R2_*` for asset storage (the real R2 consumer
reads the `ASSET_*` namespace) and `MESHY_API_KEY` / `ELEVENLABS_API_KEY` /
`SUNO_API_KEY` for AI providers (the real names are `PLATFORM_*`). The chat
reachability probe also hard-coded `api.anthropic.com` while production routes
chat through the Vercel AI Gateway.

Every namespace a health check reads now comes from a shared constants module,
so the check and its consumer can no longer drift apart.
