---
"spawnforge-web": patch
---

Fix the JS↔engine game-component wire contract so AI-authored gameplay actually reaches the engine.

The store models a game component as a tagged union (`{ type: 'characterController', characterController: {...} }`) but `handle_add_game_component` requires a flat `{ entityId, componentType: 'character_controller', properties }`, and the engine deserializes each properties bag with strict serde. Ten dispatch sites were sending a shape the engine rejected, and because `dispatchCommand` returns `void` every rejection was silent — the AI reported success on gameplay that was never added.

- New `lib/engine/gameComponentWire.ts` owns the store↔engine name mapping, the per-type property projection, and a `buildStoreComponent` that fills a complete, deserializable default bag for all 13 component types.
- `gameSlice` add/update/remove now dispatch the flat snake_case shape, which also revives the Remove button in the game-component inspector.
- `characterSetupExecutor` sends all four `character_controller` fields (a missing `canDoubleJump` dropped the whole component) and uses `create_skeleton2d` for 2D.
- The four `autoIteration` fix generators no longer emit the non-existent `game_component` type.
- `gameplayHandlers` derives its valid-type list from the catalog, adding the previously missing `dialogue_trigger`.
- `autoRigging` emits `create_skeleton2d` with a correctly nested `SkeletonData2d` and a string `targetEntityId`, so applying a rig works.
