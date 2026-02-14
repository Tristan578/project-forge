//! Event emission infrastructure for Rust → React communication.
//!
//! This module provides the mechanism for emitting typed events to JavaScript.
//! Events are JSON-serialized and passed through a callback function.

use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use serde_wasm_bindgen::Serializer;

thread_local! {
    static EVENT_CALLBACK: RefCell<Option<js_sys::Function>> = const { RefCell::new(None) };
}

/// Store the event callback function from JavaScript.
pub fn set_event_callback_impl(callback: js_sys::Function) {
    EVENT_CALLBACK.with(|cb| {
        *cb.borrow_mut() = Some(callback);
    });
    web_sys::console::log_1(&"Event callback stored".into());
}

/// Check if an event callback is registered.
pub fn has_event_callback() -> bool {
    EVENT_CALLBACK.with(|cb| cb.borrow().is_some())
}

/// Emit an event to JavaScript.
/// The event is serialized to JSON and passed to the callback.
pub fn emit_event<T: Serialize>(event_type: &str, payload: &T) {
    EVENT_CALLBACK.with(|cb| {
        if let Some(callback) = cb.borrow().as_ref() {
            let event = serde_json::json!({
                "type": event_type,
                "payload": payload,
            });

            match event.serialize(&Serializer::json_compatible()) {
                Ok(js_value) => {
                    if let Err(e) = callback.call1(&JsValue::NULL, &js_value) {
                        super::log(&format!("Error calling event callback: {:?}", e));
                    }
                }
                Err(e) => {
                    super::log(&format!("Error serializing event: {:?}", e));
                }
            }
        }
    });
}

/// Emit a selection changed event.
pub fn emit_selection_changed(selected_ids: Vec<String>, primary_id: Option<String>, primary_name: Option<String>) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SelectionPayload {
        selected_ids: Vec<String>,
        primary_id: Option<String>,
        primary_name: Option<String>,
    }

    emit_event("SELECTION_CHANGED", &SelectionPayload {
        selected_ids,
        primary_id,
        primary_name,
    });
}

/// Emit a scene graph update event.
pub fn emit_scene_graph_update(data: &crate::core::scene_graph::SceneGraphData) {
    emit_event("SCENE_GRAPH_UPDATE", data);
}

/// Emit a history changed event.
pub fn emit_history_changed(
    can_undo: bool,
    can_redo: bool,
    undo_description: Option<String>,
    redo_description: Option<String>,
) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoryPayload {
        can_undo: bool,
        can_redo: bool,
        undo_description: Option<String>,
        redo_description: Option<String>,
    }

    emit_event("HISTORY_CHANGED", &HistoryPayload {
        can_undo,
        can_redo,
        undo_description,
        redo_description,
    });
}

/// Emit a snap settings changed event.
pub fn emit_snap_settings_changed(settings: &crate::core::snap::SnapSettings) {
    emit_event("SNAP_SETTINGS_CHANGED", settings);
}

/// Emit a light changed event for the selected entity.
pub fn emit_light_changed(entity_id: &str, data: &crate::core::lighting::LightData) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LightPayload<'a> {
        entity_id: &'a str,
        #[serde(flatten)]
        data: &'a crate::core::lighting::LightData,
    }

    emit_event("LIGHT_CHANGED", &LightPayload {
        entity_id,
        data,
    });
}

/// Emit an ambient light changed event.
pub fn emit_ambient_light_changed(color: [f32; 3], brightness: f32) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AmbientPayload {
        color: [f32; 3],
        brightness: f32,
    }

    emit_event("AMBIENT_LIGHT_CHANGED", &AmbientPayload {
        color,
        brightness,
    });
}

/// Emit an environment changed event.
pub fn emit_environment_changed(settings: &crate::core::environment::EnvironmentSettings) {
    emit_event("ENVIRONMENT_CHANGED", settings);
}

/// Emit a post-processing settings changed event.
pub fn emit_post_processing_changed(
    settings: &crate::core::post_processing::PostProcessingSettings
) {
    emit_event("POST_PROCESSING_CHANGED", settings);
}

/// Emit an engine mode changed event.
pub fn emit_engine_mode_changed(mode: &crate::core::engine_mode::EngineMode) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ModePayload {
        mode: String,
    }

    emit_event("ENGINE_MODE_CHANGED", &ModePayload {
        mode: mode.as_str().to_string(),
    });
}

/// Emit an input bindings changed event.
pub fn emit_input_bindings_changed(input_map: &crate::core::input::InputMap) {
    emit_event("INPUT_BINDINGS_CHANGED", input_map);
}

/// Emit a physics changed event for an entity.
pub fn emit_physics_changed(entity_id: &str, physics_data: &crate::core::physics::PhysicsData, enabled: bool) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PhysicsPayload<'a> {
        entity_id: &'a str,
        enabled: bool,
        #[serde(flatten)]
        data: &'a crate::core::physics::PhysicsData,
    }

    emit_event("PHYSICS_CHANGED", &PhysicsPayload {
        entity_id,
        enabled,
        data: physics_data,
    });
}

