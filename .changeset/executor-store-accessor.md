---
"web": patch
---

Game-creation executors now read the editor store live through a `getStore()` accessor on `ExecutorContext` instead of a snapshot captured before the pipeline starts. `verify_all_scenes` no longer reports `empty_scene` on a populated scene, and `auto_polish` no longer dispatches `set_game_camera` against a despawned entity id. A guard test fails the build if any `lib/game-creation` module value-imports a client-only module, which is what previously broke the production build of `/api/game/decompose`.
