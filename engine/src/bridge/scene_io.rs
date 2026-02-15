//! Scene import/export and asset loading systems.

use bevy::prelude::*;
use crate::core::{
    asset_manager::{AssetRef, AssetRegistry},
    audio::{AudioBusConfig, AudioData},
    csg::CsgMeshData,
    entity_factory,
    entity_id::{EntityId, EntityName, EntityVisible},
    environment::EnvironmentSettings,
    game_camera::{GameCameraData, ActiveGameCamera},
    game_components::GameComponents,
    history::{EntitySnapshot as HistEntitySnapshot, HistoryStack, TransformSnapshot},
    input::InputMap,
    lighting::{LightData, LightType},
    material::MaterialData,
    particles::{ParticleData, ParticleEnabled},
    pending_commands::{EntityType, PendingCommands},
    physics::{JointData, PhysicsData, PhysicsEnabled},
    post_processing::PostProcessingSettings,
    procedural_mesh::ProceduralMeshData,
    scene_file::{self, SceneName},
    scripting::ScriptData,
    selection::{Selection, SelectionChangedEvent},
    shader_effects::ShaderEffectData,
};

use super::events;

/// System that processes scene export requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_scene_export(
    mut pending: ResMut<PendingCommands>,
    scene_name: Res<SceneName>,
    env: Res<EnvironmentSettings>,
    ambient: Res<AmbientLight>,
    input_map: Res<InputMap>,
    asset_registry: Res<AssetRegistry>,
    post_processing_settings: Res<PostProcessingSettings>,
    bus_config: Res<AudioBusConfig>,
    entity_query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        &EntityVisible,
        Option<&EntityType>,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
        Option<&AssetRef>,
    ), Without<entity_factory::Undeletable>>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_export_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_export_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_procedural_joint_query: Query<(&EntityId, Option<&CsgMeshData>, Option<&ProceduralMeshData>, Option<&JointData>, Option<&GameComponents>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    child_of_query: Query<&ChildOf>,
    eid_query: Query<&EntityId>,
) {
    if pending.scene_export_requests.is_empty() {
        return;
    }
    pending.scene_export_requests.clear();

    // Build entity snapshots
    let mut snapshots = Vec::new();
    for (entity, eid, name, transform, visible, ent_type, mat_data, light_data, phys_data, phys_enabled, asset_ref) in entity_query.iter() {
        // Use EntityType component if available, else guess from light data
        let entity_type = ent_type.copied().unwrap_or_else(|| {
            if let Some(ld) = light_data {
                match ld.light_type {
                    LightType::Point => EntityType::PointLight,
                    LightType::Directional => EntityType::DirectionalLight,
                    LightType::Spot => EntityType::SpotLight,
                }
            } else {
                EntityType::Cube
            }
        });

        // Resolve parent_id via ChildOf
        let parent_id = child_of_query.get(entity).ok().and_then(|child_of| {
            eid_query.get(child_of.parent()).ok().map(|parent_eid| parent_eid.0.clone())
        });

        // Look up script data separately
        let script_data = script_query.iter()
            .find(|(script_eid, _)| script_eid.0 == eid.0)
            .and_then(|(_, sd)| sd.cloned());

        // Look up audio data separately
        let audio_data = audio_export_query.iter()
            .find(|(audio_eid, _)| audio_eid.0 == eid.0)
            .and_then(|(_, ad)| ad.cloned());

        // Look up particle data separately
        let (particle_data, particle_enabled) = particle_export_query.iter()
            .find(|(peid, _, _)| peid.0 == eid.0)
            .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
            .unwrap_or((None, false));

        // Look up shader data separately
        let shader_effect_data = shader_query.iter()
            .find(|(seid, _)| seid.0 == eid.0)
            .and_then(|(_, sed)| sed.cloned());

        // Look up csg + procedural mesh + joint + game component + game camera data from combined query
        let (csg_mesh_data, procedural_mesh_data, joint_data, game_components, game_camera_data, active_game_camera) = csg_procedural_joint_query.iter()
            .find(|(ceid, _, _, _, _, _, _)| ceid.0 == eid.0)
            .map(|(_, cmd, pmd, jd, gc, gcd, agc)| (cmd.cloned(), pmd.cloned(), jd.cloned(), gc.cloned(), gcd.cloned(), agc.is_some()))
            .unwrap_or((None, None, None, None, None, false));

        let mut snap = HistEntitySnapshot::new(
            eid.0.clone(),
            entity_type,
            name.0.clone(),
            TransformSnapshot::from(transform),
        );
        snap.parent_id = parent_id;
        snap.visible = visible.0;
        snap.material_data = mat_data.cloned();
        snap.light_data = light_data.cloned();
        snap.physics_data = phys_data.cloned();
        snap.physics_enabled = phys_enabled.is_some();
        snap.asset_ref = asset_ref.cloned();
        snap.script_data = script_data;
        snap.audio_data = audio_data;
        snap.particle_data = particle_data;
        snap.particle_enabled = particle_enabled;
        snap.shader_effect_data = shader_effect_data;
        snap.csg_mesh_data = csg_mesh_data;
        snap.procedural_mesh_data = procedural_mesh_data;
        snap.joint_data = joint_data;
        snap.game_components = game_components;
        snap.game_camera_data = game_camera_data;
        snap.active_game_camera = active_game_camera;
        snapshots.push(snap);
    }

    let scene_file = scene_file::build_scene_file(
        &scene_name.0,
        &env,
        &ambient,
        &input_map,
        asset_registry.assets.clone(),
        &post_processing_settings,
        &bus_config,
        snapshots,
        None,
    );

    match serde_json::to_string(&scene_file) {
        Ok(json) => {
            events::emit_scene_exported(&json, &scene_name.0);
            tracing::info!("Scene exported: {} entities", scene_file.entities.len());
        }
        Err(e) => {
            tracing::error!("Failed to serialize scene: {}", e);
        }
    }
}

