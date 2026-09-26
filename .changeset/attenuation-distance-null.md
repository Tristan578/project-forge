---
---

Fixed a bug where a scene with an untouched (default) material failed to load. `attenuation_distance` defaults to `f32::INFINITY`, which serialized as JSON `null` with no way back; the loader now writes an explicit `"Infinity"`/`"-Infinity"`/`"NaN"` sentinel for non-finite values and still accepts `null` from scenes saved before this fix.
