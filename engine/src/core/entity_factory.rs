//! Entity factory - systems for spawning, deleting, and duplicating entities.

use bevy::prelude::*;
use std::collections::HashMap;

use super::animation_clip::AnimationClipData;
use super::asset_manager::AssetRef;
use super::audio::{AudioData, AudioEnabled};
use super::csg;
use super::entity_id::{EntityId, EntityName, EntityVisible};
use super::game_camera::ActiveGameCamera;
use super::terrain::{self, TerrainEnabled};
use super::tilemap::TilemapEnabled;
// Re-export history types for backward compatibility (bridge/mod.rs accesses these via entity_factory::)
pub use super::history::{EntitySnapshot, HistoryStack, TransformSnapshot, UndoableAction};
use super::lighting::LightData;
use super::material::MaterialData;
use super::particles::{ParticleData, ParticleEnabled};
use super::pending_commands::{EntityType, PendingCommands};
use super::physics::{JointData, PhysicsData, PhysicsEnabled};
use super::scripting::ScriptData;
use super::selection::{Selection, SelectionChangedEvent};
use super::shader_effects::ShaderEffectData;
use super::component_carry::{
    build_aux_index, insert_aux_components, insert_base_components, snapshot_entity,
    AuxComponentData, AuxQueries, BaseComponentData,
};

/// Marker component for entities that cannot be deleted by the user.
#[derive(Component)]
pub struct Undeletable;

/// Counter for generating unique entity names.
#[derive(Default)]
pub struct EntityNameCounter {
    counts: HashMap<EntityType, u32>,
}

impl EntityNameCounter {
    /// Generate the next unique name for an entity type.
    pub fn next_name(&mut self, entity_type: EntityType) -> String {
        let count = self.counts.entry(entity_type).or_insert(0);
        let name = if *count == 0 {
            entity_type.default_name().to_string()
        } else {
            format!("{} ({})", entity_type.default_name(), count)
        };
        *count += 1;
        name
    }
}

/// Whether a caller-supplied id may override the engine-generated `EntityId`.
///
/// The sole production caller passes `crypto.randomUUID()`, so this is
/// defense-in-depth against a future or rogue caller, never the normal path. An
/// id is honored only when it is a plausible identifier: non-empty (the caller
/// already trims it), at most 64 bytes, and free of control characters. This
/// rejects the concrete vectors a stricter-than-`trim` check would otherwise
/// admit — interior NUL bytes (`\0`, not stripped by `str::trim`) and unbounded
/// blobs — while staying decoupled from any single id format. A rejected id
/// falls back to the engine-generated UUID, so the spawn still succeeds.
pub(crate) fn is_valid_override_id(id: &str) -> bool {
    // `len()` is the UTF-8 byte length on purpose: this is a storage/DoS bound on
    // the string we copy into the `EntityId`, so bytes (not grapheme count) is the
    // right unit. Do not swap to `chars().count()`. The control-char check is
    // per-`char`, which is correct for catching interior NUL/format chars.
    !id.is_empty() && id.len() <= 64 && !id.chars().any(|c| c.is_control())
}

/// Maximum characters of a caller-supplied id rendered into a log line.
const LOG_ID_MAX_CHARS: usize = 64;

/// Render a caller-supplied entity id safely for a log message.
///
/// `update_terrain` / `sculpt_terrain` accept an arbitrary `entity_id` string —
/// unlike `spawn_terrain`, they never pass it through
/// [`is_valid_override_id`], because they only ever compare it against existing
/// ids. On the miss path that raw string reached `tracing::warn!` verbatim, so a
/// caller could embed newlines to forge additional log lines (log injection) or
/// megabytes of text to bloat the log stream. Neither is reachable from the
/// editor UI today, which is why this is a hardening measure rather than a live
/// exploit — but the values are caller-controlled and the miss path is trivially
/// reachable by looping on a nonexistent id.
///
/// Control characters become `?` (the whole class, so `\n`, `\r` and NUL are all
/// covered) and the result is truncated to [`LOG_ID_MAX_CHARS`] **characters** —
/// `char` boundaries, not bytes, so a multi-byte id can never be split mid-scalar.
/// A truncated value is marked with a trailing `…` so a bounded id and a clipped
/// one are distinguishable in the log.
pub(crate) fn log_safe_id(id: &str) -> String {
    let mut out: String = id
        .chars()
        .take(LOG_ID_MAX_CHARS)
        .map(|c| if c.is_control() { '?' } else { c })
        .collect();
    if id.chars().nth(LOG_ID_MAX_CHARS).is_some() {
        out.push('…');
    }
    out
}

/// System that processes pending spawn requests.
pub fn apply_spawn_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut name_counter: Local<EntityNameCounter>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.spawn_requests.drain(..) {
        let name = request.name.unwrap_or_else(|| {
            name_counter.next_name(request.entity_type)
        });

        let (entity, entity_id, position) = match request.entity_type {
            EntityType::Cube => spawn_cube_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Sphere => spawn_sphere_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Plane => spawn_plane_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Cylinder => spawn_cylinder_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Cone => spawn_cone_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Torus => spawn_torus_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::Capsule => spawn_capsule_with_id(&mut commands, &mut meshes, &mut materials, &name, request.position),
            EntityType::PointLight => spawn_point_light_with_id(&mut commands, &name, request.position),
            EntityType::DirectionalLight => spawn_directional_light_with_id(&mut commands, &name, request.position),
            EntityType::SpotLight => spawn_spot_light_with_id(&mut commands, &name, request.position),
            EntityType::Sprite => continue,
            EntityType::GltfModel | EntityType::GltfMesh => {
                // GltfModel/GltfMesh are spawned through the asset pipeline, not through spawn requests.
                // Skip these if they somehow end up in the spawn queue.
                continue;
            }
            EntityType::CsgResult => {
                // CsgResult entities are created by the CSG system, not through spawn requests.
                continue;
            }
            EntityType::Terrain => {
                // Terrain entities are created by the terrain system, not through spawn requests.
                continue;
            }
            EntityType::ProceduralMesh => {
                // ProceduralMesh entities are created by extrude/lathe/combine systems, not through spawn requests.
                continue;
            }
        };

        // If the caller supplied a valid id (see `is_valid_override_id`),
        // override the engine-generated EntityId so the JS caller can reference
        // this entity synchronously (before the async SELECTION_CHANGED
        // round-trip). Bevy's `insert` replaces the EntityId the spawn helper
        // already attached; a blank/None/malformed id falls back to that
        // generated UUID, so the spawn still succeeds. `EntityId` is itself a
        // UUID-v4 String newtype, so a client-supplied id has identical
        // uniqueness properties. The `continue` arms above never reach here, so
        // only real spawns are overridden.
        let entity_id = match request.id.as_deref().map(str::trim) {
            Some(id) if is_valid_override_id(id) => {
                commands.entity(entity).insert(EntityId::new(id));
                id.to_string()
            }
            _ => entity_id,
        };

        // Material data for mesh entities, light data for light entities
        let material_data = match request.entity_type {
            EntityType::PointLight | EntityType::DirectionalLight | EntityType::SpotLight => None,
            _ => Some(MaterialData::default()),
        };
        let light_data = match request.entity_type {
            EntityType::PointLight => Some(LightData::point()),
            EntityType::DirectionalLight => Some(LightData::directional()),
            EntityType::SpotLight => Some(LightData::spot()),
            _ => None,
        };

        // Record spawn action in history
        let mut snapshot = EntitySnapshot::new(
            entity_id.clone(),
            request.entity_type,
            name.clone(),
            TransformSnapshot {
                position: [position.x, position.y, position.z],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        );
        snapshot.material_data = material_data;
        snapshot.light_data = light_data;
        history.push(UndoableAction::Spawn { snapshot });

        let _ = entity; // Entity handle available for future use
    }
}

// ---------------------------------------------------------------------------
// Terrain — the consumers for `PendingCommands::terrain_*`
// ---------------------------------------------------------------------------

/// Build the material every terrain entity shares, matching the `EntityType::Terrain`
/// arm of `spawn_from_snapshot` so a spawn/undo/redo round-trip is lossless.
fn terrain_material() -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgb(0.5, 0.5, 0.5),
        ..default()
    }
}

/// Swap `Mesh3d`'s handle for a freshly built mesh and drop the superseded one.
///
/// The superseded handle is deliberately NOT passed to `Assets::remove`.
/// `remove`/`remove_untracked` are REFCOUNT-BLIND — they delete the asset no
/// matter how many live `Handle<Mesh>`es still point at it — and a terrain mesh
/// handle is not exclusively owned: `apply_duplicate_requests` clones the
/// source's `Mesh3d` handle straight onto the duplicate. An explicit remove
/// therefore deleted the duplicate's mesh too and it rendered as nothing.
///
/// Dropping the handle here is sufficient: `init_asset` registers
/// `Assets::<Mesh>::track_assets` in `PreUpdate`, which reclaims an asset once
/// its refcount genuinely reaches zero (see
/// `dropping_the_last_handle_frees_the_asset_without_an_explicit_remove`).
fn swap_terrain_mesh(meshes: &mut Assets<Mesh>, mesh3d: &mut Mesh3d, mesh: Mesh) {
    mesh3d.0 = meshes.add(mesh);
}

/// System that processes pending terrain spawn requests.
///
/// Without this the `spawn_terrain` command queued a request that nothing ever
/// read, so live terrain creation was a no-op.
pub fn apply_terrain_spawn_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut name_counter: Local<EntityNameCounter>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.terrain_spawn_requests.drain(..) {
        let terrain_data = request.terrain_data;
        // `terrain::build_terrain_mesh` divides by `resolution - 1` and sizes its
        // index buffer from `(resolution - 1)^2` in `usize`, so `resolution == 0`
        // underflows into a capacity-overflow panic (which in WASM takes the whole
        // engine down) and `resolution == 1` divides by zero into a NaN mesh. A
        // huge resolution allocates `resolution^2` f32s inside a 32-bit heap.
        // Non-finite noise parameters poison every vertex. The command layer
        // already screens all of this; this refuses a caller that bypasses it.
        if let Some(reason) = terrain::terrain_data_rejection(&terrain_data) {
            tracing::warn!("Rejected terrain spawn: {}", reason);
            continue;
        }

        let name = request
            .name
            .unwrap_or_else(|| name_counter.next_name(EntityType::Terrain));

        // Same override contract as `apply_spawn_requests`: honor a plausible
        // caller id verbatim so JS can address the terrain synchronously, and
        // fall back to the engine-generated UUID for anything else. A malformed
        // id costs the caller its handle, never the spawn.
        let entity_id = match request.id.as_deref().map(str::trim) {
            Some(id) if is_valid_override_id(id) => id.to_string(),
            _ => EntityId::default().0,
        };

        let position = request.position.unwrap_or(Vec3::ZERO);
        let mesh_data = terrain::TerrainMeshData {
            heights: terrain::generate_heightmap(&terrain_data),
            resolution: terrain_data.resolution,
            size: terrain_data.size,
        };
        let mesh = terrain::rebuild_terrain_mesh(&mesh_data);

        let transform = Transform::from_translation(position);

        // Component set is byte-for-byte the `EntityType::Terrain` arm of
        // `spawn_from_snapshot`, so undo/redo of this spawn round-trips.
        commands.spawn((
            EntityType::Terrain,
            EntityId::new(&entity_id),
            EntityName::new(&name),
            EntityVisible(true),
            terrain_data.clone(),
            mesh_data.clone(),
            TerrainEnabled,
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(terrain_material())),
            transform,
            // `Transform` requires `GlobalTransform`, but the required-component
            // default is the IDENTITY, and `TransformPlugin` does not correct it
            // until `PostUpdate`. The terrain drains are `.chain()`ed in
            // `bridge/mod.rs`, so `apply_terrain_sculpts` queries this entity in
            // the same frame it is spawned — and it converts a world-space brush
            // to terrain-local through this affine. Left at the identity, a hill
            // requested right after a spawn lands at the terrain's local
            // coordinate instead of the world one. A freshly-spawned ROOT
            // entity's global pose is just its local pose, so writing it here is
            // exact; `PostUpdate` recomputes the same value, or the parented one
            // once something reparents the terrain.
            GlobalTransform::from(transform),
        ));

        // Undo rebuilds the mesh from the snapshot, so it needs BOTH the noise
        // config and the computed heightmap — a snapshot missing either
        // degrades to the flat fallback plane in `spawn_from_snapshot`.
        let mut snapshot = EntitySnapshot::new(
            entity_id,
            EntityType::Terrain,
            name,
            TransformSnapshot {
                position: [position.x, position.y, position.z],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        );
        snapshot.terrain_data = Some(terrain_data);
        snapshot.terrain_mesh_data = Some(mesh_data);
        history.push(UndoableAction::Spawn { snapshot });
    }
}

/// System that processes pending terrain noise-config updates.
///
/// The request carries a PATCH — only the fields the caller actually sent — which
/// is merged onto the entity's live `TerrainData`. A request carrying a whole
/// `TerrainData` could not distinguish "omitted" from "explicitly the default",
/// so changing one field silently reset the other seven.
pub fn apply_terrain_updates(
    mut pending: ResMut<PendingCommands>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut history: ResMut<HistoryStack>,
    mut terrain_query: Query<(
        &EntityId,
        &mut terrain::TerrainData,
        &mut terrain::TerrainMeshData,
        &mut Mesh3d,
    )>,
) {
    for update in pending.terrain_updates.drain(..) {
        // An id matching nothing is dropped, not retried and not recorded: a
        // history entry that restores nothing would make the user's next undo
        // appear to do nothing at all.
        let Some((_, mut terrain_data, mut mesh_data, mut mesh3d)) = terrain_query
            .iter_mut()
            .find(|(id, _, _, _)| id.0 == update.entity_id)
        else {
            tracing::warn!(
                "Dropped terrain update: no entity with id {}",
                log_safe_id(&update.entity_id),
            );
            continue;
        };

        let old_terrain = terrain_data.clone();
        let merged = update.patch.merge_into(&old_terrain);

        // Validate the MERGED config, not the patch: a patch is only ever
        // partial, so a resolution of 0 can arrive either explicitly or by
        // merging onto a config that already carried one.
        if let Some(reason) = terrain::terrain_data_rejection(&merged) {
            tracing::warn!("Rejected terrain update: {}", reason);
            continue;
        }

        // An update that changes nothing must not cost the user an undo press.
        if merged == old_terrain {
            continue;
        }

        let old_mesh_data = mesh_data.clone();

        let new_mesh_data = terrain::TerrainMeshData {
            heights: terrain::generate_heightmap(&merged),
            resolution: merged.resolution,
            size: merged.size,
        };
        swap_terrain_mesh(
            &mut meshes,
            &mut mesh3d,
            terrain::rebuild_terrain_mesh(&new_mesh_data),
        );

        *terrain_data = merged.clone();
        *mesh_data = new_mesh_data.clone();

        history.push(UndoableAction::TerrainChange {
            entity_id: update.entity_id,
            old_terrain,
            new_terrain: merged,
            old_mesh_data,
            new_mesh_data,
        });
    }
}

/// System that processes pending terrain sculpt strokes.
///
/// A sculpt edits the heightmap in place and leaves the noise config alone, so
/// the recorded `TerrainChange` carries an identical `TerrainData` either side.
///
/// `sculpt.position` is a WORLD-space `[x, z]` — that is what every other
/// position in the command API means, and it is the only thing a caller who
/// picked a point off the viewport can supply. `terrain::sculpt_heightmap`
/// indexes the grid in terrain-LOCAL space, so the world point is converted
/// here. Without that conversion, sculpting a terrain that had ever been moved
/// edited the wrong cells (or silently missed the grid entirely).
///
/// The conversion inverts the full `GlobalTransform` affine, not just the
/// translation, and it must be `GlobalTransform` rather than `Transform` for
/// two reasons:
///
/// - `Transform` is LOCAL. `core::reparent` inserts `ChildOf` without rebasing
///   the child's transform, so once a terrain has a parent its `Transform` is
///   no longer its world pose. `create_level_layout` parents the terrain ground
///   under the level root, which makes that the common case, not the exotic one.
/// - Rotation and scale are real. `bridge/core_systems` applies gizmo rotation
///   and scale to any entity by id with no terrain exclusion, and
///   `build_terrain_mesh`/`sculpt_heightmap` both index a grid laid out in the
///   entity's local frame. Subtracting only the translation puts the brush on
///   the transposed cell for a Y-rotated terrain and at the wrong radius for a
///   scaled one — silently, since `sculpt_heightmap` clamps to the grid.
///
/// The world point is lifted to the terrain origin's height (`translation().y`)
/// because the command carries only `[x, z]`. That is exact for translation,
/// Y-rotation, scale and parenting; a terrain tilted about X or Z would need a
/// real ray/plane intersection, which the 2D command shape cannot express.
///
/// `GlobalTransform` propagates in `PostUpdate`, so a pose written by a
/// `Transform` mutation this frame is only visible on the next one — the same
/// one-frame budget the rest of the editor already runs on. A SPAWN is the
/// exception and is NOT covered by that budget: the terrain drains are
/// `.chain()`ed in `bridge/mod.rs`, so the `ApplyDeferred` between them makes a
/// terrain spawned this frame queryable here in the same frame, and the
/// required-component default `GlobalTransform` is the identity rather than the
/// pose it was spawned with. `apply_terrain_spawn_requests` therefore writes an
/// explicit `GlobalTransform`; do not drop it on the assumption that the
/// required component covers this.
pub fn apply_terrain_sculpts(
    mut pending: ResMut<PendingCommands>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut history: ResMut<HistoryStack>,
    mut terrain_query: Query<(
        &EntityId,
        &terrain::TerrainData,
        &mut terrain::TerrainMeshData,
        &mut Mesh3d,
        &GlobalTransform,
    )>,
) {
    for sculpt in pending.terrain_sculpts.drain(..) {
        // Same drop-don't-record contract as `apply_terrain_updates`.
        let Some((_, terrain_data, mut mesh_data, mut mesh3d, global)) = terrain_query
            .iter_mut()
            .find(|(id, _, _, _, _)| id.0 == sculpt.entity_id)
        else {
            tracing::warn!(
                "Dropped terrain sculpt: no entity with id {}",
                log_safe_id(&sculpt.entity_id),
            );
            continue;
        };

        let old_mesh_data = mesh_data.clone();

        let world_point = Vec3::new(
            sculpt.position[0],
            global.translation().y,
            sculpt.position[1],
        );
        let local_point = global.affine().inverse().transform_point3(world_point);
        let local_position = [local_point.x, local_point.z];

        let mut heights = mesh_data.heights.clone();
        terrain::sculpt_heightmap(
            &mut heights,
            mesh_data.resolution,
            mesh_data.size,
            local_position,
            sculpt.radius,
            sculpt.strength,
        );

        // A brush that fell outside the grid (or was rejected by
        // `sculpt_heightmap`'s own guards) changed nothing. Rebuilding the mesh
        // and pushing history for it would burn an undo slot on a no-op and let
        // a stream of misses evict the user's real edits from the history stack.
        if heights == mesh_data.heights {
            continue;
        }

        let new_mesh_data = terrain::TerrainMeshData {
            heights,
            resolution: mesh_data.resolution,
            size: mesh_data.size,
        };
        swap_terrain_mesh(
            &mut meshes,
            &mut mesh3d,
            terrain::rebuild_terrain_mesh(&new_mesh_data),
        );

        *mesh_data = new_mesh_data.clone();

        history.push(UndoableAction::TerrainChange {
            entity_id: sculpt.entity_id,
            old_terrain: terrain_data.clone(),
            new_terrain: terrain_data.clone(),
            old_mesh_data,
            new_mesh_data,
        });
    }
}

// ---------------------------------------------------------------------------
// Shared component-carry helpers live in core::component_carry (PF-1193) so the
// wasm-only bridge systems (array, combine) drive the same single list.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delete system
// ---------------------------------------------------------------------------

/// System that processes pending delete requests.
/// Uses pre-indexed HashMaps for O(n) batch performance instead of O(n^2) nested loops.
pub fn apply_delete_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, &EntityName, &Transform, &EntityVisible, Option<&EntityType>, Option<&MaterialData>, Option<&LightData>, Option<&PhysicsData>, Option<&PhysicsEnabled>, Option<&AssetRef>), Without<Undeletable>>,
    aux_queries: AuxQueries,
    mut selection: ResMut<Selection>,
    mut selection_events: MessageWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    if pending.delete_requests.is_empty() {
        return;
    }

    // Pre-index: entity ID string -> (Entity, base query data) for O(1) lookup
    let entity_index: HashMap<String, (Entity, &EntityId, &EntityName, &Transform, &EntityVisible, Option<&EntityType>, Option<&MaterialData>, Option<&LightData>, Option<&PhysicsData>, Option<&PhysicsEnabled>, Option<&AssetRef>)> =
        query.iter().map(|row| (row.1 .0.clone(), row)).collect();

    // Pre-index auxiliary component data (single O(n) pass over 7 queries)
    let aux_index = build_aux_index(&aux_queries);

    let empty_aux = AuxComponentData::default();
    let mut deleted_any = false;

    for request in pending.delete_requests.drain(..) {
        for entity_id_to_delete in &request.entity_ids {
            // O(1) lookup instead of O(n) linear scan
            if let Some(&(entity, eid, name, transform, visible, ent_type, mat_data, light_data, phys_data, phys_enabled, asset_ref)) =
                entity_index.get(entity_id_to_delete)
            {
                let entity_type = ent_type.copied().unwrap_or(EntityType::Cube);
                let aux = aux_index.get(&eid.0).unwrap_or(&empty_aux);

                let snapshot = snapshot_entity(
                    &eid.0,
                    entity_type,
                    &name.0,
                    transform,
                    BaseComponentData {
                        visible: visible.0,
                        material_data: mat_data,
                        light_data,
                        physics_data: phys_data,
                        physics_enabled: phys_enabled.is_some(),
                        asset_ref,
                    },
                    aux,
                );
                history.push(UndoableAction::Delete { snapshot });

                commands.entity(entity).despawn();

                // Remove from selection if present
                if selection.entity_ids.contains(entity_id_to_delete) {
                    selection.entities.remove(&entity);
                    selection.entity_ids.remove(entity_id_to_delete);
                    deleted_any = true;
                }
            }
        }
    }

    // Clear primary selection if it was deleted
    if deleted_any {
        if let Some(ref primary_id) = selection.primary_id {
            if !selection.entity_ids.contains(primary_id) {
                // Primary was deleted, pick a new one or clear
                selection.primary = selection.entities.iter().next().copied();
                selection.primary_id = selection.entity_ids.iter().next().cloned();
            }
        }

        // Emit selection changed event
        selection_events.write(SelectionChangedEvent {
            selected_ids: selection.selected_ids(),
            primary_id: selection.primary_id.clone(),
            primary_name: None, // Will be populated by the event system
        });
    }
}

