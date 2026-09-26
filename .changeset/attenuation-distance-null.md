---
"web": patch
---

Fixed a bug where a scene with an untouched (default) material failed to load. `attenuation_distance` defaults to `f32::INFINITY`, which serialized as JSON `null` with no way back; saving a scene now writes an explicit `"Infinity"`/`"-Infinity"`/`"NaN"` sentinel for non-finite values, and loading still accepts `null` from scenes saved before this fix. Scoped to scene persistence only, so live editor updates (material inspector, entity queries) are unaffected.
