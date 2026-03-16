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

    // Pre-index auxiliary component data (single O(n) pass over 6 queries)
    let aux_index = build_aux_index(
        &script_audio_query,
        &reverb_particle_query,
        &shader_csg_query,
        &procedural_joint_query,
        &game_anim_query,
        &sprite_query,
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

    // Pre-index auxiliary component data (single O(n) pass over 6 queries)
    let aux_index = build_aux_index(
        &script_audio_query,
        &reverb_particle_query,
        &shader_csg_query,
        &procedural_joint_query,
        &game_anim_query,
        &sprite_query,
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
                *current_mat = update.material_data.clone();

                // Record for undo
                history.push(UndoableAction::MaterialChange {
                    entity_id: update.entity_id.clone(),
                    old_material,
                    new_material: update.material_data.clone(),
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
        UndoableAction::ReverbZoneChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::SpriteChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::Physics2dChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::Joint2dChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::TilemapChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::SkeletonChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
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
        UndoableAction::ReverbZoneChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::SpriteChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::Physics2dChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::Joint2dChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::TilemapChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
        UndoableAction::SkeletonChange { entity_id, .. } => {
            // Clone entity_id for logging
            let _eid = entity_id.clone();
        }
    }
}
