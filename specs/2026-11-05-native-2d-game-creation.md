# Spec: Game creation builds a 2D game out of 2D entities and 2D physics

> **Status:** DRAFT, for approval. Requested by Tristan on 2026-11-05 ("we need to support both 2D and 3D creation out of the box").
> **Date:** 2026-11-05
> **Ticket:** #10464 (follows Tristan's decision on #10368)
> **Scope:** The `projectType: '2d'` path of `web/src/lib/game-creation/` and the engine commands it needs. The 3D path does not change.

## Problem

When the GDD says `projectType: '2d'`, the pipeline puts the engine in 2D mode and then builds the scene out of 3D meshes with 3D physics.

What is right today:

- The orchestrator dispatches `set_project_type` with the GDD's type before the first step (`web/src/stores/slices/orchestratorSlice.ts:742`), so the engine's `ProjectType` is `TwoD` for the run.
- The first scene states the type (`sceneCreateExecutor.ts:118`, `createScene(project, name, ctx.projectType)`), the engine writes `metadata.projectType` on every export (`engine/src/core/scene_file.rs:159`), and `POST /api/publish` snapshots the saved `project.sceneData` (`web/src/app/api/publish/route.ts:253`, `:278`). So a 2D game created and saved today is stored, and published, as `2d`. `/play` switches to 2D for it.

What is wrong:

