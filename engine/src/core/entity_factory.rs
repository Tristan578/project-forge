//! Entity factory - systems for spawning, deleting, and duplicating entities.

use bevy::prelude::*;
use std::collections::HashMap;

use super::animation_clip::AnimationClipData;
use super::asset_manager::AssetRef;
use super::audio::{AudioData, AudioEnabled};
use super::csg;
use super::entity_id::{EntityId, EntityName, EntityVisible};
use super::game_camera::{GameCameraData, ActiveGameCamera};
use super::terrain::{self, TerrainEnabled};
use super::lod::LodData;
use super::physics_2d::{Physics2dData, Physics2dEnabled};
use super::skeleton2d::{SkeletonData2d, SkeletonEnabled2d};
use super::tilemap::{TilemapData, TilemapEnabled};
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
            EntityType::DirectionalLight => spawn_directional_light_with_id(&mut commands, &name),
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

/// Smallest grid a terrain mesh can be built from.
///
/// `terrain::build_terrain_mesh` divides by `resolution - 1` and sizes its index
/// buffer from `(resolution - 1)^2` computed in `usize`, so `resolution == 0`
/// underflows (a capacity-overflow panic, which in WASM takes the whole engine
/// down) and `resolution == 1` divides by zero into a NaN mesh. The command
/// layer already clamps to 32/64/128/256, so this only guards a caller that
/// bypasses it — but the failure mode is bad enough to refuse explicitly.
const MIN_TERRAIN_RESOLUTION: u32 = 2;

/// Build the material every terrain entity shares, matching the `EntityType::Terrain`
/// arm of `spawn_from_snapshot` so a spawn/undo/redo round-trip is lossless.
fn terrain_material() -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgb(0.5, 0.5, 0.5),
        ..default()
    }
}

/// Swap `Mesh3d`'s handle for a freshly built mesh and release the superseded
/// one. The old mesh had exactly one owner (this component — snapshots store
/// `TerrainMeshData`, never a handle), so removing it explicitly is safe and
/// keeps `Assets<Mesh>` from growing by one entry per edit for the lifetime of
/// the session.
fn swap_terrain_mesh(meshes: &mut Assets<Mesh>, mesh3d: &mut Mesh3d, mesh: Mesh) {
    let superseded = std::mem::replace(&mut mesh3d.0, meshes.add(mesh));
    meshes.remove(&superseded);
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
        if terrain_data.resolution < MIN_TERRAIN_RESOLUTION {
            tracing::warn!(
                "Rejected terrain spawn: resolution {} is below the minimum of {}",
                terrain_data.resolution,
                MIN_TERRAIN_RESOLUTION,
            );
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
            Transform::from_translation(position),
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
/// The request carries a complete replacement `TerrainData` (see
/// `handle_update_terrain`), so the heightmap is regenerated from scratch.
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
        if update.terrain_data.resolution < MIN_TERRAIN_RESOLUTION {
            tracing::warn!(
                "Rejected terrain update: resolution {} is below the minimum of {}",
                update.terrain_data.resolution,
                MIN_TERRAIN_RESOLUTION,
            );
            continue;
        }

        // An id matching nothing is dropped, not retried and not recorded: a
        // history entry that restores nothing would make the user's next undo
        // appear to do nothing at all.
        let Some((_, mut terrain_data, mut mesh_data, mut mesh3d)) = terrain_query
            .iter_mut()
            .find(|(id, _, _, _)| id.0 == update.entity_id)
        else {
            tracing::warn!(
                "Dropped terrain update: no entity with id {}",
                update.entity_id,
            );
            continue;
        };

        let old_terrain = terrain_data.clone();
        let old_mesh_data = mesh_data.clone();

        let new_mesh_data = terrain::TerrainMeshData {
            heights: terrain::generate_heightmap(&update.terrain_data),
            resolution: update.terrain_data.resolution,
            size: update.terrain_data.size,
        };
        swap_terrain_mesh(
            &mut meshes,
            &mut mesh3d,
            terrain::rebuild_terrain_mesh(&new_mesh_data),
        );

        *terrain_data = update.terrain_data.clone();
        *mesh_data = new_mesh_data.clone();

        history.push(UndoableAction::TerrainChange {
            entity_id: update.entity_id,
            old_terrain,
            new_terrain: update.terrain_data,
            old_mesh_data,
            new_mesh_data,
        });
    }
}

