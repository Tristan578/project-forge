//! Bridge layer - all JavaScript interop lives here.
//!
//! This module is the ONLY place where web_sys, js_sys, and wasm_bindgen
//! should be used. It translates between JS and the pure Rust core.

pub mod events;
mod core_systems;
mod material;
mod physics;
mod audio;
mod query;
mod animation;
mod particles;
mod scene_io;
mod procedural;
mod mesh_ops;
mod scripts;
mod game;
mod skeleton2d;

use bevy::prelude::*;
use bevy::window::{PresentMode, Window, WindowPlugin};
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use crate::core::{
    self,
    animation::AnimationPlugin,
    asset_manager::{AssetRegistry, TextureHandleMap},
    audio::AudioBusConfig,
    camera::CameraControlPlugin,
    commands::CommandResponse,
    engine_mode::{EngineMode, SceneSnapshot},
    entity_factory,
    environment::{EnvironmentPlugin, SkyboxHandles},
    history::HistoryStack,
    input::InputPlugin,
    lighting::LightingPlugin,
    material::MaterialPlugin,
    observability::ObservabilityPlugin,
    pending_commands::PendingCommands,
    physics::PhysicsPlugin,
    post_processing::PostProcessingPlugin,
    quality::QualitySettings,
    scene,
    scene_file::SceneName,
    scene_graph::{self, SceneGraphCache},
    selection::{Selection, SelectionChangedEvent},
    shader_effects::ShaderEffectsPlugin,
};

// Editor-only imports
#[cfg(not(feature = "runtime"))]
use crate::core::{
    engine_mode::{EditorSystemSet, in_edit_mode},
    gizmo::ForgeGizmoPlugin,
    snap::SnapPlugin,
    visibility,
};

#[cfg(not(feature = "runtime"))]
use core_systems::PickBuffer;

// Thread-local callback storage for init events (WASM is single-threaded)
thread_local! {
    static INIT_CALLBACK: RefCell<Option<js_sys::Function>> = const { RefCell::new(None) };
}

/// Set the callback function for initialization events.
/// Call this before init_engine to receive lifecycle events.
#[wasm_bindgen]
pub fn set_init_callback(callback: js_sys::Function) {
    INIT_CALLBACK.with(|cb| {
        *cb.borrow_mut() = Some(callback);
    });
    log("Init callback registered");
}

/// Emit an initialization event to JavaScript.
/// This is called internally during engine startup.
pub fn emit_init_event(phase: &str, message: Option<&str>, error: Option<&str>) {
    // Log to console
    if let Some(err) = error {
        log(&format!("[Init] {} - ERROR: {}", phase, err));
    } else if let Some(msg) = message {
        log(&format!("[Init] {} - {}", phase, msg));
    } else {
        log(&format!("[Init] {}", phase));
    }

    // Call JS callback if registered
    INIT_CALLBACK.with(|cb| {
        if let Some(callback) = cb.borrow().as_ref() {
            let this = JsValue::NULL;
            let phase_js = JsValue::from_str(phase);
            let message_js = message.map(JsValue::from_str).unwrap_or(JsValue::UNDEFINED);
            let error_js = error.map(JsValue::from_str).unwrap_or(JsValue::UNDEFINED);

            let _ = callback.call3(&this, &phase_js, &message_js, &error_js);
        }
    });
}

