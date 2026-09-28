---
"web": patch
---

Fixed a bug where a scene with an untouched (default) material failed to load. A material's `attenuationDistance` defaults to infinity, which JSON stores as `null`, and the loader rejected its own output (`invalid type: null, expected f32`). The engine now reads that `null` back as infinity at the field level, so every previously saved scene loads and nothing about the saved scene format changes — `null` stays the encoding of the default, keys and number formatting are untouched, and live editor updates (material inspector, entity queries) keep their `number | null` contract.

A negative or non-finite `attenuationDistance` is now refused at both boundaries with the same rule: `update_material` rejects it live (before it can be persisted and exported into a scene that would never reopen), and a scene file carrying one is refused on load. When the engine refuses a scene, its own reason — naming the field — is now shown in the save-lockout notice and returned by the AI `validate_scene` tool, instead of a generic "the engine refused to load it" sentence.