/// System that processes pending terrain sculpt strokes.
///
/// A sculpt edits the heightmap in place and leaves the noise config alone, so
/// the recorded `TerrainChange` carries an identical `TerrainData` either side.
pub fn apply_terrain_sculpts(
    mut pending: ResMut<PendingCommands>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut history: ResMut<HistoryStack>,
    mut terrain_query: Query<(
        &EntityId,
        &terrain::TerrainData,
        &mut terrain::TerrainMeshData,
        &mut Mesh3d,
    )>,
) {
    for sculpt in pending.terrain_sculpts.drain(..) {
        // Same drop-don't-record contract as `apply_terrain_updates`.
        let Some((_, terrain_data, mut mesh_data, mut mesh3d)) = terrain_query
            .iter_mut()
            .find(|(id, _, _, _)| id.0 == sculpt.entity_id)
        else {
            tracing::warn!(
                "Dropped terrain sculpt: no entity with id {}",
                sculpt.entity_id,
            );
            continue;
        };

        let old_mesh_data = mesh_data.clone();

        let mut heights = mesh_data.heights.clone();
        terrain::sculpt_heightmap(
            &mut heights,
            mesh_data.resolution,
            mesh_data.size,
            sculpt.position,
            sculpt.radius,
            sculpt.strength,
        );
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
// Shared helpers for delete & duplicate — pre-indexed O(1) lookups
// ---------------------------------------------------------------------------

/// Auxiliary component data collected from secondary queries, keyed by entity ID.
/// Used by both delete and duplicate to avoid redundant O(n) scans.
struct AuxComponentData {
    script_data: Option<ScriptData>,
    audio_data: Option<AudioData>,
    reverb_zone_data: Option<super::reverb_zone::ReverbZoneData>,
    reverb_zone_enabled: bool,
    particle_data: Option<ParticleData>,
    particle_enabled: bool,
    shader_effect_data: Option<ShaderEffectData>,
    csg_mesh_data: Option<csg::CsgMeshData>,
    procedural_mesh_data: Option<super::procedural_mesh::ProceduralMeshData>,
    joint_data: Option<JointData>,
    game_components: Option<super::game_components::GameComponents>,
    animation_clip_data: Option<AnimationClipData>,
    game_camera_data: Option<GameCameraData>,
    active_game_camera: bool,
    sprite_data: Option<super::sprite::SpriteData>,
    physics2d_data: Option<Physics2dData>,
    physics2d_enabled: bool,
    tilemap_data: Option<TilemapData>,
    tilemap_enabled: bool,
    skeleton2d_data: Option<SkeletonData2d>,
    skeleton2d_enabled: bool,
    lod_data: Option<LodData>,
}

impl Default for AuxComponentData {
    fn default() -> Self {
        Self {
            script_data: None,
            audio_data: None,
            reverb_zone_data: None,
            reverb_zone_enabled: false,
            particle_data: None,
            particle_enabled: false,
            shader_effect_data: None,
            csg_mesh_data: None,
            procedural_mesh_data: None,
            joint_data: None,
            game_components: None,
            animation_clip_data: None,
            game_camera_data: None,
            active_game_camera: false,
            sprite_data: None,
            physics2d_data: None,
            physics2d_enabled: false,
            tilemap_data: None,
            tilemap_enabled: false,
            skeleton2d_data: None,
            skeleton2d_enabled: false,
            lod_data: None,
        }
    }
}

/// Build a HashMap of auxiliary component data from the secondary queries.
/// This converts 7 separate O(n) linear scans per entity into a single O(n) pass.
fn build_aux_index(
    script_audio_query: &Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>)>,
    reverb_particle_query: &Query<(
        &EntityId,
        Option<&super::reverb_zone::ReverbZoneData>,
        Option<&super::reverb_zone::ReverbZoneEnabled>,
        Option<&ParticleData>,
        Option<&ParticleEnabled>,
    )>,
    shader_csg_query: &Query<(&EntityId, Option<&ShaderEffectData>, Option<&csg::CsgMeshData>)>,
    procedural_joint_query: &Query<(
        &EntityId,
        Option<&super::procedural_mesh::ProceduralMeshData>,
        Option<&JointData>,
    )>,
    game_anim_query: &Query<(
        &EntityId,
        Option<&super::game_components::GameComponents>,
        Option<&AnimationClipData>,
        Option<&GameCameraData>,
        Option<&ActiveGameCamera>,
    )>,
    sprite_query: &Query<(&EntityId, Option<&super::sprite::SpriteData>)>,
    physics2d_tilemap_skeleton_lod_query: &Query<(
        &EntityId,
        Option<&Physics2dData>,
        Option<&Physics2dEnabled>,
        Option<&TilemapData>,
        Option<&TilemapEnabled>,
        Option<&SkeletonData2d>,
        Option<&SkeletonEnabled2d>,
        Option<&LodData>,
    )>,
) -> HashMap<String, AuxComponentData> {
    let mut index: HashMap<String, AuxComponentData> = HashMap::new();

    for (eid, sd, ad) in script_audio_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.script_data = sd.cloned();
        entry.audio_data = ad.cloned();
    }

    for (eid, rzd, rze, pd, pe) in reverb_particle_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.reverb_zone_data = rzd.cloned();
        entry.reverb_zone_enabled = rze.is_some();
        entry.particle_data = pd.cloned();
        entry.particle_enabled = pe.is_some();
    }

    for (eid, sed, cmd) in shader_csg_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.shader_effect_data = sed.cloned();
        entry.csg_mesh_data = cmd.cloned();
    }

    for (eid, pmd, jd) in procedural_joint_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.procedural_mesh_data = pmd.cloned();
        entry.joint_data = jd.cloned();
    }

    for (eid, gc, acd, gcd, agc) in game_anim_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.game_components = gc.cloned();
        entry.animation_clip_data = acd.cloned();
        entry.game_camera_data = gcd.cloned();
        entry.active_game_camera = agc.is_some();
    }

    for (eid, sd) in sprite_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.sprite_data = sd.cloned();
    }

    for (eid, p2d, p2de, tmd, tme, sk, ske, ld) in physics2d_tilemap_skeleton_lod_query.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.physics2d_data = p2d.cloned();
        entry.physics2d_enabled = p2de.is_some();
        entry.tilemap_data = tmd.cloned();
        entry.tilemap_enabled = tme.is_some();
        entry.skeleton2d_data = sk.cloned();
        entry.skeleton2d_enabled = ske.is_some();
        entry.lod_data = ld.cloned();
    }

    index
}

