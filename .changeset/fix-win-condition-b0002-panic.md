---
"web": patch
---

fix(engine): resolve the B0002 ECS panic that crashed the engine on entering Play mode in any scene containing a win-condition game component.

`system_win_condition` declared both `Option<Res<GameComponentRuntime>>` and `Option<ResMut<GameComponentRuntime>>`, registering a read and a write of the same resource in one system. Bevy treats that as the canonical B0002 access conflict and panics the schedule when the system runs (Edit → Play inserts `GameComponentRuntime` and registers the system under `PlaySystemSet`). Merged the two params into a single `Option<ResMut<GameComponentRuntime>>`, reading and writing through it. Added native ECS regression tests (`win_condition_tests`) that run the system in a `Schedule` to assert no access conflict and that the `game_win` event fires exactly once when the score target is met. Requires a WASM rebuild (handled by CD).
