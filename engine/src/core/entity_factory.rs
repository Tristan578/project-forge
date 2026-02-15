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
use super::tilemap::{TilemapData, TilemapEnabled};
use super::history::{EntitySnapshot, HistoryStack, TransformSnapshot, UndoableAction};
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
        history.push(UndoableAction::Spawn {
            snapshot: EntitySnapshot {
                entity_id: entity_id.clone(),
                entity_type: request.entity_type,
                name: name.clone(),
                transform: TransformSnapshot {
                    position: [position.x, position.y, position.z],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                },
                parent_id: None,
                visible: true,
                material_data,
                light_data,
                physics_data: None,
                physics_enabled: false,
                asset_ref: None,
                script_data: None,
                audio_data: None,
                reverb_zone_data: None,
                reverb_zone_enabled: false,
                particle_data: None,
                particle_enabled: false,
                shader_effect_data: None,
                csg_mesh_data: None,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: None,
                joint_data: None,
                game_components: None,
                animation_clip_data: None,
                game_camera_data: None,
                active_game_camera: false,
                sprite_data: None,
                physics2d_data: None,
                physics2d_enabled: false,
                joint2d_data: None,
                tilemap_data: None,
                tilemap_enabled: false,
                skeleton2d_data: None,
                skeleton2d_enabled: false,
                skeletal_animations: None,
            },
        });

        let _ = entity; // Entity handle available for future use
    }
}

