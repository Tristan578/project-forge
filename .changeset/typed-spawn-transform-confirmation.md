---
"web": minor
---

Confirm spawned entities by querying the real engine before a game-creation step reports success. The entity-setup spawn path now proves an entity exists by reading the engine's own state (via `get_entity_details` -> `QUERY_ENTITY_DETAILS`) after the deferred command applies — with a 5-second deadline and a cancellation token — instead of trusting that the command was accepted plus a two-frame wait. A spawn that never lands is reported as timed-out, never as a completed step.

The typed observation adapter (`observeEngineEffect`) returns an `applied`/`rejected`/`timed-out`/`cancelled` result correlated by operation id and entity, and its `satisfied` predicate confirms transforms by comparing the observed position/scale against the requested value (`observeTransformEffect` + `observedVec3Matches`, within an f32 round-trip tolerance). That transform confirmation is now wired into the production steps that dispatch `update_transform`: `worldBuildExecutor` proves every piece of world geometry reached its requested scale, and `autoPolishExecutor` proves the repaired ground plane did, before either reports success. A resize the engine never applies is reported as timed-out (never a built world), and a cancel mid-observation as aborted. Contexts without a query capability keep the legacy accept-plus-`waitForEngineFrame` path unchanged.
