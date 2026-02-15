//! Query processing systems for the bridge layer.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    entity_id::EntityName,
    material::MaterialData,
    lighting::LightData,
    physics::{PhysicsData, PhysicsEnabled, JointData},
    scripting::ScriptData,
    audio::{AudioData, AudioBusConfig},
    reverb_zone::{ReverbZoneData, ReverbZoneEnabled},
    shader_effects::ShaderEffectData,
    particles::{ParticleData, ParticleEnabled},
    terrain::TerrainData,
    quality::QualitySettings,
    selection::Selection,
    pending_commands::PendingCommands,
    engine_mode::EngineMode,
    input::{InputMap, InputState},
    asset_manager::AssetRegistry,
    post_processing::PostProcessingSettings,
    animation::AnimationRegistry,
};
use super::{
    events,
    scene_graph::SceneGraphCache,
};

/// Process query requests from MCP and emit response events.
pub(super) fn process_query_requests(
    mut pending: ResMut<PendingCommands>,
    selection: Res<Selection>,
    scene_cache: Res<SceneGraphCache>,
    engine_mode: Res<EngineMode>,
    input_map: Res<InputMap>,
    input_state: Res<InputState>,
    asset_registry: Res<AssetRegistry>,
    post_processing_settings: Res<PostProcessingSettings>,
    bus_config: Res<AudioBusConfig>,
    query_entities: Query<(
        &EntityId,
        Option<&EntityName>,
        &Transform,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
        Option<&ScriptData>,
    )>,
    audio_query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    particle_q: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_data_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    animation_registry: Res<AnimationRegistry>,
    animation_player_query: Query<&AnimationPlayer>,
    camera_query: Query<&bevy_panorbit_camera::PanOrbitCamera>,
) {
    use crate::core::pending_commands::QueryRequest;

    let requests: Vec<QueryRequest> = pending.query_requests.drain(..).collect();
    for request in requests {
        match request {
            QueryRequest::SceneGraph => {
                // Emit the cached scene graph
                events::emit_event("QUERY_SCENE_GRAPH", &scene_cache.data);
            }
            QueryRequest::Selection => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct SelectionResponse {
                    selected_ids: Vec<String>,
                    primary_id: Option<String>,
                }
                events::emit_event("QUERY_SELECTION", &SelectionResponse {
                    selected_ids: selection.selected_ids(),
                    primary_id: selection.primary_id.clone(),
                });
            }
            QueryRequest::EntityDetails { entity_id } => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct EntityDetails {
                    entity_id: String,
                    name: Option<String>,
                    position: [f32; 3],
                    rotation: [f32; 3],
                    scale: [f32; 3],
                    material: Option<MaterialData>,
                    light: Option<LightData>,
                    physics: Option<PhysicsData>,
                    physics_enabled: bool,
                }

                for (eid, ename, transform, mat, light, physics, phys_enabled, _script) in query_entities.iter() {
                    if eid.0 == entity_id {
                        let (rx, ry, rz) = transform.rotation.to_euler(bevy::math::EulerRot::XYZ);
                        events::emit_event("QUERY_ENTITY_DETAILS", &EntityDetails {
                            entity_id: eid.0.clone(),
                            name: ename.map(|n| n.0.clone()),
                            position: [transform.translation.x, transform.translation.y, transform.translation.z],
                            rotation: [rx.to_degrees(), ry.to_degrees(), rz.to_degrees()],
                            scale: [transform.scale.x, transform.scale.y, transform.scale.z],
                            material: mat.cloned(),
                            light: light.cloned(),
                            physics: physics.cloned(),
                            physics_enabled: phys_enabled.is_some(),
                        });
                        break;
                    }
                }
            }
            QueryRequest::CameraState => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct CameraStateResponse {
                    yaw: f32,
                    pitch: f32,
                    radius: f32,
                    focus: [f32; 3],
                }

                if let Ok(cam) = camera_query.single() {
                    events::emit_event("QUERY_CAMERA_STATE", &CameraStateResponse {
                        yaw: cam.yaw.unwrap_or(0.0),
                        pitch: cam.pitch.unwrap_or(0.0),
                        radius: cam.radius.unwrap_or(10.0),
                        focus: [cam.focus.x, cam.focus.y, cam.focus.z],
                    });
                }
            }
            QueryRequest::EngineMode => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct EngineModeResponse {
                    mode: String,
                }

                events::emit_event("ENGINE_MODE", &EngineModeResponse {
                    mode: engine_mode.as_str().to_string(),
                });
            }
            QueryRequest::InputBindings => {
                events::emit_event("QUERY_INPUT_BINDINGS", &*input_map);
            }
            QueryRequest::InputState => {
                events::emit_event("QUERY_INPUT_STATE", &*input_state);
            }
            QueryRequest::AssetList => {
                events::emit_asset_list(&asset_registry);
            }
            QueryRequest::PhysicsState { entity_id } => {
                for (eid, _, _, _, _, physics, phys_enabled, _script) in query_entities.iter() {
                    if eid.0 == entity_id {
                        if let Some(physics_data) = physics {
                            events::emit_physics_changed(&entity_id, physics_data, phys_enabled.is_some());
                        }
                        break;
                    }
                }
            }
            QueryRequest::ScriptData { entity_id } => {
                for (eid, _, _, _, _, _, _, script_data) in query_entities.iter() {
                    if eid.0 == entity_id {
                        events::emit_script_changed(&entity_id, script_data);
                        break;
                    }
                }
            }
            QueryRequest::AudioData { entity_id } => {
                for (_entity, eid, audio_data) in audio_query.iter() {
                    if eid.0 == entity_id {
                        events::emit_audio_changed(&entity_id, audio_data);
                        break;
                    }
                }
            }
            QueryRequest::ReverbZoneState { entity_id: _ } => {
                // Note: reverb zone query handled in separate process_reverb_zone_queries to avoid param limit
            }
            QueryRequest::ScriptTemplates => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct TemplateList {
                    templates: Vec<String>,
                }

                events::emit_event("QUERY_SCRIPT_TEMPLATES", &TemplateList {
                    templates: vec![
                        "character_controller".to_string(),
                        "collectible".to_string(),
                        "rotating_object".to_string(),
                        "follow_camera".to_string(),
                    ],
                });
            }
            QueryRequest::PostProcessingState => {
                events::emit_event("QUERY_POST_PROCESSING", &*post_processing_settings);
            }
            QueryRequest::AudioBuses => {
                events::emit_event("QUERY_AUDIO_BUSES", &*bus_config);
            }
            QueryRequest::ParticleState { entity_id } => {
                for (eid, pd, pe) in particle_q.iter() {
                    if eid.0 == entity_id {
                        events::emit_particle_changed(&entity_id, pd, pe.is_some());
                        break;
                    }
                }
            }
            QueryRequest::AnimationState { entity_id } => {
                if let Some(state) = super::animation::build_animation_state(&entity_id, &animation_registry, &animation_player_query) {
                    events::emit_animation_state_changed(&state);
                }
            }
            QueryRequest::AnimationGraph { entity_id } => {
                if let Some(entry) = animation_registry.entries.get(&entity_id) {
                    if let Ok(player) = animation_player_query.get(entry.player_entity) {
                        let graph_state = super::animation::build_animation_graph_state(&entity_id, entry, &player);
                        events::emit_event("QUERY_ANIMATION_GRAPH", &graph_state);
                    }
                }
            }
            QueryRequest::ShaderData { entity_id } => {
                for (eid, shader_data) in shader_data_query.iter() {
                    if eid.0 == entity_id {
                        events::emit_shader_changed(&entity_id, shader_data);
                        break;
                    }
                }
            }
            QueryRequest::QualitySettings => {
                // Handled by process_quality_queries system to avoid system parameter limit
            }
            QueryRequest::TerrainState { .. } => {
                // Handled by process_terrain_queries system to avoid system parameter limit
            }
            QueryRequest::ListJoints => {
                // Handled by process_joint_queries system to avoid system parameter limit
            }
            QueryRequest::GameComponentState { .. } => {
                // Handled by process_game_component_queries system to avoid system parameter limit
            }
            QueryRequest::AnimationClipState { .. } => {
                // Animation clip state is emitted via selection events and other apply systems
            }
            QueryRequest::Physics2dState { .. } => {
                // 2D physics state handled separately
            }
            QueryRequest::GameCameraState { .. } => {
                // Game camera state handled separately
            }
            QueryRequest::SpriteState { .. } => {
                // Sprite state handled separately
            }
            QueryRequest::Camera2dState => {
                // 2D camera state handled separately
            }
            QueryRequest::ProjectType => {
                // Project type handled separately
            }
            QueryRequest::Skeleton2dState { .. } => {
                // Skeleton 2D state handled separately
            }
        }
    }
}

