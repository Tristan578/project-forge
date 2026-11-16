---
"web": patch
---

When a scene can't be opened but the current scene stays open, the message now says why instead of showing a generic error. This covers switching scenes in the Scene Browser, restoring an auto-save backup, importing a scene file, and the AI assistant opening or switching a scene. The message names one of: the engine's own reason (the same plain-words text the save-lockout notice gives, capped at 512 characters), that the engine gave no reason, that the scene's prefab data is invalid, or that the engine isn't ready yet. Each message also says what was kept: the current scene is unchanged, and a refused auto-save restore keeps the backup. These error toasts now stay up until dismissed, because the engine's reason can be long.
