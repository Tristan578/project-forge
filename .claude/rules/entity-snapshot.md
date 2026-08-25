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
- `UndoableAction` enum (29 variants): TransformChange, MultiTransformChange, Rename, Spawn, Delete, Duplicate, VisibilityChange, MaterialChange, LightChange, PhysicsChange, ScriptChange, AudioChange, ReverbZoneChange, ParticleChange, ShaderChange, CsgOperation, TerrainChange, ExtrudeShape, LatheShape, ArrayEntity, CombineMeshes, JointChange, GameComponentChange, AnimationClipChange, SpriteChange, Physics2dChange, Joint2dChange, TilemapChange, SkeletonChange
- Entity IDs preserved on undo/redo for reference stability
- `GizmoInteractionState` tracks drag start/end for transform history

## Merging Queries
- When a new query pushes a system to 17 params, merge related queries (e.g. combine `csg_export_query` + `procedural_mesh_export_query` into one `Query<(&EntityId, Option<&CsgMeshData>, Option<&ProceduralMeshData>)>`)
