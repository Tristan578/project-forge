---
'web': patch
---

Fix anti-patterns found during codebase audit: replace `Number() ||` with `Number.isFinite()` guard in save system generator, fix `volume || 1.0` to `volume ?? 1.0` in audio crossfade/fadeIn, correct non-existent `forge.ui` API names in generated scripts, replace invalid `forge.on()` with `onStart` lifecycle.