// ---------------------------------------------------------------------------
// Duplicate system
// ---------------------------------------------------------------------------

/// System that processes pending duplicate requests.
/// Uses pre-indexed HashMaps for O(n) batch performance instead of O(n^2) nested loops.
pub fn apply_duplicate_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        &EntityVisible,
        Option<&EntityType>,
        Option<&Mesh3d>,
        Option<&MeshMaterial3d<StandardMaterial>>,
        Option<&PointLight>,
        Option<&DirectionalLight>,
        Option<&SpotLight>,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
    )>,
    asset_ref_query: Query<(&EntityId, Option<&AssetRef>)>,
    aux_queries: AuxQueries,
    mut history: ResMut<HistoryStack>,
) {
    if pending.duplicate_requests.is_empty() {
        return;
    }

    // Pre-index: entity ID string -> query row for O(1) lookup
    let entity_index: HashMap<
        String,
        (
            Entity, &EntityId, &EntityName, &Transform, &EntityVisible,
            Option<&EntityType>, Option<&Mesh3d>, Option<&MeshMaterial3d<StandardMaterial>>,
            Option<&PointLight>, Option<&DirectionalLight>, Option<&SpotLight>,
            Option<&MaterialData>, Option<&LightData>, Option<&PhysicsData>,
            Option<&PhysicsEnabled>,
        ),
    > = query.iter().map(|row| (row.1 .0.clone(), row)).collect();

    // Pre-index: entity ID string -> AssetRef for O(1) lookup
    let asset_ref_index: HashMap<String, Option<AssetRef>> = asset_ref_query
        .iter()
        .map(|(eid, ar)| (eid.0.clone(), ar.cloned()))
        .collect();

    // Pre-index auxiliary component data (single O(n) pass over 7 queries)
    let aux_index = build_aux_index(&aux_queries);

    let empty_aux = AuxComponentData::default();

    for request in pending.duplicate_requests.drain(..) {
        // O(1) lookup instead of O(n) linear scan
        if let Some(&(
            // `_visible`: a duplicate is always spawned visible (see the
            // BaseComponentData below), so the source's state is deliberately
            // not read. The query still requires the component so that the set
            // of duplicable entities is unchanged.
            _entity, source_eid, name, transform, _visible,
            src_entity_type, mesh_handle, material_handle,
            point_light, dir_light, spot_light,
            src_mat_data, src_light_data, src_phys_data, src_phys_enabled,
        )) = entity_index.get(&request.entity_id)
        {
            let src_asset_ref = asset_ref_index.get(&source_eid.0).and_then(|ar| ar.as_ref());
            let aux = aux_index.get(&source_eid.0).unwrap_or(&empty_aux);

            // Clone with offset
            let new_pos = transform.translation + Vec3::new(1.0, 0.0, 0.0);
            let new_name = format!("{} (Copy)", name.0);

            // Create a new EntityId for the duplicate
            let new_entity_id = EntityId::default();
            let new_entity_id_str = new_entity_id.0.clone();

            // Use EntityType component if available, else guess from light components
            let entity_type = src_entity_type.copied().unwrap_or_else(|| {
                if point_light.is_some() {
                    EntityType::PointLight
                } else if dir_light.is_some() {
                    EntityType::DirectionalLight
                } else if spot_light.is_some() {
                    EntityType::SpotLight
                } else {
                    EntityType::Cube
                }
            });

            // Spawn duplicate with base components
            let mut entity_commands = commands.spawn((
                entity_type,
                new_entity_id,
                EntityName::new(&new_name),
                EntityVisible::default(),
                Transform {
                    translation: new_pos,
                    rotation: transform.rotation,
                    scale: transform.scale,
                },
            ));

            // Clone mesh and material if present (for mesh entities)
            if let Some(mesh_h) = mesh_handle {
                entity_commands.insert(mesh_h.clone());
            }
            if let Some(mat_h) = material_handle {
                entity_commands.insert(mat_h.clone());
            }

            // Clone light components if present
            if let Some(pl) = point_light {
                entity_commands.insert(pl.clone());
            }
            if let Some(dl) = dir_light {
                entity_commands.insert(dl.clone());
            }
            if let Some(sl) = spot_light {
                entity_commands.insert(sl.clone());
            }

            // Clone material data if present
            if let Some(md) = src_mat_data {
                entity_commands.insert(md.clone());
            }

            // Clone the shared base + auxiliary component set (single list)
            let base = BaseComponentData {
                // Duplicates spawn EntityVisible::default() (= true) regardless of
                // the source's visibility, so a copy of a hidden entity is not
                // itself invisible with no way to find it. `base.visible` is what
                // the snapshot records, and it must match what was spawned or redo
                // would restore a hidden duplicate.
                visible: true,
                material_data: src_mat_data,
                light_data: src_light_data,
                physics_data: src_phys_data,
                physics_enabled: src_phys_enabled.is_some(),
                asset_ref: src_asset_ref,
            };
            insert_base_components(&mut entity_commands, base);
            insert_aux_components(&mut entity_commands, aux);

            // Build snapshot using shared helper
            let mut snapshot =
                snapshot_entity(&source_eid.0, entity_type, &name.0, transform, base, aux);
            // Override snapshot fields for the NEW duplicate entity
            snapshot.entity_id = new_entity_id_str;
            snapshot.entity_type = entity_type;
            snapshot.name = new_name;
            snapshot.transform = TransformSnapshot {
                position: [new_pos.x, new_pos.y, new_pos.z],
                rotation: [
                    transform.rotation.x, transform.rotation.y,
                    transform.rotation.z, transform.rotation.w,
                ],
                scale: [transform.scale.x, transform.scale.y, transform.scale.z],
            };
            // Don't duplicate active game camera state
            snapshot.active_game_camera = false;

            history.push(UndoableAction::Duplicate {
                source_entity_id: source_eid.0.clone(),
                snapshot,
            });
        }
    }
}

// Helper functions for spawning each entity type (return entity, entity_id, position)

fn spawn_cube_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.5, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Cube,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_sphere_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.5, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Sphere,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Sphere::new(0.5).mesh().uv(32, 18))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_plane_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::ZERO);
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Plane,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Plane3d::default().mesh().size(2.0, 2.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_cylinder_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.5, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Cylinder,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Cylinder::new(0.5, 1.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_cone_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.5, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Cone,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Cone::new(0.5, 1.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_torus_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.5, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Torus,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Torus::new(0.15, 0.5))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_capsule_with_id(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 0.75, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();

    let entity = commands.spawn((
        EntityType::Capsule,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        MaterialData::default(),
        Mesh3d(meshes.add(Capsule3d::new(0.25, 1.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            ..default()
        })),
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_point_light_with_id(
    commands: &mut Commands,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 3.0, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();
    let light_data = LightData::point();

    let entity = commands.spawn((
        EntityType::PointLight,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        light_data,
        PointLight {
            intensity: 100_000.0,
            color: Color::WHITE,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_translation(pos),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_directional_light_with_id(
    commands: &mut Commands,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    // A directional light's illumination is rotation-only, but its translation
    // is still what the gizmo, the outliner and the history snapshot address, so
    // a requested position has to land on the Transform like every other type.
    let pos = position.unwrap_or(Vec3::ZERO);
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();
    let light_data = LightData::directional();

    let entity = commands.spawn((
        EntityType::DirectionalLight,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        light_data,
        DirectionalLight {
            illuminance: 10_000.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_translation(pos)
            .with_rotation(Quat::from_euler(EulerRot::XYZ, -0.5, 0.5, 0.0)),
    )).id();

    (entity, entity_id_str, pos)
}

fn spawn_spot_light_with_id(
    commands: &mut Commands,
    name: &str,
    position: Option<Vec3>,
) -> (Entity, String, Vec3) {
    let pos = position.unwrap_or(Vec3::new(0.0, 3.0, 0.0));
    let entity_id = EntityId::default();
    let entity_id_str = entity_id.0.clone();
    let light_data = LightData::spot();

    let entity = commands.spawn((
        EntityType::SpotLight,
        entity_id,
        EntityName::new(name),
        EntityVisible::default(),
        light_data,
        SpotLight {
            intensity: 100_000.0,
            color: Color::WHITE,
            shadows_enabled: false,
            range: 20.0,
            inner_angle: 0.0,
            outer_angle: std::f32::consts::FRAC_PI_4,
            ..default()
        },
        Transform::from_translation(pos)
            .looking_at(Vec3::ZERO, Vec3::Y),
    )).id();

    (entity, entity_id_str, pos)
}

/// Copy an entity's terrain components onto the snapshot the scene exporter is
/// building.
///
/// Both halves are required. `TerrainMeshData` alone reloads a heightmap the
/// user can no longer regenerate or sculpt (the noise config is gone);
/// `TerrainData` alone reloads a terrain whose saved sculpting is lost. With
/// neither, `spawn_from_snapshot` falls through to its flat 2x2 plane arm and
/// the entity comes back with the right name and the right `EntityType::Terrain`
/// — which is exactly why the loss is invisible in the UI.
///
/// This lives in `core/` rather than inline in `bridge/scene_io.rs` because the
/// bridge is `wasm32`-only: a `#[cfg(test)]` module there never compiles under
/// native `cargo test`, so an assignment made only at the bridge call site
/// cannot be covered by any test that actually runs. See
/// `terrain_snapshot_export_tests` below.
pub fn apply_terrain_to_snapshot(
    snapshot: &mut EntitySnapshot,
    terrain_data: Option<&terrain::TerrainData>,
    terrain_mesh_data: Option<&terrain::TerrainMeshData>,
) {
    snapshot.terrain_data = terrain_data.cloned();
    snapshot.terrain_mesh_data = terrain_mesh_data.cloned();
}

/// Spawn an entity from a snapshot (for undo/redo).
pub fn spawn_from_snapshot(
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    snapshot: &EntitySnapshot,
) -> Entity {
    let transform = snapshot.transform.to_transform();
    let entity_id = EntityId(snapshot.entity_id.clone());

    let mat_data = snapshot.material_data.clone().unwrap_or_default();

    let entity = match snapshot.entity_type {
        EntityType::GltfModel | EntityType::GltfMesh => {
            // Imported models can't be fully recreated from snapshot (no mesh data).
            // Spawn as an empty entity with the metadata; the actual mesh would need
            // re-import. This preserves transforms and hierarchy for save/load.
            let mut ec = commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                transform,
            ));
            if let Some(ar) = &snapshot.asset_ref {
                ec.insert(ar.clone());
            }
            ec.id()
        }
        EntityType::Cube => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Sphere => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Sphere::new(0.5).mesh().uv(32, 18))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Plane => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Plane3d::default().mesh().size(2.0, 2.0))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Cylinder => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Cylinder::new(0.5, 1.0))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Cone => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Cone::new(0.5, 1.0))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Torus => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Torus::new(0.15, 0.5))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::Capsule => {
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                mat_data,
                Mesh3d(meshes.add(Capsule3d::new(0.25, 1.0))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.5, 0.5, 0.5),
                    ..default()
                })),
                transform,
            )).id()
        }
        EntityType::CsgResult => {
            // CSG result mesh data is stored in the snapshot
            // Rebuild the mesh from stored vertex/index data
            if let Some(ref mesh_data) = snapshot.csg_mesh_data {
                let mesh = csg::rebuild_mesh_from_data(mesh_data);
                commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    mat_data,
                    Mesh3d(meshes.add(mesh)),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                    mesh_data.clone(),  // CsgMeshData component
                )).id()
            } else {
                // Fallback: spawn as a cube if mesh data is missing
                commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    mat_data,
                    Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                )).id()
            }
        }
        EntityType::Terrain => {
            // Terrain mesh data is stored in the snapshot
            // Rebuild the mesh from stored heightmap data
            if let Some(ref mesh_data) = snapshot.terrain_mesh_data {
                let terrain_data = snapshot.terrain_data.clone().unwrap_or_default();
                let mesh = terrain::rebuild_terrain_mesh(mesh_data);
                let mut entity_commands = commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    terrain_data,
                    mesh_data.clone(),  // TerrainMeshData component
                    TerrainEnabled,
                    Mesh3d(meshes.add(mesh)),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                ));
                // Apply material data if present
                if let Some(mat) = &snapshot.material_data {
                    entity_commands.insert(mat.clone());
                }
                entity_commands.id()
            } else {
                // Fallback: spawn as a plane if mesh data is missing
                commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    mat_data,
                    Mesh3d(meshes.add(Plane3d::new(Vec3::Y, Vec2::splat(1.0)))),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                )).id()
            }
        }
        EntityType::ProceduralMesh => {
            // Procedural mesh data is stored in the snapshot
            // Rebuild the mesh from stored data
            if let Some(ref mesh_data) = snapshot.procedural_mesh_data {
                let mesh = super::procedural_mesh::rebuild_procedural_mesh(mesh_data);
                commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    mat_data,
                    Mesh3d(meshes.add(mesh)),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                    mesh_data.clone(),  // ProceduralMeshData component
                )).id()
            } else {
                // Fallback: spawn as a cube if mesh data is missing
                commands.spawn((
                    snapshot.entity_type,
                    entity_id,
                    EntityName::new(&snapshot.name),
                    EntityVisible(snapshot.visible),
                    mat_data,
                    Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: Color::srgb(0.5, 0.5, 0.5),
                        ..default()
                    })),
                    transform,
                )).id()
            }
        }
        EntityType::PointLight => {
            let ld = snapshot.light_data.clone().unwrap_or_else(LightData::point);
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                ld.clone(),
                PointLight {
                    intensity: ld.intensity,
                    color: Color::linear_rgb(ld.color[0], ld.color[1], ld.color[2]),
                    shadows_enabled: ld.shadows_enabled,
                    shadow_depth_bias: ld.shadow_depth_bias,
                    shadow_normal_bias: ld.shadow_normal_bias,
                    range: ld.range,
                    radius: ld.radius,
                    ..default()
                },
                transform,
            )).id()
        }
        EntityType::DirectionalLight => {
            let ld = snapshot.light_data.clone().unwrap_or_else(LightData::directional);
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                ld.clone(),
                DirectionalLight {
                    illuminance: ld.intensity,
                    color: Color::linear_rgb(ld.color[0], ld.color[1], ld.color[2]),
                    shadows_enabled: ld.shadows_enabled,
                    shadow_depth_bias: ld.shadow_depth_bias,
                    shadow_normal_bias: ld.shadow_normal_bias,
                    ..default()
                },
                transform,
            )).id()
        }
        EntityType::SpotLight => {
            let ld = snapshot.light_data.clone().unwrap_or_else(LightData::spot);
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                ld.clone(),
                SpotLight {
                    intensity: ld.intensity,
                    color: Color::linear_rgb(ld.color[0], ld.color[1], ld.color[2]),
                    shadows_enabled: ld.shadows_enabled,
                    shadow_depth_bias: ld.shadow_depth_bias,
                    shadow_normal_bias: ld.shadow_normal_bias,
                    range: ld.range,
                    radius: ld.radius,
                    inner_angle: ld.inner_angle,
                    outer_angle: ld.outer_angle,
                    ..default()
                },
                transform,
            )).id()
        }
        EntityType::Sprite => {
            // Sprite entities spawn with just metadata - actual rendering handled by sprite system
            let sprite_data = snapshot.sprite_data.clone().unwrap_or_default();
            commands.spawn((
                snapshot.entity_type,
                entity_id,
                EntityName::new(&snapshot.name),
                EntityVisible(snapshot.visible),
                sprite_data,
                super::sprite::SpriteEnabled,
                transform,
            )).id()
        }
    };

    // Restore physics data if present
    if let Some(pd) = &snapshot.physics_data {
        commands.entity(entity).insert(pd.clone());
    }
    if snapshot.physics_enabled {
        commands.entity(entity).insert(PhysicsEnabled);
    }
    // Restore asset ref if present
    if let Some(ar) = &snapshot.asset_ref {
        commands.entity(entity).insert(ar.clone());
    }
    // Restore script data if present
    if let Some(sd) = &snapshot.script_data {
        commands.entity(entity).insert(sd.clone());
    }
    // Restore audio data if present
    if let Some(ad) = &snapshot.audio_data {
        commands.entity(entity).insert(ad.clone());
    }
    // The enablement marker follows the snapshot's own flag — restoring audio the
    // user had switched off must not bring it back playing (PF-1193). Gated on
    // the data too: `audio_enabled` defaults to true for scenes saved before the
    // field existed, so an ungated insert would give every entity in every such
    // scene a bare AudioEnabled marker with no AudioData under it.
    if snapshot.audio_data.is_some() && snapshot.audio_enabled {
        commands.entity(entity).insert(AudioEnabled);
    }
    // Restore reverb zone data if present
    if let Some(rzd) = &snapshot.reverb_zone_data {
        commands.entity(entity).insert(rzd.clone());
    }
    if snapshot.reverb_zone_enabled {
        commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
    }
    // Restore particle data if present
    if let Some(pd) = &snapshot.particle_data {
        commands.entity(entity).insert(pd.clone());
    }
    if snapshot.particle_enabled {
        commands.entity(entity).insert(ParticleEnabled);
    }

    // Restore shader data if present
    if let Some(sed) = &snapshot.shader_effect_data {
        commands.entity(entity).insert(sed.clone());
    }

    // Restore joint data if present
    if let Some(jd) = &snapshot.joint_data {
        commands.entity(entity).insert(jd.clone());
    }

    // Restore game components if present
    if let Some(gc) = &snapshot.game_components {
        commands.entity(entity).insert(gc.clone());
    }

    // Restore animation clip data if present
    if let Some(acd) = &snapshot.animation_clip_data {
        commands.entity(entity).insert(acd.clone());
    }

    // Restore game camera data if present
    if let Some(gcd) = &snapshot.game_camera_data {
        commands.entity(entity).insert(gcd.clone());
    }
    if snapshot.active_game_camera {
        commands.entity(entity).insert(ActiveGameCamera);
    }

    // Restore sprite data if present
    if let Some(sd) = &snapshot.sprite_data {
        commands.entity(entity).insert(sd.clone());
        commands.entity(entity).insert(super::sprite::SpriteEnabled);
    }

    // Restore 2D physics data if present
    if let Some(pd) = &snapshot.physics2d_data {
        commands.entity(entity).insert(pd.clone());
    }
    if snapshot.physics2d_enabled {
        commands.entity(entity).insert(super::physics_2d::Physics2dEnabled);
    }

    // Restore 2D joint data if present
    if let Some(jd) = &snapshot.joint2d_data {
        commands.entity(entity).insert(jd.clone());
    }

    // Restore tilemap data if present
    if let Some(tmd) = &snapshot.tilemap_data {
        commands.entity(entity).insert(tmd.clone());
    }
    if snapshot.tilemap_enabled {
        commands.entity(entity).insert(TilemapEnabled);
    }

    // Restore 2D skeleton data if present
    if let Some(sd) = &snapshot.skeleton2d_data {
        commands.entity(entity).insert(sd.clone());
        if snapshot.skeleton2d_enabled {
            commands
                .entity(entity)
                .insert(super::skeleton2d::SkeletonEnabled2d);
        }
    }

    // The ECS holds at most one SkeletalAnimation2d per entity; the snapshot
    // stores a Vec to match the file format, so only the first element can be
    // restored.
    if let Some(anim) = snapshot.skeletal_animations.as_ref().and_then(|a| a.first()) {
        commands.entity(entity).insert(anim.clone());
    }

    // Restore LOD data if present
    if let Some(ld) = &snapshot.lod_data {
        commands.entity(entity).insert(ld.clone());
    }

    entity
}

/// System that processes undo requests.
pub fn apply_undo_requests(
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
    mut query: Query<(Entity, &EntityId, &mut Transform, &mut EntityName, &mut EntityVisible)>,
    mut mat_query: Query<(&EntityId, &mut MaterialData)>,
    mut light_query: Query<(&EntityId, &mut LightData)>,
    mut physics_query: Query<(&EntityId, &mut PhysicsData)>,
    script_query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    audio_query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    particle_query: Query<(Entity, &EntityId, Option<&ParticleData>)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    use super::history::take_undo_request;

    if !take_undo_request() {
        return;
    }

    if let Some(action) = history.pop_undo() {
        execute_undo(&action, &mut commands, &mut query, &mut mat_query, &mut light_query, &mut physics_query, &script_query, &audio_query, &particle_query, &mut meshes, &mut materials);
        history.push_redo(action);
    }
}

/// System that processes redo requests.
pub fn apply_redo_requests(
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
    mut query: Query<(Entity, &EntityId, &mut Transform, &mut EntityName, &mut EntityVisible)>,
    mut mat_query: Query<(&EntityId, &mut MaterialData)>,
    mut light_query: Query<(&EntityId, &mut LightData)>,
    mut physics_query: Query<(&EntityId, &mut PhysicsData)>,
    script_query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    audio_query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    particle_query: Query<(Entity, &EntityId, Option<&ParticleData>)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    use super::history::take_redo_request;

    if !take_redo_request() {
        return;
    }

    if let Some(action) = history.pop_redo() {
        execute_redo(&action, &mut commands, &mut query, &mut mat_query, &mut light_query, &mut physics_query, &script_query, &audio_query, &particle_query, &mut meshes, &mut materials);
        // Use push_undo_only to avoid clearing remaining redo items
        history.push_undo_only(action);
    }
}

