---
"web": patch
---

Fix phantom-success spawns in chat/compound/2D handlers (#8748). `spawnEntity` now returns the new entity's id synchronously instead of relying on the async `primaryId` selection round-trip, so AI-driven "spawn then transform/material" commands target the entity that was actually created — including on a fresh scene where `primaryId` was `null`. Non-spawnable types and a not-yet-loaded engine now surface a real failure rather than reporting success against an undefined id.