/// Build a complete EntitySnapshot from base query data and pre-indexed auxiliary data.
fn snapshot_entity(
    entity_id: &str,
    entity_type: EntityType,
    name: &str,
    transform: &Transform,
    visible: bool,
    mat_data: Option<&MaterialData>,
    light_data: Option<&LightData>,
    phys_data: Option<&PhysicsData>,
    phys_enabled: bool,
    asset_ref: Option<&AssetRef>,
    aux: &AuxComponentData,
) -> EntitySnapshot {
    let mut snapshot = EntitySnapshot::new(
        entity_id.to_string(),
        entity_type,
        name.to_string(),
        TransformSnapshot::from(transform),
    );
    snapshot.visible = visible;
    snapshot.material_data = mat_data.cloned();
    snapshot.light_data = light_data.cloned();
    snapshot.physics_data = phys_data.cloned();
    snapshot.physics_enabled = phys_enabled;
    snapshot.asset_ref = asset_ref.cloned();
    snapshot.script_data = aux.script_data.clone();
    snapshot.audio_data = aux.audio_data.clone();
    snapshot.reverb_zone_data = aux.reverb_zone_data.clone();
    snapshot.reverb_zone_enabled = aux.reverb_zone_enabled;
    snapshot.particle_data = aux.particle_data.clone();
    snapshot.particle_enabled = aux.particle_enabled;
    snapshot.shader_effect_data = aux.shader_effect_data.clone();
    snapshot.csg_mesh_data = aux.csg_mesh_data.clone();
    snapshot.procedural_mesh_data = aux.procedural_mesh_data.clone();
    snapshot.joint_data = aux.joint_data.clone();
    snapshot.game_components = aux.game_components.clone();
    snapshot.animation_clip_data = aux.animation_clip_data.clone();
    snapshot.game_camera_data = aux.game_camera_data.clone();
    snapshot.active_game_camera = aux.active_game_camera;
    snapshot.sprite_data = aux.sprite_data.clone();
    snapshot.physics2d_data = aux.physics2d_data.clone();
    snapshot.physics2d_enabled = aux.physics2d_enabled;
    snapshot.tilemap_data = aux.tilemap_data.clone();
    snapshot.tilemap_enabled = aux.tilemap_enabled;
    snapshot.skeleton2d_data = aux.skeleton2d_data.clone();
    snapshot.skeleton2d_enabled = aux.skeleton2d_enabled;
    snapshot.lod_data = aux.lod_data.clone();
    snapshot
}