/// Process terrain query requests separately to stay under 16 system parameter limit.
pub(super) fn process_terrain_queries(
    mut pending: ResMut<PendingCommands>,
    terrain_query: Query<(&EntityId, Option<&TerrainData>)>,
) {
    use crate::core::pending_commands::QueryRequest;

    let requests: Vec<QueryRequest> = pending.query_requests.iter().filter_map(|req| {
        if matches!(req, QueryRequest::TerrainState { .. }) {
            Some(req.clone())
        } else {
            None
        }
    }).collect();

    for request in requests {
        if let QueryRequest::TerrainState { entity_id } = request {
            for (eid, terrain_data) in terrain_query.iter() {
                if eid.0 == entity_id {
                    if let Some(terrain) = terrain_data {
                        events::emit_terrain_changed(&entity_id, terrain);
                    }
                    break;
                }
            }
            // Remove the processed request
            pending.query_requests.retain(|r| !matches!(r, QueryRequest::TerrainState { entity_id: ref eid } if eid == &entity_id));
        }
    }
}

/// Process quality query requests separately to stay under 16 system parameter limit.
pub(super) fn process_quality_queries(
    mut pending: ResMut<PendingCommands>,
    quality_settings: Res<QualitySettings>,
) {
    use crate::core::pending_commands::QueryRequest;

    let has_quality = pending.query_requests.iter().any(|r| matches!(r, QueryRequest::QualitySettings));
    if has_quality {
        events::emit_quality_changed(&quality_settings);
        pending.query_requests.retain(|r| !matches!(r, QueryRequest::QualitySettings));
    }
}

