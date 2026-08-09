---
"web": patch
---

Surface engine command rejections. `dispatchCommand` now returns the engine's `CommandResponse` instead of discarding it, and the store's tracked wrapper logs and reports any rejection — making a whole class of silent no-ops diagnosable across every editor panel, chat handler, and pipeline executor.