/// Emit a debug physics toggle event.
pub fn emit_debug_physics_changed(enabled: bool) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DebugPhysicsPayload {
        enabled: bool,
    }

    emit_event("DEBUG_PHYSICS_CHANGED", &DebugPhysicsPayload { enabled });
}

/// Emit a scene exported event with the full JSON.
pub fn emit_scene_exported(json: &str, name: &str) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SceneExportedPayload<'a> {
        json: &'a str,
        name: &'a str,
    }

    emit_event("SCENE_EXPORTED", &SceneExportedPayload { json, name });
}

/// Emit a scene loaded event.
pub fn emit_scene_loaded(name: &str) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SceneLoadedPayload<'a> {
        name: &'a str,
    }

    emit_event("SCENE_LOADED", &SceneLoadedPayload { name });
}

/// Emit an asset imported event.
pub fn emit_asset_imported(asset_id: &str, name: &str, kind: &str, file_size: u64) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AssetImportedPayload<'a> {
        asset_id: &'a str,
        name: &'a str,
        kind: &'a str,
        file_size: u64,
    }

    emit_event("ASSET_IMPORTED", &AssetImportedPayload {
        asset_id,
        name,
        kind,
        file_size,
    });
}

/// Emit an asset deleted event.
pub fn emit_asset_deleted(asset_id: &str) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AssetDeletedPayload<'a> {
        asset_id: &'a str,
    }

    emit_event("ASSET_DELETED", &AssetDeletedPayload { asset_id });
}

/// Emit an asset list event.
pub fn emit_asset_list(registry: &crate::core::asset_manager::AssetRegistry) {
    emit_event("ASSET_LIST", registry);
}

/// Emit a material changed event for the selected entity.
pub fn emit_material_changed(entity_id: &str, data: &crate::core::material::MaterialData) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MaterialPayload<'a> {
        entity_id: &'a str,
        #[serde(flatten)]
        data: &'a crate::core::material::MaterialData,
    }

    emit_event("MATERIAL_CHANGED", &MaterialPayload {
        entity_id,
        data,
    });
}

/// Emit a script changed event for an entity.
pub fn emit_script_changed(entity_id: &str, script_data: Option<&crate::core::scripting::ScriptData>) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ScriptPayload<'a> {
        entity_id: &'a str,
        script: Option<&'a crate::core::scripting::ScriptData>,
    }

    emit_event("SCRIPT_CHANGED", &ScriptPayload {
        entity_id,
        script: script_data,
    });
}

/// Emit an audio changed event for an entity.
pub fn emit_audio_changed(entity_id: &str, audio_data: Option<&crate::core::audio::AudioData>) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AudioPayload<'a> {
        entity_id: &'a str,
        audio: Option<&'a crate::core::audio::AudioData>,
    }

    emit_event("AUDIO_CHANGED", &AudioPayload {
        entity_id,
        audio: audio_data,
    });
}

/// Emit an audio playback event.
pub fn emit_audio_playback(entity_id: &str, action: &str) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AudioPlaybackPayload<'a> {
        entity_id: &'a str,
        action: &'a str,
    }

    emit_event("AUDIO_PLAYBACK", &AudioPlaybackPayload {
        entity_id,
        action,
    });
}

/// Emit an audio buses changed event with the full bus configuration.
pub fn emit_audio_buses_changed(config: &crate::core::audio::AudioBusConfig) {
    emit_event("AUDIO_BUSES_CHANGED", config);
}

/// Emit a particle changed event for an entity.
pub fn emit_particle_changed(
    entity_id: &str,
    particle_data: Option<&crate::core::particles::ParticleData>,
    enabled: bool,
) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ParticlePayload<'a> {
        entity_id: &'a str,
        enabled: bool,
        particle: Option<&'a crate::core::particles::ParticleData>,
    }

    emit_event("PARTICLE_CHANGED", &ParticlePayload {
        entity_id,
        enabled,
        particle: particle_data,
    });
}

/// Emit an animation state changed event.
pub fn emit_animation_state_changed(state: &crate::core::animation::AnimationPlaybackState) {
    emit_event("ANIMATION_STATE_CHANGED", state);
}

/// Emit an animation list changed event (when clips are first discovered).
pub fn emit_animation_list_changed(state: &crate::core::animation::AnimationPlaybackState) {
    emit_event("ANIMATION_LIST_CHANGED", state);
}

/// Emit a shader effect changed event for an entity.
pub fn emit_shader_changed(entity_id: &str, data: Option<&crate::core::shader_effects::ShaderEffectData>) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ShaderPayload<'a> {
        entity_id: &'a str,
        data: Option<&'a crate::core::shader_effects::ShaderEffectData>,
    }
    emit_event("SHADER_CHANGED", &ShaderPayload { entity_id, data });
}

