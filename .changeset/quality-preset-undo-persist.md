---
"web": patch
---

Changing the rendering quality preset in Scene Settings (or via the in-app AI `set_quality_preset` command) is now undoable and is saved with the scene. Undo restores the previous profile and redo reapplies it, and a scene's quality profile round-trips through save and reload without altering any other scene data. Scenes saved before this change load with the default High profile.