/// System that applies pending material updates from the bridge.
pub fn apply_material_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut MaterialData)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.material_updates.drain(..) {
        for (entity_id, mut current_mat) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_material = current_mat.clone();
                // Merge: start from incoming update but preserve existing texture IDs
                // when the update leaves them as None (update_material only sends changed fields).
                let mut new_mat = update.material_data.clone();
                if new_mat.base_color_texture.is_none() { new_mat.base_color_texture = old_material.base_color_texture.clone(); }
                if new_mat.normal_map_texture.is_none() { new_mat.normal_map_texture = old_material.normal_map_texture.clone(); }
                if new_mat.metallic_roughness_texture.is_none() { new_mat.metallic_roughness_texture = old_material.metallic_roughness_texture.clone(); }
                if new_mat.emissive_texture.is_none() { new_mat.emissive_texture = old_material.emissive_texture.clone(); }
                if new_mat.occlusion_texture.is_none() { new_mat.occlusion_texture = old_material.occlusion_texture.clone(); }
                if new_mat.depth_map_texture.is_none() { new_mat.depth_map_texture = old_material.depth_map_texture.clone(); }
                if new_mat.clearcoat_texture.is_none() { new_mat.clearcoat_texture = old_material.clearcoat_texture.clone(); }
                if new_mat.clearcoat_roughness_texture.is_none() { new_mat.clearcoat_roughness_texture = old_material.clearcoat_roughness_texture.clone(); }
                if new_mat.clearcoat_normal_texture.is_none() { new_mat.clearcoat_normal_texture = old_material.clearcoat_normal_texture.clone(); }
                *current_mat = new_mat.clone();

                // Record for undo
                history.push(UndoableAction::MaterialChange {
                    entity_id: update.entity_id.clone(),
                    old_material,
                    new_material: new_mat,
                });
                break;
            }
        }
    }
}

/// System that applies pending light updates from the bridge.
pub fn apply_light_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut LightData)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.light_updates.drain(..) {
        for (entity_id, mut current_light) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_light = current_light.clone();
                // Preserve the light_type from the existing component
                let mut new_light = update.light_data.clone();
                new_light.light_type = old_light.light_type.clone();
                *current_light = new_light.clone();

                // Record for undo
                history.push(UndoableAction::LightChange {
                    entity_id: update.entity_id.clone(),
                    old_light,
                    new_light,
                });
                break;
            }
        }
    }
}

/// System that applies pending ambient light updates from the bridge.
pub fn apply_ambient_light_updates(
    mut pending: ResMut<PendingCommands>,
    mut ambient: ResMut<GlobalAmbientLight>,
) {
    for update in pending.ambient_light_updates.drain(..) {
        if let Some(color) = update.color {
            ambient.color = Color::linear_rgb(color[0], color[1], color[2]);
        }
        if let Some(brightness) = update.brightness {
            ambient.brightness = brightness;
        }
    }
}

/// Execute undo for an action.
fn execute_undo(
    action: &UndoableAction,
    commands: &mut Commands,
    query: &mut Query<(Entity, &EntityId, &mut Transform, &mut EntityName, &mut EntityVisible)>,
    mat_query: &mut Query<(&EntityId, &mut MaterialData)>,
    light_query: &mut Query<(&EntityId, &mut LightData)>,
    physics_query: &mut Query<(&EntityId, &mut PhysicsData)>,
    script_query: &Query<(Entity, &EntityId, Option<&ScriptData>)>,
    audio_query: &Query<(Entity, &EntityId, Option<&AudioData>)>,
    particle_query: &Query<(Entity, &EntityId, Option<&ParticleData>)>,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
) {
    match action {
        UndoableAction::TransformChange { entity_id, old_transform, .. } => {
            // Restore old transform
            for (_, eid, mut transform, _, _) in query.iter_mut() {
                if &eid.0 == entity_id {
                    *transform = old_transform.to_transform();
                    break;
                }
            }
        }
        UndoableAction::MultiTransformChange { transforms } => {
            // Restore old transforms for all entities
            for (entity_id, old_transform, _) in transforms {
                for (_, eid, mut transform, _, _) in query.iter_mut() {
                    if &eid.0 == entity_id {
                        *transform = old_transform.to_transform();
                        break;
                    }
                }
            }
        }
        UndoableAction::Rename { entity_id, old_name, .. } => {
            // Restore old name
            for (_, eid, _, mut name, _) in query.iter_mut() {
                if &eid.0 == entity_id {
                    name.0 = old_name.clone();
                    break;
                }
            }
        }
        UndoableAction::Spawn { snapshot } => {
            // Delete the spawned entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
        }
        UndoableAction::Delete { snapshot } => {
            // Respawn the deleted entity with its original entity_id
            spawn_from_snapshot(commands, meshes, materials, snapshot);
        }
        UndoableAction::Duplicate { snapshot, .. } => {
            // Delete the duplicated entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
        }
        UndoableAction::VisibilityChange { entity_id, old_visible, .. } => {
            // Restore old visibility
            for (_, eid, _, _, mut visible) in query.iter_mut() {
                if &eid.0 == entity_id {
                    visible.0 = *old_visible;
                    break;
                }
            }
        }
        UndoableAction::MaterialChange { entity_id, old_material, .. } => {
            // Restore old material
            for (eid, mut mat) in mat_query.iter_mut() {
                if &eid.0 == entity_id {
                    *mat = old_material.clone();
                    break;
                }
            }
        }
        UndoableAction::LightChange { entity_id, old_light, .. } => {
            // Restore old light data
            for (eid, mut light) in light_query.iter_mut() {
                if &eid.0 == entity_id {
                    *light = old_light.clone();
                    break;
                }
            }
        }
        UndoableAction::PhysicsChange { entity_id, old_physics, .. } => {
            // Restore old physics data
            for (eid, mut phys) in physics_query.iter_mut() {
                if &eid.0 == entity_id {
                    *phys = old_physics.clone();
                    break;
                }
            }
        }
        UndoableAction::ScriptChange { entity_id, old_script, .. } => {
            for (entity, eid, _) in script_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(script) = old_script {
                        commands.entity(entity).insert(script.clone());
                    } else {
                        commands.entity(entity).remove::<ScriptData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::AudioChange { entity_id, old_audio, .. } => {
            for (entity, eid, _) in audio_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(audio) = old_audio {
                        commands.entity(entity).insert(audio.clone());
                    } else {
                        commands.entity(entity).remove::<AudioData>().remove::<AudioEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ParticleChange { entity_id, old_particle, .. } => {
            for (entity, eid, _) in particle_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(particle) = old_particle {
                        commands.entity(entity).insert(particle.clone());
                    } else {
                        commands.entity(entity).remove::<ParticleData>().remove::<ParticleEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ShaderChange { entity_id, old_shader, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(shader) = old_shader {
                        commands.entity(entity).insert(shader.clone());
                    } else {
                        commands.entity(entity).remove::<ShaderEffectData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::CsgOperation {
            source_a_snapshot,
            source_b_snapshot,
            result_snapshot,
            sources_deleted,
        } => {
            // 1. Delete the result entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == result_snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }

            // 2. Restore source entities if they were deleted
            if *sources_deleted {
                if let Some(ref snap_a) = source_a_snapshot {
                    spawn_from_snapshot(commands, meshes, materials, snap_a);
                }
                if let Some(ref snap_b) = source_b_snapshot {
                    spawn_from_snapshot(commands, meshes, materials, snap_b);
                }
            }
        }
        UndoableAction::TerrainChange { entity_id, old_terrain, old_mesh_data, .. } => {
            // Restore old terrain data and rebuild mesh
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    // Replace terrain data
                    commands.entity(entity).insert(old_terrain.clone());
                    commands.entity(entity).insert(old_mesh_data.clone());
                    // Rebuild mesh from old heightmap
                    let mesh = terrain::rebuild_terrain_mesh(old_mesh_data);
                    commands.entity(entity).insert(Mesh3d(meshes.add(mesh)));
                    break;
                }
            }
        }
        UndoableAction::ExtrudeShape { snapshot } => {
            // Delete the extruded entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
        }
        UndoableAction::LatheShape { snapshot } => {
            // Delete the lathed entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
        }
        UndoableAction::ArrayEntity { created_snapshots, .. } => {
            // Delete all created array copies
            for snap in created_snapshots {
                for (entity, eid, _, _, _) in query.iter() {
                    if eid.0 == snap.entity_id {
                        commands.entity(entity).despawn();
                        break;
                    }
                }
            }
        }
        UndoableAction::CombineMeshes { source_snapshots, result_snapshot } => {
            // Delete the combined result entity
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == result_snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
            // Restore source entities
            for snap in source_snapshots {
                spawn_from_snapshot(commands, meshes, materials, snap);
            }
        }
        UndoableAction::JointChange { entity_id, old_joint, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref jd) = old_joint {
                        commands.entity(entity).insert(jd.clone());
                    } else {
                        commands.entity(entity).remove::<JointData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::GameComponentChange { entity_id, old_components, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref gc) = old_components {
                        commands.entity(entity).insert(gc.clone());
                    } else {
                        commands.entity(entity).remove::<super::game_components::GameComponents>();
                    }
                    break;
                }
            }
        }
        UndoableAction::AnimationClipChange { entity_id, old_clip, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref acd) = old_clip {
                        commands.entity(entity).insert(acd.clone());
                    } else {
                        commands.entity(entity).remove::<AnimationClipData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ReverbZoneChange { entity_id, old_reverb, old_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    // Restore the marker from what was RECORDED, never
                    // unconditionally: enabling a zone the user had disabled is
                    // the PF-1173 bug, and this action also covers removal, so
                    // the marker genuinely varies.
                    if let Some(ref rz) = old_reverb {
                        commands.entity(entity).insert(rz.clone());
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneData>();
                    }
                    if *old_enabled {
                        commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneEnabled>();
                    }
                    // This arm is pure `core/` and cannot emit, and the bridge's
                    // only reverb emitter is gated on both `selection.primary`
                    // and `Changed<ReverbZoneData>` — so it reaches neither a
                    // non-selected entity nor this arm's removal branch, and the
                    // browser's mirror kept a zone the engine had just dropped.
                    // Carry the state written, don't ask for it to be re-read:
                    // the drain runs in a different system and `Commands` are
                    // deferred.
                    // The bool is checked, not discarded: `with_pending` returns
                    // `None` when the thread-local `PendingCommands` is not
                    // registered, and dropping that signal would silently defeat
                    // the very re-report this call exists to make — the mirror
                    // would keep stale state with nothing in the log to say why.
                    if !super::pending_commands::queue_reverb_zone_resync_pending(
                        super::reverb_zone::ReverbZoneResync {
                            entity_id: entity_id.clone(),
                            data: old_reverb.clone(),
                            enabled: *old_enabled,
                        },
                    ) {
                        tracing::warn!(
                            "undo: could not queue reverb zone resync for '{}' — PendingCommands is not registered; the editor mirror will be stale",
                            entity_id,
                        );
                    }
                    break;
                }
            }
        }
        UndoableAction::SpriteChange { entity_id, old_sprite, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sd) = old_sprite {
                        commands.entity(entity).insert(sd.clone());
                    } else {
                        commands.entity(entity).remove::<super::sprite::SpriteData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::Physics2dChange { entity_id, old_physics, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref pd) = old_physics {
                        // Restore the DATA only. `Physics2dEnabled` is a separate
                        // marker toggled by its own command, and nothing that
                        // records this action changes it — so inserting it here
                        // turned physics ON for a disabled entity every time a
                        // property edit was undone. Matches the 3D
                        // `PhysicsChange` arm, which never touches
                        // `PhysicsEnabled`.
                        commands.entity(entity).insert(pd.clone());
                    } else {
                        // The asymmetry is deliberate: with no data to restore
                        // the entity had no 2D body at all, and an enabled
                        // marker with no `Physics2dData` is a state no command
                        // can produce (`apply_physics2d_toggles` inserts
                        // default data whenever it inserts the marker), so the
                        // pair has to come off together.
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::Physics2dToggle { entity_id, old_physics, old_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref pd) = old_physics {
                        commands.entity(entity).insert(pd.clone());
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                    }
                    if *old_enabled {
                        commands.entity(entity).insert(super::physics_2d::Physics2dEnabled);
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
                    }
                    #[cfg(target_arch = "wasm32")]
                    {
                        let restored = old_physics.clone().unwrap_or_default();
                        crate::bridge::events::emit_physics2d_changed(
                            entity_id,
                            &restored,
                            *old_enabled,
                        );
                    }
                    break;
                }
            }
        }
        UndoableAction::Joint2dChange { entity_id, old_joint, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref jd) = old_joint {
                        commands.entity(entity).insert(jd.clone());
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::PhysicsJoint2d>();
                    }
                    break;
                }
            }
        }
        UndoableAction::TilemapChange { entity_id, old_tilemap, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref td) = old_tilemap {
                        // Data only, for the same reason as `Physics2dChange`
                        // above. `TilemapEnabled` is restored conditionally
                        // from a recorded bool by both other restore paths
                        // (`insert_aux_components`, `spawn_from_snapshot`), so
                        // a disabled tilemap is a real state — and this action
                        // records no enablement, so it must not invent one.
                        commands.entity(entity).insert(td.clone());
                    } else {
                        commands.entity(entity).remove::<super::tilemap::TilemapData>();
                        commands.entity(entity).remove::<TilemapEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::SkeletonChange { entity_id, old_skeleton, old_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sk) = old_skeleton {
                        commands.entity(entity).insert(sk.clone());
                        if *old_enabled {
                            commands.entity(entity).insert(super::skeleton2d::SkeletonEnabled2d);
                        } else {
                            commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
                        }
                    } else {
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonData2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
                        // Mirror `apply_skeleton2d_removes`: the two derived
                        // components have to go with the rig that produced them.
                        // `SkinnedMeshInitialized` is the one that bites — it is a
                        // `Without<>` guard on `init_skinned_meshes_2d`, so a stale
                        // marker does not merely hold old data, it permanently
                        // suppresses re-initialization for this entity. Restore the
                        // rig afterwards and the skinned mesh never comes back.
                        commands.entity(entity).remove::<super::skeleton2d::BoneWorldTransforms2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkinnedMeshInitialized>();
                    }
                    // This arm is pure `core/` and cannot emit, and the bridge's
                    // only skeleton emitter is gated on a live rig — so it reaches
                    // neither a non-selected entity nor this arm's removal branch,
                    // and the browser's mirror kept a rig the engine had dropped.
                    // Carry the state written, don't ask for it to be re-read: the
                    // drain runs in a different system and `Commands` are deferred.
                    // The bool is checked, not discarded: `with_pending` returns
                    // `None` when the thread-local `PendingCommands` is not
                    // registered, and dropping that signal would silently defeat
                    // the very re-report this call exists to make — the mirror
                    // would keep stale state with nothing in the log to say why.
                    if !super::pending_commands::queue_skeleton2d_resync_pending(
                        super::skeleton2d::Skeleton2dResync {
                            entity_id: entity_id.clone(),
                            data: old_skeleton.clone(),
                            enabled: *old_enabled,
                        },
                    ) {
                        tracing::warn!(
                            "undo: could not queue 2D skeleton resync for '{}' — PendingCommands is not registered; the editor mirror will be stale",
                            entity_id,
                        );
                    }
                    break;
                }
            }
        }
    }
}

