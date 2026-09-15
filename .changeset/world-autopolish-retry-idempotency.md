---
"web": patch
---

Make `world_build` and `auto_polish` retries idempotent against the spawn/transform confirmation added in #9899. Both steps get `maxRetries: 1`, and `pipelineRunner` reruns them from scratch on a retryable `EFFECT_TIMED_OUT` with the same static `step.input` — but the engine does not reject a caller-supplied entity id already in use. `worldBuildExecutor` now skips re-dispatching `spawn_entity` for any entity already observable via `ctx.observeEntity` (mirroring `entitySetupExecutor`'s guard), so a retry after one entity's scale confirmation times out no longer duplicates every entity the prior attempt already spawned. `autoPolishExecutor` now uses a deterministic ground-plane id plus the same guard instead of minting a fresh `crypto.randomUUID()` inside `execute()`, so a retry addresses the same ground plane rather than spawning a second, orphaned one.