/// Emit a terrain changed event for an entity.
pub fn emit_terrain_changed(entity_id: &str, data: &crate::core::terrain::TerrainData) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TerrainPayload<'a> {
        entity_id: &'a str,
        #[serde(flatten)]
        data: &'a crate::core::terrain::TerrainData,
    }
    emit_event("TERRAIN_CHANGED", &TerrainPayload { entity_id, data });
}

/// Emit a CSG operation completed event.
pub fn emit_csg_completed(entity_id: &str, name: &str, operation: crate::core::csg::CsgOperation) {
    use crate::core::csg::CsgOperation;
    let op_str = match operation {
        CsgOperation::Union => "union",
        CsgOperation::Subtract => "subtract",
        CsgOperation::Intersect => "intersect",
    };
    emit_event("CSG_COMPLETED", &serde_json::json!({
        "entityId": entity_id,
        "name": name,
        "operation": op_str,
    }));
}

/// Emit a CSG operation error event.
pub fn emit_csg_error(message: &str) {
    emit_event("CSG_ERROR", &serde_json::json!({
        "message": message,
    }));
}

/// Emit a procedural mesh created event.
pub fn emit_procedural_mesh_created(entity_id: &str, name: &str, operation: &str) {
    emit_event("PROCEDURAL_MESH_CREATED", &serde_json::json!({
        "entityId": entity_id,
        "name": name,
        "operation": operation,
    }));
}

/// Emit a procedural mesh error event.
pub fn emit_procedural_mesh_error(message: &str) {
    emit_event("PROCEDURAL_MESH_ERROR", &serde_json::json!({
        "message": message,
    }));
}

/// Emit an array completed event.
pub fn emit_array_completed(source_id: &str, created_ids: &[String]) {
    emit_event("ARRAY_COMPLETED", &serde_json::json!({
        "sourceId": source_id,
        "createdIds": created_ids,
    }));
}

/// Emit a play tick event with all entity states for the script runtime.
pub fn emit_play_tick(entities: &[(String, [f32; 3], [f32; 3], [f32; 3], String, String, f32)], input_state: &crate::core::input::InputState) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct EntityState {
        position: [f32; 3],
        rotation: [f32; 3],
        scale: [f32; 3],
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct EntityInfo {
        name: String,
        #[serde(rename = "type")]
        entity_type: String,
        collider_radius: f32,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PlayTickPayload {
        entities: std::collections::HashMap<String, EntityState>,
        entity_infos: std::collections::HashMap<String, EntityInfo>,
        input_state: InputStatePayload,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct InputStatePayload {
        pressed: std::collections::HashMap<String, bool>,
        just_pressed: std::collections::HashMap<String, bool>,
        just_released: std::collections::HashMap<String, bool>,
        axes: std::collections::HashMap<String, f32>,
    }

    let mut entity_states = std::collections::HashMap::new();
    let mut entity_infos = std::collections::HashMap::new();

    for (id, pos, rot, scale, name, etype, collider_r) in entities {
        entity_states.insert(id.clone(), EntityState {
            position: *pos,
            rotation: *rot,
            scale: *scale,
        });
        entity_infos.insert(id.clone(), EntityInfo {
            name: name.clone(),
            entity_type: etype.clone(),
            collider_radius: *collider_r,
        });
    }

    let input_payload = InputStatePayload {
        pressed: input_state.actions.iter().map(|(k, v)| (k.clone(), v.pressed)).collect(),
        just_pressed: input_state.actions.iter().map(|(k, v)| (k.clone(), v.just_pressed)).collect(),
        just_released: input_state.actions.iter().map(|(k, v)| (k.clone(), v.just_released)).collect(),
        axes: input_state.actions.iter().map(|(k, v)| (k.clone(), v.axis_value)).collect(),
    };

    emit_event("PLAY_TICK", &PlayTickPayload {
        entities: entity_states,
        entity_infos,
        input_state: input_payload,
    });
}

/// Emit a quality settings changed event.
pub fn emit_quality_changed(settings: &crate::core::quality::QualitySettings) {
    emit_event("QUALITY_CHANGED", settings);
}

/// Emit a collision event (started or stopped).
pub fn emit_collision_event(entity_a: &str, entity_b: &str, started: bool) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CollisionPayload<'a> {
        entity_a: &'a str,
        entity_b: &'a str,
        started: bool,
    }
    emit_event("COLLISION_EVENT", &CollisionPayload { entity_a, entity_b, started });
}

/// Emit a raycast result event.
pub fn emit_raycast_result(request_id: &str, hit_entity: Option<&str>, point: [f32; 3], distance: f32) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RaycastPayload<'a> {
        request_id: &'a str,
        hit_entity: Option<&'a str>,
        point: [f32; 3],
        distance: f32,
    }
    emit_event("RAYCAST_RESULT", &RaycastPayload { request_id, hit_entity, point, distance });
}