/// Execute redo for an action (opposite of undo).
fn execute_redo(
    action: &UndoableAction,
    commands: &mut Commands,
    query: &mut Query<(Entity, &EntityId, &mut Transform, &mut EntityName, &mut EntityVisible)>,
    mat_query: &mut Query<(&EntityId, &mut MaterialData)>,
    light_query: &mut Query<(&EntityId, &mut LightData)>,
    physics_query: &mut Query<(&EntityId, &mut PhysicsData)>,
    script_query: &Query<(Entity, &EntityId, Option<&ScriptData>)>,
    audio_query: &Query<(Entity, &EntityId, Option<&AudioData>)>,
    particle_query: &Query<(Entity, &EntityId, Option<&ParticleData>)>,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
) {
    match action {
        UndoableAction::TransformChange { entity_id, new_transform, .. } => {
            // Apply new transform
            for (_, eid, mut transform, _, _) in query.iter_mut() {
                if &eid.0 == entity_id {
                    *transform = new_transform.to_transform();
                    break;
                }
            }
        }
        UndoableAction::MultiTransformChange { transforms } => {
            // Apply new transforms for all entities
            for (entity_id, _, new_transform) in transforms {
                for (_, eid, mut transform, _, _) in query.iter_mut() {
                    if &eid.0 == entity_id {
                        *transform = new_transform.to_transform();
                        break;
                    }
                }
            }
        }
        UndoableAction::Rename { entity_id, new_name, .. } => {
            // Apply new name
            for (_, eid, _, mut name, _) in query.iter_mut() {
                if &eid.0 == entity_id {
                    name.0 = new_name.clone();
                    break;
                }
            }
        }
        UndoableAction::Spawn { snapshot } => {
            // Respawn the entity with its original ID
            spawn_from_snapshot(commands, meshes, materials, snapshot);
        }
        UndoableAction::Delete { snapshot } => {
            // Delete the entity again
            for (entity, eid, _, _, _) in query.iter() {
                if eid.0 == snapshot.entity_id {
                    commands.entity(entity).despawn();
                    break;
                }
            }
        }
        UndoableAction::Duplicate { snapshot, .. } => {
            // Recreate the duplicate with its original ID
            spawn_from_snapshot(commands, meshes, materials, snapshot);
        }
        UndoableAction::VisibilityChange { entity_id, new_visible, .. } => {
            for (_, eid, _, _, mut visible) in query.iter_mut() {
                if &eid.0 == entity_id {
                    visible.0 = *new_visible;
                    break;
                }
            }
        }
        UndoableAction::MaterialChange { entity_id, new_material, .. } => {
            // Apply new material
            for (eid, mut mat) in mat_query.iter_mut() {
                if &eid.0 == entity_id {
                    *mat = new_material.clone();
                    break;
                }
            }
        }
        UndoableAction::LightChange { entity_id, new_light, .. } => {
            // Apply new light data
            for (eid, mut light) in light_query.iter_mut() {
                if &eid.0 == entity_id {
                    *light = new_light.clone();
                    break;
                }
            }
        }
        UndoableAction::PhysicsChange { entity_id, new_physics, .. } => {
            // Apply new physics data
            for (eid, mut phys) in physics_query.iter_mut() {
                if &eid.0 == entity_id {
                    *phys = new_physics.clone();
                    break;
                }
            }
        }
        UndoableAction::ScriptChange { entity_id, new_script, .. } => {
            for (entity, eid, _) in script_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(script) = new_script {
                        commands.entity(entity).insert(script.clone());
                    } else {
                        commands.entity(entity).remove::<ScriptData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::AudioChange { entity_id, new_audio, .. } => {
            for (entity, eid, _) in audio_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(audio) = new_audio {
                        commands.entity(entity).insert(audio.clone());
                    } else {
                        commands.entity(entity).remove::<AudioData>().remove::<AudioEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ParticleChange { entity_id, new_particle, .. } => {
            for (entity, eid, _) in particle_query.iter() {
                if &eid.0 == entity_id {
                    if let Some(particle) = new_particle {
                        commands.entity(entity).insert(particle.clone());
                    } else {
                        commands.entity(entity).remove::<ParticleData>().remove::<ParticleEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ShaderChange { entity_id, new_shader, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(shader) = new_shader {
                        commands.entity(entity).insert(shader.clone());
                    } else {
                        commands.entity(entity).remove::<ShaderEffectData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::CsgOperation {
            source_a_snapshot,
            source_b_snapshot,
            result_snapshot,
            sources_deleted,
        } => {
            // 1. Delete source entities if they were originally deleted
            if *sources_deleted {
                if let Some(ref snap_a) = source_a_snapshot {
                    for (entity, eid, _, _, _) in query.iter() {
                        if eid.0 == snap_a.entity_id {
                            commands.entity(entity).despawn();
                            break;
                        }
                    }
                }
                if let Some(ref snap_b) = source_b_snapshot {
                    for (entity, eid, _, _, _) in query.iter() {
                        if eid.0 == snap_b.entity_id {
                            commands.entity(entity).despawn();
                            break;
                        }
                    }
                }
            }

            // 2. Restore the result entity from snapshot
            spawn_from_snapshot(commands, meshes, materials, result_snapshot);
        }
        UndoableAction::TerrainChange { entity_id, new_terrain, new_mesh_data, .. } => {
            // Apply new terrain data and rebuild mesh
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    // Replace terrain data
                    commands.entity(entity).insert(new_terrain.clone());
                    commands.entity(entity).insert(new_mesh_data.clone());
                    // Rebuild mesh from new heightmap
                    let mesh = terrain::rebuild_terrain_mesh(new_mesh_data);
                    commands.entity(entity).insert(Mesh3d(meshes.add(mesh)));
                    break;
                }
            }
        }
        UndoableAction::ExtrudeShape { snapshot } => {
            // Re-create the extruded entity
            spawn_from_snapshot(commands, meshes, materials, snapshot);
        }
        UndoableAction::LatheShape { snapshot } => {
            // Re-create the lathed entity
            spawn_from_snapshot(commands, meshes, materials, snapshot);
        }
        UndoableAction::ArrayEntity { created_snapshots, .. } => {
            // Re-create all array copies
            for snap in created_snapshots {
                spawn_from_snapshot(commands, meshes, materials, snap);
            }
        }
        UndoableAction::CombineMeshes { source_snapshots, result_snapshot } => {
            // Delete source entities
            for snap in source_snapshots {
                for (entity, eid, _, _, _) in query.iter() {
                    if eid.0 == snap.entity_id {
                        commands.entity(entity).despawn();
                        break;
                    }
                }
            }
            // Re-create the combined result entity
            spawn_from_snapshot(commands, meshes, materials, result_snapshot);
        }
        UndoableAction::JointChange { entity_id, new_joint, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref jd) = new_joint {
                        commands.entity(entity).insert(jd.clone());
                    } else {
                        commands.entity(entity).remove::<JointData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::GameComponentChange { entity_id, new_components, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref gc) = new_components {
                        commands.entity(entity).insert(gc.clone());
                    } else {
                        commands.entity(entity).remove::<super::game_components::GameComponents>();
                    }
                    break;
                }
            }
        }
        UndoableAction::AnimationClipChange { entity_id, new_clip, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref acd) = new_clip {
                        commands.entity(entity).insert(acd.clone());
                    } else {
                        commands.entity(entity).remove::<AnimationClipData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::ReverbZoneChange { entity_id, new_reverb, new_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    // Mirror of the undo arm: the marker comes from the recorded
                    // post-state, not from "data is present".
                    if let Some(ref rz) = new_reverb {
                        commands.entity(entity).insert(rz.clone());
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneData>();
                    }
                    if *new_enabled {
                        commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneEnabled>();
                    }
                    // Same re-report as the undo arm, with the post-state.
                    // The bool is checked, not discarded: `with_pending` returns
                    // `None` when the thread-local `PendingCommands` is not
                    // registered, and dropping that signal would silently defeat
                    // the very re-report this call exists to make — the mirror
                    // would keep stale state with nothing in the log to say why.
                    if !super::pending_commands::queue_reverb_zone_resync_pending(
                        super::reverb_zone::ReverbZoneResync {
                            entity_id: entity_id.clone(),
                            data: new_reverb.clone(),
                            enabled: *new_enabled,
                        },
                    ) {
                        tracing::warn!(
                            "redo: could not queue reverb zone resync for '{}' — PendingCommands is not registered; the editor mirror will be stale",
                            entity_id,
                        );
                    }
                    break;
                }
            }
        }
        UndoableAction::SpriteChange { entity_id, new_sprite, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sd) = new_sprite {
                        commands.entity(entity).insert(sd.clone());
                    } else {
                        commands.entity(entity).remove::<super::sprite::SpriteData>();
                    }
                    break;
                }
            }
        }
        UndoableAction::Physics2dChange { entity_id, new_physics, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref pd) = new_physics {
                        // Data only — see the undo arm: enablement is a
                        // separate marker this action never records.
                        commands.entity(entity).insert(pd.clone());
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::Physics2dToggle { entity_id, new_physics, new_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref pd) = new_physics {
                        commands.entity(entity).insert(pd.clone());
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                    }
                    if *new_enabled {
                        commands.entity(entity).insert(super::physics_2d::Physics2dEnabled);
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
                    }
                    #[cfg(target_arch = "wasm32")]
                    {
                        let restored = new_physics.clone().unwrap_or_default();
                        crate::bridge::events::emit_physics2d_changed(
                            entity_id,
                            &restored,
                            *new_enabled,
                        );
                    }
                    break;
                }
            }
        }
        UndoableAction::Joint2dChange { entity_id, new_joint, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref jd) = new_joint {
                        commands.entity(entity).insert(jd.clone());
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::PhysicsJoint2d>();
                    }
                    break;
                }
            }
        }
        UndoableAction::TilemapChange { entity_id, new_tilemap, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref td) = new_tilemap {
                        // Data only — see the undo arm.
                        commands.entity(entity).insert(td.clone());
                    } else {
                        commands.entity(entity).remove::<super::tilemap::TilemapData>();
                        commands.entity(entity).remove::<TilemapEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::SkeletonChange { entity_id, new_skeleton, new_enabled, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sk) = new_skeleton {
                        commands.entity(entity).insert(sk.clone());
                        if *new_enabled {
                            commands.entity(entity).insert(super::skeleton2d::SkeletonEnabled2d);
                        } else {
                            commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
                        }
                    } else {
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonData2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
                        // Mirror `apply_skeleton2d_removes`: the two derived
                        // components have to go with the rig that produced them.
                        // `SkinnedMeshInitialized` is the one that bites — it is a
                        // `Without<>` guard on `init_skinned_meshes_2d`, so a stale
                        // marker does not merely hold old data, it permanently
                        // suppresses re-initialization for this entity. Restore the
                        // rig afterwards and the skinned mesh never comes back.
                        commands.entity(entity).remove::<super::skeleton2d::BoneWorldTransforms2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkinnedMeshInitialized>();
                    }
                    // See the undo arm: `core/` cannot emit, so re-report.
                    // The bool is checked, not discarded: `with_pending` returns
                    // `None` when the thread-local `PendingCommands` is not
                    // registered, and dropping that signal would silently defeat
                    // the very re-report this call exists to make — the mirror
                    // would keep stale state with nothing in the log to say why.
                    if !super::pending_commands::queue_skeleton2d_resync_pending(
                        super::skeleton2d::Skeleton2dResync {
                            entity_id: entity_id.clone(),
                            data: new_skeleton.clone(),
                            enabled: *new_enabled,
                        },
                    ) {
                        tracing::warn!(
                            "redo: could not queue 2D skeleton resync for '{}' — PendingCommands is not registered; the editor mirror will be stale",
                            entity_id,
                        );
                    }
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod spawn_id_tests {
    use super::apply_spawn_requests;
    use super::HistoryStack;
    use crate::core::entity_id::EntityId;
    use crate::core::pending_commands::{EntityType, PendingCommands, SpawnRequest};
    use bevy::prelude::*;

    /// Build a minimal World with the resources `apply_spawn_requests` reads,
    /// run the system once through a Schedule (which flushes the deferred
    /// `Commands`), and return every EntityId string left in the world.
    fn run_spawn(request: SpawnRequest) -> Vec<String> {
        let mut world = World::new();
        let mut pending = PendingCommands::default();
        pending.spawn_requests.push(request);
        world.insert_resource(pending);
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world.insert_resource(HistoryStack::default());

        let mut schedule = Schedule::default();
        schedule.add_systems(apply_spawn_requests);
        schedule.run(&mut world);

        let mut query = world.query::<&EntityId>();
        query.iter(&world).map(|id| id.0.clone()).collect()
    }

    /// The core fix: a supplied non-blank id becomes the spawned entity's
    /// EntityId. This is what lets the JS caller reference the entity
    /// synchronously instead of reading a stale `primaryId` that the async
    /// SELECTION_CHANGED event has not yet updated.
    #[test]
    fn supplied_id_overrides_generated_entity_id() {
        let ids = run_spawn(SpawnRequest {
            entity_type: EntityType::Cube,
            name: Some("Hero".into()),
            position: None,
            id: Some("client-uuid-123".into()),
        });
        assert_eq!(
            ids,
            vec!["client-uuid-123".to_string()],
            "supplied id must override the engine-generated EntityId",
        );
    }

    /// Legacy path: a `None` id falls back to the engine-generated UUID-v4
    /// (36 chars). Spawns that don't supply an id must keep working.
    #[test]
    fn none_id_falls_back_to_generated_uuid() {
        let ids = run_spawn(SpawnRequest {
            entity_type: EntityType::Sphere,
            name: Some("Ball".into()),
            position: None,
            id: None,
        });
        assert_eq!(ids.len(), 1, "exactly one entity should spawn");
        assert_eq!(
            ids[0].len(),
            36,
            "fallback EntityId should be a UUID-v4 (36 chars), got {:?}",
            ids[0],
        );
    }

    /// A blank / whitespace-only id is treated as absent and falls back to a
    /// generated UUID — guards against a client sending "" or "   ".
    #[test]
    fn blank_id_falls_back_to_generated_uuid() {
        let ids = run_spawn(SpawnRequest {
            entity_type: EntityType::Cube,
            name: Some("Blank".into()),
            position: None,
            id: Some("   ".into()),
        });
        assert_eq!(ids.len(), 1, "exactly one entity should spawn");
        assert_eq!(
            ids[0].len(),
            36,
            "blank id must fall back to a UUID-v4, got {:?}",
            ids[0],
        );
    }

    /// An id containing a control / NUL character (which `str::trim` does NOT
    /// strip from the interior) is rejected by `is_valid_override_id` and falls
    /// back to a generated UUID. The spawn still succeeds — a malformed client
    /// id can never produce a malformed EntityId.
    #[test]
    fn control_char_id_falls_back_to_generated_uuid() {
        let ids = run_spawn(SpawnRequest {
            entity_type: EntityType::Cube,
            name: Some("Ctrl".into()),
            position: None,
            id: Some("ab\u{0}cd".into()),
        });
        assert_eq!(ids.len(), 1, "exactly one entity should spawn");
        assert_eq!(
            ids[0].len(),
            36,
            "control-char id must fall back to a UUID-v4, got {:?}",
            ids[0],
        );
    }

    /// An oversized id (> 64 chars) is rejected and falls back to a generated
    /// UUID, bounding the EntityId length against an unbounded client blob.
    #[test]
    fn oversized_id_falls_back_to_generated_uuid() {
        let oversized = "a".repeat(65);
        let ids = run_spawn(SpawnRequest {
            entity_type: EntityType::Cube,
            name: Some("Big".into()),
            position: None,
            id: Some(oversized),
        });
        assert_eq!(ids.len(), 1, "exactly one entity should spawn");
        assert_eq!(
            ids[0].len(),
            36,
            "oversized id must fall back to a UUID-v4, got {:?}",
            ids[0],
        );
    }
}

#[cfg(test)]
mod spawn_position_tests {
    use super::apply_spawn_requests;
    use super::HistoryStack;
    use crate::core::pending_commands::{EntityType, PendingCommands, SpawnRequest};
    use bevy::prelude::*;

    /// Spawn one entity and return its Transform. Mirrors `run_spawn` in
    /// `spawn_id_tests`, but reads the Transform rather than the EntityId.
    fn run_spawn_transform(entity_type: EntityType, position: Option<Vec3>) -> Transform {
        let mut world = World::new();
        let mut pending = PendingCommands::default();
        pending.spawn_requests.push(SpawnRequest {
            entity_type,
            name: Some("Subject".into()),
            position,
            id: None,
        });
        world.insert_resource(pending);
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world.insert_resource(HistoryStack::default());

        let mut schedule = Schedule::default();
        schedule.add_systems(apply_spawn_requests);
        schedule.run(&mut world);

        let mut query = world.query::<&Transform>();
        let transforms: Vec<Transform> = query.iter(&world).copied().collect();
        assert_eq!(transforms.len(), 1, "exactly one entity should spawn");
        transforms[0]
    }

    /// Every spawnable type must honor a requested position. `DirectionalLight`
    /// was the one arm of `apply_spawn_requests` that never received
    /// `request.position`, so a caller asking for a light at (5, 10, 5) silently
    /// got one at the origin — and, because the arm also returned `Vec3::ZERO`,
    /// the history snapshot recorded the origin too, so undo/redo could not
    /// recover the requested placement either.
    #[test]
    fn every_spawnable_type_honors_the_requested_position() {
        let requested = Vec3::new(5.0, 10.0, -5.0);

        for entity_type in [
            EntityType::Cube,
            EntityType::Sphere,
            EntityType::Plane,
            EntityType::Cylinder,
            EntityType::Cone,
            EntityType::Torus,
            EntityType::Capsule,
            EntityType::PointLight,
            EntityType::DirectionalLight,
            EntityType::SpotLight,
        ] {
            let transform = run_spawn_transform(entity_type, Some(requested));
            assert_eq!(
                transform.translation, requested,
                "{entity_type:?} ignored the requested spawn position",
            );
        }
    }

    /// Applying the position must not cost the directional light its default
    /// aim — the rotation is what makes it light the scene at all, so a fix that
    /// swapped `from_rotation` for `from_translation` would be a silent
    /// regression the position assertion above cannot see.
    #[test]
    fn directional_light_keeps_its_default_rotation() {
        let expected = Quat::from_euler(EulerRot::XYZ, -0.5, 0.5, 0.0);

        for position in [None, Some(Vec3::new(5.0, 10.0, -5.0))] {
            let transform = run_spawn_transform(EntityType::DirectionalLight, position);
            assert!(
                transform.rotation.abs_diff_eq(expected, 1e-5),
                "directional light lost its default rotation (position: {position:?})",
            );
        }
    }

    /// Omitting the position keeps each type's own documented default. Pinned so
    /// the position plumbing can never quietly move an existing default.
    #[test]
    fn omitted_position_keeps_the_type_default() {
        assert_eq!(
            run_spawn_transform(EntityType::DirectionalLight, None).translation,
            Vec3::ZERO,
        );
        assert_eq!(
            run_spawn_transform(EntityType::SpotLight, None).translation,
            Vec3::new(0.0, 3.0, 0.0),
        );
    }
}

#[cfg(test)]
mod terrain_drain_tests {
    use super::{
        apply_terrain_sculpts, apply_terrain_spawn_requests, apply_terrain_updates, log_safe_id,
        HistoryStack, UndoableAction, LOG_ID_MAX_CHARS,
    };
    use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
    use crate::core::pending_commands::{
        EntityType, PendingCommands, TerrainSculpt, TerrainSpawnRequest, TerrainUpdate,
    };
    use crate::core::terrain::{
        TerrainData, TerrainDataPatch, TerrainEnabled, TerrainMeshData,
    };
    use bevy::prelude::*;
    use bevy::transform::systems::{
        mark_dirty_trees, propagate_parent_transforms, sync_simple_transforms,
    };

    /// A terrain small enough to reason about by hand: an 8x8 grid over 7.0
    /// world units, so `step` is exactly 1.0 and grid cell `(x, z)` sits at
    /// world `(-3.5 + x, -3.5 + z)`.
    fn small_terrain(seed: u32) -> TerrainData {
        TerrainData {
            resolution: 8,
            size: 7.0,
            seed,
            ..Default::default()
        }
    }

    /// Minimal World carrying exactly the resources the three drain systems read.
    /// Mirrors the proven `spawn_id_tests` harness.
    fn base_world() -> World {
        let mut world = World::new();
        world.insert_resource(PendingCommands::default());
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world.insert_resource(HistoryStack::default());
        // `apply_terrain_sculpts` reads `GlobalTransform`, which Bevy only
        // auto-inserts as IDENTITY -- nothing propagates it unless the transform
        // systems run, and `mark_dirty_trees` / `propagate_parent_transforms`
        // both need this resource. Without it every sculpt test would silently
        // assert against an identity pose and could not tell `Transform` from
        // `GlobalTransform`.
        world.insert_resource(StaticTransformOptimizations::default());
        world
    }

    /// Run a single system once through a Schedule, which also flushes the
    /// deferred `Commands` so spawned entities are queryable afterwards.
    /// A macro rather than a generic fn so it needs no naming of Bevy's
    /// `IntoScheduleConfigs` marker types.
    macro_rules! run_system {
        ($world:expr, $system:expr) => {{
            let mut schedule = Schedule::default();
            schedule.add_systems($system);
            schedule.run($world);
        }};
    }

    /// Bring every `GlobalTransform` up to date, exactly as `TransformPlugin`
    /// does in `PostUpdate`. The order is load-bearing and mirrors
    /// `TransformPlugin::build`.
    fn propagate_transforms(world: &mut World) {
        run_system!(
            world,
            (
                mark_dirty_trees,
                propagate_parent_transforms,
                sync_simple_transforms,
            )
                .chain()
        );
    }

    fn queue_spawn(world: &mut World, request: TerrainSpawnRequest) {
        world
            .resource_mut::<PendingCommands>()
            .terrain_spawn_requests
            .push(request);
        run_system!(world, apply_terrain_spawn_requests);
    }

    fn spawn_request(id: Option<&str>, position: Option<Vec3>) -> TerrainSpawnRequest {
        TerrainSpawnRequest {
            name: None,
            position,
            terrain_data: small_terrain(7),
            id: id.map(str::to_string),
        }
    }

    /// Every `EntityId` string currently in the world.
    fn entity_ids(world: &mut World) -> Vec<String> {
        let mut query = world.query::<&EntityId>();
        query.iter(world).map(|id| id.0.clone()).collect()
    }

    /// Drain the undo stack (oldest first). `pop_undo` is the only public reader.
    fn drain_history(world: &mut World) -> Vec<UndoableAction> {
        let mut history = world.resource_mut::<HistoryStack>();
        let mut actions = Vec::new();
        while let Some(action) = history.pop_undo() {
            actions.push(action);
        }
        actions.reverse();
        actions
    }

    fn heights_of(world: &mut World) -> Vec<f32> {
        let mut query = world.query::<&TerrainMeshData>();
        let data = query
            .iter(world)
            .next()
            .expect("expected exactly one terrain entity");
        data.heights.clone()
    }

    fn mesh_handle_of(world: &mut World) -> Handle<Mesh> {
        let mut query = world.query::<&Mesh3d>();
        query
            .iter(world)
            .next()
            .expect("expected a Mesh3d on the terrain entity")
            .0
            .clone()
    }

    fn queue_update(world: &mut World, entity_id: &str, patch: TerrainDataPatch) {
        world
            .resource_mut::<PendingCommands>()
            .terrain_updates
            .push(TerrainUpdate {
                entity_id: entity_id.to_string(),
                patch,
            });
        run_system!(world, apply_terrain_updates);
    }

    fn push_sculpt(world: &mut World, entity_id: &str, position: [f32; 2], strength: f32) {
        world
            .resource_mut::<PendingCommands>()
            .terrain_sculpts
            .push(TerrainSculpt {
                entity_id: entity_id.to_string(),
                position,
                radius: 1.5,
                strength,
            });
    }

    /// Sculpt a frame AFTER the spawn: the editor ran `PostUpdate` in between,
    /// so every `GlobalTransform` is already current.
    fn queue_sculpt(world: &mut World, entity_id: &str, position: [f32; 2], strength: f32) {
        push_sculpt(world, entity_id, position, strength);
        propagate_transforms(world);
        run_system!(world, apply_terrain_sculpts);
    }

    /// Sculpt in the SAME frame as the spawn, which is what the `Update` chain
    /// in `bridge/mod.rs` actually does — the drains are `.chain()`ed, so the
    /// `ApplyDeferred` between them makes the just-spawned terrain queryable,
    /// and `TransformPlugin` does not run until `PostUpdate`. No propagation
    /// here, deliberately: propagating would hide exactly the case this
    /// ordering creates.
    fn queue_sculpt_same_frame(
        world: &mut World,
        entity_id: &str,
        position: [f32; 2],
        strength: f32,
    ) {
        push_sculpt(world, entity_id, position, strength);
        run_system!(world, apply_terrain_sculpts);
    }

    // === spawn: id resolution ===

    /// The core contract: a well-formed caller id becomes the entity's
    /// `EntityId` byte-for-byte, so JS can address the new terrain synchronously.
    #[test]
    fn spawn_writes_valid_override_id_verbatim() {
        let mut world = base_world();
        let supplied = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
        queue_spawn(&mut world, spawn_request(Some(supplied), None));

        assert_eq!(
            entity_ids(&mut world),
            vec![supplied.to_string()],
            "a valid supplied id must be written to the terrain's EntityId verbatim",
        );
    }

    /// No id supplied -> engine-generated UUID-v4 (36 chars).
    #[test]
    fn spawn_without_id_generates_uuid() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(None, None));

        let ids = entity_ids(&mut world);
        assert_eq!(ids.len(), 1, "exactly one terrain entity should spawn");
        assert_eq!(
            ids[0].len(),
            36,
            "fallback EntityId should be a UUID-v4, got {:?}",
            ids[0],
        );
    }

    /// A malformed id must never reach the entity AND must never cost the
    /// spawn: empty, interior-NUL and oversized all fall back to a fresh UUID.
    #[test]
    fn spawn_with_malformed_id_still_spawns_with_generated_uuid() {
        let oversized = "a".repeat(65);
        let cases: [(&str, &str); 3] = [
            ("empty", ""),
            ("interior NUL", "ab\u{0}cd"),
            ("oversized", oversized.as_str()),
        ];

        for (label, supplied) in cases {
            let mut world = base_world();
            queue_spawn(&mut world, spawn_request(Some(supplied), None));

            let ids = entity_ids(&mut world);
            assert_eq!(
                ids.len(),
                1,
                "{label} id must still spawn exactly one terrain entity",
            );
            assert_ne!(
                ids[0], supplied,
                "{label} id must never be written into the EntityId",
            );
            assert_eq!(
                ids[0].len(),
                36,
                "{label} id must fall back to a UUID-v4, got {:?}",
                ids[0],
            );
        }
    }

    // === spawn: components & transform ===

    /// All TEN components, not the five that happened to be convenient. A
    /// terrain missing `EntityName` is unlabelled in the hierarchy, missing
    /// `EntityVisible` is invisible to the visibility toggle, and missing
    /// `MeshMaterial3d` renders as Bevy's fallback magenta — each a real
    /// user-visible break that a 5-component query cannot see.
    #[test]
    fn spawn_attaches_the_full_terrain_component_set() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(None, None));

        let mut query = world.query::<(
            &EntityType,
            &EntityId,
            &EntityName,
            &EntityVisible,
            &TerrainData,
            &TerrainMeshData,
            &TerrainEnabled,
            &Mesh3d,
            &MeshMaterial3d<StandardMaterial>,
            &Transform,
        )>();
        let (entity_type, entity_id, name, visible, terrain_data, mesh_data, _, mesh3d, material, _) =
            query.iter(&world).next().expect(
                "terrain entity must carry the full EntityType/EntityId/EntityName/EntityVisible/\
                 TerrainData/TerrainMeshData/TerrainEnabled/Mesh3d/MeshMaterial3d/Transform set",
            );

        assert_eq!(*entity_type, EntityType::Terrain);
        assert!(!entity_id.0.is_empty());
        assert!(
            !name.0.is_empty(),
            "an unnamed terrain shows as a blank row in the hierarchy",
        );
        assert!(visible.0, "a freshly spawned terrain must be visible");
        assert_eq!(terrain_data.resolution, 8);
        assert_eq!(mesh_data.resolution, 8);
        assert_eq!(mesh_data.size, 7.0);
        assert_eq!(
            mesh_data.heights.len(),
            8 * 8,
            "heightmap must hold resolution * resolution samples",
        );

        // The handles must name assets that actually exist, or the entity renders
        // as nothing / Bevy's fallback magenta.
        assert!(
            world.resource::<Assets<Mesh>>().get(&mesh3d.0).is_some(),
            "Mesh3d must reference a live mesh asset",
        );
        assert!(
            world
                .resource::<Assets<StandardMaterial>>()
                .get(&material.0)
                .is_some(),
            "MeshMaterial3d must reference a live material asset",
        );
    }

    /// The heightmap must be the noise function's real output for THIS config.
    /// Asserting only `heights.len()` passes just as happily on a `vec![0.0; 64]`
    /// placeholder, i.e. on a perfectly flat terrain that ignores every noise
    /// parameter the user set.
    #[test]
    fn spawn_derives_the_heightmap_from_the_supplied_noise_config() {
        let mut world = base_world();
        let config = small_terrain(7);
        queue_spawn(&mut world, spawn_request(None, None));

        let heights = heights_of(&mut world);
        assert_eq!(
            heights,
            crate::core::terrain::generate_heightmap(&config),
            "the heightmap must be generate_heightmap() of the request's config, \
             not a placeholder",
        );
        let first = heights[0];
        assert!(
            heights.iter().any(|h| (h - first).abs() > 1e-6),
            "a noise heightmap must not be constant — got a flat plane, which is \
             what a zeroed placeholder looks like",
        );
    }

    #[test]
    fn spawn_applies_supplied_position() {
        let mut world = base_world();
        queue_spawn(
            &mut world,
            spawn_request(None, Some(Vec3::new(1.0, 2.0, 3.0))),
        );

        let mut query = world.query::<&Transform>();
        let transform = query.iter(&world).next().expect("terrain needs a Transform");
        assert_eq!(transform.translation, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn spawn_without_position_lands_at_origin() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(None, None));

        let mut query = world.query::<&Transform>();
        let transform = query.iter(&world).next().expect("terrain needs a Transform");
        assert_eq!(transform.translation, Vec3::ZERO);
    }

    /// Undo of a terrain spawn goes through `spawn_from_snapshot`, which can only
    /// rebuild the mesh when the snapshot carries BOTH the noise config and the
    /// computed heightmap. A snapshot missing either silently degrades to a flat
    /// 1x1 plane on redo, so both are asserted.
    #[test]
    fn spawn_pushes_one_history_entry_carrying_terrain_and_mesh_data() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));

        let actions = drain_history(&mut world);
        assert_eq!(actions.len(), 1, "exactly one history entry per spawn");
        match &actions[0] {
            UndoableAction::Spawn { snapshot } => {
                assert_eq!(snapshot.entity_id, "terrain-1");
                assert_eq!(snapshot.entity_type, EntityType::Terrain);
                let terrain_data = snapshot
                    .terrain_data
                    .as_ref()
                    .expect("snapshot must carry TerrainData");
                assert_eq!(terrain_data.resolution, 8);
                let mesh_data = snapshot
                    .terrain_mesh_data
                    .as_ref()
                    .expect("snapshot must carry TerrainMeshData");
                assert_eq!(mesh_data.heights.len(), 8 * 8);
                assert_eq!(
                    mesh_data.heights,
                    crate::core::terrain::generate_heightmap(&small_terrain(7)),
                    "the snapshot must carry the REAL heightmap — a placeholder \
                     redoes as a flat plane",
                );

                // The snapshot's transform is what `spawn_from_snapshot` restores.
                // A zeroed scale makes the redone terrain invisible; a zeroed
                // quaternion is not a valid rotation at all. Neither is visible
                // if the transform is left unasserted.
                assert_eq!(snapshot.transform.position, [0.0, 0.0, 0.0]);
                assert_eq!(
                    snapshot.transform.rotation,
                    [0.0, 0.0, 0.0, 1.0],
                    "identity rotation is (0,0,0,1); (0,0,0,0) is not a unit quaternion",
                );
                assert_eq!(
                    snapshot.transform.scale,
                    [1.0, 1.0, 1.0],
                    "a zero scale would redo the terrain as an invisible point",
                );
            }
            other => panic!("expected UndoableAction::Spawn, got {other:?}"),
        }
    }

    /// The snapshot transform must track the REQUEST, not a hardcoded identity.
    #[test]
    fn spawn_snapshot_records_the_supplied_position() {
        let mut world = base_world();
        queue_spawn(
            &mut world,
            spawn_request(Some("terrain-1"), Some(Vec3::new(1.0, 2.0, 3.0))),
        );

        let actions = drain_history(&mut world);
        match &actions[0] {
            UndoableAction::Spawn { snapshot } => {
                assert_eq!(snapshot.transform.position, [1.0, 2.0, 3.0]);
            }
            other => panic!("expected UndoableAction::Spawn, got {other:?}"),
        }
    }

    // === update ===

    #[test]
    fn update_regenerates_heights_and_records_old_and_new() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let old_handle = mesh_handle_of(&mut world);
        let _ = drain_history(&mut world);

        let merged = TerrainData {
            height_scale: 40.0,
            ..small_terrain(999)
        };
        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch {
                seed: Some(999),
                height_scale: Some(40.0),
                ..Default::default()
            },
        );

        let after = heights_of(&mut world);
        assert_ne!(
            before, after,
            "changing the noise config must regenerate the heightmap",
        );
        assert_eq!(
            after,
            crate::core::terrain::generate_heightmap(&merged),
            "the new heightmap must be generate_heightmap() of the MERGED config",
        );

        let mut query = world.query::<&TerrainData>();
        let live = query.iter(&world).next().expect("terrain still exists");
        assert_eq!(live.seed, 999, "the patched fields must be applied");
        assert_eq!(live.height_scale, 40.0);

        assert_ne!(
            mesh_handle_of(&mut world),
            old_handle,
            "the Mesh3d handle must point at the rebuilt mesh",
        );

        let actions = drain_history(&mut world);
        assert_eq!(actions.len(), 1, "exactly one history entry per update");
        match &actions[0] {
            UndoableAction::TerrainChange {
                entity_id,
                old_terrain,
                new_terrain,
                old_mesh_data,
                new_mesh_data,
            } => {
                assert_eq!(entity_id, "terrain-1");
                assert_eq!(old_terrain.seed, 7, "old config must be preserved for undo");
                assert_eq!(new_terrain.seed, 999);
                assert_eq!(old_mesh_data.heights, before);
                assert_eq!(new_mesh_data.heights, after);
                assert_ne!(
                    old_mesh_data.heights, new_mesh_data.heights,
                    "undo needs the pre-change heightmap, not a copy of the new one",
                );
            }
            other => panic!("expected UndoableAction::TerrainChange, got {other:?}"),
        }
    }

    /// An update naming an entity that does not exist is dropped. It must not
    /// panic, must not touch the terrain that IS present, and — deliberately —
    /// must not push a history entry: an undo that restores nothing would make
    /// the next real Ctrl+Z a no-op from the user's point of view.
    #[test]
    fn update_with_unknown_entity_id_is_a_silent_no_op() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let _ = drain_history(&mut world);

        queue_update(
            &mut world,
            "does-not-exist",
            TerrainDataPatch { seed: Some(999), ..Default::default() },
        );

        assert_eq!(
            heights_of(&mut world),
            before,
            "an unmatched update must not mutate any terrain",
        );
        assert!(
            drain_history(&mut world).is_empty(),
            "an unmatched update must not push a no-op history entry",
        );
        assert!(
            world
                .resource::<PendingCommands>()
                .terrain_updates
                .is_empty(),
            "the request must be drained, not left to retry every frame",
        );
    }

    // === sculpt ===

    /// Grid geometry (resolution 8, size 7.0 => step 1.0): the brush is centred
    /// on cell (0,0) at world (-3.5,-3.5) with radius 1.5.
    ///   - cell (0,0), dist 0.0   -> full strength
    ///   - cell (1,0), dist 1.0   -> partial, strictly less than the centre
    ///   - cell (2,2), dist ~2.12 -> outside the radius, untouched
    ///   - cell (7,7)             -> far outside the brush box, untouched
    #[test]
    fn sculpt_raises_inside_the_radius_and_leaves_the_outside_untouched() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);

        world
            .resource_mut::<PendingCommands>()
            .terrain_sculpts
            .push(TerrainSculpt {
                entity_id: "terrain-1".to_string(),
                position: [-3.5, -3.5],
                radius: 1.5,
                strength: 5.0,
            });
        run_system!(&mut world, apply_terrain_sculpts);
        let after = heights_of(&mut world);

        let centre = after[0] - before[0];
        let neighbour = after[1] - before[1];

        assert!(
            centre > 0.0,
            "the brush centre must move in the direction of strength, moved {centre}",
        );
        assert!(
            (centre - 5.0).abs() < 1e-3,
            "the brush centre must receive full strength, got {centre}",
        );
        assert!(
            neighbour > 0.0,
            "a cell inside the radius must move in the direction of strength, moved {neighbour}",
        );
        assert!(
            neighbour < centre,
            "falloff must decrease outward: centre {centre}, neighbour {neighbour}",
        );
        assert_eq!(
            after[2 * 8 + 2],
            before[2 * 8 + 2],
            "a cell outside the radius (but inside the brush bounding box) must be untouched",
        );
        assert_eq!(
            after[7 * 8 + 7],
            before[7 * 8 + 7],
            "a cell far outside the brush must be untouched",
        );
    }

    /// Magnitude, not just sign. A sign-only assertion passes on a brush that
    /// applies 1% of the requested strength — the "lower terrain" tool would feel
    /// broken while the test stayed green. Matches the tolerance the sibling
    /// `terrain::sculpt_tests` assertion uses.
    #[test]
    fn sculpt_lowers_when_strength_is_negative() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);

        queue_sculpt(&mut world, "terrain-1", [-3.5, -3.5], -5.0);
        let after = heights_of(&mut world);

        let delta = after[0] - before[0];
        assert!(
            (delta + 5.0).abs() < 1e-3,
            "the brush centre must drop by the full strength, dropped {delta}",
        );
    }

    /// THE positioning contract. `sculpt_terrain`'s payload is documented as
    /// world space and every other position in the command API is world space,
    /// but `sculpt_heightmap` addresses the heightmap in terrain-LOCAL space. The
    /// drain has to convert, or a terrain moved off the origin sculpts at the
    /// wrong spot — and at any offset larger than the grid, the brush lands
    /// entirely off it and the tool does nothing at all.
    #[test]
    fn sculpt_position_is_world_space_and_is_offset_by_the_terrain_transform() {
        let mut world = base_world();
        let origin = Vec3::new(10.0, 0.0, 10.0);
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), Some(origin)));
        let before = heights_of(&mut world);

        // Grid cell (0,0) of a terrain centred on (10, 10) is at world
        // (10 - 3.5, 10 - 3.5) = (6.5, 6.5).
        queue_sculpt(&mut world, "terrain-1", [6.5, 6.5], 5.0);
        let after = heights_of(&mut world);

        let delta = after[0] - before[0];
        assert!(
            (delta - 5.0).abs() < 1e-3,
            "a world-space brush over cell (0,0) of a terrain at {origin:?} must \
             raise that cell by the full strength, raised {delta}",
        );
    }

    /// The same conversion, one frame earlier — and that one frame is the whole
    /// bug. `bridge/mod.rs` registers the terrain drains with `.chain()`, so the
    /// `ApplyDeferred` between `apply_terrain_spawn_requests` and
    /// `apply_terrain_sculpts` makes a terrain spawned this frame queryable by
    /// the sculpt drain in the same frame. But `TransformPlugin` propagates in
    /// `PostUpdate`, so the entity is visible with its `Transform` set and its
    /// `GlobalTransform` still at the identity. The world -> local conversion
    /// then ran through the wrong affine and the brush landed on the terrain's
    /// LOCAL coordinate — the exact off-by-the-offset error
    /// `sculpt_position_is_world_space_and_is_offset_by_the_terrain_transform`
    /// fixed for the second frame onward.
    ///
    /// "Spawn a terrain, then immediately raise a hill" is one chat turn, so this
    /// is the ordinary path, not a corner.
    #[test]
    fn sculpting_a_terrain_the_frame_it_spawned_still_uses_its_real_pose() {
        let mut world = base_world();
        let origin = Vec3::new(10.0, 0.0, 10.0);
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), Some(origin)));
        let before = heights_of(&mut world);

        // Same brush as the propagated test: cell (0,0) of a terrain centred on
        // (10, 10) sits at world (6.5, 6.5).
        queue_sculpt_same_frame(&mut world, "terrain-1", [6.5, 6.5], 5.0);
        let after = heights_of(&mut world);

        let delta = after[0] - before[0];
        assert!(
            (delta - 5.0).abs() < 1e-3,
            "a terrain sculpted the same frame it spawned must use the pose it \
             spawned with, not the identity; cell (0,0) rose by {delta}",
        );
    }

    /// The converse of the same-frame case: with a stale identity
    /// `GlobalTransform`, the raw local coordinate (-3.5,-3.5) hits cell (0,0)
    /// instead of missing the grid by 14 units.
    #[test]
    fn sculpting_the_spawn_frame_far_off_an_offset_terrain_changes_nothing() {
        let mut world = base_world();
        queue_spawn(
            &mut world,
            spawn_request(Some("terrain-1"), Some(Vec3::new(10.0, 0.0, 10.0))),
        );
        let before = heights_of(&mut world);

        queue_sculpt_same_frame(&mut world, "terrain-1", [-3.5, -3.5], 5.0);

        assert_eq!(
            heights_of(&mut world),
            before,
            "a same-frame brush 14 world units off the grid must change nothing",
        );
    }

    /// The converse: the brush must NOT be applied at the raw world coordinate.
    /// Pre-fix, sculpting world (-3.5,-3.5) on a terrain at (10,0,10) hit cell
    /// (0,0) — the local coordinate — instead of missing the grid entirely.
    #[test]
    fn sculpt_far_from_an_offset_terrain_changes_nothing() {
        let mut world = base_world();
        queue_spawn(
            &mut world,
            spawn_request(Some("terrain-1"), Some(Vec3::new(10.0, 0.0, 10.0))),
        );
        let before = heights_of(&mut world);
        let _ = drain_history(&mut world);

        queue_sculpt(&mut world, "terrain-1", [-3.5, -3.5], 5.0);

        assert_eq!(
            heights_of(&mut world),
            before,
            "a brush 14 world units off the grid must change nothing",
        );
        assert!(
            drain_history(&mut world).is_empty(),
            "a stroke that changed no height must not push an undo entry the user \
             then has to press Ctrl+Z twice to get past",
        );
    }

    /// `name` is a real public parameter of the `spawn_terrain` command
    /// (`core/commands/procedural.rs`) and is exposed on the MCP surface, but the
    /// shared `spawn_request()` helper always passes `None` — so the `Some` arm
    /// of the `unwrap_or_else` was never executed and a mutant that ignored
    /// `request.name` entirely passed the whole suite.
    #[test]
    fn spawn_honours_a_caller_supplied_name() {
        let mut world = base_world();
        queue_spawn(
            &mut world,
            TerrainSpawnRequest {
                name: Some("Ridge".to_string()),
                ..spawn_request(Some("terrain-1"), None)
            },
        );

        let mut query = world.query::<&EntityName>();
        let names: Vec<String> = query.iter(&world).map(|n| n.0.clone()).collect();
        assert_eq!(names, vec!["Ridge".to_string()]);
    }

    /// The other arm, so the two are distinguishable: without a name the entity
    /// takes the generated counter name rather than an empty string.
    #[test]
    fn spawn_without_a_name_uses_the_generated_counter_name() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));

        let mut query = world.query::<&EntityName>();
        let names: Vec<String> = query.iter(&world).map(|n| n.0.clone()).collect();
        assert_eq!(names, vec!["Terrain".to_string()]);
    }

    /// `Transform` is LOCAL, and `core::reparent` inserts `ChildOf` without
    /// rebasing it — so a parented terrain's `Transform` is no longer its world
    /// pose. This is not an exotic case: `create_level_layout` parents the
    /// terrain ground under the level root on every generated level, which makes
    /// the parented terrain the COMMON one. Reading `Transform` here put every
    /// subsequent sculpt on the wrong grid cell.
    #[test]
    fn sculpt_on_a_parented_terrain_uses_the_world_pose() {
        let mut world = base_world();
        // Terrain at the local origin, so `Transform` alone says "centred on 0".
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);

        // Parent it under an entity at (10, 0, 10). The terrain's own Transform
        // is untouched — only its GlobalTransform moves.
        let parent = world
            .spawn(Transform::from_translation(Vec3::new(10.0, 0.0, 10.0)))
            .id();
        let terrain = {
            let mut query = world.query::<(Entity, &EntityId)>();
            query
                .iter(&world)
                .find(|(_, id)| id.0 == "terrain-1")
                .map(|(e, _)| e)
                .expect("terrain entity")
        };
        world.entity_mut(terrain).insert(ChildOf(parent));

        // Cell (0,0) of a terrain whose WORLD centre is (10, 10) sits at
        // (6.5, 6.5). Under the pre-fix local read it sat at (-3.5, -3.5).
        queue_sculpt(&mut world, "terrain-1", [6.5, 6.5], 5.0);

        let delta = heights_of(&mut world)[0] - before[0];
        assert!(
            (delta - 5.0).abs() < 1e-3,
            "a brush over cell (0,0) of a terrain parented to (10,0,10) must raise \
             that cell by the full strength, raised {delta}",
        );
    }

    /// Rotation is real: `bridge/core_systems` applies gizmo rotation to any
    /// entity by id with no terrain exclusion, while `build_terrain_mesh` and
    /// `sculpt_heightmap` both index a grid laid out in the entity's LOCAL
    /// frame. Subtracting only the translation puts the brush on the transposed
    /// cell — silently, because `sculpt_heightmap` clamps its scan to the grid.
    #[test]
    fn sculpt_on_a_rotated_terrain_hits_the_rotated_cell() {
        use std::f32::consts::FRAC_PI_2;

        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);

        let terrain = {
            let mut query = world.query::<(Entity, &EntityId)>();
            query
                .iter(&world)
                .find(|(_, id)| id.0 == "terrain-1")
                .map(|(e, _)| e)
                .expect("terrain entity")
        };
        world
            .entity_mut(terrain)
            .insert(Transform::from_rotation(Quat::from_rotation_y(FRAC_PI_2)));

        // A +90 deg yaw maps local (x, z) -> world (z, -x). Local cell (0,0) at
        // local (-3.5, -3.5) therefore lands at world (-3.5, 3.5).
        queue_sculpt(&mut world, "terrain-1", [-3.5, 3.5], 5.0);
        let after = heights_of(&mut world);

        let delta = after[0] - before[0];
        assert!(
            (delta - 5.0).abs() < 1e-3,
            "a brush at the ROTATED world position of cell (0,0) must raise that \
             cell by the full strength, raised {delta}",
        );

        // And the naive translation-only answer must NOT have been sculpted:
        // world (-3.5, 3.5) read as a local coordinate is cell (0, 7).
        let naive = 7 * 8;
        assert!(
            (after[naive] - before[naive]).abs() < 1e-3,
            "the cell the translation-only conversion would have hit must be \
             untouched, or the rotation was ignored",
        );
    }

    /// The mesh must be rebuilt from the SCULPTED heights, not the pre-stroke
    /// ones — otherwise the stored heightmap and the rendered surface diverge and
    /// the sculpt is invisible until some later edit happens to rebuild.
    #[test]
    fn sculpt_rebuilds_the_mesh_from_the_new_heightmap() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        queue_sculpt(&mut world, "terrain-1", [-3.5, -3.5], 5.0);

        let heights = heights_of(&mut world);
        let handle = mesh_handle_of(&mut world);
        let expected = crate::core::terrain::rebuild_terrain_mesh(&TerrainMeshData {
            heights: heights.clone(),
            resolution: 8,
            size: 7.0,
        });
        let expected_positions = expected
            .attribute(Mesh::ATTRIBUTE_POSITION)
            .expect("terrain mesh must carry positions")
            .as_float3()
            .expect("positions are float3")
            .to_vec();

        let meshes = world.resource::<Assets<Mesh>>();
        let live = meshes.get(&handle).expect("Mesh3d must reference a live mesh");
        let live_positions = live
            .attribute(Mesh::ATTRIBUTE_POSITION)
            .expect("terrain mesh must carry positions")
            .as_float3()
            .expect("positions are float3")
            .to_vec();

        assert_eq!(live_positions, expected_positions);
        // The y of vertex 0 is grid cell (0,0)'s height, i.e. the brush centre.
        assert!(
            (live_positions[0][1] - heights[0]).abs() < 1e-6,
            "the rendered surface must follow the sculpted heightmap",
        );
    }

    /// A sculpt changes only the heightmap, never the noise config, so the
    /// history entry carries an unchanged TerrainData either side and a changed
    /// mesh either side.
    #[test]
    fn sculpt_pushes_terrain_change_with_unchanged_config_and_changed_mesh() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let old_handle = mesh_handle_of(&mut world);
        let _ = drain_history(&mut world);

        queue_sculpt(&mut world, "terrain-1", [-3.5, -3.5], 5.0);

        assert_ne!(
            mesh_handle_of(&mut world),
            old_handle,
            "the Mesh3d handle must point at the resculpted mesh",
        );

        let actions = drain_history(&mut world);
        assert_eq!(actions.len(), 1, "exactly one history entry per sculpt");
        match &actions[0] {
            UndoableAction::TerrainChange {
                entity_id,
                old_terrain,
                new_terrain,
                old_mesh_data,
                new_mesh_data,
            } => {
                assert_eq!(entity_id, "terrain-1");
                // Both sides pinned to the entity's REAL config. Comparing the two
                // sides only to each other passes just as well when the sculpt
                // silently rewrote both to TerrainData::default().
                for (label, data) in [("old", old_terrain), ("new", new_terrain)] {
                    assert_eq!(data.seed, 7, "{label}_terrain.seed");
                    assert_eq!(data.resolution, 8, "{label}_terrain.resolution");
                    assert_eq!(data.size, 7.0, "{label}_terrain.size");
                }
                assert_eq!(old_mesh_data.heights, before);
                assert_ne!(
                    old_mesh_data.heights, new_mesh_data.heights,
                    "the sculpt must be recorded as a heightmap change",
                );
            }
            other => panic!("expected UndoableAction::TerrainChange, got {other:?}"),
        }
    }

    #[test]
    fn sculpt_with_unknown_entity_id_is_a_silent_no_op() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let _ = drain_history(&mut world);

        queue_sculpt(&mut world, "does-not-exist", [-3.5, -3.5], 5.0);

        assert_eq!(
            heights_of(&mut world),
            before,
            "an unmatched sculpt must not mutate any terrain",
        );
        assert!(
            drain_history(&mut world).is_empty(),
            "an unmatched sculpt must not push a no-op history entry",
        );
        assert!(
            world
                .resource::<PendingCommands>()
                .terrain_sculpts
                .is_empty(),
            "the request must be drained, not left to retry every frame",
        );
    }

    // === log rendering of caller-supplied ids ===

    /// The miss paths above log the id they failed to match, and that id is
    /// caller-supplied and never validated (unlike a spawn override id). A raw
    /// newline there would forge an additional log line.
    #[test]
    fn a_logged_id_has_its_control_characters_replaced() {
        assert_eq!(
            log_safe_id("a\nWARN forged line\r\0b"),
            "a?WARN forged line??b",
        );
    }

    /// Truncation is by `char`, not byte, so a multi-byte id can never be split
    /// mid-scalar — and the ellipsis makes a clipped id distinguishable from one
    /// that merely happens to end at the bound.
    #[test]
    fn a_logged_id_is_truncated_at_the_character_bound() {
        let long = "é".repeat(LOG_ID_MAX_CHARS + 10);
        let rendered = log_safe_id(&long);
        assert_eq!(rendered.chars().count(), LOG_ID_MAX_CHARS + 1);
        assert!(rendered.ends_with('…'));
        assert_eq!(
            rendered.chars().take(LOG_ID_MAX_CHARS).collect::<String>(),
            "é".repeat(LOG_ID_MAX_CHARS),
        );
    }

    /// The boundary itself: exactly `LOG_ID_MAX_CHARS` is NOT truncated, so the
    /// marker never appears on an id that was rendered in full.
    #[test]
    fn a_logged_id_at_exactly_the_bound_is_not_marked_truncated() {
        let exact = "x".repeat(LOG_ID_MAX_CHARS);
        assert_eq!(log_safe_id(&exact), exact);
    }

    /// The ordinary case must pass through byte-for-byte — a sanitizer that
    /// mangled normal ids would make every real warning unreadable.
    #[test]
    fn a_logged_id_that_is_already_safe_is_unchanged() {
        assert_eq!(
            log_safe_id("6f9619ff-8b86-d011-b42d-00c04fc964ff"),
            "6f9619ff-8b86-d011-b42d-00c04fc964ff",
        );
    }

    // === degenerate resolution ===

    /// `build_terrain_mesh` computes `(resolution - 1)^2` quads in `usize`, so a
    /// resolution below 2 underflows and panics — which in WASM takes the whole
    /// engine down. The command layer clamps to 32/64/128/256, so this only
    /// guards a non-JS caller, but the failure mode is severe enough to pin.
    #[test]
    fn spawn_with_degenerate_resolution_is_rejected_without_panicking() {
        for resolution in [0u32, 1u32] {
            let mut world = base_world();
            world
                .resource_mut::<PendingCommands>()
                .terrain_spawn_requests
                .push(TerrainSpawnRequest {
                    name: None,
                    position: None,
                    terrain_data: TerrainData {
                        resolution,
                        ..small_terrain(7)
                    },
                    id: None,
                });
            run_system!(&mut world, apply_terrain_spawn_requests);

            assert!(
                entity_ids(&mut world).is_empty(),
                "resolution {resolution} must not spawn a degenerate terrain",
            );
            assert!(
                drain_history(&mut world).is_empty(),
                "a rejected spawn must not push history",
            );
        }
    }

    /// The same underflow is reachable through `update_terrain`, which had no
    /// test at all — the spawn-path guard proves nothing about this one.
    #[test]
    fn update_with_degenerate_resolution_is_rejected_without_panicking() {
        for resolution in [0u32, 1u32] {
            let mut world = base_world();
            queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
            let before = heights_of(&mut world);
            let _ = drain_history(&mut world);

            queue_update(
                &mut world,
                "terrain-1",
                TerrainDataPatch { resolution: Some(resolution), ..Default::default() },
            );

            assert_eq!(
                heights_of(&mut world),
                before,
                "resolution {resolution} must leave the terrain untouched",
            );
            assert!(
                drain_history(&mut world).is_empty(),
                "a rejected update must not push history",
            );
        }
    }

    /// An oversized resolution allocates `resolution^2` f32s inside a 32-bit
    /// WASM heap. 100000 is 40 GB and aborts the whole instance, taking the
    /// user's unsaved scene with it.
    #[test]
    fn update_with_an_oversized_resolution_is_rejected() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let _ = drain_history(&mut world);

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch { resolution: Some(100_000), ..Default::default() },
        );

        assert_eq!(heights_of(&mut world), before);
        assert!(drain_history(&mut world).is_empty());
    }

    // === update is a merge, not a replace ===

    /// The drain half of the patch contract: an omitted field must keep the
    /// entity's LIVE value, not fall back to `TerrainData::default()`.
    #[test]
    fn update_merges_the_patch_onto_the_live_config() {
        let mut world = base_world();
        let live = TerrainData {
            noise_type: crate::core::terrain::NoiseType::Value,
            octaves: 3,
            frequency: 0.11,
            amplitude: 0.77,
            height_scale: 12.5,
            seed: 4242,
            resolution: 8,
            size: 7.0,
        };
        world
            .resource_mut::<PendingCommands>()
            .terrain_spawn_requests
            .push(TerrainSpawnRequest {
                name: None,
                position: None,
                terrain_data: live.clone(),
                id: Some("terrain-1".to_string()),
            });
        run_system!(&mut world, apply_terrain_spawn_requests);
        let _ = drain_history(&mut world);

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch { height_scale: Some(40.0), ..Default::default() },
        );

        let mut query = world.query::<&TerrainData>();
        let after = query.iter(&world).next().expect("terrain still exists");
        assert_eq!(after.height_scale, 40.0, "the patched field must move");
        assert_eq!(after.seed, 4242, "an omitted field must keep its live value");
        assert_eq!(after.noise_type, crate::core::terrain::NoiseType::Value);
        assert_eq!(after.octaves, 3);
        assert_eq!(after.frequency, 0.11);
        assert_eq!(after.amplitude, 0.77);
        assert_eq!(after.resolution, 8);
        assert_eq!(after.size, 7.0);
    }

    /// An update that changes nothing must not cost the user an undo press.
    #[test]
    fn update_with_an_empty_patch_pushes_no_history() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before = heights_of(&mut world);
        let _ = drain_history(&mut world);

        queue_update(&mut world, "terrain-1", TerrainDataPatch::default());

        assert_eq!(heights_of(&mut world), before);
        assert!(
            drain_history(&mut world).is_empty(),
            "a no-op update must not push a history entry",
        );
    }

    // === mesh handle lifetime ===

    /// `Assets::remove` is REFCOUNT-BLIND: it deletes the asset outright no
    /// matter how many live `Handle<Mesh>`es still point at it. Terrain mesh
    /// handles are NOT exclusively owned — `apply_duplicate_requests` clones the
    /// source's handle straight onto the duplicate — so an explicit remove on
    /// update/sculpt deleted the *duplicate's* mesh too, and the duplicate
    /// rendered as nothing.
    ///
    /// The correct release path is dropping the handle and letting
    /// `Assets::<Mesh>::track_assets` (registered in `PreUpdate` by
    /// `init_asset`) reclaim it once the refcount actually hits zero.
    #[test]
    fn updating_a_terrain_does_not_delete_a_mesh_another_entity_still_holds() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));

        // Mirror what `apply_duplicate_requests` does: clone the handle onto a
        // second entity.
        let shared = mesh_handle_of(&mut world);
        world.spawn(Mesh3d(shared.clone()));

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch { seed: Some(999), ..Default::default() },
        );

        assert!(
            world.resource::<Assets<Mesh>>().get(&shared).is_some(),
            "the duplicate's mesh must survive an edit to the original",
        );
    }

    #[test]
    fn sculpting_a_terrain_does_not_delete_a_mesh_another_entity_still_holds() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));

        let shared = mesh_handle_of(&mut world);
        world.spawn(Mesh3d(shared.clone()));

        queue_sculpt(&mut world, "terrain-1", [-3.5, -3.5], 5.0);

        assert!(
            world.resource::<Assets<Mesh>>().get(&shared).is_some(),
            "the duplicate's mesh must survive a sculpt of the original",
        );
    }

    /// The measurement behind the fix: in a real `App` (where `AssetPlugin`
    /// registers `Assets::<Mesh>::track_assets` in `PreUpdate`), dropping the
    /// last handle DOES free the asset. So the superseded mesh is reclaimed
    /// without an explicit refcount-blind `remove`, and nothing leaks.
    #[test]
    fn dropping_the_last_handle_frees_the_asset_without_an_explicit_remove() {
        use bevy::asset::AssetPlugin;

        let mut app = App::new();
        app.add_plugins((bevy::app::TaskPoolPlugin::default(), AssetPlugin::default()));
        app.init_asset::<Mesh>();

        let handle = app
            .world_mut()
            .resource_mut::<Assets<Mesh>>()
            .add(Mesh::new(
                bevy::mesh::PrimitiveTopology::TriangleList,
                bevy::asset::RenderAssetUsages::default(),
            ));
        let id = handle.id();
        app.update();
        assert_eq!(
            app.world().resource::<Assets<Mesh>>().len(),
            1,
            "sanity: the asset is live while a handle exists",
        );

        drop(handle);
        // track_assets drains the drop channel; give it a couple of frames since
        // the drop notification is delivered asynchronously.
        app.update();
        app.update();

        assert!(
            app.world().resource::<Assets<Mesh>>().get(id).is_none(),
            "dropping the last handle must free the asset via track_assets — this \
             is why an explicit refcount-blind remove is unnecessary AND unsafe",
        );
    }

    // === undo / redo of UndoableAction::TerrainChange ===
    //
    // The drains push this action; nothing in the suite ever executed it. Its
    // undo arm restores THREE things that can each be wrong independently — the
    // noise config, the heightmap, and the rendered mesh — and a partial restore
    // is invisible in the inspector (which reads the config) or in the viewport
    // (which reads the mesh), but never in both at once.

    fn undo(world: &mut World) {
        crate::core::history::queue_undo_from_bridge();
        run_system!(world, super::apply_undo_requests);
    }

    fn redo(world: &mut World) {
        crate::core::history::queue_redo_from_bridge();
        run_system!(world, super::apply_redo_requests);
    }

    fn config_of(world: &mut World) -> TerrainData {
        let mut query = world.query::<&TerrainData>();
        query
            .iter(world)
            .next()
            .expect("expected exactly one terrain entity")
            .clone()
    }

    /// Vertex count of whatever mesh the entity's `Mesh3d` currently names.
    /// Panics if the handle is dangling, which is the whole point: a restore
    /// that leaves `Mesh3d` pointing at a freed asset renders as nothing.
    fn live_mesh_vertex_count(world: &mut World) -> usize {
        let handle = mesh_handle_of(world);
        world
            .resource::<Assets<Mesh>>()
            .get(&handle)
            .expect("Mesh3d must name a LIVE mesh asset after undo/redo")
            .count_vertices()
    }

    #[test]
    fn undoing_an_update_restores_the_config_the_heightmap_and_the_mesh() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before_heights = heights_of(&mut world);
        let before_config = config_of(&mut world);

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch {
                seed: Some(999),
                height_scale: Some(40.0),
                ..Default::default()
            },
        );
        let after_heights = heights_of(&mut world);
        assert_ne!(before_heights, after_heights, "sanity: the update changed something");

        undo(&mut world);

        assert_eq!(
            config_of(&mut world),
            before_config,
            "undo must restore the WHOLE previous config, not just the fields the \
             patch happened to name",
        );
        assert_eq!(
            heights_of(&mut world),
            before_heights,
            "undo must restore the pre-change heightmap — leaving the new one \
             makes the inspector and the viewport disagree",
        );
        assert_eq!(
            live_mesh_vertex_count(&mut world),
            8 * 8,
            "undo must rebuild the render mesh from the restored heightmap",
        );
    }

    #[test]
    fn redoing_an_update_reapplies_the_config_the_heightmap_and_the_mesh() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch {
                seed: Some(999),
                height_scale: Some(40.0),
                ..Default::default()
            },
        );
        let after_config = config_of(&mut world);
        let after_heights = heights_of(&mut world);

        undo(&mut world);
        redo(&mut world);

        assert_eq!(config_of(&mut world), after_config, "redo must reapply the new config");
        assert_eq!(
            heights_of(&mut world),
            after_heights,
            "redo must reapply the new heightmap",
        );
        assert_eq!(live_mesh_vertex_count(&mut world), 8 * 8);
    }

    /// Undo then redo then undo again. The redo arm re-pushes onto the undo
    /// stack, so a bug that pushes the WRONG side of the action (or drops it)
    /// only shows on the second undo.
    #[test]
    fn undo_redo_undo_lands_back_on_the_original_terrain() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before_heights = heights_of(&mut world);
        let before_config = config_of(&mut world);

        queue_update(
            &mut world,
            "terrain-1",
            TerrainDataPatch { seed: Some(999), ..Default::default() },
        );

        undo(&mut world);
        redo(&mut world);
        undo(&mut world);

        assert_eq!(config_of(&mut world), before_config);
        assert_eq!(heights_of(&mut world), before_heights);
    }

    /// A sculpt records the same action type, but its `old_terrain` and
    /// `new_terrain` are IDENTICAL (sculpting edits the heightmap, not the noise
    /// config). An undo arm that only restored the config would score green on
    /// the update tests above and still lose every brush stroke.
    #[test]
    fn undoing_a_sculpt_restores_the_pre_sculpt_heightmap() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(Some("terrain-1"), None));
        let before_heights = heights_of(&mut world);

        queue_sculpt(&mut world, "terrain-1", [0.0, 0.0], 5.0);
        let sculpted = heights_of(&mut world);
        assert_ne!(before_heights, sculpted, "sanity: the sculpt moved vertices");

        undo(&mut world);

        assert_eq!(
            heights_of(&mut world),
            before_heights,
            "undo must restore the pre-sculpt heightmap",
        );
        assert_eq!(
            live_mesh_vertex_count(&mut world),
            8 * 8,
            "undo must rebuild the render mesh, not just the data component",
        );

        redo(&mut world);
        assert_eq!(heights_of(&mut world), sculpted, "redo must reapply the brush stroke");
    }
}

