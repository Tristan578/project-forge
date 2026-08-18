---
"web": patch
---

2D physics now reaches the engine, and what the engine does with it comes back.
Every 2D physics edit made from chat or the editor was being dropped before the
simulation saw it — the payload was the wrong shape, two of the three commands
had no engine handler at all, and nothing ever switched the body on. So no
static platform, sensor trigger, one-way platform or conveyor had ever behaved
as authored, while the inspector displayed the value that was asked for.

Setting one property no longer resets the others: changing a body type or
collider shape used to silently reset the thirteen other fields. And the editor
now reflects what the simulation actually holds, rather than only its own
optimistic copy.

2D joints now connect. Every joint the editor has ever created was rejected
before it reached the simulation, so no hinge, slider, rope or spring had ever
held two sprites together — and a joint the engine reported back was dropped
without being read, so the inspector never showed the real one. Both directions
now speak the same vocabulary, and a parameter that belongs to a different joint
type is no longer sent along to be quietly ignored.

Adding 2D physics to an entity now starts it at the engine's own defaults, so
the collider shape reads Box rather than Auto.

Configuring an entity's 2D physics in one go — as chat and the generation
pipeline do — no longer loses the earlier half of the change or leaves two undo
steps behind where one edit was made.