/// System that applies quality preset requests.
pub(super) fn apply_quality_presets(
    mut pending: ResMut<PendingCommands>,
    mut quality: ResMut<QualitySettings>,
) {
    for request in pending.quality_preset_requests.drain(..) {
        if let Some(preset) = crate::core::quality::QualitySettings::parse_preset(&request.preset) {
            *quality = crate::core::quality::QualitySettings::from_preset(preset);
            events::emit_quality_changed(&quality);
            tracing::info!("Applied quality preset: {}", request.preset);
        }
    }
}

/// Process reverb zone query requests separately to stay under 16 system parameter limit.
pub(super) fn process_reverb_zone_queries(
    mut pending: ResMut<PendingCommands>,
    reverb_zone_query: Query<(&EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
) {
    use crate::core::pending_commands::QueryRequest;

    let requests: Vec<QueryRequest> = pending.query_requests.iter().filter_map(|req| {
        if matches!(req, QueryRequest::ReverbZoneState { .. }) {
            Some(req.clone())
        } else {
            None
        }
    }).collect();

    for request in requests {
        if let QueryRequest::ReverbZoneState { entity_id } = request {
            for (eid, reverb_zone_data, rz_enabled) in reverb_zone_query.iter() {
                if eid.0 == entity_id {
                    if let Some(data) = reverb_zone_data {
                        events::emit_reverb_zone_changed(&entity_id, data, rz_enabled.is_some());
                    }
                    break;
                }
            }
            // Remove the processed request
            pending.query_requests.retain(|r| !matches!(r, QueryRequest::ReverbZoneState { entity_id: ref eid } if eid == &entity_id));
        }
    }
}

/// Process joint list query requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn process_joint_queries(
    mut pending: ResMut<PendingCommands>,
    joint_query: Query<(&EntityId, &JointData)>,
) {
    use crate::core::pending_commands::QueryRequest;

    let has_list_joints = pending.query_requests.iter().any(|r| matches!(r, QueryRequest::ListJoints));
    if has_list_joints {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct JointInfo {
            entity_id: String,
            #[serde(flatten)]
            joint_data: JointData,
        }

        let joints: Vec<JointInfo> = joint_query.iter()
            .map(|(eid, jd)| JointInfo {
                entity_id: eid.0.clone(),
                joint_data: jd.clone(),
            })
            .collect();

        events::emit_event("QUERY_JOINTS_LIST", &joints);
        pending.query_requests.retain(|r| !matches!(r, QueryRequest::ListJoints));
    }
}
