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