/// System that processes pending delete requests.
pub fn apply_delete_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, &EntityName, &Transform, &EntityVisible, Option<&EntityType>, Option<&MaterialData>, Option<&LightData>, Option<&PhysicsData>, Option<&PhysicsEnabled>, Option<&AssetRef>), Without<Undeletable>>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    reverb_zone_query: Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>)>,
    joint_query: Query<(&EntityId, Option<&JointData>)>,
    game_component_query: Query<(&EntityId, Option<&super::game_components::GameComponents>)>,
    animation_clip_query: Query<(&EntityId, Option<&AnimationClipData>)>,
    game_camera_query: Query<(&EntityId, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    sprite_query: Query<(&EntityId, Option<&super::sprite::SpriteData>)>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    let mut deleted_any = false;

    for request in pending.delete_requests.drain(..) {
        for entity_id_to_delete in &request.entity_ids {
            // Find and despawn entity (skip Undeletable entities)
            for (entity, eid, name, transform, visible, ent_type, mat_data, light_data, phys_data, phys_enabled, asset_ref) in query.iter() {
                if &eid.0 == entity_id_to_delete {
                    let entity_type = ent_type.copied().unwrap_or(EntityType::Cube);

                    // Look up script data separately
                    let script_data = script_query.iter()
                        .find(|(script_eid, _)| script_eid.0 == eid.0)
                        .and_then(|(_, sd)| sd.cloned());

                    // Look up audio data separately
                    let audio_data = audio_query.iter()
                        .find(|(audio_eid, _)| audio_eid.0 == eid.0)
                        .and_then(|(_, ad)| ad.cloned());

                    // Look up reverb zone data separately
                    let (reverb_zone_data, reverb_zone_enabled) = reverb_zone_query.iter()
                        .find(|(rzeid, _, _)| rzeid.0 == eid.0)
                        .map(|(_, rzd, rze)| (rzd.cloned(), rze.is_some()))
                        .unwrap_or((None, false));

                    // Look up particle data separately
                    let (particle_data, particle_enabled) = particle_query.iter()
                        .find(|(peid, _, _)| peid.0 == eid.0)
                        .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                        .unwrap_or((None, false));

                    // Look up shader data separately
                    let shader_effect_data = shader_query.iter()
                        .find(|(seid, _)| seid.0 == eid.0)
                        .and_then(|(_, sed)| sed.cloned());

                    // Look up csg data separately
                    let csg_mesh_data = csg_query.iter()
                        .find(|(ceid, _)| ceid.0 == eid.0)
                        .and_then(|(_, cmd)| cmd.cloned());

                    // Look up procedural mesh data separately
                    let procedural_mesh_data = procedural_mesh_query.iter()
                        .find(|(pmeid, _)| pmeid.0 == eid.0)
                        .and_then(|(_, pmd)| pmd.cloned());

                    // Look up joint data separately
                    let joint_data = joint_query.iter()
                        .find(|(jeid, _)| jeid.0 == eid.0)
                        .and_then(|(_, jd)| jd.cloned());

                    // Look up game component data separately
                    let game_components = game_component_query.iter()
                        .find(|(gceid, _)| gceid.0 == eid.0)
                        .and_then(|(_, gc)| gc.cloned());

                    // Look up animation clip data separately
                    let animation_clip_data = animation_clip_query.iter()
                        .find(|(aceid, _)| aceid.0 == eid.0)
                        .and_then(|(_, acd)| acd.cloned());

                    // Look up game camera data separately
                    let (game_camera_data, active_game_camera) = game_camera_query.iter()
                        .find(|(gceid, _, _)| gceid.0 == eid.0)
                        .map(|(_, gcd, agc)| (gcd.cloned(), agc.is_some()))
                        .unwrap_or((None, false));

                    // Look up sprite data separately
                    let sprite_data = sprite_query.iter()
                        .find(|(speid, _)| speid.0 == eid.0)
                        .and_then(|(_, sd)| sd.cloned());

                    // Record delete action in history before deleting
                    history.push(UndoableAction::Delete {
                        snapshot: EntitySnapshot {
                            entity_id: eid.0.clone(),
                            entity_type,
                            name: name.0.clone(),
                            transform: TransformSnapshot::from(transform),
                            parent_id: None,
                            visible: visible.0,
                            material_data: mat_data.cloned(),
                            light_data: light_data.cloned(),
                            physics_data: phys_data.cloned(),
                            physics_enabled: phys_enabled.is_some(),
                            asset_ref: asset_ref.cloned(),
                            script_data,
                            audio_data,
                            reverb_zone_data,
                            reverb_zone_enabled,
                            particle_data,
                            particle_enabled,
                            shader_effect_data,
                            csg_mesh_data,
                            terrain_data: None,
                            terrain_mesh_data: None,
                            procedural_mesh_data,
                            joint_data,
                            game_components,
                            animation_clip_data,
                            game_camera_data,
                            active_game_camera,
                            sprite_data,
                            physics2d_data: None,
                            physics2d_enabled: false,
                            joint2d_data: None,
                            tilemap_data: None,
                            tilemap_enabled: false,
                            skeleton2d_data: None,
                            skeleton2d_enabled: false,
                            skeletal_animations: None,
                        },
                    });

                    commands.entity(entity).despawn();

                    // Remove from selection if present
                    if selection.entity_ids.contains(entity_id_to_delete) {
                        selection.entities.remove(&entity);
                        selection.entity_ids.remove(entity_id_to_delete);
                        deleted_any = true;
                    }
                    break;
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

/// System that processes pending duplicate requests.
pub fn apply_duplicate_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
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
        Option<&AssetRef>,
    )>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    reverb_zone_query: Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>)>,
    joint_query: Query<(&EntityId, Option<&JointData>)>,
    game_component_query: Query<(&EntityId, Option<&super::game_components::GameComponents>)>,
    animation_clip_query: Query<(&EntityId, Option<&AnimationClipData>)>,
    game_camera_query: Query<(&EntityId, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    sprite_query: Query<(&EntityId, Option<&super::sprite::SpriteData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.duplicate_requests.drain(..) {
        // Find source entity
        if let Some((_, source_eid, name, transform, src_entity_type, mesh_handle, material_handle, point_light, dir_light, spot_light, src_mat_data, src_light_data, src_phys_data, src_phys_enabled, src_asset_ref)) =
            query.iter().find(|(_, eid, ..)| eid.0 == request.entity_id)
        {
            // Look up script data separately
            let src_script_data: Option<ScriptData> = script_query.iter()
                .find(|(script_eid, _)| script_eid.0 == source_eid.0)
                .and_then(|(_, sd)| sd.cloned());

            // Look up audio data separately
            let src_audio_data: Option<AudioData> = audio_query.iter()
                .find(|(audio_eid, _)| audio_eid.0 == source_eid.0)
                .and_then(|(_, ad)| ad.cloned());

            // Look up reverb zone data separately
            let (src_reverb_zone_data, src_reverb_zone_enabled) = reverb_zone_query.iter()
                .find(|(rzeid, _, _)| rzeid.0 == source_eid.0)
                .map(|(_, rzd, rze)| (rzd.cloned(), rze.is_some()))
                .unwrap_or((None, false));

            // Look up particle data separately
            let (src_particle_data, src_particle_enabled) = particle_query.iter()
                .find(|(peid, _, _)| peid.0 == source_eid.0)
                .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                .unwrap_or((None, false));

            // Look up shader data separately
            let src_shader_data: Option<ShaderEffectData> = shader_query.iter()
                .find(|(seid, _)| seid.0 == source_eid.0)
                .and_then(|(_, sed)| sed.cloned());

            // Look up csg data separately
            let src_csg_data: Option<csg::CsgMeshData> = csg_query.iter()
                .find(|(ceid, _)| ceid.0 == source_eid.0)
                .and_then(|(_, cmd)| cmd.cloned());

            // Look up procedural mesh data separately
            let src_procedural_mesh_data = procedural_mesh_query.iter()
                .find(|(pmeid, _)| pmeid.0 == source_eid.0)
                .and_then(|(_, pmd)| pmd.cloned());

            // Look up joint data separately
            let src_joint_data = joint_query.iter()
                .find(|(jeid, _)| jeid.0 == source_eid.0)
                .and_then(|(_, jd)| jd.cloned());

            // Look up game component data separately
            let src_game_components = game_component_query.iter()
                .find(|(gceid, _)| gceid.0 == source_eid.0)
                .and_then(|(_, gc)| gc.cloned());

            // Look up animation clip data separately
            let src_animation_clip_data = animation_clip_query.iter()
                .find(|(aceid, _)| aceid.0 == source_eid.0)
                .and_then(|(_, acd)| acd.cloned());

            // Look up game camera data separately (don't duplicate active state)
            let src_game_camera_data = game_camera_query.iter()
                .find(|(gceid, _, _)| gceid.0 == source_eid.0)
                .and_then(|(_, gcd, _)| gcd.cloned());

            // Look up sprite data separately
            let src_sprite_data = sprite_query.iter()
                .find(|(speid, _)| speid.0 == source_eid.0)
                .and_then(|(_, sd)| sd.cloned());

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

            // Clone script data if present
            if let Some(ref sd) = src_script_data {
                entity_commands.insert(sd.clone());
            }

            // Clone audio data if present
            if let Some(ref ad) = src_audio_data {
                entity_commands.insert(ad.clone());
                entity_commands.insert(AudioEnabled);
            }

            // Clone particle data if present
            if let Some(ref pd) = src_particle_data {
                entity_commands.insert(pd.clone());
            }
            if src_particle_enabled {
                entity_commands.insert(ParticleEnabled);
            }

            // Clone shader data if present
            if let Some(ref sed) = src_shader_data {
                entity_commands.insert(sed.clone());
            }

            // Clone csg data if present
            if let Some(ref cmd) = src_csg_data {
                entity_commands.insert(cmd.clone());
            }

            // Clone procedural mesh data if present
            if let Some(ref pmd) = src_procedural_mesh_data {
                entity_commands.insert(pmd.clone());
            }

            // Clone joint data if present
            if let Some(ref jd) = src_joint_data {
                entity_commands.insert(jd.clone());
            }

            // Clone game components if present
            if let Some(ref gc) = src_game_components {
                entity_commands.insert(gc.clone());
            }

            // Clone animation clip data if present
            if let Some(ref acd) = src_animation_clip_data {
                entity_commands.insert(acd.clone());
            }

            // Clone game camera data if present (not active state)
            if let Some(ref gcd) = src_game_camera_data {
                entity_commands.insert(gcd.clone());
            }

            // Clone sprite data if present
            if let Some(ref sd) = src_sprite_data {
                entity_commands.insert(sd.clone());
            }

            // Record duplicate action in history
            history.push(UndoableAction::Duplicate {
                source_entity_id: source_eid.0.clone(),
                snapshot: EntitySnapshot {
                    entity_id: new_entity_id_str,
                    entity_type,
                    name: new_name,
                    transform: TransformSnapshot {
                        position: [new_pos.x, new_pos.y, new_pos.z],
                        rotation: [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
                        scale: [transform.scale.x, transform.scale.y, transform.scale.z],
                    },
                    parent_id: None,
                    visible: true,
                    material_data: src_mat_data.cloned(),
                    light_data: src_light_data.cloned(),
                    physics_data: src_phys_data.cloned(),
                    physics_enabled: src_phys_enabled.is_some(),
                    asset_ref: src_asset_ref.cloned(),
                    script_data: src_script_data,
                    audio_data: src_audio_data,
                    reverb_zone_data: src_reverb_zone_data,
                    reverb_zone_enabled: src_reverb_zone_enabled,
                    particle_data: src_particle_data,
                    particle_enabled: src_particle_enabled,
                    shader_effect_data: src_shader_data,
                    csg_mesh_data: src_csg_data,
                    terrain_data: None,
                    terrain_mesh_data: None,
                    procedural_mesh_data: src_procedural_mesh_data,
                    joint_data: src_joint_data,
                    game_components: src_game_components,
                    animation_clip_data: src_animation_clip_data,
                    game_camera_data: src_game_camera_data,
                    active_game_camera: false, // Don't duplicate active state
                    sprite_data: src_sprite_data,
                    physics2d_data: None,
                    physics2d_enabled: false,
                    joint2d_data: None,
                    tilemap_data: None,
                    tilemap_enabled: false,
                    skeleton2d_data: None,
                    skeleton2d_enabled: false,
                    skeletal_animations: None,
                },
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
    mut ambient: ResMut<AmbientLight>,
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
    }
}