1. **Blueprint entities are `plane` meshes.** `resolveEntityShape` returns `'plane'` for every 2D role (`web/src/lib/game-creation/entityShape.ts:75`, used at `planBuilder.ts:305`). The engine spawns a plane as `Mesh3d(Plane3d::default()...)` (`engine/src/core/entity_factory.rs:854`). `Plane3d::default()` lies in the XZ plane with its normal on +Y. A 2D scene is viewed down -Z, so the plane is edge-on to the camera.
2. **Nothing a 2D camera draws is spawned.** In 2D mode the engine deactivates the 3D editor camera and spawns a `Camera2d` (`engine/src/bridge/sprite.rs:379`, `:391`). In Bevy a `Camera2d` runs the 2D render graph, which draws sprites and `Mesh2d`, and `Mesh3d` + `StandardMaterial` entities are queued only for 3D views. The pipeline spawns only `Mesh3d` entities: planes for the cast, cubes for world geometry (`worldGeometry.ts:171`, `:431`). **Not verified at runtime here** (no WASM build in this session). It needs a live-engine readback (see the acceptance criteria).
3. **All physics is 3D.** `physics_enable` sends `toggle_physics` + `update_physics` (`executors/physicsEnableExecutor.ts:142`, `:168`). The auto-polish ground repair does the same (`executors/autoPolishExecutor.ts:246`, `:306`). The feel pass sends `update_physics` through `applyPhysicsProfile` (`web/src/lib/ai/physicsFeel.ts:570`). The engine steps both simulations whatever the project type, and `system_track_collisions` reads both event streams (`engine/src/core/game_components.rs`, #10194), so contacts may still fire. But the 2D inspector (`Physics2dInspector`) shows none of these bodies, the store's 2D physics state stays empty, and the game is not a 2D game a creator can edit as one.
4. **A 2D player has no real movement model.** The kinematic controller is attached only outside 2D (`engine/src/core/character_controller.rs:480`), so a 2D player takes the legacy direct-translation path, where a jump is a one-frame nudge. That is #10378, which this spec depends on but does not fix.
5. **Published pre-#10358 copies of these games carry no 2D marker.** That is why #10454's `/play` heuristic cannot rescue them and the #10368 backfill reads the source project's type instead.

## Design

### Entities

- In 2D, the cast and the world geometry are **sprites**: entities carrying `SpriteData`, which `sync_sprite_rendering` turns into a Bevy `Sprite` (`engine/src/bridge/sprite.rs`). Sprites are what the 2D camera draws.
- `spawn_sprite` does not accept a caller-supplied `id` today (`engine/src/core/commands/sprites.rs:31-62`). The pipeline binds every later step to the planned id (`engineDispatch.ts` `engineEntityId`), so the engine change is one of these:
  - (a) `spawn_sprite` honours `id` exactly as `spawn_entity` does (`is_valid_override_id`), or
  - (b) the pipeline keeps `spawn_entity` for the id and converts the entity with `set_sprite_data`, provided that removes the `Mesh3d`.
  Option (a) is preferred, because (b) leaves an entity that is a mesh and a sprite at once.
- Sprite size has to agree with the world units the colliders and `worldGeometry.ts` use. Today `DEFAULT_SPRITE_SIZE` applies when there is no texture and no `customSize`, so the pipeline sets `customSize` from the descriptor's width and height. `sync_sprite_rendering` also rewrites `translation.z` from the sorting layer, which is harmless in 2D.
- `entityShape.ts` gains a 2D resolver that returns a sprite descriptor (size, tint from the role) instead of a mesh shape. `resolveEntityShape` keeps the 3D path unchanged.

### Physics

- In 2D, `physics_enable` sends `toggle_physics2d { entityId, enabled: true }` then `update_physics2d` built by `buildUpdatePhysics2dPayload` (`web/src/lib/physics/physics2dPayload.ts`). The engine chains `apply_physics2d_toggles` → `apply_physics2d_updates` with a deferred flush between them (`engine/src/bridge/mod.rs:585-588`), so one frame after the spawn is enough. Keep the existing wait against the spawn.
- `physicsRoles.ts` keeps one table. A 2D mapping is derived from it: `dynamic` → `dynamic`, `fixed` → `static`, `cuboid` → `box`, `ball` → `circle`, `capsule` → `capsule` if `Physics2dData` has it, otherwise `box`. `isSensor` and `lockRotation` carry over. Colliders stay the unit shape, `size: [1, 1]`, with the transform scale giving the extent (see `e2e/fixtures/reference-games/platformer-2d.ts`, COORDINATES).
- `autoPolishExecutor`'s ground repair and `applyPhysicsProfile` branch on the project type the same way. `applyPhysicsProfile` is shared with `PhysicsFeelPanel`, so it takes the project type as a parameter rather than reading a store.
- No 3D physics command is sent for any entity in a 2D run.

### Out of scope

- The 2D jump and grounded state (#10378). Until it lands, a generated 2D platformer can be walked but not jumped, the same limitation the 2D reference game documents.
- Texture generation for the sprites. Untextured tinted sprites are acceptable for the first cut.

## Acceptance criteria

- [ ] A unit test over `buildPlan` + the executors, with `projectType: '2d'`, records every dispatched command and asserts: no `spawn_entity` with a mesh type for the cast or the world, a sprite for each, and no `toggle_physics` / `update_physics` for any entity, while the same plan in 3D is unchanged. This test fails on today's code (it sends `spawn_entity { entityType: 'plane' }` and `toggle_physics`).
- [ ] Every 2D body gets `toggle_physics2d` before its `update_physics2d`, after the frame that flushed its spawn, and the update's body type, collider and sensor flag match the role table.
- [ ] The ground repair and the feel pass send only 2D physics commands in a 2D run.
- [ ] Engine: `spawn_sprite` honours a valid caller `id` (native Rust test), or the chosen conversion removes the `Mesh3d` (native Rust test).
- [ ] Live engine (`@engine` Playwright): a generated 2D plan built through the real engine renders non-background pixels in the canvas under the 2D camera, the 2D inspector shows each body's physics, and the coin and the goal register contacts. This is the check that proves criterion 2 of the Problem section, which no unit test can see.
- [ ] Publish and reopen: the saved scene states `2d`, `/play` renders the same game.

## Evidence still to collect

- Whether `Mesh3d` entities render under the managed `Camera2d` (Problem 2). Measure with the canvas readback the `viewport` skill describes before choosing between this spec and a cheaper fix that keeps meshes.
