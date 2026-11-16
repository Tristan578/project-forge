---
"web": patch
---

When a scene is refused while the current scene stays open and savable, the message now names the cause instead of guessing. This covers restoring an auto-save backup, importing a scene file from the toolbar, and the AI assistant's `load_scene` and `switch_scene` tools. Before, these said something like "its data may be invalid or the engine is not ready", even though the editor knew which. Now they say one of three things: the engine's own reason (the same plain-words text the save-lockout notice shows, capped at 512 characters), that the scene's prefab data is invalid or forms a cycle, or that the engine is not ready yet. A refused scene still leaves the current scene untouched and saving enabled, and a refused auto-save restore still keeps the backup.