/// Round-trip coverage for the terrain half of a scene save/load.
///
/// The scene exporter builds an `EntitySnapshot` per entity and `spawn_from_snapshot`
/// rebuilds from it. These tests pin what a terrain snapshot MUST carry, because the
/// failure mode when it does not is silent: the entity comes back with the right name
/// and the right `EntityType::Terrain`, just as a flat 2x2 plane.
#[cfg(test)]
mod terrain_snapshot_round_trip_tests {
    use super::{spawn_from_snapshot, EntitySnapshot, EntityType, TransformSnapshot};
    use crate::core::terrain::{generate_heightmap, TerrainData, TerrainEnabled, TerrainMeshData};
    use bevy::prelude::*;

    fn terrain_config() -> TerrainData {
        TerrainData {
            resolution: 8,
            size: 7.0,
            seed: 4242,
            height_scale: 12.5,
            ..Default::default()
        }
    }

    fn base_snapshot() -> EntitySnapshot {
        EntitySnapshot::new(
            "terrain-1".to_string(),
            EntityType::Terrain,
            "Terrain".to_string(),
            TransformSnapshot {
                position: [1.0, 2.0, 3.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        )
    }

    /// Runs `spawn_from_snapshot` against a minimal World and returns it.
    fn restore(snapshot: EntitySnapshot) -> World {
        let mut world = World::new();
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());

        let mut schedule = Schedule::default();
        schedule.add_systems(
            move |mut commands: Commands,
                  mut meshes: ResMut<Assets<Mesh>>,
                  mut materials: ResMut<Assets<StandardMaterial>>| {
                spawn_from_snapshot(&mut commands, &mut meshes, &mut materials, &snapshot);
            },
        );
        schedule.run(&mut world);
        world
    }

    #[test]
    fn a_snapshot_carrying_both_terrain_fields_restores_the_terrain_exactly() {
        let config = terrain_config();
        let mesh_data = TerrainMeshData {
            heights: generate_heightmap(&config),
            resolution: config.resolution,
            size: config.size,
        };

        let mut snapshot = base_snapshot();
        snapshot.terrain_data = Some(config.clone());
        snapshot.terrain_mesh_data = Some(mesh_data.clone());

        let mut world = restore(snapshot);

        let mut query =
            world.query::<(&TerrainData, &TerrainMeshData, &TerrainEnabled, &Transform)>();
        let (restored_config, restored_mesh, _, transform) = query
            .iter(&world)
            .next()
            .expect("a terrain snapshot must restore a terrain entity");

        assert_eq!(*restored_config, config, "the noise config must survive");
        assert_eq!(
            restored_mesh.heights, mesh_data.heights,
            "the sculpted heightmap must survive verbatim — regenerating it from the \
             noise config would silently discard every sculpt stroke",
        );
        assert_eq!(restored_mesh.resolution, 8);
        assert_eq!(restored_mesh.size, 7.0);
        assert_eq!(transform.translation, Vec3::new(1.0, 2.0, 3.0));
    }

    /// The failure this pins down: an exporter that omits `terrain_mesh_data`
    /// produces a snapshot that restores as a FLAT PLANE with no terrain
    /// components at all — and reports no error at any layer.
    #[test]
    fn a_snapshot_missing_the_mesh_data_degrades_to_a_flat_plane() {
        let mut snapshot = base_snapshot();
        snapshot.terrain_data = Some(terrain_config());
        snapshot.terrain_mesh_data = None;

        let mut world = restore(snapshot);

        let mut terrain_query = world.query::<&TerrainMeshData>();
        assert_eq!(
            terrain_query.iter(&world).count(),
            0,
            "this is the data loss: no heightmap comes back",
        );
        let mut enabled_query = world.query::<&TerrainEnabled>();
        assert_eq!(enabled_query.iter(&world).count(), 0);
        let mut config_query = world.query::<&TerrainData>();
        assert_eq!(
            config_query.iter(&world).count(),
            0,
            "the noise config is dropped too, so the terrain cannot even be regenerated",
        );

        // The entity itself still exists and still claims to be a terrain, which is
        // exactly why the loss is invisible in the UI.
        let mut type_query = world.query::<&EntityType>();
        assert_eq!(
            type_query.iter(&world).next().copied(),
            Some(EntityType::Terrain),
        );
    }
}

/// Coverage for the export half of a scene save.
///
/// `terrain_snapshot_round_trip_tests` above pins what `spawn_from_snapshot`
/// does with a snapshot that carries terrain. These pin that the exporter
/// actually PUTS the terrain there — the failure this branch fixes was silent
/// in exactly that gap: every load-side test passed while the saved file
/// carried no terrain at all.
#[cfg(test)]
mod terrain_snapshot_export_tests {
    use super::{apply_terrain_to_snapshot, EntitySnapshot, EntityType, TransformSnapshot};
    use crate::core::terrain::{TerrainData, TerrainMeshData};

