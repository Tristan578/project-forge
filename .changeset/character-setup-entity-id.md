---
"web": patch
---

Bind generated character setup to the engine's entity id instead of the designed
name. `character_setup` steps come from the system registry rather than the
entity loop, so they carried no entity at all — the executor then fell back to
the GDD name, which the engine's `EntityId` match never resolves. A generated 3D
player silently received no `CharacterController` and could not move. System
definitions now receive the planned entities, and an unresolvable target fails
loudly instead of dispatching a no-op.