/// System that processes scene load requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_scene_load(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut scene_name: ResMut<SceneName>,
    mut env: ResMut<EnvironmentSettings>,
    mut ambient: ResMut<AmbientLight>,
    mut input_map: ResMut<InputMap>,
    mut history: ResMut<HistoryStack>,
    mut asset_registry: ResMut<AssetRegistry>,
    mut post_processing_settings: ResMut<PostProcessingSettings>,
    mut bus_config: ResMut<AudioBusConfig>,
    existing_entities: Query<Entity, (With<EntityId>, Without<entity_factory::Undeletable>)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    let requests: Vec<_> = pending.scene_load_requests.drain(..).collect();
    if requests.is_empty() {
        return;
    }

    // Process only the last load request (if multiple queued)
    let request = requests.into_iter().last().unwrap();

    let scene_file: scene_file::SceneFile = match serde_json::from_str(&request.json) {
        Ok(sf) => sf,
        Err(e) => {
            tracing::error!("Failed to deserialize scene file: {}", e);
            return;
        }
    };

    if scene_file.format_version > 3 {
        tracing::error!("Unsupported scene format version: {}", scene_file.format_version);
        return;
    }

    // 1. Despawn all existing entities
    for entity in existing_entities.iter() {
        commands.entity(entity).despawn();
    }

    // 2. Clear history
    *history = HistoryStack::default();

    // 3. Clear selection
    selection.clear();
    selection_events.write(SelectionChangedEvent {
        selected_ids: vec![],
        primary_id: None,
        primary_name: None,
    });

    // 4. Apply environment settings
    *env = scene_file.environment;

    // 5. Apply ambient light
    ambient.color = Color::linear_rgb(
        scene_file.ambient_light.color[0],
        scene_file.ambient_light.color[1],
        scene_file.ambient_light.color[2],
    );
    ambient.brightness = scene_file.ambient_light.brightness;

    // 6. Apply input bindings
    *input_map = scene_file.input_bindings;

    // 6b. Load asset registry
    *asset_registry = AssetRegistry { assets: scene_file.assets };

    // 7. Spawn entities from snapshots
    // Sort by hierarchy: roots first (no parent_id), then children
    let mut roots: Vec<&HistEntitySnapshot> = Vec::new();
    let mut children: Vec<&HistEntitySnapshot> = Vec::new();
    for snap in &scene_file.entities {
        if snap.parent_id.is_none() {
            roots.push(snap);
        } else {
            children.push(snap);
        }
    }

    for snap in roots.iter().chain(children.iter()) {
        entity_factory::spawn_from_snapshot(&mut commands, &mut meshes, &mut materials, snap);
    }

    // 8. Reparent children (deferred — will happen next frame via ChildOf)
    // TODO: implement reparenting from parent_id fields

    // 9. Update scene name
    scene_name.0 = scene_file.metadata.name.clone();

    // 9.5. Restore post-processing settings
    *post_processing_settings = scene_file.post_processing;

    // 9.6. Restore audio bus config
    *bus_config = scene_file.audio_buses;

    // 10. Emit events
    events::emit_scene_loaded(&scene_name.0);
    events::emit_environment_changed(&env);
    events::emit_post_processing_changed(&post_processing_settings);
    events::emit_input_bindings_changed(&input_map);
    events::emit_audio_buses_changed(&bus_config);

    let amb_color = ambient.color.to_linear();
    events::emit_ambient_light_changed(
        [amb_color.red, amb_color.green, amb_color.blue],
        ambient.brightness,
    );

    tracing::info!("Scene loaded: '{}' with {} entities", scene_name.0, scene_file.entities.len());
}