    fn blank_snapshot() -> EntitySnapshot {
        EntitySnapshot::new(
            "terrain-1".to_string(),
            EntityType::Terrain,
            "Terrain".to_string(),
            TransformSnapshot {
                position: [0.0; 3],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0; 3],
            },
        )
    }

    #[test]
    fn both_terrain_components_are_copied_onto_the_snapshot() {
        let data = TerrainData { resolution: 8, size: 7.0, seed: 4242, ..Default::default() };
        let mesh = TerrainMeshData { resolution: 8, size: 7.0, heights: vec![0.5; 8 * 8] };

        let mut snap = blank_snapshot();
        apply_terrain_to_snapshot(&mut snap, Some(&data), Some(&mesh));

        assert_eq!(
            snap.terrain_data.as_ref(),
            Some(&data),
            "the noise config was dropped — the reloaded terrain cannot be regenerated",
        );
        assert_eq!(
            snap.terrain_mesh_data.as_ref(),
            Some(&mesh),
            "the heightmap was dropped — every sculpt stroke is lost on save",
        );
    }

    /// The overwhelming majority of entities are not terrain, and the exporter
    /// runs this for all of them. Writing `Some(default())` there would give
    /// every cube a terrain component on reload.
    #[test]
    fn a_non_terrain_entity_gets_neither_component() {
        let mut snap = blank_snapshot();
        apply_terrain_to_snapshot(&mut snap, None, None);

        assert!(snap.terrain_data.is_none());
        assert!(snap.terrain_mesh_data.is_none());
    }