/// Insert auxiliary component data onto a spawned entity (used by duplicate).
fn insert_aux_components(entity_commands: &mut bevy::ecs::system::EntityCommands, aux: &AuxComponentData) {
    if let Some(ref sd) = aux.script_data {
        entity_commands.insert(sd.clone());
    }
    if let Some(ref ad) = aux.audio_data {
        entity_commands.insert(ad.clone());
        entity_commands.insert(AudioEnabled);
    }
    if let Some(ref pd) = aux.particle_data {
        entity_commands.insert(pd.clone());
    }
    if aux.particle_enabled {
        entity_commands.insert(ParticleEnabled);
    }
    if let Some(ref sed) = aux.shader_effect_data {
        entity_commands.insert(sed.clone());
    }
    if let Some(ref cmd) = aux.csg_mesh_data {
        entity_commands.insert(cmd.clone());
    }
    if let Some(ref pmd) = aux.procedural_mesh_data {
        entity_commands.insert(pmd.clone());
    }
    if let Some(ref jd) = aux.joint_data {
        entity_commands.insert(jd.clone());
    }
    if let Some(ref gc) = aux.game_components {
        entity_commands.insert(gc.clone());
    }
    if let Some(ref acd) = aux.animation_clip_data {
        entity_commands.insert(acd.clone());
    }
    if let Some(ref gcd) = aux.game_camera_data {
        entity_commands.insert(gcd.clone());
    }
    if let Some(ref sd) = aux.sprite_data {
        entity_commands.insert(sd.clone());
    }
    if let Some(ref p2d) = aux.physics2d_data {
        entity_commands.insert(p2d.clone());
    }
    if aux.physics2d_enabled {
        entity_commands.insert(Physics2dEnabled);
    }
    if let Some(ref tmd) = aux.tilemap_data {
        entity_commands.insert(tmd.clone());
    }
    if aux.tilemap_enabled {
        entity_commands.insert(TilemapEnabled);
    }
    if let Some(ref sk) = aux.skeleton2d_data {
        entity_commands.insert(sk.clone());
    }
    if aux.skeleton2d_enabled {
        entity_commands.insert(SkeletonEnabled2d);
    }
    if let Some(ref ld) = aux.lod_data {
        entity_commands.insert(ld.clone());
    }
}

// ---------------------------------------------------------------------------
// Delete system
// ---------------------------------------------------------------------------

