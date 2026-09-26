---
"web": patch
---

Bind generation job ids to the caller so a signed-in user can no longer poll another user's job (#10262).

The `/api/generate/<type>/status` routes (model, skybox, sprite, sprite-sheet, texture, tileset-gen, pixel-art) resolve the platform provider key by default for a zero-cost status check, so they never verified that the polled `jobId` belonged to the caller. `createGenerationHandler` now binds a just-issued provider job id to the creating user server-side, before the response is returned, and every status route verifies that binding before resolving a key — refusing a mismatch with 404. `POST /api/jobs` also refuses to create a client-reported job row for a `providerJobId` already bound to a different account.
