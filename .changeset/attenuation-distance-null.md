---
"web": patch
---

Fixed a bug where a scene with an untouched (default) material failed to load. A material's `attenuationDistance` defaults to infinity, which JSON stores as `null`, and the loader rejected its own output (`invalid type: null, expected f32`). The engine now reads that `null` back as infinity at the field level, so every previously saved scene loads and nothing about the saved scene format changes — `null` stays the encoding of the default, keys and number formatting are untouched, and live editor updates (material inspector, entity queries) keep their `number | null` contract. A negative or non-finite `attenuationDistance` in a scene file is rejected with a clear error, the same rule already applied to transforms.
