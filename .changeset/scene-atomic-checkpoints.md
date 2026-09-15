---
"web": minor
---

Add recovery checkpoints to the Scene Browser and in-app AI. Checkpoints are stored in this browser for the current project, with at most ten retained per project. Saving validates each scene with the engine before writing; quota failures preserve the previous stored value. A restore waits for the engine to apply and export the requested scene before replacing the active save. If confirmation or storage fails, the editor keeps the previous save, attempts to recover unsaved viewport work, and displays an actionable error. Restore and delete require confirmation.

Existing anonymous checkpoints are not assigned to named projects. Browser autosaves, cross-device recovery, and the broader multi-scene workflow remain separate work tracked in #10052 and #9813.
