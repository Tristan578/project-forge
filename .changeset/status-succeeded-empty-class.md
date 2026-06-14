---
"web": patch
---

Fix the "succeeded-with-no-artifact" hang across the remaining six AI generation status routes (sprite-sheet, tileset-gen, model, skybox, texture, music). When a provider reported success but produced no downloadable artifact, the route returned `status: 'completed'` with an empty result field. The client poller then threw an uncaught "No result URL"/"No texture maps", stuck the job in `downloading` for the full 5-minute poll cap, and only refunded with a generic timeout. These routes now report `failed` when the completion field is absent, so the poller refunds immediately with a meaningful error. Result/maps fields are also gated on completion so a partial artifact can't leak while a job is still processing. (Boy Scout: added the missing `captureException` Sentry hook to the tileset-gen route's 500 handler.)
