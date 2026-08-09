---
"web": patch
---

Fix scene management dispatching engine commands that reject by design. Scenes live JS-side in `lib/scenes/sceneManager`, but four call sites dispatched the engine's `switch_scene` / `create_scene` / `delete_scene` / `duplicate_scene` / `save_scene` stubs instead. This hard-failed every entity in the AI game-creation pipeline, made the Scene Browser's add/switch/duplicate/delete controls inert, turned scene creation into a silent no-op, and stopped crash-recovery autosave from ever writing a byte.
