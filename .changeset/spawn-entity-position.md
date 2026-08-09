---
"web": patch
---

Chat `spawn_entity` now honors the documented `position` parameter. Asking the AI to spawn an entity at specific world coordinates previously reported success while placing it at the origin — the manifest documented `position` and the engine honored it, but the chat handler parsed only `entityType` and `name`. A malformed position (wrong arity, non-finite element) is now rejected with a clear error instead of being silently dropped, and the AI-facing tool schema no longer advertises the internal `id` override.
