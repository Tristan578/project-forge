---
"web": patch
---

Fixed restoring a checkpoint whose scene metadata carries an explicit `"projectType": null`. A null project type already means "not stated" everywhere a scene file is read, and the engine loaded such a checkpoint correctly, but the restore then compared the null against the concrete "2d" or "3d" the engine always exports and rolled the restore back as "the engine applied different scene data". A null project type now counts as not asserted in that comparison; a "2d" or "3d" in the checkpoint must still match what the engine reports.
