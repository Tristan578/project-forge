---
"web": patch
---

Fix pixel-art generation hanging for 5 minutes then erroneously refunding. The async poller (`useGenerationPolling`) polls `/api/generate/pixel-art/status`, but that route did not exist — every poll 404'd, so a Replicate (the default SDXL provider) pixel-art job never resolved, hit the 5-minute poll cap, was marked `failed`, and triggered a refund even though the image had actually been generated. Added the missing status route, mirroring the sprite status route: it resolves the platform Replicate key, polls the prediction, and maps Replicate states to the client polling contract (`succeeded`→`completed` with `resultUrl`, `failed`/`canceled`→`failed`, `processing`→`processing`, else `pending`). A `pixel_art` capability was added to the type-safe `DB_PROVIDER` map so the route resolves its key without a cast.
