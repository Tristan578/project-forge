---
"web": minor
---

Confirm spawned entities and transforms by querying the real engine before a game-creation step reports success. Spawn and transform operations now return a typed applied/rejected/timed-out/cancelled result correlated by operation id and entity, produced by a bounded observation adapter that polls the engine's own state (via `get_entity_details`) with a 5-second deadline and a cancellation token instead of trusting that the command was accepted plus a two-frame wait. Manual creator controls and in-app AI operations share this one confirmation contract, so a deferred effect that never lands is reported as timed-out — never as a completed step.
