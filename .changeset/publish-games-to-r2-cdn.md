---
"web": minor
---

Published games are now mirrored to Cloudflare R2 object storage on publish and served from that CDN-backed bundle on the player page. When `PUBLISH_TO_R2` is enabled (it defaults on wherever an `ASSET_BUCKET_NAME` is configured), publishing writes the game's scene data to `games/{userId}/{slug}/bundle.json` and records the object key on the game row; the `/play` route then reads that bundle first for faster, globally-cached loads. The write and the read are both fail-open — any R2 outage or missing object logs to Sentry and transparently falls back to the existing Postgres-served scene data, so publishing and playing keep working with object storage entirely absent.