    /// A terrain that has never been sculpted has config but no baked heightmap,
    /// and vice versa is reachable from an older save. Neither arm may be
    /// promoted to a default.
    #[test]
    fn each_component_is_carried_independently() {
        let data = TerrainData::default();
        let mut config_only = blank_snapshot();
        apply_terrain_to_snapshot(&mut config_only, Some(&data), None);
        assert!(config_only.terrain_data.is_some());
        assert!(config_only.terrain_mesh_data.is_none());

        let mesh = TerrainMeshData { resolution: 4, size: 2.0, heights: vec![1.0; 16] };
        let mut mesh_only = blank_snapshot();
        apply_terrain_to_snapshot(&mut mesh_only, None, Some(&mesh));
        assert!(mesh_only.terrain_data.is_none());
        assert!(mesh_only.terrain_mesh_data.is_some());
    }

    /// The tests above only mean anything if the exporter still calls the helper.
    /// `bridge/scene_io.rs` is wasm32-only, so this reads its source text — the
    /// same constraint (and the same weakness) as
    /// `bridge_registration_pin_tests`.
    #[test]
    fn the_scene_exporter_calls_the_helper() {
        const SCENE_IO_SRC: &str = include_str!("../bridge/scene_io.rs");
        assert!(
            SCENE_IO_SRC.contains("entity_factory::apply_terrain_to_snapshot("),
            "the scene exporter no longer populates terrain on the snapshot; saved terrain \
             reloads as a flat 2x2 plane and nothing else fails",
        );
    }
}

/// Source pin for the bridge-side registration of the terrain pipeline.
///
/// `engine/src/lib.rs` gates `pub mod bridge` behind
/// `#[cfg(target_arch = "wasm32")]`, so a `#[cfg(test)]` module inside
/// `bridge/` never compiles under native `cargo test` — it matches zero tests
/// and reports green while covering nothing. There is no `wasm_bindgen_test`
/// harness anywhere in this repo either. Reading the source text is therefore
/// the only way to pin the registration natively.
///
/// This is deliberately a weak test: it proves the identifiers are present, in
/// the required relative order, inside one chained `add_systems` call — NOT
/// that the schedule Bevy actually builds is correct. It exists because the
/// alternative is zero coverage of the single line that makes every terrain
/// command reach an entity. Delete `apply_terrain_spawn_requests` from that
/// tuple and every test in `terrain_drain_tests` still passes while live
/// terrain creation silently becomes a no-op again — which is precisely the
/// bug this work fixes.
#[cfg(test)]
mod bridge_registration_pin_tests {
    /// `include_str!` rather than a runtime read on purpose: if `bridge/mod.rs`
    /// is moved or renamed, that is a compile error here instead of a test that
    /// quietly stops covering the boundary.
    const BRIDGE_SRC: &str = include_str!("../bridge/mod.rs");

    /// The five systems that carry a terrain command from the pending queue to
    /// the JS shell, in the order they MUST run. `collect_terrain_changes`
    /// reads `Changed<TerrainData>`, so it has to run after the three drains
    /// that write it; `emit_terrain_changes` drains what it collected.
    const TERRAIN_PIPELINE: [&str; 5] = [
        "entity_factory::apply_terrain_spawn_requests",
        "entity_factory::apply_terrain_updates",
        "entity_factory::apply_terrain_sculpts",
        "core::terrain::collect_terrain_changes",
        "procedural::emit_terrain_changes",
    ];

    /// Byte offset of `needle`, asserting it appears exactly once. Uniqueness is
    /// load-bearing: with two occurrences the ordering assertion below would be
    /// comparing whichever pair `find` happened to reach first.
    fn sole_offset(needle: &str) -> usize {
        let first = BRIDGE_SRC.find(needle).unwrap_or_else(|| {
            panic!(
                "`{needle}` is not registered in bridge/mod.rs — the terrain command it \
                 serves is accepted, acknowledged, and silently dropped",
            )
        });
        assert!(
            BRIDGE_SRC[first + needle.len()..].find(needle).is_none(),
            "`{needle}` appears more than once in bridge/mod.rs; this pin assumes a single \
             registration site",
        );
        first
    }

    #[test]
    fn every_terrain_pipeline_system_is_registered() {
        for needle in TERRAIN_PIPELINE {
            sole_offset(needle);
        }
    }

    #[test]
    fn terrain_pipeline_systems_are_registered_in_execution_order() {
        let offsets: Vec<usize> = TERRAIN_PIPELINE.iter().map(|n| sole_offset(n)).collect();
        for window in offsets.windows(2) {
            assert!(
                window[0] < window[1],
                "terrain pipeline systems are registered out of order — a collector that runs \
                 before its drains emits the change one frame late, or never",
            );
        }
    }

    /// Order in the source only implies order at runtime because the whole tuple
    /// is `.chain()`ed. Split across two `add_systems` calls, or with the
    /// `.chain()` dropped, Bevy is free to run them in any order.
    #[test]
    fn terrain_pipeline_is_registered_as_one_chained_call() {
        let first = sole_offset(TERRAIN_PIPELINE[0]);
        let last = sole_offset(TERRAIN_PIPELINE[4]);

        assert!(
            !BRIDGE_SRC[first..last].contains("add_systems"),
            "the terrain pipeline is split across more than one `add_systems` call, so \
             `.chain()` no longer orders it end to end",
        );

        // Everything from the last system up to the next registration belongs to
        // this one call.
        let tail = &BRIDGE_SRC[last..];
        let call_end = tail.find("add_systems").unwrap_or(tail.len());
        let call = &tail[..call_end];

        assert!(
            call.contains(".chain()"),
            "the terrain pipeline tuple is not `.chain()`ed — Bevy may run the collector \
             before the drains that feed it",
        );
        assert!(
            call.contains("in_set(EditorSystemSet)"),
            "the terrain pipeline is not confined to `EditorSystemSet`, so terrain edits \
             would keep applying in Play mode",
        );
    }

    /// `collect_terrain_changes` takes `ResMut<TerrainChangeEvents>`. Without the
    /// resource initialised, that is a missing-resource panic at run time, not a
    /// compile error.
    #[test]
    fn the_terrain_change_events_resource_is_initialised() {
        assert!(
            BRIDGE_SRC.contains("init_resource::<core::terrain::TerrainChangeEvents>()"),
            "TerrainChangeEvents is never initialised; `collect_terrain_changes` panics on \
             the first frame it runs",
        );
    }
}

#[cfg(test)]
mod reverb_zone_history_tests {
    //! Undo/redo of a reverb zone must restore the RECORDED enablement, not
    //! infer it from "data is present".
    //!
    //! Two distinct failures motivate these: the PF-1173 class, where the arms
    //! inserted `ReverbZoneEnabled` unconditionally and so switched a zone on
    //! that the user had deliberately turned off; and reverb removal, which
    //! PF-1182 makes undoable for the first time — a data-only restore would
    //! bring the zone back invisibly disabled, and because
    //! `ReverbZoneInspector` gates its editing controls on the enabled flag, the
    //! user would be looking at "Add Reverb Zone" with a configured zone sitting
    //! underneath it.

    use super::{apply_redo_requests, apply_undo_requests, HistoryStack, UndoableAction};
    use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
    use crate::core::history::{queue_redo_from_bridge, queue_undo_from_bridge};
    use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled, ReverbZoneResync};
    use bevy::prelude::*;

    /// A zone distinguishable from `ReverbZoneData::default()` in every field a
    /// test reads, so "restored the recorded data" cannot pass by accident.
    fn cave() -> ReverbZoneData {
        ReverbZoneData {
            preset: "cave".to_string(),
            wet_mix: 0.9,
            ..Default::default()
        }
    }

    /// World carrying exactly the resources `apply_undo_requests` /
    /// `apply_redo_requests` read, plus one entity with the components their
    /// primary query requires.
    fn world_with(data: Option<ReverbZoneData>, enabled: bool) -> (World, Entity) {
        let mut world = World::new();
        world.insert_resource(HistoryStack::default());
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());

        let mut entity = world.spawn((
            EntityId("zone-1".to_string()),
            EntityName("Zone".to_string()),
            EntityVisible(true),
            Transform::default(),
        ));
        if let Some(d) = data {
            entity.insert(d);
        }
        if enabled {
            entity.insert(ReverbZoneEnabled);
        }
        let id = entity.id();
        (world, id)
    }

    /// Run one system once through a Schedule, which also flushes the deferred
    /// `Commands` the undo arms queue — without the flush every assertion below
    /// would read the pre-undo state and pass vacuously.
    fn run_once(world: &mut World, system: fn(Commands, ResMut<HistoryStack>, Query<(Entity, &EntityId, &mut Transform, &mut EntityName, &mut EntityVisible)>, Query<(&EntityId, &mut crate::core::material::MaterialData)>, Query<(&EntityId, &mut crate::core::lighting::LightData)>, Query<(&EntityId, &mut crate::core::physics::PhysicsData)>, Query<(Entity, &EntityId, Option<&crate::core::scripting::ScriptData>)>, Query<(Entity, &EntityId, Option<&crate::core::audio::AudioData>)>, Query<(Entity, &EntityId, Option<&crate::core::particles::ParticleData>)>, ResMut<Assets<Mesh>>, ResMut<Assets<StandardMaterial>>)) {
        let mut schedule = Schedule::default();
        schedule.add_systems(system);
        schedule.run(world);
    }

    fn undo(world: &mut World) {
        queue_undo_from_bridge();
        run_once(world, apply_undo_requests);
    }

    fn redo(world: &mut World) {
        queue_redo_from_bridge();
        run_once(world, apply_redo_requests);
    }

    fn state(world: &World, entity: Entity) -> (Option<ReverbZoneData>, bool) {
        (
            world.get::<ReverbZoneData>(entity).cloned(),
            world.get::<ReverbZoneEnabled>(entity).is_some(),
        )
    }

    /// A property edit on a DISABLED zone: undoing it must not start the reverb.
    #[test]
    fn undoing_a_property_edit_leaves_a_disabled_zone_disabled() {
        let edited = ReverbZoneData { wet_mix: 0.2, ..cave() };
        let (mut world, entity) = world_with(Some(edited), false);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: Some(ReverbZoneData { wet_mix: 0.2, ..cave() }),
            old_enabled: false,
            new_enabled: false,
        });

        undo(&mut world);

        assert_eq!(state(&world, entity), (Some(cave()), false));
    }

    /// The redo mirror — the two arms are separate code and each has to be right.
    #[test]
    fn redoing_a_property_edit_leaves_a_disabled_zone_disabled() {
        let (mut world, entity) = world_with(Some(cave()), false);
        let edited = ReverbZoneData { wet_mix: 0.2, ..cave() };
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: Some(edited.clone()),
            old_enabled: false,
            new_enabled: false,
        });

        undo(&mut world);
        redo(&mut world);

        assert_eq!(state(&world, entity), (Some(edited), false));
    }

    /// The opposite direction: "don't touch the marker" must not decay into
    /// "lose the reverb" for a zone that was enabled all along.
    #[test]
    fn undo_and_redo_preserve_an_enabled_zone() {
        let edited = ReverbZoneData { wet_mix: 0.2, ..cave() };
        let (mut world, entity) = world_with(Some(edited.clone()), true);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: Some(edited.clone()),
            old_enabled: true,
            new_enabled: true,
        });

        undo(&mut world);
        assert_eq!(state(&world, entity), (Some(cave()), true));

        redo(&mut world);
        assert_eq!(state(&world, entity), (Some(edited), true));
    }

    /// Removal is undoable as of PF-1182, and it has to come back ENABLED —
    /// restoring the data alone would leave the inspector showing "Add Reverb
    /// Zone" over a zone that is really there.
    #[test]
    fn undoing_a_removal_brings_the_zone_back_enabled() {
        let (mut world, entity) = world_with(None, false);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: None,
            old_enabled: true,
            new_enabled: false,
        });

        undo(&mut world);

        assert_eq!(state(&world, entity), (Some(cave()), true));
    }

    /// Redoing that removal clears both components again.
    #[test]
    fn redoing_a_removal_clears_the_data_and_the_marker() {
        let (mut world, entity) = world_with(None, false);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: None,
            old_enabled: true,
            new_enabled: false,
        });

        undo(&mut world);
        redo(&mut world);

        assert_eq!(state(&world, entity), (None, false));
    }

    /// Undoing the AUTHORING of a zone removes it entirely: there was nothing
    /// there before, so an enabled marker must not survive.
    #[test]
    fn undoing_the_creation_of_a_zone_removes_both_components() {
        let (mut world, entity) = world_with(Some(cave()), true);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: None,
            new_reverb: Some(cave()),
            old_enabled: false,
            new_enabled: true,
        });

        undo(&mut world);

        assert_eq!(state(&world, entity), (None, false));
    }

    // -- the browser has to be told, and only these arms can tell it ---------

    /// Run `body` with a live pending queue registered, and hand back the reverb
    /// resyncs it collected.
    ///
    /// The registration is not ceremony. `with_pending` reaches a thread-local
    /// raw pointer that only the bridge's `Startup` system sets in production, so
    /// an unregistered push is a SILENT no-op — a test that skipped this would
    /// assert an empty queue and pass no matter what the arms did.
    fn resyncs_from(body: impl FnOnce()) -> Vec<ReverbZoneResync> {
        struct PendingGuard;
        impl Drop for PendingGuard {
            fn drop(&mut self) {
                crate::core::pending::unregister_pending_commands();
            }
        }

        let mut pending = crate::core::pending::PendingCommands::default();
        crate::core::pending::register_pending_commands(&mut pending as *mut _);
        let guard = PendingGuard;
        body();
        // Clear the pointer before `pending` is moved out of this frame, and even
        // if `body` unwound.
        drop(guard);
        pending.reverb_zone_resyncs
    }

    /// Undoing a creation is the case no `Changed<ReverbZoneData>` watcher can
    /// ever see: the component is GONE, so the only way the browser learns to
    /// drop its copy is this arm queueing the re-report itself.
    #[test]
    fn undoing_a_creation_queues_a_removal_resync() {
        let (mut world, _) = world_with(Some(cave()), true);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: None,
            new_reverb: Some(cave()),
            old_enabled: false,
            new_enabled: true,
        });

        let queued = resyncs_from(|| undo(&mut world));

        assert_eq!(
            queued,
            vec![ReverbZoneResync {
                entity_id: "zone-1".to_string(),
                data: None,
                enabled: false,
            }]
        );
    }

    /// Undo carries the pre-state and redo the post-state, and each resync
    /// carries the data the arm WROTE — never an entity id to be re-read, since
    /// the drain runs in a different system and `Commands` are deferred.
    #[test]
    fn undo_and_redo_of_a_removal_queue_the_state_each_one_wrote() {
        let (mut world, _) = world_with(None, false);
        world.resource_mut::<HistoryStack>().push(UndoableAction::ReverbZoneChange {
            entity_id: "zone-1".to_string(),
            old_reverb: Some(cave()),
            new_reverb: None,
            old_enabled: true,
            new_enabled: false,
        });

        assert_eq!(
            resyncs_from(|| undo(&mut world)),
            vec![ReverbZoneResync {
                entity_id: "zone-1".to_string(),
                data: Some(cave()),
                enabled: true,
            }]
        );

        assert_eq!(
            resyncs_from(|| redo(&mut world)),
            vec![ReverbZoneResync {
                entity_id: "zone-1".to_string(),
                data: None,
                enabled: false,
            }]
        );
    }
}


#[cfg(test)]
mod physics2d_history_tests {
    //! `Physics2dChange` records a change to `Physics2dData` and nothing else.
    //! Enablement lives in the separate `Physics2dEnabled` marker, toggled by
    //! its own command. Both history arms used to insert that marker alongside
    //! the restored data, so undoing any 2D property edit silently switched
    //! physics ON for an entity the user had deliberately disabled — and the
    //! inspector reads the data, not the marker, so nothing showed it.

    use super::{HistoryStack, UndoableAction};
    use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
    use crate::core::physics_2d::{Physics2dData, Physics2dEnabled};
    use bevy::prelude::*;

    macro_rules! run_system {
        ($world:expr, $system:expr) => {{
            let mut schedule = Schedule::default();
            schedule.add_systems($system);
            schedule.run($world);
        }};
    }

    /// Exactly the resources `apply_undo_requests` / `apply_redo_requests` read.
    fn base_world() -> World {
        let mut world = World::new();
        world.insert_resource(HistoryStack::default());
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world
    }

    /// `mass` is deliberately off `Physics2dData::default()` (1.0), and every
    /// caller passes a `friction` off the default (0.5) too. Without that, a
    /// regression replacing `insert(pd.clone())` with `insert(default())` would
    /// satisfy these assertions by coincidence instead of failing them — the
    /// fixture has to differ from the default on the fields it asserts, or it
    /// cannot tell "restored the recorded data" from "inserted a blank struct".
    fn physics(friction: f32) -> Physics2dData {
        Physics2dData { friction, mass: 3.5, ..Default::default() }
    }

    /// Spawn an entity carrying everything the undo systems' main query needs.
    /// `enabled` decides whether the `Physics2dEnabled` marker is present —
    /// i.e. whether the body is simulating.
    fn spawn_body(world: &mut World, id: &str, data: Physics2dData, enabled: bool) -> Entity {
        let entity = world
            .spawn((
                EntityId(id.to_string()),
                EntityName(id.to_string()),
                EntityVisible(true),
                Transform::default(),
                data,
            ))
            .id();
        if enabled {
            world.entity_mut(entity).insert(Physics2dEnabled);
        }
        entity
    }

    fn record_edit(world: &mut World, id: &str, old: Option<Physics2dData>, new: Option<Physics2dData>) {
        world
            .resource_mut::<HistoryStack>()
            .push(UndoableAction::Physics2dChange {
                entity_id: id.to_string(),
                old_physics: old,
                new_physics: new,
            });
    }

    fn record_toggle(
        world: &mut World,
        id: &str,
        old: Option<Physics2dData>,
        new: Option<Physics2dData>,
        old_enabled: bool,
        new_enabled: bool,
    ) {
        world
            .resource_mut::<HistoryStack>()
            .push(UndoableAction::Physics2dToggle {
                entity_id: id.to_string(),
                old_physics: old,
                new_physics: new,
                old_enabled,
                new_enabled,
            });
    }

    fn undo(world: &mut World) {
        crate::core::history::queue_undo_from_bridge();
        run_system!(world, super::apply_undo_requests);
    }

    fn redo(world: &mut World) {
        crate::core::history::queue_redo_from_bridge();
        run_system!(world, super::apply_redo_requests);
    }

    fn friction_of(world: &World, entity: Entity) -> f32 {
        world
            .entity(entity)
            .get::<Physics2dData>()
            .expect("Physics2dData must still be present")
            .friction
    }

    fn mass_of(world: &World, entity: Entity) -> f32 {
        world
            .entity(entity)
            .get::<Physics2dData>()
            .expect("Physics2dData must still be present")
            .mass
    }

    fn is_enabled(world: &World, entity: Entity) -> bool {
        world.entity(entity).contains::<Physics2dEnabled>()
    }

    #[test]
    fn undoing_a_property_edit_leaves_a_disabled_body_disabled() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", physics(0.9), false);
        record_edit(&mut world, "sprite-1", Some(physics(0.25)), Some(physics(0.9)));

        undo(&mut world);

        assert_eq!(friction_of(&world, entity), 0.25, "undo must restore the old friction");
        assert_eq!(
            mass_of(&world, entity),
            3.5,
            "undo must restore the recorded struct, not insert a default one",
        );
        assert!(
            !is_enabled(&world, entity),
            "undo restores DATA; it must not switch 2D physics on for an entity the user disabled",
        );
    }

    #[test]
    fn redoing_a_property_edit_leaves_a_disabled_body_disabled() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", physics(0.9), false);
        record_edit(&mut world, "sprite-1", Some(physics(0.25)), Some(physics(0.9)));

        undo(&mut world);
        redo(&mut world);

        assert_eq!(friction_of(&world, entity), 0.9, "redo must reapply the new friction");
        assert_eq!(
            mass_of(&world, entity),
            3.5,
            "redo must reapply the recorded struct, not insert a default one",
        );
        assert!(
            !is_enabled(&world, entity),
            "redo restores DATA; the enabled marker is not part of this action either",
        );
    }

    /// The other direction of the same rule: not touching the marker must not
    /// mean an enabled body loses its simulation on undo.
    #[test]
    fn undo_and_redo_preserve_an_enabled_body() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", physics(0.9), true);
        record_edit(&mut world, "sprite-1", Some(physics(0.25)), Some(physics(0.9)));

        undo(&mut world);
        assert_eq!(friction_of(&world, entity), 0.25);
        assert!(is_enabled(&world, entity), "an enabled body must stay enabled across undo");

        redo(&mut world);
        assert_eq!(friction_of(&world, entity), 0.9);
        assert!(is_enabled(&world, entity), "an enabled body must stay enabled across redo");
    }

    /// `old_physics: None` means the entity had no 2D body at record time, so
    /// undo removes the data — and the marker with it, since an enabled marker
    /// with no data is a state no command can produce.
    #[test]
    fn undoing_to_no_recorded_data_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", physics(0.9), true);
        record_edit(&mut world, "sprite-1", None, Some(physics(0.9)));

        undo(&mut world);

        assert!(
            world.entity(entity).get::<Physics2dData>().is_none(),
            "undo must remove the data when none was recorded",
        );
        assert!(
            !is_enabled(&world, entity),
            "the enabled marker must not outlive the data it describes",
        );
    }

    /// The redo mirror of the branch above: `new_physics: None` means the edit
    /// being reapplied removed the body, so redo must clear the data and take
    /// the marker with it. Without this case the `None` arm of `execute_redo`
    /// is untested — all three redo tests above go through `Some`.
    #[test]
    fn redoing_to_no_new_data_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", physics(0.25), true);
        record_edit(&mut world, "sprite-1", Some(physics(0.25)), None);

        undo(&mut world);
        redo(&mut world);

        assert!(
            world.entity(entity).get::<Physics2dData>().is_none(),
            "redo must remove the data when the edit being reapplied removed it",
        );
        assert!(
            !is_enabled(&world, entity),
            "the enabled marker must not outlive the data it describes",
        );
    }

    #[test]
    fn undoing_first_enable_removes_default_data_and_marker_together() {
        let mut world = base_world();
        let entity = spawn_body(&mut world, "sprite-1", Physics2dData::default(), true);
        record_toggle(
            &mut world,
            "sprite-1",
            None,
            Some(Physics2dData::default()),
            false,
            true,
        );

        undo(&mut world);

        assert!(world.entity(entity).get::<Physics2dData>().is_none());
        assert!(!is_enabled(&world, entity));

        redo(&mut world);
        assert!(world.entity(entity).get::<Physics2dData>().is_some());
        assert!(is_enabled(&world, entity));
    }

    #[test]
    fn undoing_disable_restores_existing_data_and_marker_together() {
        let mut world = base_world();
        let recorded = physics(0.73);
        let entity = spawn_body(&mut world, "sprite-1", recorded.clone(), false);
        record_toggle(
            &mut world,
            "sprite-1",
            Some(recorded.clone()),
            Some(recorded),
            true,
            false,
        );

        undo(&mut world);
        assert_eq!(friction_of(&world, entity), 0.73);
        assert!(is_enabled(&world, entity));

        redo(&mut world);
        assert_eq!(friction_of(&world, entity), 0.73);
        assert!(!is_enabled(&world, entity));
    }
}

