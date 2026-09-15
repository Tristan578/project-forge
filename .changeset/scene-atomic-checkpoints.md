---
"web": minor
---

Multi-scene project saves are now atomic: a save serializes and validates the whole project before a single write, so an interrupted or invalid save can never replace your last valid project with a partial or corrupt scene. You can also capture named recovery checkpoints of the entire project and restore any of them later — through the Scene Browser's new checkpoint controls or by asking the in-app AI ("save a checkpoint", "restore the checkpoint from before the boss fight"). Both paths persist identical state, and the checkpoint store is bounded so it never fills browser storage or loses your newest checkpoint. Delivers operation scene.FR-3.OP-02 of the multi-scene editing package.
