---
"web": patch
---

Match the engine's whole-number coercion for game component fields. `collectible.value`, `spawner.maxCount` and `winCondition.targetScore` are `u32` in the engine, which rounds and clamps them — the editor previously kept the raw value, so a collectible authored as worth 10.4 points showed 10.4 in the inspector while the running game scored something else.