#[cfg(test)]
mod tilemap_skeleton2d_history_tests {
    //! The same defect as `physics2d_history_tests`, two more times.
    //!
    //! `TilemapChange` and `SkeletonChange` each record only their data
    //! component. Enablement lives in a separate marker — `TilemapEnabled`,
    //! `SkeletonEnabled2d` — which every other restore path in this file
    //! (`insert_aux_components`, `spawn_from_snapshot`) reinstates
    //! CONDITIONALLY from a recorded bool, i.e. "data present, marker absent"
    //! is a state the engine deliberately round-trips. Both history arms used
    //! to insert the marker unconditionally alongside the restored data, so
    //! undoing a tilemap or skeleton edit switched rendering back on for a
    //! surface the user had turned off.

    use super::{HistoryStack, UndoableAction};
    use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
    use crate::core::skeleton2d::{
        BoneWorldTransforms2d, Skeleton2dResync, SkeletonData2d, SkeletonEnabled2d,
        SkinnedMeshInitialized,
    };
    use crate::core::tilemap::{TilemapData, TilemapEnabled};
    use bevy::prelude::*;

    macro_rules! run_system {
        ($world:expr, $system:expr) => {{
            let mut schedule = Schedule::default();
            schedule.add_systems($system);
            schedule.run($world);
        }};
    }

    fn base_world() -> World {
        let mut world = World::new();
        world.insert_resource(HistoryStack::default());
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world
    }

    fn undo(world: &mut World) {
        crate::core::history::queue_undo_from_bridge();
        run_system!(world, super::apply_undo_requests);
    }

    fn redo(world: &mut World) {
        crate::core::history::queue_redo_from_bridge();
        run_system!(world, super::apply_redo_requests);
    }

    /// Spawn an entity carrying everything the undo systems' main query needs,
    /// plus `data`. `marker` is the enablement marker, inserted only when
    /// `Some` — both markers are unit structs that do not implement `Default`,
    /// so they are passed by value rather than conjured from a bound.
    fn spawn_with<D: Component, M: Component>(
        world: &mut World,
        id: &str,
        data: D,
        marker: Option<M>,
    ) -> Entity {
        let entity = world
            .spawn((
                EntityId(id.to_string()),
                EntityName(id.to_string()),
                EntityVisible(true),
                Transform::default(),
                data,
            ))
            .id();
        if let Some(marker) = marker {
            world.entity_mut(entity).insert(marker);
        }
        entity
    }

    fn spawn_tilemap(world: &mut World, id: &str, data: TilemapData, enabled: bool) -> Entity {
        spawn_with(world, id, data, enabled.then_some(TilemapEnabled))
    }

    fn spawn_skeleton(world: &mut World, id: &str, data: SkeletonData2d, enabled: bool) -> Entity {
        spawn_with(world, id, data, enabled.then_some(SkeletonEnabled2d))
    }

    // ---- tilemap ------------------------------------------------------

    /// `tile_size` is deliberately off `TilemapData::default()` (`[32, 32]`),
    /// and every caller passes a non-empty `tileset_asset_id` (default is
    /// `""`). Without that, a regression replacing `insert(td.clone())` with
    /// `insert(TilemapData::default())` would satisfy these assertions by
    /// coincidence instead of failing them.
    fn tilemap(tileset: &str) -> TilemapData {
        TilemapData {
            tileset_asset_id: tileset.to_string(),
            tile_size: [16, 16],
            ..Default::default()
        }
    }

    fn tileset_of(world: &World, entity: Entity) -> String {
        world
            .entity(entity)
            .get::<TilemapData>()
            .expect("TilemapData must still be present")
            .tileset_asset_id
            .clone()
    }

    fn tile_size_of(world: &World, entity: Entity) -> [u32; 2] {
        world
            .entity(entity)
            .get::<TilemapData>()
            .expect("TilemapData must still be present")
            .tile_size
    }

    fn record_tilemap_edit(
        world: &mut World,
        id: &str,
        old: Option<TilemapData>,
        new: Option<TilemapData>,
    ) {
        world.resource_mut::<HistoryStack>().push(UndoableAction::TilemapChange {
            entity_id: id.to_string(),
            old_tilemap: old,
            new_tilemap: new,
        });
    }

    #[test]
    fn undoing_a_tilemap_edit_leaves_a_disabled_tilemap_disabled() {
        let mut world = base_world();
        let entity =
            spawn_tilemap(&mut world, "map-1", tilemap("b"), false);
        record_tilemap_edit(&mut world, "map-1", Some(tilemap("a")), Some(tilemap("b")));

        undo(&mut world);

        assert_eq!(tileset_of(&world, entity), "a", "undo must restore the old tileset");
        assert_eq!(
            tile_size_of(&world, entity),
            [16, 16],
            "undo must restore the recorded struct, not insert a default one",
        );
        assert!(
            !world.entity(entity).contains::<TilemapEnabled>(),
            "undo restores DATA; it must not switch tilemap rendering on for a \
             tilemap the user disabled",
        );
    }

    #[test]
    fn redoing_a_tilemap_edit_leaves_a_disabled_tilemap_disabled() {
        let mut world = base_world();
        let entity =
            spawn_tilemap(&mut world, "map-1", tilemap("b"), false);
        record_tilemap_edit(&mut world, "map-1", Some(tilemap("a")), Some(tilemap("b")));

        undo(&mut world);
        redo(&mut world);

        assert_eq!(tileset_of(&world, entity), "b", "redo must reapply the new tileset");
        assert_eq!(
            tile_size_of(&world, entity),
            [16, 16],
            "redo must reapply the recorded struct, not insert a default one",
        );
        assert!(
            !world.entity(entity).contains::<TilemapEnabled>(),
            "redo restores DATA; enablement is not part of this action either",
        );
    }

    #[test]
    fn undo_and_redo_preserve_an_enabled_tilemap() {
        let mut world = base_world();
        let entity =
            spawn_tilemap(&mut world, "map-1", tilemap("b"), true);
        record_tilemap_edit(&mut world, "map-1", Some(tilemap("a")), Some(tilemap("b")));

        undo(&mut world);
        assert_eq!(tileset_of(&world, entity), "a");
        assert!(
            world.entity(entity).contains::<TilemapEnabled>(),
            "an enabled tilemap must stay enabled across undo",
        );

        redo(&mut world);
        assert_eq!(tileset_of(&world, entity), "b");
        assert!(
            world.entity(entity).contains::<TilemapEnabled>(),
            "an enabled tilemap must stay enabled across redo",
        );
    }

    #[test]
    fn undoing_to_no_recorded_tilemap_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity =
            spawn_tilemap(&mut world, "map-1", tilemap("b"), true);
        record_tilemap_edit(&mut world, "map-1", None, Some(tilemap("b")));

        undo(&mut world);

        assert!(
            world.entity(entity).get::<TilemapData>().is_none(),
            "undo must remove the data when none was recorded",
        );
        assert!(
            !world.entity(entity).contains::<TilemapEnabled>(),
            "the enabled marker must not outlive the data it describes",
        );
    }

    #[test]
    fn redoing_to_no_new_tilemap_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity =
            spawn_tilemap(&mut world, "map-1", tilemap("a"), true);
        record_tilemap_edit(&mut world, "map-1", Some(tilemap("a")), None);

        undo(&mut world);
        redo(&mut world);

        assert!(
            world.entity(entity).get::<TilemapData>().is_none(),
            "redo must remove the data when the edit being reapplied removed it",
        );
        assert!(
            !world.entity(entity).contains::<TilemapEnabled>(),
            "the enabled marker must not outlive the data it describes",
        );
    }

    // ---- skeleton2d ---------------------------------------------------

    /// A second bone puts the fixture off `SkeletonData2d::default()` (exactly
    /// one bone, named `root`) as well as the varying `active_skin` (default
    /// `"default"`), so an `insert(default())` regression fails both
    /// assertions rather than coincidentally satisfying them.
    fn skeleton(active_skin: &str) -> SkeletonData2d {
        let mut sk = SkeletonData2d { active_skin: active_skin.to_string(), ..Default::default() };
        let mut spine = sk.bones[0].clone();
        spine.name = "spine".to_string();
        spine.parent_bone = Some("root".to_string());
        sk.bones.push(spine);
        sk
    }

    fn active_skin_of(world: &World, entity: Entity) -> String {
        world
            .entity(entity)
            .get::<SkeletonData2d>()
            .expect("SkeletonData2d must still be present")
            .active_skin
            .clone()
    }

    fn bone_count_of(world: &World, entity: Entity) -> usize {
        world
            .entity(entity)
            .get::<SkeletonData2d>()
            .expect("SkeletonData2d must still be present")
            .bones
            .len()
    }

    fn record_skeleton_edit(
        world: &mut World,
        id: &str,
        old: Option<SkeletonData2d>,
        old_enabled: bool,
        new: Option<SkeletonData2d>,
        new_enabled: bool,
    ) {
        world.resource_mut::<HistoryStack>().push(UndoableAction::SkeletonChange {
            entity_id: id.to_string(),
            old_skeleton: old,
            old_enabled,
            new_skeleton: new,
            new_enabled,
        });
    }

    #[test]
    fn undoing_a_skeleton_edit_leaves_a_disabled_skeleton_disabled() {
        let mut world = base_world();
        let entity = spawn_skeleton(
            &mut world,
            "rig-1",
            skeleton("armor"),
            false,
        );
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), false, Some(skeleton("armor")), false);

        undo(&mut world);

        assert_eq!(active_skin_of(&world, entity), "cloth", "undo must restore the old skin");
        assert_eq!(
            bone_count_of(&world, entity),
            2,
            "undo must restore the recorded struct, not insert a default one",
        );
        assert!(
            !world.entity(entity).contains::<SkeletonEnabled2d>(),
            "undo restores DATA; it must not switch skeletal animation on for a \
             rig the user disabled",
        );
    }

    #[test]
    fn redoing_a_skeleton_edit_leaves_a_disabled_skeleton_disabled() {
        let mut world = base_world();
        let entity = spawn_skeleton(
            &mut world,
            "rig-1",
            skeleton("armor"),
            false,
        );
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), false, Some(skeleton("armor")), false);

        undo(&mut world);
        redo(&mut world);

        assert_eq!(active_skin_of(&world, entity), "armor", "redo must reapply the new skin");
        assert_eq!(
            bone_count_of(&world, entity),
            2,
            "redo must reapply the recorded struct, not insert a default one",
        );
        assert!(
            !world.entity(entity).contains::<SkeletonEnabled2d>(),
            "redo restores DATA; enablement is not part of this action either",
        );
    }

    #[test]
    fn undo_and_redo_preserve_an_enabled_skeleton() {
        let mut world = base_world();
        let entity = spawn_skeleton(
            &mut world,
            "rig-1",
            skeleton("armor"),
            true,
        );
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), true, Some(skeleton("armor")), true);

        undo(&mut world);
        assert_eq!(active_skin_of(&world, entity), "cloth");
        assert!(
            world.entity(entity).contains::<SkeletonEnabled2d>(),
            "an enabled rig must stay enabled across undo",
        );

        redo(&mut world);
        assert_eq!(active_skin_of(&world, entity), "armor");
        assert!(
            world.entity(entity).contains::<SkeletonEnabled2d>(),
            "an enabled rig must stay enabled across redo",
        );
    }

    /// Put an entity in the state a rig that has actually rendered leaves behind:
    /// the two components `init_skinned_meshes_2d` derives from the rig, not the
    /// rig data itself. Neither is inserted by `spawn_skeleton`, so without this
    /// the "did the arm clean them up" assertions would pass vacuously.
    fn mark_skinned_mesh_initialized(world: &mut World, entity: Entity) {
        world
            .entity_mut(entity)
            .insert(SkinnedMeshInitialized)
            .insert(BoneWorldTransforms2d { transforms: Vec::new() });
    }

    /// `SkinnedMeshInitialized` is a `Without<>` guard on `init_skinned_meshes_2d`.
    /// Leaving it behind when the rig is removed does not just strand old data: it
    /// permanently suppresses re-initialization, so the NEXT undo restores
    /// `SkeletonData2d` onto an entity the init system can no longer match, and the
    /// skinned mesh never renders again. `apply_skeleton2d_removes` clears both
    /// derived components; these two arms are the other two paths that remove a rig
    /// and they must agree with it.
    #[test]
    fn undoing_to_no_recorded_skeleton_clears_the_derived_skinning_components() {
        let mut world = base_world();
        let entity = spawn_skeleton(&mut world, "rig-1", skeleton("armor"), true);
        mark_skinned_mesh_initialized(&mut world, entity);
        record_skeleton_edit(&mut world, "rig-1", None, false, Some(skeleton("armor")), true);

        undo(&mut world);

        assert!(
            !world.entity(entity).contains::<SkinnedMeshInitialized>(),
            "a stale init guard outliving its rig blocks `init_skinned_meshes_2d` \
             forever — the mesh cannot come back on a later undo",
        );
        assert!(
            !world.entity(entity).contains::<BoneWorldTransforms2d>(),
            "bone transforms describe a rig that is gone",
        );
    }

    #[test]
    fn redoing_to_no_new_skeleton_clears_the_derived_skinning_components() {
        let mut world = base_world();
        let entity = spawn_skeleton(&mut world, "rig-1", skeleton("cloth"), true);
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), true, None, false);

        undo(&mut world);
        mark_skinned_mesh_initialized(&mut world, entity);
        redo(&mut world);

        assert!(
            !world.entity(entity).contains::<SkinnedMeshInitialized>(),
            "redoing a rig removal must clear the init guard, exactly as the \
             `remove_skeleton_2d` command path does",
        );
        assert!(
            !world.entity(entity).contains::<BoneWorldTransforms2d>(),
            "bone transforms describe a rig that is gone",
        );
    }

    /// The full sequence the guard actually breaks, end to end: remove the rig,
    /// undo (rig back), redo (rig gone again), undo (rig back again). Only the
    /// second undo is at risk — the first is fed by `apply_skeleton2d_removes`,
    /// which already cleaned up. Asserting on the second is what distinguishes a
    /// fixed redo arm from an unfixed one.
    #[test]
    fn a_rig_survives_a_second_undo_after_a_redo_removed_it() {
        let mut world = base_world();
        let entity = spawn_skeleton(&mut world, "rig-1", skeleton("armor"), true);
        mark_skinned_mesh_initialized(&mut world, entity);
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("armor")), true, None, false);

        undo(&mut world);
        redo(&mut world);
        undo(&mut world);

        assert_eq!(
            active_skin_of(&world, entity),
            "armor",
            "the rig itself must come back",
        );
        assert!(
            !world.entity(entity).contains::<SkinnedMeshInitialized>(),
            "with the guard still set from before the removal, \
             `init_skinned_meshes_2d` skips this entity and the restored rig \
             renders nothing",
        );
    }

    #[test]
    fn undoing_to_no_recorded_skeleton_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity = spawn_skeleton(
            &mut world,
            "rig-1",
            skeleton("armor"),
            true,
        );
        record_skeleton_edit(&mut world, "rig-1", None, false, Some(skeleton("armor")), true);

        undo(&mut world);

        assert!(
            world.entity(entity).get::<SkeletonData2d>().is_none(),
            "undo must remove the data when none was recorded",
        );
        assert!(
            !world.entity(entity).contains::<SkeletonEnabled2d>(),
            "the enabled marker must not outlive the data it describes",
        );
    }

    #[test]
    fn redoing_to_no_new_skeleton_clears_both_the_data_and_the_marker() {
        let mut world = base_world();
        let entity = spawn_skeleton(
            &mut world,
            "rig-1",
            skeleton("cloth"),
            true,
        );
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), true, None, false);

        undo(&mut world);
        redo(&mut world);

        assert!(
            world.entity(entity).get::<SkeletonData2d>().is_none(),
            "redo must remove the data when the edit being reapplied removed it",
        );
        assert!(
            !world.entity(entity).contains::<SkeletonEnabled2d>(),
            "the enabled marker must not outlive the data it describes",
        );
    }

    // -- the browser has to be told, and only these arms can tell it ---------

    /// Run `body` with a live pending queue registered, and hand back the
    /// skeleton resyncs it collected.
    ///
    /// The registration is not ceremony. `with_pending` reaches a thread-local
    /// raw pointer that only the bridge's `Startup` system sets in production,
    /// so an unregistered push is a SILENT no-op — a test that skipped this
    /// would assert an empty queue and pass no matter what the arms did.
    fn skeleton_resyncs_from(body: impl FnOnce()) -> Vec<Skeleton2dResync> {
        struct PendingGuard;
        impl Drop for PendingGuard {
            fn drop(&mut self) {
                crate::core::pending::unregister_pending_commands();
            }
        }

        let mut pending = crate::core::pending::PendingCommands::default();
        crate::core::pending::register_pending_commands(&mut pending as *mut _);
        let guard = PendingGuard;
        body();
        // Clear the pointer before `pending` is moved out of this frame, and
        // even if `body` unwound.
        drop(guard);
        pending.skeleton2d_resyncs
    }

    /// Undoing a creation is the case no live-rig emitter can ever see: the
    /// component is GONE, so the only way the browser learns to drop its copy
    /// is this arm queueing the re-report itself.
    #[test]
    fn undoing_a_skeleton_creation_queues_a_removal_resync() {
        let mut world = base_world();
        let _ = spawn_skeleton(&mut world, "rig-1", skeleton("armor"), true);
        record_skeleton_edit(&mut world, "rig-1", None, false, Some(skeleton("armor")), true);

        let queued = skeleton_resyncs_from(|| undo(&mut world));

        assert_eq!(queued.len(), 1, "undo must queue exactly one resync");
        assert_eq!(queued[0].entity_id, "rig-1");
        assert!(
            queued[0].data.is_none(),
            "undoing a creation wrote NO rig, so the resync must report a removal",
        );
        assert!(!queued[0].enabled, "a removed rig cannot remain enabled");
    }

    /// The failure branch, which is the one the `if !` guard added for the Seer
    /// review exists to make visible. With no `PendingCommands` registered the
    /// queue call returns `false`; the arm must still apply its world mutation
    /// and must not panic — the resync is a re-report of a change that already
    /// happened, so losing it may not cancel the change.
    ///
    /// Without a registered thread-local there is nothing to assert a warning
    /// against from a native test, so this pins the two properties that are
    /// observable: the arm completes, and the world edit lands anyway.
    #[test]
    fn undo_still_applies_when_no_pending_commands_are_registered() {
        let mut world = base_world();
        let entity = spawn_skeleton(&mut world, "rig-1", skeleton("armor"), true);
        record_skeleton_edit(&mut world, "rig-1", None, false, Some(skeleton("armor")), true);

        // Deliberately NOT wrapped in `skeleton_resyncs_from` — the point is the
        // unregistered thread-local.
        undo(&mut world);

        assert!(
            world.get::<crate::core::skeleton2d::SkeletonData2d>(entity).is_none(),
            "undo must still remove the rig it undid, even with no queue to report it on",
        );
    }

    /// Undo carries the pre-state and redo the post-state, and each resync
    /// carries the data the arm WROTE — never an entity id to be re-read, since
    /// the drain runs in a different system and `Commands` are deferred.
    #[test]
    fn undo_and_redo_of_a_skeleton_removal_queue_the_state_each_one_wrote() {
        let mut world = base_world();
        let _ = spawn_skeleton(&mut world, "rig-1", skeleton("armor"), true);
        record_skeleton_edit(&mut world, "rig-1", Some(skeleton("cloth")), true, None, false);

        let undone = skeleton_resyncs_from(|| undo(&mut world));
        assert_eq!(undone.len(), 1);
        let restored = undone[0].data.as_ref().expect("undo restored a rig, so it must be carried");
        assert_eq!(restored.active_skin, "cloth", "the resync must carry the rig the arm wrote");
        assert_eq!(
            restored.bones.len(),
            2,
            "the resync must carry the recorded struct, not a default one",
        );
        assert!(undone[0].enabled, "undo must restore the removal's enabled marker");

        let redone = skeleton_resyncs_from(|| redo(&mut world));
        assert_eq!(redone.len(), 1);
        assert!(
            redone[0].data.is_none(),
            "redoing a removal wrote NO rig, so the resync must report a removal",
        );
        assert!(!redone[0].enabled, "redoing removal must clear enablement");
    }
}

/// Source-parity gate for [`spawn_from_snapshot`] — see the module for why it
/// lives in a sibling file rather than inline.
#[cfg(test)]
#[path = "entity_factory_parity_tests.rs"]
mod entity_factory_parity_tests;