/// Initialize the Forge engine and attach to a canvas element.
/// This function is idempotent - subsequent calls are no-ops.
#[wasm_bindgen]
pub fn init_engine(canvas_id: &str) -> Result<(), JsValue> {
    // Set panic hook for better error messages in browser console
    console_error_panic_hook::set_once();

    // Singleton check - only initialize once
    if core::Engine::is_initialized() {
        log("Forge Engine already initialized, skipping.");
        return Ok(());
    }

    emit_init_event("engine_starting", Some(&format!("Initializing on canvas: {}", canvas_id)), None);

    // Mark as initialized before starting Bevy (run() doesn't return on WASM)
    core::Engine::mark_initialized();

    let canvas_selector = format!("#{}", canvas_id);

    emit_init_event("bevy_plugins", Some("Registering DefaultPlugins..."), None);

    let mut app = App::new();

    app.add_plugins(
            DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        canvas: Some(canvas_selector.into()),
                        fit_canvas_to_parent: true,
                        prevent_default_event_handling: false,
                        present_mode: PresentMode::AutoNoVsync,
                        ..default()
                    }),
                    ..default()
                })
                .set(bevy::log::LogPlugin {
                    level: bevy::log::Level::WARN,
                    filter: "wgpu=error,naga=error,bevy_render=warn,bevy_ecs=warn".to_string(),
                    ..default()
                }),
        );

    // Picking and other plugins
    app.add_plugins(MeshPickingPlugin)
        .add_plugins(ObservabilityPlugin)
        .add_plugins(SelectionPlugin)
        .add_plugins(MaterialPlugin)
        .add_plugins(LightingPlugin)
        .add_plugins(EnvironmentPlugin)
        .add_plugins(PostProcessingPlugin)
        .add_plugins(InputPlugin)
        .add_plugins(PhysicsPlugin)
        .add_plugins(ShaderEffectsPlugin)
        .add_plugins(CameraControlPlugin)
        .add_plugins(core::game_camera::GameCameraPlugin);

    // Editor-only plugins
    #[cfg(not(feature = "runtime"))]
    app.add_plugins(ForgeGizmoPlugin)
        .add_plugins(SnapPlugin);

    app.add_systems(PreStartup, || {
            emit_init_event("renderer_init", Some("Acquiring GPU adapter..."), None);
        })
        .add_systems(Startup, scene::setup_scene)
        .add_systems(Startup, || {
            emit_init_event("scene_setup", Some("Setting up scene..."), None);
        })
        .run();

    // Note: On WASM, run() enters an async event loop and doesn't return.
    // The code below won't execute, but is kept for native builds.
    log("Forge Engine initialized successfully.");

    Ok(())
}

