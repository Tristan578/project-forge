---
"web": patch
---

Persist a scene's contents when switching away from it. `saveCurrentSceneData` had no production caller, so every scene's stored data stayed empty — switching scenes discarded the outgoing scene's work and loaded a blank viewport back. Switching and duplicating now read the live scene out of the engine first, and refuse to proceed if a live scene exists but cannot be read.