/// System that processes new scene requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_new_scene(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut scene_name: ResMut<SceneName>,
    mut env: ResMut<EnvironmentSettings>,
    mut ambient: ResMut<AmbientLight>,
    mut input_map: ResMut<InputMap>,
    mut history: ResMut<HistoryStack>,
    mut asset_registry: ResMut<AssetRegistry>,
    mut post_processing_settings: ResMut<PostProcessingSettings>,
    mut bus_config: ResMut<AudioBusConfig>,
    existing_entities: Query<Entity, (With<EntityId>, Without<entity_factory::Undeletable>)>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    if pending.new_scene_requests.is_empty() {
        return;
    }
    pending.new_scene_requests.clear();

    // 1. Despawn all existing entities
    for entity in existing_entities.iter() {
        commands.entity(entity).despawn();
    }

    // 2. Clear history
    *history = HistoryStack::default();

    // 3. Clear selection
    selection.clear();
    selection_events.write(SelectionChangedEvent {
        selected_ids: vec![],
        primary_id: None,
        primary_name: None,
    });

    // 4. Reset to defaults
    *env = EnvironmentSettings::default();
    ambient.color = Color::WHITE;
    ambient.brightness = 300.0;
    *input_map = InputMap::default();
    *asset_registry = AssetRegistry::default();
    *post_processing_settings = PostProcessingSettings::default();
    *bus_config = AudioBusConfig::default();
    scene_name.0 = "Untitled".to_string();

    // 5. Emit events
    events::emit_scene_loaded(&scene_name.0);
    events::emit_environment_changed(&env);
    events::emit_post_processing_changed(&post_processing_settings);
    events::emit_input_bindings_changed(&input_map);
    events::emit_ambient_light_changed([1.0, 1.0, 1.0], 300.0);
    events::emit_audio_buses_changed(&bus_config);

    tracing::info!("New scene created");
}