/// Handle a command from JavaScript.
/// Accepts a command string and a JsValue payload, parses them,
/// and dispatches to the appropriate handler in core.
#[wasm_bindgen]
pub fn handle_command(command: &str, payload: JsValue) -> Result<JsValue, JsValue> {
    // Parse the payload from JsValue to serde_json::Value
    let payload_value: serde_json::Value = serde_wasm_bindgen::from_value(payload)
        .unwrap_or(serde_json::Value::Null);

    log(&format!("Received command: {} with payload: {:?}", command, payload_value));

    // Dispatch to core command handler
    let result = core::commands::dispatch(command, payload_value);

    // Convert result to JsValue response
    let response = match result {
        Ok(()) => CommandResponse::ok(),
        Err(e) => CommandResponse::err(e),
    };

    response.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Update engine state from JSON scene graph (legacy API).
#[wasm_bindgen]
pub fn update_scene(scene_json: &str) -> Result<(), JsValue> {
    let payload: serde_json::Value = serde_json::from_str(scene_json)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    core::commands::dispatch("update_scene", payload)
        .map_err(|e| JsValue::from_str(&e))
}

/// Helper to log to browser console
fn log(message: &str) {
    web_sys::console::log_1(&message.into());
}

/// Send an event to the JavaScript frontend.
/// This is how the engine communicates back to React.
#[wasm_bindgen]
pub fn set_event_callback(callback: js_sys::Function) {
    events::set_event_callback_impl(callback);
}

/// Picking plugin for entity selection via raycast.
pub struct SelectionPlugin;

impl Plugin for SelectionPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(AnimationPlugin);

        #[cfg(feature = "webgpu")]
        app.add_plugins(bevy_hanabi::HanabiPlugin);

        app.init_resource::<Selection>()
            .init_resource::<SceneGraphCache>()
            .init_resource::<PendingCommands>()
            .init_resource::<HistoryStack>()
            .init_resource::<EngineMode>()
            .init_resource::<SceneSnapshot>()
            .init_resource::<SceneName>()
            .init_resource::<AssetRegistry>()
            .init_resource::<TextureHandleMap>()
            .init_resource::<AudioBusConfig>()
            .init_resource::<QualitySettings>()
            .init_resource::<SkyboxHandles>()
            .add_event::<SelectionChangedEvent>();

        #[cfg(not(feature = "runtime"))]
        app.init_resource::<PickBuffer>();

        app
            .add_systems(Startup, (core_systems::register_pending_commands_resource, core_systems::register_history_stack_resource))
            // Always-active systems: run in both editor and runtime
            .add_systems(Update, query::process_query_requests)
            .add_systems(Update, query::process_terrain_queries)
            .add_systems(Update, query::process_quality_queries)
            .add_systems(Update, query::process_reverb_zone_queries);

        #[cfg(not(feature = "runtime"))]
        app.add_systems(Update, query::process_joint_queries);

        app
            .add_systems(Update, scripts::emit_play_tick_system)
            .add_systems(Update, core_systems::apply_mode_change_requests)
            .add_systems(Update, scripts::apply_input_binding_updates)
            .add_systems(Update, physics::apply_physics_updates)
            .add_systems(Update, physics::apply_physics_toggles)
            .add_systems(Update, physics::apply_force_applications)
            .add_systems(Update, scripts::apply_script_updates)
            // 2D Physics systems (always-active, metadata-only)
            .add_systems(Update, (
                physics::apply_physics2d_updates,
                physics::apply_physics2d_toggles,
                physics::apply_force_applications2d,
            ))
            .add_systems(Update, (
                physics::apply_impulse_applications2d,
                physics::apply_raycast2d_requests,
            ))
            // Collision/raycast systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                physics::read_collision_events,
                physics::apply_raycast_queries,
            ))
            // Script and audio systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                scripts::apply_script_removals,
                audio::apply_audio_updates,
                audio::apply_audio_removals,
            ))
            .add_systems(Update, (
                audio::apply_audio_playback,
                audio::apply_audio_bus_updates,
                audio::apply_reverb_zone_updates,
            ))
            .add_systems(Update, audio::apply_reverb_zone_toggles)
            // Audio bus systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                audio::apply_audio_bus_creates,
                audio::apply_audio_bus_deletes,
                audio::apply_audio_bus_effects_updates,
            ))
            .add_systems(Update, query::apply_quality_presets)
            // Entity factory and particle systems (always-active, split to stay under tuple limit)
            .add_systems(Update, entity_factory::apply_spawn_requests)
            .add_systems(Update, entity_factory::apply_delete_requests)
            .add_systems(Update, particles::apply_particle_updates)
            .add_systems(Update, particles::apply_particle_toggles)
            .add_systems(Update, particles::apply_particle_removals)
            .add_systems(Update, particles::apply_particle_preset_requests)
            .add_systems(Update, particles::apply_particle_playback);

        // WebGPU-only: sync ParticleData to bevy_hanabi GPU effects
        #[cfg(feature = "webgpu")]
        app.add_systems(Update, particles::sync_hanabi_effects);

        app
            // Animation systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                animation::register_gltf_animations,
                animation::apply_animation_requests,
            ))
            // Shader sync system (always-active)
            .add_systems(Update, material::sync_extended_material_data)
            .add_systems(PostUpdate, (
                scene_graph::detect_entity_added,
                scene_graph::detect_entity_removed,
                scene_graph::detect_name_changed,
                scene_graph::detect_visibility_changed,
                scene_graph::detect_parent_changed,
                scene_graph::build_scene_graph,
            ).chain());

        // Editor-only systems and observers
        #[cfg(not(feature = "runtime"))]
        {
            app.add_observer(core_systems::handle_picking_pressed)
                .configure_sets(Update, EditorSystemSet.run_if(in_edit_mode))
                .add_systems(Update, (
                    core_systems::apply_pending_transforms,
                    core_systems::apply_pending_renames,
                    core_systems::apply_pending_snap_settings,
                    material::apply_pending_coordinate_mode,
                    entity_factory::apply_duplicate_requests,
                    entity_factory::apply_material_updates,
                    entity_factory::apply_light_updates,
                    entity_factory::apply_ambient_light_updates,
                    material::apply_environment_updates,
                    material::apply_set_skybox_requests,
                    material::apply_remove_skybox_requests,
                    material::apply_update_skybox_requests,
                    material::apply_custom_skybox_requests,
                    material::apply_post_processing_updates,
                    material::apply_shader_updates,
                    material::apply_shader_removals,
                    entity_factory::apply_undo_requests,
                    entity_factory::apply_redo_requests,
                    core::reparent::apply_reparent_requests,
                    core_systems::apply_selection_requests,
                ).in_set(EditorSystemSet))
                .add_systems(Update, (
                    core_systems::process_pick_buffer,
                    core_systems::emit_selection_events,
                    core_systems::emit_transform_on_selection,
                    material::emit_material_on_selection,
                    material::emit_light_on_selection,
                    physics::emit_physics_on_selection,
                    physics::emit_joint_on_selection,
                    scripts::emit_script_on_selection,
                    audio::emit_audio_on_selection,
                    audio::emit_reverb_zone_on_selection,
                    particles::emit_particle_on_selection,
                    material::emit_shader_on_selection,
                    animation::emit_animation_on_selection,
                    game::emit_game_camera_on_selection,
                    skeleton2d::emit_skeleton2d_on_selection,
                    visibility::sync_visibility,
                ).chain().in_set(EditorSystemSet))
                .add_systems(Update, animation::poll_animation_state.in_set(EditorSystemSet))
                .add_systems(Update, procedural::apply_csg_requests.in_set(EditorSystemSet))
                .add_systems(Update, (
                    procedural::apply_extrude_requests,
                    procedural::apply_lathe_requests,
                    mesh_ops::apply_array_requests,
                    mesh_ops::apply_combine_requests,
                ).in_set(EditorSystemSet))
                .add_systems(Update, (
                    physics::apply_debug_physics_toggle,
                    physics::apply_create_joint_requests,
                    physics::apply_update_joint_requests,
                    physics::apply_remove_joint_requests,
                ))
                .add_systems(Update, (
                    physics::apply_create_joint2d_requests,
                    physics::apply_remove_joint2d_requests,
                    physics::apply_gravity2d_updates,
                    physics::apply_debug_physics2d_toggle,
                    physics::handle_physics2d_query,
                ))
                .add_systems(Update, (
                    scene_io::apply_scene_export,
                    scene_io::apply_scene_load,
                ))
                .add_systems(Update, (
                    scene_io::apply_new_scene,
                    scene_io::apply_gltf_import,
                    scene_io::apply_texture_load,
                    scene_io::apply_remove_texture,
                ))
                .add_systems(Update, (
                    scene_io::apply_place_asset,
                    scene_io::apply_delete_asset,
                    mesh_ops::apply_instantiate_prefab,
                ))
                .add_systems(Update, (
                    game::apply_game_component_adds,
                    game::apply_game_component_updates,
                    game::apply_game_component_removals,
                    game::process_game_component_queries,
                ))
                .add_systems(Update, (
                    game::apply_set_game_camera_requests,
                    game::apply_set_active_game_camera_requests,
                    game::apply_camera_shake_requests,
                    game::process_game_camera_queries,
                ))
                .add_systems(Update, (
                    skeleton2d::apply_skeleton2d_creates,
                    skeleton2d::apply_bone2d_adds,
                    skeleton2d::apply_bone2d_removes,
                    skeleton2d::apply_bone2d_updates,
                    skeleton2d::apply_skeletal_animation2d_creates,
                    skeleton2d::apply_keyframe2d_adds,
                    skeleton2d::apply_skeletal_animation2d_plays,
                    skeleton2d::apply_skeleton2d_skin_sets,
                    skeleton2d::apply_ik_chain2d_creates,
                    skeleton2d::handle_skeleton2d_query,
                    skeleton2d::apply_auto_weight_skeleton2d,
                ))
                .add_systems(PostUpdate, (
                    core_systems::emit_scene_graph_updates,
                    core_systems::emit_history_updates,
                ).chain());
        }
    }
}
