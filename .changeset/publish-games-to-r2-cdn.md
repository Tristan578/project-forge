---
"web": patch
---

Publishing now preserves a scene snapshot in Postgres and can mirror that snapshot to private R2 object storage. Play links continue to use the gated `/play/{creator}/{slug}` route, which validates the stored object and falls back to the publication snapshot during storage failures. Concurrent publication attempts cannot overwrite each other's snapshots, and cleanup covers failed writes, replaced snapshots, and account deletion. This foundation does not provide public CDN hosting or deploy a standalone exported game.