/// System that processes glTF import requests.
/// For now, registers the asset in the registry and spawns an empty GltfModel entity.
/// Full glTF scene loading (mesh instantiation) requires the bevy_gltf feature and
/// async asset loading, which will be implemented when we add bevy_gltf/bevy_scene features.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_gltf_import(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut asset_registry: ResMut<AssetRegistry>,
) {
    use crate::core::asset_manager::{AssetKind, AssetMetadata, AssetSource};

    for request in pending.gltf_import_requests.drain(..) {
        let asset_id = uuid::Uuid::new_v4().to_string();
        let file_size = request.data_base64.len() as u64;

        // Register in asset registry
        asset_registry.assets.insert(asset_id.clone(), AssetMetadata {
            id: asset_id.clone(),
            name: request.name.clone(),
            kind: AssetKind::GltfModel,
            file_size,
            source: AssetSource::Upload { filename: request.name.clone() },
        });

        // Spawn a root entity for the model
        let pos = request.position.unwrap_or(bevy::math::Vec3::ZERO);
        let entity_id = crate::core::entity_id::EntityId::default();
        let eid_str = entity_id.0.clone();
        commands.spawn((
            EntityType::GltfModel,
            entity_id,
            crate::core::entity_id::EntityName::new(&request.name),
            crate::core::entity_id::EntityVisible::default(),
            Transform::from_translation(pos),
            crate::core::asset_manager::AssetRef {
                asset_id: asset_id.clone(),
                asset_name: request.name.clone(),
                asset_type: AssetKind::GltfModel,
            },
        ));

        events::emit_asset_imported(&asset_id, &request.name, "gltf_model", file_size);
        tracing::info!("Imported glTF asset: {} (entity: {})", request.name, eid_str);
    }
}

/// System that processes texture load requests.
/// Decodes base64 image data, creates GPU texture assets, and updates MaterialData.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_texture_load(
    mut pending: ResMut<PendingCommands>,
    mut asset_registry: ResMut<AssetRegistry>,
    mut mat_query: Query<(&EntityId, &mut MaterialData)>,
    mut images: ResMut<Assets<Image>>,
    mut texture_handles: ResMut<crate::core::asset_manager::TextureHandleMap>,
) {
    use crate::core::asset_manager::{AssetKind, AssetMetadata, AssetSource};
    use base64::Engine as _;
    use bevy::image::{ImageType, CompressedImageFormats, ImageSampler};
    use bevy::render::render_asset::RenderAssetUsages;

    for request in pending.texture_load_requests.drain(..) {
        let asset_id = uuid::Uuid::new_v4().to_string();
        let file_size = request.data_base64.len() as u64;

        // Parse data URL: "data:image/png;base64,AAAA..."
        let (mime_type, raw_base64) = if let Some(comma_pos) = request.data_base64.find(',') {
            let header = &request.data_base64[..comma_pos];
            let mime = header
                .strip_prefix("data:")
                .and_then(|s| s.strip_suffix(";base64"))
                .unwrap_or("image/png");
            (mime.to_string(), &request.data_base64[comma_pos + 1..])
        } else {
            // Raw base64 without data URL prefix
            ("image/png".to_string(), request.data_base64.as_str())
        };

        // Decode base64 to raw bytes
        let bytes = match base64::engine::general_purpose::STANDARD.decode(raw_base64) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("Failed to decode base64 texture data: {}", e);
                continue;
            }
        };

        // Determine sRGB based on slot (normal maps, depth maps, and roughness maps are linear)
        let is_srgb = !matches!(request.slot.as_str(), "normal_map" | "depth_map" | "clearcoat_normal" | "clearcoat_roughness" | "metallic_roughness");

        // Create Bevy Image from raw bytes
        let image_result = Image::from_buffer(
            &bytes,
            ImageType::MimeType(&mime_type),
            CompressedImageFormats::NONE,
            is_srgb,
            ImageSampler::Default,
            RenderAssetUsages::RENDER_WORLD,
        );

        let image = match image_result {
            Ok(img) => img,
            Err(e) => {
                tracing::warn!("Failed to create image from texture data: {:?}", e);
                continue;
            }
        };

        // Add to Bevy's asset system and store the handle
        let image_handle = images.add(image);
        texture_handles.0.insert(asset_id.clone(), image_handle);

        // Register in asset registry
        asset_registry.assets.insert(asset_id.clone(), AssetMetadata {
            id: asset_id.clone(),
            name: request.name.clone(),
            kind: AssetKind::Texture,
            file_size,
            source: AssetSource::Upload { filename: request.name.clone() },
        });

        // Update the entity's MaterialData with the texture reference
        for (eid, mut mat_data) in mat_query.iter_mut() {
            if eid.0 == request.entity_id {
                match request.slot.as_str() {
                    "base_color" => mat_data.base_color_texture = Some(asset_id.clone()),
                    "normal_map" => mat_data.normal_map_texture = Some(asset_id.clone()),
                    "metallic_roughness" => mat_data.metallic_roughness_texture = Some(asset_id.clone()),
                    "emissive" => mat_data.emissive_texture = Some(asset_id.clone()),
                    "occlusion" => mat_data.occlusion_texture = Some(asset_id.clone()),
                    "depth_map" => mat_data.depth_map_texture = Some(asset_id.clone()),
                    "clearcoat" => mat_data.clearcoat_texture = Some(asset_id.clone()),
                    "clearcoat_roughness" => mat_data.clearcoat_roughness_texture = Some(asset_id.clone()),
                    "clearcoat_normal" => mat_data.clearcoat_normal_texture = Some(asset_id.clone()),
                    _ => {
                        tracing::warn!("Unknown texture slot: {}", request.slot);
                    }
                }
                events::emit_material_changed(&request.entity_id, &mat_data);
                break;
            }
        }

        events::emit_asset_imported(&asset_id, &request.name, "texture", file_size);
        tracing::info!("Loaded texture: {} for entity {}", request.name, request.entity_id);
    }
}

