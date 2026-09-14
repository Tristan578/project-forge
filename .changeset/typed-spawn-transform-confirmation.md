---
"web": minor
---

Confirm spawned entities by querying the real engine before a game-creation step reports success. The entity-setup spawn path now proves an entity exists by reading the engine's own state (via `get_entity_details` -> `QUERY_ENTITY_DETAILS`) after the deferred command applies — with a 5-second deadline and a cancellation token — instead of trusting that the command was accepted plus a two-frame wait. A spawn that never lands is reported as timed-out, never as a completed step.

The typed observation adapter (`observeEngineEffect`) returns an `applied`/`rejected`/`timed-out`/`cancelled` result correlated by operation id and entity, and its `satisfied` predicate already supports transform confirmation (comparing observed position/scale against the requested value). That transform half is unit-tested but is NOT yet wired into a production step: `worldBuildExecutor` and `autoPolishExecutor` still dispatch `update_transform` on the legacy accept-plus-`waitForEngineFrame` path. Connecting those transform dispatches to the adapter is the follow-on slice.
