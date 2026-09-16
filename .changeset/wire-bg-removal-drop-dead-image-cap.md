---
"web": patch
---

Background removal now runs as part of sprite generation. When a sprite is
generated on the DALL-E path with background removal requested, `/api/generate/sprite`
resolves the remove.bg key (a user's own key first, else the platform key) and
posts the finished image to remove.bg, returning a transparent sprite. The key is
resolved without an extra token charge, and a sprite still generates normally when
no remove.bg key is configured or its lookup fails, with an explicit warning that
the background remains. SDXL reports that removal is unsupported. Configured
remove.bg request failures fail the job and refund the generation charge. This also fixes a latent bug that would have thrown the
first time the path ran on the server (it used a browser-only API to encode the
result).