/// System that processes remove-texture requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_remove_texture(
    mut pending: ResMut<PendingCommands>,
    mut mat_query: Query<(&EntityId, &mut MaterialData)>,
) {
    for request in pending.remove_texture_requests.drain(..) {
        for (eid, mut mat_data) in mat_query.iter_mut() {
            if eid.0 == request.entity_id {
                match request.slot.as_str() {
                    "base_color" => mat_data.base_color_texture = None,
                    "normal_map" => mat_data.normal_map_texture = None,
                    "metallic_roughness" => mat_data.metallic_roughness_texture = None,
                    "emissive" => mat_data.emissive_texture = None,
                    "occlusion" => mat_data.occlusion_texture = None,
                    "depth_map" => mat_data.depth_map_texture = None,
                    "clearcoat" => mat_data.clearcoat_texture = None,
                    "clearcoat_roughness" => mat_data.clearcoat_roughness_texture = None,
                    "clearcoat_normal" => mat_data.clearcoat_normal_texture = None,
                    _ => {
                        tracing::warn!("Unknown texture slot: {}", request.slot);
                    }
                }
                events::emit_material_changed(&request.entity_id, &mat_data);
                break;
            }
        }
    }
}

/// System that processes place-asset requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_place_asset(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    asset_registry: Res<AssetRegistry>,
) {
    use crate::core::asset_manager::AssetKind;

    for request in pending.place_asset_requests.drain(..) {
        if let Some(metadata) = asset_registry.assets.get(&request.asset_id) {
            let pos = request.position.unwrap_or(bevy::math::Vec3::ZERO);
            let entity_id = crate::core::entity_id::EntityId::default();

            match metadata.kind {
                AssetKind::GltfModel => {
                    commands.spawn((
                        EntityType::GltfModel,
                        entity_id,
                        crate::core::entity_id::EntityName::new(&metadata.name),
                        crate::core::entity_id::EntityVisible::default(),
                        Transform::from_translation(pos),
                        crate::core::asset_manager::AssetRef {
                            asset_id: metadata.id.clone(),
                            asset_name: metadata.name.clone(),
                            asset_type: AssetKind::GltfModel,
                        },
                    ));
                    tracing::info!("Placed asset: {}", metadata.name);
                }
                AssetKind::Texture => {
                    tracing::warn!("Cannot place texture assets as entities");
                }
            }
        } else {
            tracing::warn!("Unknown asset ID: {}", request.asset_id);
        }
    }
}

/// System that processes delete-asset requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_delete_asset(
    mut pending: ResMut<PendingCommands>,
    mut asset_registry: ResMut<AssetRegistry>,
) {
    for request in pending.delete_asset_requests.drain(..) {
        if asset_registry.assets.remove(&request.asset_id).is_some() {
            events::emit_asset_deleted(&request.asset_id);
            tracing::info!("Deleted asset: {}", request.asset_id);
        } else {
            tracing::warn!("Asset not found for deletion: {}", request.asset_id);
        }
    }
}
