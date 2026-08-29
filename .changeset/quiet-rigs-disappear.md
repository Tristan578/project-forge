---
'web': patch
---

Remove deleted 2D skeleton rigs from the engine, preserve overwritten rigs for undo, and tell the editor when a rig is gone. Deleting a rig — or undoing the creation of one — left the editor still showing a skeleton the engine had already dropped, so the next bone edit was authored against a rig that no longer existed.
