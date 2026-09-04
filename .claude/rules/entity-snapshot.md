---
description: EntityType, EntitySnapshot construction, history stack, selection events
paths:
  - "engine/**"
  - "**/*.rs"
---

# Entity & Snapshot Patterns

## EntityType
- Must derive `Component` and be inserted on EVERY entity
- Export/snapshot queries use `Option<&EntityType>` — never guess from mesh/light components
- When adding new variants (e.g. `GltfModel`), ALL match statements must be updated — especially `apply_spawn_requests` in `entity_factory.rs`. Non-spawnable types need `continue;` arms

## EntitySnapshot Construction
- **Use `EntitySnapshot::new(entity_id, entity_type, name, transform)`** — defaults all ~35 optional fields to None/false, visible=true
- For ECS reads: `let mut snap = EntitySnapshot::new(...); snap.material_data = mat_data.cloned(); ...`
- For new entities: `let mut snap = EntitySnapshot::new(...); snap.procedural_mesh_data = Some(data); snap`
- When adding a new `Option<T>` field: add to `EntitySnapshot` struct + update `new()` constructor (1 site) + add the field to `AuxComponentData` (or `BaseComponentData`) in `core/component_carry.rs` **and** read it back in `spawn_from_snapshot` — there are FOUR rebuild paths and only three of them share `insert_aux_components`; `spawn_from_snapshot` (undo/redo, prefab instantiation) reads the snapshot directly, so a field wired into one side only survives undo but vanishes on duplicate/array/combine, or the reverse, with no error anywhere. Two gates fail the build if either half is forgotten: `mod component_carry_parity` in `core/component_carry_tests.rs` (which also diffs the carry list against every `EntitySnapshot` field) and `mod snapshot_restore_parity` in `core/entity_factory_parity_tests.rs`. They REPLACE the older `mod aux_component_parity`; see `rules/gotchas-engine.md` → Engine & Game Loop
- In bridge modules, `EntitySnapshot` is imported as `HistEntitySnapshot` — same type, both have `new()`

## spawn_from_snapshot
- Match returns `Entity` via `.id()` — capture with `let entity = match ...`, not `match ... ;`
- Uses fixed mesh sizes (e.g. Plane 2x2). Use Transform scale to encode size differences

## Undeletable Entities
- Camera has `EntityId` + `Undeletable`
- Bulk-despawn queries MUST include `Without<Undeletable>` or camera gets destroyed
- Scene export should also exclude `Undeletable`

## SelectionChangedEvent
- Struct fields: `SelectionChangedEvent { selected_ids, primary_id, primary_name }` — NOT a unit struct. New systems must construct it properly

## History System
- `UndoableAction` enum (30 variants): TransformChange, MultiTransformChange, Rename, Spawn, Delete, Duplicate, VisibilityChange, MaterialChange, LightChange, PhysicsChange, ScriptChange, AudioChange, ReverbZoneChange, ParticleChange, ShaderChange, CsgOperation, TerrainChange, ExtrudeShape, LatheShape, ArrayEntity, CombineMeshes, JointChange, GameComponentChange, AnimationClipChange, SpriteChange, Physics2dChange, Physics2dToggle, Joint2dChange, TilemapChange, SkeletonChange
- Entity IDs preserved on undo/redo for reference stability
- `GizmoInteractionState` tracks drag start/end for transform history

## Every history arm owes the browser a re-report (#9290, #9291)

An undo/redo arm writes the ECS directly, so nothing in `bridge/` notices. The
per-component emitters (`emit_material_on_selection` and its fourteen siblings)
are gated on `selection.primary` **and** `Changed<T>`, so undoing an edit to a
NON-selected entity leaves the Zustand mirror holding state the engine has
already dropped — and the next inspector edit sends a full-replace command built
from that stale value.

`core/` cannot emit (bridge isolation), so the arms queue instead:

- **Every `UndoableAction` arm in both `execute_undo` and `execute_redo`** pushes
  a `ComponentResync` through `queue_resync(...)` — `core/component_resync.rs`
  for the enum, `core/entity_factory.rs` for the helper. Two arms
  (`ReverbZoneChange`, `SkeletonChange`) use their own older resync queues
  instead; both are equally valid, neither is optional.
- **`spawn_from_snapshot`** pushes everything `resyncs_for_snapshot` finds in the
  snapshot, plus the two own-queue pushes — unless the caller passes
  `ResyncReport::Silent`. That flag is ONLY for a bulk caller that restores many
  entities at once and already tells the browser wholesale (the scene loader,
  which emits `SCENE_LOADED`). Each resync is one synchronous JS callback whose
  handler spreads a whole Zustand map, so per-entity reporting on a bulk path is
  O(N^2) main-thread work. Choosing `Silent` on a single-entity path reinstates
  the desync above.
- `bridge/component_resync.rs` drains the queue, bounded by
  `MAX_RESYNC_DRAIN_PER_FRAME`, and turns each resync into the event the browser
  already handles. Any handler it reaches that writes a `primary*` store field
  must go through `applyWhenPrimary(entityId, ...)`, which means the event
  payload has to carry an `entity_id`.

An arm that owes nothing must say why in `EXEMPT_ARMS`
(`core/component_resync_tests.rs`) — there are only two valid reasons today: an
ungated `Changed<T>` system already reports the write (Rename,
VisibilityChange, TerrainChange), or the whole entity despawns/respawns. That
gate iterates the arms parsed out of the source, so a new arm fails the build
until it is queued or exempted.

## Merging Queries
- When a new query pushes a system to 17 params, merge related queries (e.g. combine `csg_export_query` + `procedural_mesh_export_query` into one `Query<(&EntityId, Option<&CsgMeshData>, Option<&ProceduralMeshData>)>`)
