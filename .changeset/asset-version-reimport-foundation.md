---
"web": minor
---

Prefabs now track a versioned source record. Saving a prefab cuts version 1 (with a stable source-content hash and created/updated timestamps), and editing it bumps the version while preserving its history. A new manual reimport flow lets you preview which prefab instances and fields a re-read of the source asset would change before applying it, then applies the update while preserving each instance's transform, script, and any material overrides. Reimport is transactional at the prefab level: a missing or incompatible source is rejected and the previous playable version is kept with no partial mutation.