/// System that processes pending delete requests.
/// Uses pre-indexed HashMaps for O(n) batch performance instead of O(n^2) nested loops.
pub fn apply_delete_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, &EntityName, &Transform, &EntityVisible, Option<&EntityType>, Option<&MaterialData>, Option<&LightData>, Option<&PhysicsData>, Option<&PhysicsEnabled>, Option<&AssetRef>), Without<Undeletable>>,
    script_audio_query: Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>)>,
    reverb_particle_query: Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_csg_query: Query<(&EntityId, Option<&ShaderEffectData>, Option<&csg::CsgMeshData>)>,
    procedural_joint_query: Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>, Option<&JointData>)>,
    game_anim_query: Query<(&EntityId, Option<&super::game_components::GameComponents>, Option<&AnimationClipData>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    sprite_query: Query<(&EntityId, Option<&super::sprite::SpriteData>)>,
    physics2d_tilemap_skeleton_lod_query: Query<(&EntityId, Option<&Physics2dData>, Option<&Physics2dEnabled>, Option<&TilemapData>, Option<&TilemapEnabled>, Option<&SkeletonData2d>, Option<&SkeletonEnabled2d>, Option<&LodData>)>,
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
    let aux_index = build_aux_index(
        &script_audio_query,
        &reverb_particle_query,
        &shader_csg_query,
        &procedural_joint_query,
        &game_anim_query,
        &sprite_query,
        &physics2d_tilemap_skeleton_lod_query,
    );

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
                    &eid.0, entity_type, &name.0, transform, visible.0,
                    mat_data, light_data, phys_data, phys_enabled.is_some(), asset_ref, aux,
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
    script_audio_query: Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>)>,
    reverb_particle_query: Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_csg_query: Query<(&EntityId, Option<&ShaderEffectData>, Option<&csg::CsgMeshData>)>,
    procedural_joint_query: Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>, Option<&JointData>)>,
    game_anim_query: Query<(&EntityId, Option<&super::game_components::GameComponents>, Option<&AnimationClipData>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    sprite_query: Query<(&EntityId, Option<&super::sprite::SpriteData>)>,
    physics2d_tilemap_skeleton_lod_query: Query<(&EntityId, Option<&Physics2dData>, Option<&Physics2dEnabled>, Option<&TilemapData>, Option<&TilemapEnabled>, Option<&SkeletonData2d>, Option<&SkeletonEnabled2d>, Option<&LodData>)>,
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
    let aux_index = build_aux_index(
        &script_audio_query,
        &reverb_particle_query,
        &shader_csg_query,
        &procedural_joint_query,
        &game_anim_query,
        &sprite_query,
        &physics2d_tilemap_skeleton_lod_query,
    );

    let empty_aux = AuxComponentData::default();

    for request in pending.duplicate_requests.drain(..) {
        // O(1) lookup instead of O(n) linear scan
        if let Some(&(
            _entity, source_eid, name, transform, visible,
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

            // Clone light data if present
            if let Some(ld) = src_light_data {
                entity_commands.insert(ld.clone());
            }

            // Clone physics data if present
            if let Some(pd) = src_phys_data {
                entity_commands.insert(pd.clone());
            }
            if src_phys_enabled.is_some() {
                entity_commands.insert(PhysicsEnabled);
            }

            // Clone asset ref if present
            if let Some(ar) = src_asset_ref {
                entity_commands.insert(ar.clone());
            }

            // Clone auxiliary component data
            insert_aux_components(&mut entity_commands, aux);

            // Build snapshot using shared helper
            let mut snapshot = snapshot_entity(
                &source_eid.0, entity_type, &name.0, transform, visible.0,
                src_mat_data, src_light_data, src_phys_data, src_phys_enabled.is_some(),
                src_asset_ref, aux,
            );
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
            // Duplicates are always spawned visible (EntityVisible::default() = true)
            // regardless of source visibility. The snapshot must match the spawned state
            // so that redo correctly restores the duplicate as visible.
            snapshot.visible = true;
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
) -> (Entity, String, Vec3) {
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
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -0.5, 0.5, 0.0)),
    )).id();

    (entity, entity_id_str, Vec3::ZERO)
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
        UndoableAction::ReverbZoneChange { entity_id, old_reverb, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref rz) = old_reverb {
                        commands.entity(entity).insert(rz.clone());
                        commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneData>();
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneEnabled>();
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
                        commands.entity(entity).insert(pd.clone());
                        commands.entity(entity).insert(super::physics_2d::Physics2dEnabled);
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
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
                        commands.entity(entity).insert(td.clone());
                        commands.entity(entity).insert(TilemapEnabled);
                    } else {
                        commands.entity(entity).remove::<super::tilemap::TilemapData>();
                        commands.entity(entity).remove::<TilemapEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::SkeletonChange { entity_id, old_skeleton, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sk) = old_skeleton {
                        commands.entity(entity).insert(sk.clone());
                        commands.entity(entity).insert(super::skeleton2d::SkeletonEnabled2d);
                    } else {
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonData2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
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
        UndoableAction::ReverbZoneChange { entity_id, new_reverb, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref rz) = new_reverb {
                        commands.entity(entity).insert(rz.clone());
                        commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
                    } else {
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneData>();
                        commands.entity(entity).remove::<super::reverb_zone::ReverbZoneEnabled>();
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
                        commands.entity(entity).insert(pd.clone());
                        commands.entity(entity).insert(super::physics_2d::Physics2dEnabled);
                    } else {
                        commands.entity(entity).remove::<super::physics_2d::Physics2dData>();
                        commands.entity(entity).remove::<super::physics_2d::Physics2dEnabled>();
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
                        commands.entity(entity).insert(td.clone());
                        commands.entity(entity).insert(TilemapEnabled);
                    } else {
                        commands.entity(entity).remove::<super::tilemap::TilemapData>();
                        commands.entity(entity).remove::<TilemapEnabled>();
                    }
                    break;
                }
            }
        }
        UndoableAction::SkeletonChange { entity_id, new_skeleton, .. } => {
            for (entity, eid, _, _, _) in query.iter() {
                if &eid.0 == entity_id {
                    if let Some(ref sk) = new_skeleton {
                        commands.entity(entity).insert(sk.clone());
                        commands.entity(entity).insert(super::skeleton2d::SkeletonEnabled2d);
                    } else {
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonData2d>();
                        commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
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
mod terrain_drain_tests {
    use super::{
        apply_terrain_sculpts, apply_terrain_spawn_requests, apply_terrain_updates, HistoryStack,
        UndoableAction,
    };
    use crate::core::entity_id::EntityId;
    use crate::core::pending_commands::{
        EntityType, PendingCommands, TerrainSculpt, TerrainSpawnRequest, TerrainUpdate,
    };
    use crate::core::terrain::{TerrainData, TerrainEnabled, TerrainMeshData};
    use bevy::prelude::*;

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

    #[test]
    fn spawn_attaches_the_full_terrain_component_set() {
        let mut world = base_world();
        queue_spawn(&mut world, spawn_request(None, None));

        let mut query =
            world.query::<(&EntityType, &TerrainData, &TerrainMeshData, &TerrainEnabled, &Mesh3d)>();
        let (entity_type, terrain_data, mesh_data, _, _) = query
            .iter(&world)
            .next()
            .expect("terrain entity must carry EntityType, TerrainData, TerrainMeshData, TerrainEnabled and Mesh3d");

        assert_eq!(*entity_type, EntityType::Terrain);
        assert_eq!(terrain_data.resolution, 8);
        assert_eq!(mesh_data.resolution, 8);
        assert_eq!(mesh_data.size, 7.0);
        assert_eq!(
            mesh_data.heights.len(),
            8 * 8,
            "heightmap must hold resolution * resolution samples",
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

        let new_data = TerrainData {
            height_scale: 40.0,
            ..small_terrain(999)
        };
        world
            .resource_mut::<PendingCommands>()
            .terrain_updates
            .push(TerrainUpdate {
                entity_id: "terrain-1".to_string(),
                terrain_data: new_data.clone(),
            });
        run_system!(&mut world, apply_terrain_updates);

        let after = heights_of(&mut world);
        assert_ne!(
            before, after,
            "changing the noise config must regenerate the heightmap",
        );

        let mut query = world.query::<&TerrainData>();
        let live = query.iter(&world).next().expect("terrain still exists");
        assert_eq!(live.seed, 999, "the new TerrainData must replace the old");
        assert_eq!(live.height_scale, 40.0);

        assert_ne!(
            mesh_handle_of(&mut world),
            old_handle,
            "the Mesh3d handle must point at the rebuilt mesh",
        );
        assert_eq!(
            world.resource::<Assets<Mesh>>().len(),
            1,
            "the superseded mesh must be released, not leaked in Assets<Mesh>",
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

        world
            .resource_mut::<PendingCommands>()
            .terrain_updates
            .push(TerrainUpdate {
                entity_id: "does-not-exist".to_string(),
                terrain_data: small_terrain(999),
            });
        run_system!(&mut world, apply_terrain_updates);

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

    #[test]
    fn sculpt_lowers_when_strength_is_negative() {
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
                strength: -5.0,
            });
        run_system!(&mut world, apply_terrain_sculpts);
        let after = heights_of(&mut world);

        assert!(
            after[0] < before[0],
            "negative strength must lower the brush centre",
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

        assert_ne!(
            mesh_handle_of(&mut world),
            old_handle,
            "the Mesh3d handle must point at the resculpted mesh",
        );
        assert_eq!(
            world.resource::<Assets<Mesh>>().len(),
            1,
            "the superseded mesh must be released, not leaked in Assets<Mesh>",
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
                assert_eq!(
                    old_terrain.seed, new_terrain.seed,
                    "a sculpt must not alter the noise config",
                );
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

        world
            .resource_mut::<PendingCommands>()
            .terrain_sculpts
            .push(TerrainSculpt {
                entity_id: "does-not-exist".to_string(),
                position: [-3.5, -3.5],
                radius: 1.5,
                strength: 5.0,
            });
        run_system!(&mut world, apply_terrain_sculpts);

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
}
