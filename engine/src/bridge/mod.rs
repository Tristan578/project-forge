//! Bridge layer - all JavaScript interop lives here.
//!
//! This module is the ONLY place where web_sys, js_sys, and wasm_bindgen
//! should be used. It translates between JS and the pure Rust core.

pub mod events;

use bevy::prelude::*;
use bevy::window::{PresentMode, Window, WindowPlugin};
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use crate::core::{
    self,
    animation::{AnimationPlugin, AnimationRegistry, AnimationPlaybackState, AnimationClipInfo, HasAnimations},
    asset_manager::{AssetRef, AssetRegistry},
    audio::{AudioBusConfig, AudioData, AudioEnabled},
    particles::{ParticleData, ParticleEnabled},
    camera::CameraControlPlugin,
    commands::CommandResponse,
    engine_mode::{EngineMode, SceneSnapshot, ModeChangeRequest},
    entity_factory,
    entity_id::{EntityId, EntityName, EntityVisible},
    environment::{EnvironmentPlugin, EnvironmentSettings},
    history::{self, EntitySnapshot as HistEntitySnapshot, HistoryStack, TransformSnapshot},
    post_processing::{PostProcessingPlugin, PostProcessingSettings},
    input::{InputMap, InputPlugin, InputState},
    lighting::{LightData, LightingPlugin},
    physics::{PhysicsData, PhysicsEnabled, PhysicsPlugin},
    material::{MaterialData, MaterialPlugin},
    observability::ObservabilityPlugin,
    pending_commands::{self, EntityType, PendingCommands},
    scene,
    scene_file::{self, SceneName},
    scene_graph::{self, SceneGraphCache},
    scripting::ScriptData,
    selection::{Selection, SelectionChangedEvent},
    shader_effects::{ShaderEffectsPlugin, ShaderEffectData, ForgeShaderExtension, ForgeMaterial},
    terrain::TerrainData,
    quality::QualitySettings,
};
use bevy::animation::{AnimationClip, AnimationPlayer, RepeatAnimation, graph::{AnimationGraph, AnimationGraphHandle}, transition::AnimationTransitions};
use bevy::gltf::Gltf;

// Editor-only imports
#[cfg(not(feature = "runtime"))]
use crate::core::{
    engine_mode::{EditorSystemSet, in_edit_mode},
    gizmo::{CoordinateMode, ForgeGizmoPlugin},
    physics::DebugPhysicsEnabled,
    snap::{SnapPlugin, SnapSettings},
    visibility,
};

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
        .add_plugins(CameraControlPlugin);

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

/// Buffer for collecting picking hits within a frame, so we can select the closest.
#[cfg(not(feature = "runtime"))]
#[derive(Resource, Default)]
struct PickBuffer {
    hits: Vec<PickHit>,
    ctrl_held: bool,
}

#[cfg(not(feature = "runtime"))]
struct PickHit {
    entity: Entity,
    entity_id: String,
    entity_name: Option<String>,
    depth: f32,
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
            .init_resource::<crate::core::asset_manager::TextureHandleMap>()
            .init_resource::<AudioBusConfig>()
            .init_resource::<QualitySettings>()
            .init_resource::<core::environment::SkyboxHandles>()
            .add_event::<SelectionChangedEvent>();

        #[cfg(not(feature = "runtime"))]
        app.init_resource::<PickBuffer>();

        app
            .add_systems(Startup, (register_pending_commands_resource, register_history_stack_resource))
            // Always-active systems: run in both editor and runtime
            .add_systems(Update, process_query_requests)
            .add_systems(Update, process_terrain_queries)
            .add_systems(Update, process_quality_queries)
            .add_systems(Update, emit_play_tick_system)
            .add_systems(Update, (
                apply_mode_change_requests,
                apply_input_binding_updates,
                apply_physics_updates,
                apply_physics_toggles,
                apply_force_applications,
                apply_script_updates,
            ))
            // Collision/raycast systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                read_collision_events,
                apply_raycast_queries,
            ))
            // Script and audio systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                apply_script_removals,
                apply_audio_updates,
                apply_audio_removals,
                apply_audio_playback,
                apply_audio_bus_updates,
            ))
            // Audio bus systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                apply_audio_bus_creates,
                apply_audio_bus_deletes,
                apply_audio_bus_effects_updates,
                apply_quality_presets,
            ))
            // Entity factory and particle systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                entity_factory::apply_spawn_requests,
                entity_factory::apply_delete_requests,
                apply_particle_updates,
                apply_particle_toggles,
                apply_particle_removals,
                apply_particle_preset_requests,
                apply_particle_playback,
            ));

        // WebGPU-only: sync ParticleData to bevy_hanabi GPU effects
        #[cfg(feature = "webgpu")]
        app.add_systems(Update, sync_hanabi_effects);

        app
            // Animation systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                register_gltf_animations,
                apply_animation_requests,
            ))
            // Shader sync system (always-active)
            .add_systems(Update, sync_extended_material_data)
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
            app.add_observer(handle_picking_pressed)
                .configure_sets(Update, EditorSystemSet.run_if(in_edit_mode))
                .add_systems(Update, (
                    apply_pending_transforms,
                    apply_pending_renames,
                    apply_pending_snap_settings,
                    apply_pending_coordinate_mode,
                    entity_factory::apply_duplicate_requests,
                    entity_factory::apply_material_updates,
                    entity_factory::apply_light_updates,
                    entity_factory::apply_ambient_light_updates,
                    apply_environment_updates,
                    apply_set_skybox_requests,
                    apply_remove_skybox_requests,
                    apply_update_skybox_requests,
                    apply_post_processing_updates,
                    apply_shader_updates,
                    apply_shader_removals,
                    entity_factory::apply_undo_requests,
                    entity_factory::apply_redo_requests,
                    core::reparent::apply_reparent_requests,
                    apply_selection_requests,
                ).in_set(EditorSystemSet))
                .add_systems(Update, (
                    process_pick_buffer,
                    emit_selection_events,
                    emit_transform_on_selection,
                    emit_material_on_selection,
                    emit_light_on_selection,
                    emit_physics_on_selection,
                    emit_script_on_selection,
                    emit_audio_on_selection,
                    emit_particle_on_selection,
                    emit_shader_on_selection,
                    emit_animation_on_selection,
                    visibility::sync_visibility,
                ).chain().in_set(EditorSystemSet))
                .add_systems(Update, poll_animation_state.in_set(EditorSystemSet))
                .add_systems(Update, apply_csg_requests.in_set(EditorSystemSet))
                .add_systems(Update, (
                    apply_extrude_requests,
                    apply_lathe_requests,
                    apply_array_requests,
                    apply_combine_requests,
                ).in_set(EditorSystemSet))
                .add_systems(Update, (
                    apply_debug_physics_toggle,
                    apply_scene_export,
                    apply_scene_load,
                    apply_new_scene,
                    apply_gltf_import,
                    apply_texture_load,
                    apply_remove_texture,
                ))
                .add_systems(Update, (
                    apply_place_asset,
                    apply_delete_asset,
                    apply_instantiate_prefab,
                ))
                .add_systems(PostUpdate, (
                    emit_scene_graph_updates,
                    emit_history_updates,
                ).chain());
        }
    }
}

/// System that processes mode change requests (play/stop/pause/resume).
/// Uses ParamSet because snapshot_query (read) and restore_query (write)
/// access overlapping components (Transform, EntityName, etc.).
fn apply_mode_change_requests(
    mut pending: ResMut<PendingCommands>,
    mut mode: ResMut<EngineMode>,
    mut snapshot: ResMut<SceneSnapshot>,
    mut selection: ResMut<Selection>,
    mut queries: ParamSet<(
        Query<(
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
            Option<&Mesh3d>,
            Option<&PointLight>,
            Option<&DirectionalLight>,
            Option<&SpotLight>,
            Option<&AssetRef>,
        )>,
        Query<(
            Entity,
            &EntityId,
            &mut Transform,
            &mut EntityName,
            &mut EntityVisible,
            Option<&mut MaterialData>,
            Option<&mut LightData>,
            Option<&mut PhysicsData>,
        ), Without<entity_factory::Undeletable>>,
    )>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_snapshot_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_snapshot_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_snapshot_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&crate::core::procedural_mesh::ProceduralMeshData>)>,
    runtime_query: Query<Entity, With<core::engine_mode::RuntimeEntity>>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    let requests: Vec<ModeChangeRequest> = pending.mode_change_requests.drain(..).collect();
    for request in requests {
        let current = *mode;
        match request {
            ModeChangeRequest::Play => {
                if current != EngineMode::Edit { continue; }
                // Snapshot the scene (uses read-only query p0)
                {
                    let snapshot_query = queries.p0();
                    *snapshot = core::engine_mode::snapshot_scene(&snapshot_query, &script_query, &audio_query, &particle_snapshot_query, &shader_snapshot_query, &csg_snapshot_query, &procedural_mesh_query, &selection);
                }
                // Clear selection for play mode
                selection.clear();
                selection_events.write(SelectionChangedEvent {
                    selected_ids: vec![],
                    primary_id: None,
                    primary_name: None,
                });
                *mode = EngineMode::Play;
                events::emit_engine_mode_changed(&mode);
                log("Entered Play mode");
            }
            ModeChangeRequest::Stop => {
                if current == EngineMode::Edit { continue; }
                // Restore scene from snapshot (uses mutable query p1)
                {
                    let restore_query = queries.p1();
                    core::engine_mode::restore_scene(
                        &mut commands,
                        &snapshot,
                        &restore_query,
                        &runtime_query,
                        &mut meshes,
                        &mut materials,
                    );
                }
                // Restore transform state for existing entities
                {
                    let mut restore_query = queries.p1();
                    for snap in &snapshot.entities {
                        for (_, eid, mut transform, mut ename, mut visible, mat_data, light_data, phys_data) in restore_query.iter_mut() {
                            if eid.0 == snap.entity_id {
                                *transform = snap.transform.to_transform();
                                ename.0 = snap.name.clone();
                                visible.0 = snap.visible;
                                if let (Some(snap_mat), Some(mut current_mat)) = (&snap.material_data, mat_data) {
                                    *current_mat = snap_mat.clone();
                                }
                                if let (Some(snap_light), Some(mut current_light)) = (&snap.light_data, light_data) {
                                    *current_light = snap_light.clone();
                                }
                                if let (Some(snap_phys), Some(mut current_phys)) = (&snap.physics_data, phys_data) {
                                    *current_phys = snap_phys.clone();
                                }
                                break;
                            }
                        }
                    }
                }
                *mode = EngineMode::Edit;
                events::emit_engine_mode_changed(&mode);
                log("Exited Play mode (scene restored)");
            }
            ModeChangeRequest::Pause => {
                if current != EngineMode::Play { continue; }
                *mode = EngineMode::Paused;
                events::emit_engine_mode_changed(&mode);
                log("Paused Play mode");
            }
            ModeChangeRequest::Resume => {
                if current != EngineMode::Paused { continue; }
                *mode = EngineMode::Play;
                events::emit_engine_mode_changed(&mode);
                log("Resumed Play mode");
            }
        }
    }
}

/// System that processes pending selection requests from the hierarchy panel.
#[cfg(not(feature = "runtime"))]
fn apply_selection_requests(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId, Option<&EntityName>)>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    for request in pending.selection_requests.drain(..) {
        // Find the entity by ID
        if let Some((entity, _, entity_name)) = query
            .iter()
            .find(|(_, eid, _)| eid.0 == request.entity_id)
        {
            let name = entity_name.map(|n| n.0.clone());

            match request.mode {
                pending_commands::SelectionMode::Replace => {
                    selection.select_one(entity, request.entity_id.clone());
                }
                pending_commands::SelectionMode::Add => {
                    selection.add(entity, request.entity_id.clone());
                }
                pending_commands::SelectionMode::Toggle => {
                    selection.toggle(entity, request.entity_id.clone());
                }
            }

            // Emit selection changed event
            selection_events.write(SelectionChangedEvent {
                selected_ids: selection.selected_ids(),
                primary_id: selection.primary_id.clone(),
                primary_name: name,
            });
        }
    }
}

/// System that emits transform data when the primary selection changes.
#[cfg(not(feature = "runtime"))]
fn emit_transform_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &Transform)>,
) {
    // Only run when Selection resource changes
    if !selection.is_changed() {
        return;
    }

    if let Some(primary) = selection.primary {
        if let Ok((entity_id, transform)) = query.get(primary) {
            let (rx, ry, rz) = transform.rotation.to_euler(bevy::math::EulerRot::XYZ);

            let payload = core::gizmo::TransformPayload {
                entity_id: entity_id.0.clone(),
                position: [
                    transform.translation.x,
                    transform.translation.y,
                    transform.translation.z,
                ],
                rotation: [rx, ry, rz],
                scale: [transform.scale.x, transform.scale.y, transform.scale.z],
            };

            events::emit_event("TRANSFORM_CHANGED", &payload);
        }
    }
}

/// Observer that collects picking hits into the PickBuffer.
/// Uses Pointer<Pressed> instead of Pointer<Click> because Click requires
/// press+release on the same entity, which is unreliable in WASM.
#[cfg(not(feature = "runtime"))]
fn handle_picking_pressed(
    trigger: Trigger<Pointer<Pressed>>,
    query: Query<(&EntityId, Option<&EntityName>)>,
    mut pick_buffer: ResMut<PickBuffer>,
    keyboard: Res<ButtonInput<KeyCode>>,
) {
    let event = trigger.event();

    // Only handle left clicks
    if event.button != PointerButton::Primary {
        return;
    }

    let entity = trigger.target();

    if let Ok((entity_id, entity_name)) = query.get(entity) {
        pick_buffer.hits.push(PickHit {
            entity,
            entity_id: entity_id.0.clone(),
            entity_name: entity_name.map(|n| n.0.clone()),
            depth: event.hit.depth,
        });
        pick_buffer.ctrl_held = keyboard.pressed(KeyCode::ControlLeft)
            || keyboard.pressed(KeyCode::ControlRight);
    }
}

/// System that processes the pick buffer and selects the closest entity.
#[cfg(not(feature = "runtime"))]
fn process_pick_buffer(
    mut pick_buffer: ResMut<PickBuffer>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    if pick_buffer.hits.is_empty() {
        return;
    }

    // Find the closest hit (smallest depth)
    let closest = pick_buffer.hits.iter()
        .min_by(|a, b| a.depth.partial_cmp(&b.depth).unwrap_or(std::cmp::Ordering::Equal));

    if let Some(hit) = closest {
        let ctrl_held = pick_buffer.ctrl_held;

        if ctrl_held {
            selection.toggle(hit.entity, hit.entity_id.clone());
        } else {
            selection.select_one(hit.entity, hit.entity_id.clone());
        }

        selection_events.write(SelectionChangedEvent {
            selected_ids: selection.selected_ids(),
            primary_id: selection.primary_id.clone(),
            primary_name: hit.entity_name.clone(),
        });
    }

    pick_buffer.hits.clear();
}

/// System that emits selection events to JavaScript when selection changes.
#[cfg(not(feature = "runtime"))]
fn emit_selection_events(
    mut events: EventReader<SelectionChangedEvent>,
) {
    for event in events.read() {
        events::emit_selection_changed(
            event.selected_ids.clone(),
            event.primary_id.clone(),
            event.primary_name.clone(),
        );
    }
}

/// System that emits material data when the primary selection has a MaterialData component.
#[cfg(not(feature = "runtime"))]
fn emit_material_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &MaterialData), Changed<MaterialData>>,
    selection_query: Query<(&EntityId, &MaterialData)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, mat_data)) = selection_query.get(primary) {
                events::emit_material_changed(&entity_id.0, mat_data);
            }
        }
    }

    // Emit when material data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, mat_data)) = query.get(primary) {
            events::emit_material_changed(&entity_id.0, mat_data);
        }
    }
}

/// System that emits light data when the primary selection has a LightData component.
#[cfg(not(feature = "runtime"))]
fn emit_light_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &LightData), Changed<LightData>>,
    selection_query: Query<(&EntityId, &LightData)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, light_data)) = selection_query.get(primary) {
                events::emit_light_changed(&entity_id.0, light_data);
            }
        }
    }

    // Emit when light data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, light_data)) = query.get(primary) {
            events::emit_light_changed(&entity_id.0, light_data);
        }
    }
}

/// System that emits scene graph updates when the graph is dirty.
#[cfg(not(feature = "runtime"))]
fn emit_scene_graph_updates(
    mut cache: ResMut<SceneGraphCache>,
) {
    if cache.dirty && events::has_event_callback() {
        events::emit_scene_graph_update(&cache.data);
        cache.dirty = false;
    }
}

/// System that emits history state updates when history changes.
#[cfg(not(feature = "runtime"))]
fn emit_history_updates(
    mut history: ResMut<HistoryStack>,
) {
    if history.dirty && events::has_event_callback() {
        events::emit_history_changed(
            history.can_undo(),
            history.can_redo(),
            history.undo_description(),
            history.redo_description(),
        );
        history.dirty = false;
    }
}

/// Startup system to register the PendingCommands resource for bridge access.
fn register_pending_commands_resource(
    mut commands_res: ResMut<PendingCommands>,
) {
    let ptr = commands_res.as_mut() as *mut PendingCommands;
    pending_commands::register_pending_commands(ptr);
    log("PendingCommands resource registered for bridge access");
}

/// Startup system to register the HistoryStack resource for bridge access.
fn register_history_stack_resource(
    mut history_res: ResMut<HistoryStack>,
) {
    let ptr = history_res.as_mut() as *mut HistoryStack;
    history::register_history_stack(ptr);
    log("HistoryStack resource registered for bridge access");
}

/// System that applies pending transform updates from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_pending_transforms(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut Transform)>,
) {
    for update in pending.transform_updates.drain(..) {
        for (entity_id, mut transform) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                if let Some(pos) = update.position {
                    transform.translation = pos;
                }
                if let Some(rot) = update.rotation {
                    transform.rotation = rot;
                }
                if let Some(scale) = update.scale {
                    transform.scale = scale;
                }
                break;
            }
        }
    }
}

/// System that applies pending rename requests from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_pending_renames(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut EntityName)>,
    mut cache: ResMut<SceneGraphCache>,
) {
    for request in pending.rename_requests.drain(..) {
        for (entity_id, mut name) in query.iter_mut() {
            if entity_id.0 == request.entity_id {
                name.0 = request.new_name.clone();
                // Mark scene graph as dirty so it emits an update
                cache.dirty = true;
                break;
            }
        }
    }
}

/// System that applies pending snap settings changes from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_pending_snap_settings(
    mut pending: ResMut<PendingCommands>,
    mut snap_settings: ResMut<SnapSettings>,
) {
    for update in pending.snap_settings_updates.drain(..) {
        if let Some(v) = update.translation_snap {
            snap_settings.translation_snap = v;
        }
        if let Some(v) = update.rotation_snap_degrees {
            snap_settings.rotation_snap_degrees = v;
        }
        if let Some(v) = update.scale_snap {
            snap_settings.scale_snap = v;
        }
        if let Some(v) = update.grid_visible {
            snap_settings.grid_visible = v;
        }
        if let Some(v) = update.grid_size {
            snap_settings.grid_size = v;
        }
        if let Some(v) = update.grid_extent {
            snap_settings.grid_extent = v;
        }

        // Emit event to React
        events::emit_snap_settings_changed(&snap_settings);
    }

    for _ in pending.grid_toggles.drain(..) {
        snap_settings.grid_visible = !snap_settings.grid_visible;
        events::emit_snap_settings_changed(&snap_settings);
    }
}

/// System that applies pending environment updates from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_environment_updates(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
) {
    for update in pending.environment_updates.drain(..) {
        if let Some(v) = update.skybox_brightness { settings.skybox_brightness = v; }
        if let Some(v) = update.ibl_intensity { settings.ibl_intensity = v; }
        if let Some(v) = update.ibl_rotation_degrees { settings.ibl_rotation_degrees = v; }
        if let Some(v) = update.clear_color { settings.clear_color = v; }
        if let Some(v) = update.fog_enabled { settings.fog_enabled = v; }
        if let Some(v) = update.fog_color { settings.fog_color = v; }
        if let Some(v) = update.fog_start { settings.fog_start = v; }
        if let Some(v) = update.fog_end { settings.fog_end = v; }

        // Emit event back to React with full state
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending set skybox requests.
#[cfg(not(feature = "runtime"))]
fn apply_set_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    mut skybox_handles: ResMut<core::environment::SkyboxHandles>,
    mut images: ResMut<Assets<Image>>,
    camera_query: Query<Entity, With<core::camera::EditorCamera>>,
    mut commands: Commands,
) {
    for request in pending.set_skybox_requests.drain(..) {
        // Update settings fields
        if let Some(brightness) = request.brightness {
            settings.skybox_brightness = brightness;
        }
        if let Some(intensity) = request.ibl_intensity {
            settings.ibl_intensity = intensity;
        }
        if let Some(rotation) = request.rotation {
            settings.ibl_rotation_degrees = rotation;
        }

        // Handle preset or asset ID
        if let Some(preset) = request.preset {
            settings.skybox_preset = Some(preset.clone());
            settings.skybox_asset_id = None;

            // Generate or retrieve cached preset cubemap
            let handle = if let Some(h) = skybox_handles.handles.get(&preset) {
                h.clone()
            } else {
                let image = core::environment::generate_preset_cubemap(&preset);
                let handle = images.add(image);
                skybox_handles.handles.insert(preset.clone(), handle.clone());
                handle
            };

            // Apply to camera
            if let Ok(camera_entity) = camera_query.single() {
                commands.entity(camera_entity).insert(bevy::core_pipeline::Skybox {
                    image: handle,
                    brightness: settings.skybox_brightness,
                    ..Default::default()
                });
            }

            tracing::info!("Applied skybox preset: {}", preset);
        } else if let Some(asset_id) = request.asset_id {
            settings.skybox_asset_id = Some(asset_id.clone());
            settings.skybox_preset = None;
            // TODO: Handle custom cubemap assets when asset pipeline is ready
            tracing::warn!("Custom skybox assets not yet supported: {}", asset_id);
        }

        // Emit event
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending remove skybox requests.
#[cfg(not(feature = "runtime"))]
fn apply_remove_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    camera_query: Query<Entity, With<core::camera::EditorCamera>>,
    mut commands: Commands,
) {
    if !pending.remove_skybox_requests.is_empty() {
        pending.remove_skybox_requests.clear();

        settings.skybox_preset = None;
        settings.skybox_asset_id = None;

        // Remove Skybox component from camera
        if let Ok(camera_entity) = camera_query.single() {
            commands.entity(camera_entity).remove::<bevy::core_pipeline::Skybox>();
        }

        tracing::info!("Removed skybox");
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending update skybox requests.
#[cfg(not(feature = "runtime"))]
fn apply_update_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    camera_query: Query<Entity, With<core::camera::EditorCamera>>,
    mut skybox_query: Query<&mut bevy::core_pipeline::Skybox>,
    _commands: Commands,
) {
    for request in pending.update_skybox_requests.drain(..) {
        if let Some(brightness) = request.brightness {
            settings.skybox_brightness = brightness;
        }
        if let Some(intensity) = request.ibl_intensity {
            settings.ibl_intensity = intensity;
        }
        if let Some(rotation) = request.rotation {
            settings.ibl_rotation_degrees = rotation;
        }

        // Update Skybox component brightness
        if let Ok(camera_entity) = camera_query.single() {
            if let Ok(mut skybox) = skybox_query.get_mut(camera_entity) {
                skybox.brightness = settings.skybox_brightness;
            }
        }

        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending post-processing updates from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_post_processing_updates(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<PostProcessingSettings>,
) {
    for update in pending.post_processing_updates.drain(..) {
        if let Some(bloom) = update.bloom {
            settings.bloom = bloom;
        }
        if let Some(ca) = update.chromatic_aberration {
            settings.chromatic_aberration = ca;
        }
        if let Some(cg) = update.color_grading {
            settings.color_grading = cg;
        }
        if let Some(sharp) = update.sharpening {
            settings.sharpening = sharp;
        }

        // Emit event back to React with full state
        events::emit_post_processing_changed(&settings);
    }
}

/// System that applies pending coordinate mode updates from the bridge.
#[cfg(not(feature = "runtime"))]
fn apply_pending_coordinate_mode(
    mut pending: ResMut<PendingCommands>,
    mut coordinate_mode: ResMut<CoordinateMode>,
) {
    if let Some(new_mode) = pending.coordinate_mode_update.take() {
        *coordinate_mode = new_mode;

        // Emit event to React
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CoordinateModePayload {
            mode: CoordinateMode,
            display_name: &'static str,
        }

        events::emit_event("COORDINATE_MODE_CHANGED", &CoordinateModePayload {
            mode: new_mode,
            display_name: new_mode.display_name(),
        });
    }
}

/// System that applies pending input binding updates (works in all modes).
fn apply_input_binding_updates(
    mut pending: ResMut<PendingCommands>,
    mut input_map: ResMut<InputMap>,
) {
    let mut changed = false;

    // Process preset requests first (replaces entire map)
    for request in pending.input_preset_requests.drain(..) {
        *input_map = request.preset.default_bindings();
        changed = true;
        tracing::info!("Applied input preset: {:?}", request.preset);
    }

    // Process individual binding updates
    for update in pending.input_binding_updates.drain(..) {
        let name = update.action_def.name.clone();
        input_map.actions.insert(name.clone(), update.action_def);
        input_map.preset = None; // Mark as custom
        changed = true;
        tracing::info!("Updated input binding: {}", name);
    }

    // Process binding removals
    for removal in pending.input_binding_removals.drain(..) {
        if input_map.actions.remove(&removal.action_name).is_some() {
            input_map.preset = None;
            changed = true;
            tracing::info!("Removed input binding: {}", removal.action_name);
        }
    }

    if changed {
        events::emit_input_bindings_changed(&input_map);
    }
}

/// System that emits entity states every frame during Play mode for the script runtime.
fn emit_play_tick_system(
    mode: Res<EngineMode>,
    query: Query<(&EntityId, &Transform, &EntityName, Option<&EntityType>)>,
    input_state: Res<InputState>,
) {
    if !matches!(*mode, EngineMode::Play) {
        return;
    }

    let entities: Vec<(String, [f32; 3], [f32; 3], [f32; 3], String, String, f32)> = query.iter()
        .map(|(eid, transform, ename, etype)| {
            let pos = transform.translation;
            let rot = transform.rotation.to_euler(bevy::math::EulerRot::XYZ);
            let scale = transform.scale;
            let type_str = etype.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "unknown".to_string());
            // Estimate collider radius from max of scale dimensions * 0.5
            let collider_r = scale.x.max(scale.y).max(scale.z) * 0.5;
            (
                eid.0.clone(),
                [pos.x, pos.y, pos.z],
                [rot.0, rot.1, rot.2],
                [scale.x, scale.y, scale.z],
                ename.0.clone(),
                type_str,
                collider_r,
            )
        })
        .collect();

    events::emit_play_tick(&entities, &input_state);
}

/// Process query requests from MCP and emit response events.
fn process_query_requests(
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
                if let Some(state) = build_animation_state(&entity_id, &animation_registry, &animation_player_query) {
                    events::emit_animation_state_changed(&state);
                }
            }
            QueryRequest::AnimationGraph { entity_id } => {
                if let Some(entry) = animation_registry.entries.get(&entity_id) {
                    if let Ok(player) = animation_player_query.get(entry.player_entity) {
                        let graph_state = build_animation_graph_state(&entity_id, entry, &player);
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
        }
    }
}

/// Process terrain query requests separately to stay under 16 system parameter limit.
fn process_terrain_queries(
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
fn process_quality_queries(
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
fn apply_quality_presets(
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

/// System that applies pending physics updates (always-active — edit physics in any mode).
fn apply_physics_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut PhysicsData)>,
    phys_enabled_query: Query<&EntityId, With<PhysicsEnabled>>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.physics_updates.drain(..) {
        for (entity_id, mut current_physics) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_physics = current_physics.clone();
                *current_physics = update.physics_data.clone();

                // Record for undo
                history.push(core::history::UndoableAction::PhysicsChange {
                    entity_id: update.entity_id.clone(),
                    old_physics,
                    new_physics: update.physics_data.clone(),
                });

                // Emit change event
                let enabled = phys_enabled_query.iter().any(|eid| eid.0 == update.entity_id);
                events::emit_physics_changed(&update.entity_id, &update.physics_data, enabled);
                break;
            }
        }
    }
}

/// System that applies pending physics toggle requests (always-active).
fn apply_physics_toggles(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
) {
    for toggle in pending.physics_toggles.drain(..) {
        for (entity, entity_id, physics_data, phys_enabled) in query.iter() {
            if entity_id.0 == toggle.entity_id {
                if toggle.enabled {
                    // Enable physics: add PhysicsEnabled marker and PhysicsData if missing
                    if phys_enabled.is_none() {
                        commands.entity(entity).insert(PhysicsEnabled);
                    }
                    if physics_data.is_none() {
                        let default_data = PhysicsData::default();
                        events::emit_physics_changed(&toggle.entity_id, &default_data, true);
                        commands.entity(entity).insert(default_data);
                    } else {
                        events::emit_physics_changed(&toggle.entity_id, physics_data.unwrap(), true);
                    }
                } else {
                    // Disable physics: remove PhysicsEnabled marker (keep PhysicsData)
                    if phys_enabled.is_some() {
                        commands.entity(entity).remove::<PhysicsEnabled>();
                    }
                    if let Some(pd) = physics_data {
                        events::emit_physics_changed(&toggle.entity_id, pd, false);
                    }
                }
                break;
            }
        }
    }
}

/// System that applies pending debug physics toggle requests.
#[cfg(not(feature = "runtime"))]
fn apply_debug_physics_toggle(
    mut pending: ResMut<PendingCommands>,
    mut debug_enabled: ResMut<DebugPhysicsEnabled>,
) {
    for _ in pending.debug_physics_toggles.drain(..) {
        debug_enabled.0 = !debug_enabled.0;
        events::emit_debug_physics_changed(debug_enabled.0);
        tracing::info!("Debug physics rendering: {}", debug_enabled.0);
    }
}

/// System that applies pending force applications (only works during Play mode).
fn apply_force_applications(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    engine_mode: Res<EngineMode>,
    query: Query<(Entity, &EntityId), With<bevy_rapier3d::prelude::RigidBody>>,
) {
    if !engine_mode.is_playing() {
        pending.force_applications.clear();
        return;
    }

    for application in pending.force_applications.drain(..) {
        for (entity, entity_id) in query.iter() {
            if entity_id.0 == application.entity_id {
                let force_vec = bevy::math::Vec3::new(
                    application.force[0],
                    application.force[1],
                    application.force[2],
                );
                let torque_vec = bevy::math::Vec3::new(
                    application.torque[0],
                    application.torque[1],
                    application.torque[2],
                );

                if application.is_impulse {
                    commands.entity(entity).insert(
                        bevy_rapier3d::prelude::ExternalImpulse {
                            impulse: force_vec,
                            torque_impulse: torque_vec,
                        }
                    );
                } else {
                    commands.entity(entity).insert(
                        bevy_rapier3d::prelude::ExternalForce {
                            force: force_vec,
                            torque: torque_vec,
                        }
                    );
                }
                break;
            }
        }
    }
}

/// System that reads collision events from Rapier and emits them to JS.
/// Runs always (mode-gated internally by checking if physics is active).
fn read_collision_events(
    mut collision_events: EventReader<bevy_rapier3d::prelude::CollisionEvent>,
    entity_id_query: Query<&EntityId>,
    engine_mode: Res<EngineMode>,
) {
    if !engine_mode.is_playing() {
        collision_events.clear();
        return;
    }

    for event in collision_events.read() {
        let (entity_a, entity_b, started) = match event {
            bevy_rapier3d::prelude::CollisionEvent::Started(a, b, _) => (*a, *b, true),
            bevy_rapier3d::prelude::CollisionEvent::Stopped(a, b, _) => (*a, *b, false),
        };

        if let (Ok(id_a), Ok(id_b)) = (entity_id_query.get(entity_a), entity_id_query.get(entity_b)) {
            events::emit_collision_event(&id_a.0, &id_b.0, started);
        }
    }
}

/// System that processes raycast requests.
/// Runs always-active (AI/MCP might raycast from edit mode too).
fn apply_raycast_queries(
    mut pending: ResMut<PendingCommands>,
    rapier_context: bevy_rapier3d::prelude::ReadRapierContext,
    entity_id_query: Query<&EntityId>,
) {
    for request in pending.raycast_requests.drain(..) {
        let Ok(rapier_context) = rapier_context.single() else {
            events::emit_raycast_result(&request.request_id, None, [0.0; 3], 0.0);
            continue;
        };

        let origin = bevy::math::Vec3::new(request.origin[0], request.origin[1], request.origin[2]);
        let direction = bevy::math::Vec3::new(request.direction[0], request.direction[1], request.direction[2]);

        if let Some((entity, toi)) = rapier_context.cast_ray(
            origin,
            direction,
            request.max_distance,
            true,
            bevy_rapier3d::prelude::QueryFilter::default(),
        ) {
            let hit_point = origin + direction * toi;
            if let Ok(eid) = entity_id_query.get(entity) {
                events::emit_raycast_result(
                    &request.request_id,
                    Some(&eid.0),
                    [hit_point.x, hit_point.y, hit_point.z],
                    toi,
                );
            } else {
                events::emit_raycast_result(&request.request_id, None, [0.0; 3], 0.0);
            }
        } else {
            events::emit_raycast_result(&request.request_id, None, [0.0; 3], 0.0);
        }
    }
}

/// System that processes scene export requests.
#[cfg(not(feature = "runtime"))]
fn apply_scene_export(
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
    csg_procedural_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>, Option<&core::procedural_mesh::ProceduralMeshData>)>,
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
                    core::lighting::LightType::Point => EntityType::PointLight,
                    core::lighting::LightType::Directional => EntityType::DirectionalLight,
                    core::lighting::LightType::Spot => EntityType::SpotLight,
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

        // Look up csg + procedural mesh data from combined query
        let (csg_mesh_data, procedural_mesh_data) = csg_procedural_query.iter()
            .find(|(ceid, _, _)| ceid.0 == eid.0)
            .map(|(_, cmd, pmd)| (cmd.cloned(), pmd.cloned()))
            .unwrap_or((None, None));

        snapshots.push(HistEntitySnapshot {
            entity_id: eid.0.clone(),
            entity_type,
            name: name.0.clone(),
            transform: TransformSnapshot::from(transform),
            parent_id,
            visible: visible.0,
            material_data: mat_data.cloned(),
            light_data: light_data.cloned(),
            physics_data: phys_data.cloned(),
            physics_enabled: phys_enabled.is_some(),
            asset_ref: asset_ref.cloned(),
            script_data,
            audio_data,
            particle_data,
            particle_enabled,
            shader_effect_data,
            csg_mesh_data,
            terrain_data: None,
            terrain_mesh_data: None,
            procedural_mesh_data,
        });
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
fn apply_scene_load(
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

    if scene_file.format_version != 1 && scene_file.format_version != 2 {
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
fn apply_new_scene(
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
fn apply_gltf_import(
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
fn apply_texture_load(
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
fn apply_remove_texture(
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
fn apply_place_asset(
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
fn apply_delete_asset(
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

/// System that emits physics data when the primary selection changes or physics data changes.
#[cfg(not(feature = "runtime"))]
fn emit_physics_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &PhysicsData, Option<&PhysicsEnabled>), Changed<PhysicsData>>,
    selection_query: Query<(&EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, physics_data, phys_enabled)) = selection_query.get(primary) {
                if let Some(pd) = physics_data {
                    events::emit_physics_changed(&entity_id.0, pd, phys_enabled.is_some());
                }
            }
        }
    }

    // Emit when physics data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, physics_data, phys_enabled)) = query.get(primary) {
            events::emit_physics_changed(&entity_id.0, physics_data, phys_enabled.is_some());
        }
    }
}

/// System that applies pending script updates (always-active).
fn apply_script_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.script_updates.drain(..) {
        for (entity, entity_id, current_script) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_script = current_script.cloned();
                let new_script = ScriptData {
                    source: update.source.clone(),
                    enabled: update.enabled,
                    template: update.template.clone(),
                };

                // Insert or update script component
                commands.entity(entity).insert(new_script.clone());

                // Record for undo
                history.push(core::history::UndoableAction::ScriptChange {
                    entity_id: update.entity_id.clone(),
                    old_script,
                    new_script: Some(new_script.clone()),
                });

                // Emit change event
                events::emit_script_changed(&update.entity_id, Some(&new_script));
                break;
            }
        }
    }
}

/// System that applies pending script removals (always-active).
fn apply_script_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.script_removals.drain(..) {
        for (entity, entity_id, current_script) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_script = current_script.cloned();

                // Remove script component
                commands.entity(entity).remove::<ScriptData>();

                // Record for undo
                history.push(core::history::UndoableAction::ScriptChange {
                    entity_id: removal.entity_id.clone(),
                    old_script,
                    new_script: None,
                });

                // Emit change event
                events::emit_script_changed(&removal.entity_id, None);
                break;
            }
        }
    }
}

/// Emit script changed events on selection changes and script data changes.
#[cfg(not(feature = "runtime"))]
fn emit_script_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ScriptData), Changed<ScriptData>>,
    selection_query: Query<(&EntityId, Option<&ScriptData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, script_data)) = selection_query.get(primary) {
                events::emit_script_changed(&entity_id.0, script_data);
            }
        }
    }

    // Emit when script data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, script_data)) = query.get(primary) {
            events::emit_script_changed(&entity_id.0, Some(script_data));
        }
    }
}

// ---------------------------------------------------------------------------
// Audio systems
// ---------------------------------------------------------------------------

/// System that applies pending audio updates (always-active).
fn apply_audio_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.audio_updates.drain(..) {
        for (entity, entity_id, current_audio) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_audio = current_audio.cloned();

                // Merge partial update with existing data or defaults
                let base = current_audio.cloned().unwrap_or_default();
                let new_audio = AudioData {
                    asset_id: update.asset_id.or(base.asset_id),
                    volume: update.volume.unwrap_or(base.volume),
                    pitch: update.pitch.unwrap_or(base.pitch),
                    loop_audio: update.loop_audio.unwrap_or(base.loop_audio),
                    spatial: update.spatial.unwrap_or(base.spatial),
                    max_distance: update.max_distance.unwrap_or(base.max_distance),
                    ref_distance: update.ref_distance.unwrap_or(base.ref_distance),
                    rolloff_factor: update.rolloff_factor.unwrap_or(base.rolloff_factor),
                    autoplay: update.autoplay.unwrap_or(base.autoplay),
                    bus: base.bus,
                };

                // Insert or update audio components
                commands.entity(entity)
                    .insert(new_audio.clone())
                    .insert(AudioEnabled);

                // Record for undo
                history.push(core::history::UndoableAction::AudioChange {
                    entity_id: update.entity_id.clone(),
                    old_audio,
                    new_audio: Some(new_audio.clone()),
                });

                // Emit change event
                events::emit_audio_changed(&update.entity_id, Some(&new_audio));
                break;
            }
        }
    }
}

/// System that applies pending audio removals (always-active).
fn apply_audio_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.audio_removals.drain(..) {
        for (entity, entity_id, current_audio) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_audio = current_audio.cloned();

                // Remove audio components
                commands.entity(entity)
                    .remove::<AudioData>()
                    .remove::<AudioEnabled>();

                // Record for undo
                history.push(core::history::UndoableAction::AudioChange {
                    entity_id: removal.entity_id.clone(),
                    old_audio,
                    new_audio: None,
                });

                // Emit change event
                events::emit_audio_changed(&removal.entity_id, None);
                break;
            }
        }
    }
}

/// System that applies pending audio playback actions (always-active).
fn apply_audio_playback(
    mut pending: ResMut<PendingCommands>,
) {
    for playback in pending.audio_playback.drain(..) {
        // Emit playback event to JS (Web Audio API handles actual playback)
        events::emit_audio_playback(&playback.entity_id, &playback.action);
    }
}

/// System that applies pending audio bus updates (always-active for runtime audio mixing).
fn apply_audio_bus_updates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for update in pending.audio_bus_updates.drain(..) {
        if let Some(bus) = bus_config.buses.iter_mut().find(|b| b.name == update.bus_name) {
            if let Some(v) = update.volume {
                bus.volume = v.clamp(0.0, 1.0);
            }
            if let Some(v) = update.muted {
                bus.muted = v;
            }
            if let Some(v) = update.soloed {
                bus.soloed = v;
            }
            events::emit_audio_buses_changed(&bus_config);
        }
    }
}

/// System that applies pending audio bus creation requests (always-active).
fn apply_audio_bus_creates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for create in pending.audio_bus_creates.drain(..) {
        // Prevent duplicates
        if bus_config.buses.iter().any(|b| b.name == create.name) {
            continue;
        }
        bus_config.buses.push(crate::core::audio::AudioBusDef {
            name: create.name,
            volume: create.volume.clamp(0.0, 1.0),
            muted: create.muted,
            soloed: create.soloed,
            effects: vec![],
        });
        events::emit_audio_buses_changed(&bus_config);
    }
}

/// System that applies pending audio bus deletion requests (always-active).
fn apply_audio_bus_deletes(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for delete in pending.audio_bus_deletes.drain(..) {
        if delete.bus_name == "master" {
            continue; // Cannot delete master
        }
        bus_config.buses.retain(|b| b.name != delete.bus_name);
        events::emit_audio_buses_changed(&bus_config);
    }
}

/// System that applies pending audio bus effects updates (always-active, Phase A-2).
fn apply_audio_bus_effects_updates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for update in pending.audio_bus_effects_updates.drain(..) {
        if let Some(bus) = bus_config.buses.iter_mut().find(|b| b.name == update.bus_name) {
            bus.effects = update.effects;
            events::emit_audio_buses_changed(&bus_config);
        }
    }
}

/// Emit audio changed events on selection changes and audio data changes.
#[cfg(not(feature = "runtime"))]
fn emit_audio_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &AudioData), Changed<AudioData>>,
    selection_query: Query<(&EntityId, Option<&AudioData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, audio_data)) = selection_query.get(primary) {
                events::emit_audio_changed(&entity_id.0, audio_data);
            }
        }
    }

    // Emit when audio data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, audio_data)) = query.get(primary) {
            events::emit_audio_changed(&entity_id.0, Some(audio_data));
        }
    }
}

// ---------------------------------------------------------------------------
// Particle systems
// ---------------------------------------------------------------------------

/// System that applies pending particle updates (always-active).
fn apply_particle_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.particle_updates.drain(..) {
        for (entity, entity_id, current_particle, _pe) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_particle = current_particle.cloned();

                // Insert or update particle component
                commands.entity(entity).insert(update.particle_data.clone());

                // Record for undo
                history.push(core::history::UndoableAction::ParticleChange {
                    entity_id: update.entity_id.clone(),
                    old_particle,
                    new_particle: Some(update.particle_data.clone()),
                });

                // Emit change event
                events::emit_particle_changed(&update.entity_id, Some(&update.particle_data), true);
                break;
            }
        }
    }
}

/// System that applies pending particle toggle requests (always-active).
fn apply_particle_toggles(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
) {
    for toggle in pending.particle_toggles.drain(..) {
        for (entity, entity_id, particle_data, part_enabled) in query.iter() {
            if entity_id.0 == toggle.entity_id {
                if toggle.enabled {
                    // Enable particles: add ParticleEnabled marker and ParticleData if missing
                    if part_enabled.is_none() {
                        commands.entity(entity).insert(ParticleEnabled);
                    }
                    if particle_data.is_none() {
                        let default_data = ParticleData::default();
                        events::emit_particle_changed(&toggle.entity_id, Some(&default_data), true);
                        commands.entity(entity).insert(default_data);
                    } else {
                        events::emit_particle_changed(&toggle.entity_id, particle_data, true);
                    }
                } else {
                    // Disable particles: remove ParticleEnabled marker (keep ParticleData)
                    if part_enabled.is_some() {
                        commands.entity(entity).remove::<ParticleEnabled>();
                    }
                    events::emit_particle_changed(&toggle.entity_id, particle_data, false);
                }
                break;
            }
        }
    }
}

/// System that applies pending particle removals (always-active).
fn apply_particle_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.particle_removals.drain(..) {
        for (entity, entity_id, current_particle) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_particle = current_particle.cloned();

                // Remove particle components
                commands.entity(entity)
                    .remove::<ParticleData>()
                    .remove::<ParticleEnabled>();

                // Record for undo
                history.push(core::history::UndoableAction::ParticleChange {
                    entity_id: removal.entity_id.clone(),
                    old_particle,
                    new_particle: None,
                });

                // Emit change event
                events::emit_particle_changed(&removal.entity_id, None, false);
                break;
            }
        }
    }
}

/// System that applies pending particle preset requests (always-active).
fn apply_particle_preset_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::particles::ParticlePreset;

    for request in pending.particle_preset_requests.drain(..) {
        if let Some(preset) = ParticlePreset::from_str(&request.preset) {
            for (entity, entity_id, current_particle, _pe) in query.iter() {
                if entity_id.0 == request.entity_id {
                    let old_particle = current_particle.cloned();
                    let new_data = ParticleData::from_preset(&preset);

                    commands.entity(entity)
                        .insert(new_data.clone())
                        .insert(ParticleEnabled);

                    // Record for undo
                    history.push(core::history::UndoableAction::ParticleChange {
                        entity_id: request.entity_id.clone(),
                        old_particle,
                        new_particle: Some(new_data.clone()),
                    });

                    events::emit_particle_changed(&request.entity_id, Some(&new_data), true);
                    break;
                }
            }
        }
    }
}

/// System that applies pending particle playback actions (always-active).
/// Playback is controlled via ParticleEnabled toggle on both platforms.
fn apply_particle_playback(
    mut pending: ResMut<PendingCommands>,
) {
    // Playback (play/stop/burst) is handled by toggling ParticleEnabled.
    // The sync_hanabi_effects system (WebGPU) watches for component changes.
    pending.particle_playback.clear();
}

/// Emit particle changed events on selection changes and particle data changes.
#[cfg(not(feature = "runtime"))]
fn emit_particle_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ParticleData, Option<&ParticleEnabled>), Changed<ParticleData>>,
    selection_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, particle_data, part_enabled)) = selection_query.get(primary) {
                events::emit_particle_changed(&entity_id.0, particle_data, part_enabled.is_some());
            }
        }
    }

    // Emit when particle data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, particle_data, part_enabled)) = query.get(primary) {
            events::emit_particle_changed(&entity_id.0, Some(particle_data), part_enabled.is_some());
        }
    }
}

// ---------------------------------------------------------------------------
// Shader Effect systems
// ---------------------------------------------------------------------------

/// System that applies pending shader update requests (editor-only).
#[cfg(not(feature = "runtime"))]
fn apply_shader_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&ShaderEffectData>)>,
    std_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<StandardMaterial>, &MaterialData)>,
    ext_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<ForgeMaterial>)>,
    std_materials: ResMut<Assets<StandardMaterial>>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.shader_updates.drain(..) {
        // Find entity
        let found = entity_query.iter().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, old_shader)) = found else { continue; };

        let old_shader_clone = old_shader.cloned();

        // Check if entity already has ExtendedMaterial
        if let Ok((_, _, ext_handle)) = ext_mat_query.get(entity) {
            // Update existing extended material
            if let Some(ext_mat) = ext_materials.get_mut(ext_handle) {
                ext_mat.extension = ForgeShaderExtension::from(&update.shader_data);
            }
        } else if let Ok((_, _, std_handle, _mat_data)) = std_mat_query.get(entity) {
            // Upgrade from StandardMaterial to ExtendedMaterial
            if let Some(std_mat) = std_materials.get(std_handle.0.id()) {
                let base = std_mat.clone();
                let extension = ForgeShaderExtension::from(&update.shader_data);
                let ext_mat = ForgeMaterial { base, extension };
                let ext_handle = ext_materials.add(ext_mat);
                commands.entity(entity)
                    .remove::<MeshMaterial3d<StandardMaterial>>()
                    .insert(MeshMaterial3d(ext_handle));
            }
        }

        // Insert/update the ShaderEffectData component
        commands.entity(entity).insert(update.shader_data.clone());

        // Record undo
        history.push(core::history::UndoableAction::ShaderChange {
            entity_id: update.entity_id.clone(),
            old_shader: old_shader_clone,
            new_shader: Some(update.shader_data),
        });
    }
}

/// System that applies pending shader removal requests (editor-only).
#[cfg(not(feature = "runtime"))]
fn apply_shader_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&ShaderEffectData>)>,
    ext_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<ForgeMaterial>)>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.shader_removals.drain(..) {
        let found = entity_query.iter().find(|(_, eid, _)| eid.0 == removal.entity_id);
        let Some((entity, _, old_shader)) = found else { continue; };

        let old_shader_clone = old_shader.cloned();

        // Set shader to passthrough (don't swap back to StandardMaterial)
        let none_data = ShaderEffectData { shader_type: "none".to_string(), ..Default::default() };

        if let Ok((_, _, ext_handle)) = ext_mat_query.get(entity) {
            if let Some(ext_mat) = ext_materials.get_mut(ext_handle) {
                ext_mat.extension.shader_type = 0;
            }
        }

        commands.entity(entity).insert(none_data.clone());

        history.push(core::history::UndoableAction::ShaderChange {
            entity_id: removal.entity_id.clone(),
            old_shader: old_shader_clone,
            new_shader: Some(none_data),
        });
    }
}

/// System that processes pending CSG boolean operation requests (editor-only).
#[cfg(not(feature = "runtime"))]
fn apply_csg_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mesh_query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        &EntityVisible,
        Option<&EntityType>,
        Option<&MaterialData>,
        Option<&Mesh3d>,
        Option<&AssetRef>,
    )>,
    // Separate queries for components beyond the 15-tuple limit
    light_query: Query<(&EntityId, Option<&LightData>)>,
    physics_query: Query<(&EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_data_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    mesh_assets: Res<Assets<Mesh>>,
    mut history: ResMut<HistoryStack>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    for request in pending.csg_requests.drain(..) {
        let operation_name = request.operation;

        // 1. Find both entities
        let entity_a = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_a);
        let entity_b = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_b);

        let (Some(a_data), Some(b_data)) = (entity_a, entity_b) else {
            tracing::warn!("CSG: one or both entities not found");
            events::emit_csg_error("One or both entities not found");
            continue;
        };

        // 2. Get Mesh handles
        let (entity_a_ent, a_eid, a_name, a_transform, a_visible, a_etype,
             a_mat, a_mesh3d, a_asset_ref) = a_data;
        let (entity_b_ent, _b_eid, _b_name, b_transform, _b_visible, _b_etype,
             _b_mat, b_mesh3d, _b_asset_ref) = b_data;

        let Some(a_mesh_handle) = a_mesh3d else {
            tracing::warn!("CSG: entity A has no Mesh3d component");
            events::emit_csg_error("Entity A has no mesh");
            continue;
        };
        let Some(b_mesh_handle) = b_mesh3d else {
            tracing::warn!("CSG: entity B has no Mesh3d component");
            events::emit_csg_error("Entity B has no mesh");
            continue;
        };

        // 3. Get actual Mesh assets
        let Some(a_mesh) = mesh_assets.get(&a_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity A");
            events::emit_csg_error("Could not load mesh for entity A");
            continue;
        };
        let Some(b_mesh) = mesh_assets.get(&b_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity B");
            events::emit_csg_error("Could not load mesh for entity B");
            continue;
        };

        // 4. Convert to csgrs format (world space)
        let csg_a = match core::csg::bevy_mesh_to_csg(a_mesh, a_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity A mesh: {}", e);
                events::emit_csg_error(&format!("Failed to convert mesh A: {}", e));
                continue;
            }
        };
        let csg_b = match core::csg::bevy_mesh_to_csg(b_mesh, b_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity B mesh: {}", e);
                events::emit_csg_error(&format!("Failed to convert mesh B: {}", e));
                continue;
            }
        };

        // 5. Perform CSG operation
        let result_csg = core::csg::perform_csg(&csg_a, &csg_b, operation_name);

        // 6. Convert result back to Bevy Mesh
        let (result_mesh, mesh_data) = match core::csg::csg_to_bevy_mesh(&result_csg) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("CSG: operation produced invalid result: {}", e);
                events::emit_csg_error(&format!("CSG operation failed: {}", e));
                continue;
            }
        };

        // 7. Create result entity
        let result_material = a_mat.cloned().unwrap_or_default();
        let result_entity_id = EntityId::default();
        let result_entity_id_str = result_entity_id.0.clone();
        let result_name = request.result_name.unwrap_or_else(|| {
            let op_name = match operation_name {
                core::csg::CsgOperation::Union => "Union",
                core::csg::CsgOperation::Subtract => "Subtract",
                core::csg::CsgOperation::Intersect => "Intersect",
            };
            format!("{} Result", op_name)
        });

        // Position at identity transform (mesh is already in world space)
        let result_transform = Transform::IDENTITY;

        commands.spawn((
            EntityType::CsgResult,
            result_entity_id.clone(),
            EntityName::new(&result_name),
            EntityVisible::default(),
            result_material.clone(),
            Mesh3d(meshes.add(result_mesh)),
            MeshMaterial3d(materials.add(StandardMaterial::default())),
            result_transform,
            mesh_data.clone(),  // CsgMeshData component
        ));

        // 8. Build helper function for snapshots
        let build_snapshot = |eid: &EntityId, ename: &EntityName, etransform: &Transform,
                              evisible: &EntityVisible, etype: Option<&EntityType>,
                              emat: Option<&MaterialData>, easset: Option<&AssetRef>| -> core::history::EntitySnapshot {
            let light_data = light_query.iter()
                .find(|(lid, _)| lid.0 == eid.0)
                .and_then(|(_, ld)| ld.cloned());

            let (physics_data, physics_enabled) = physics_query.iter()
                .find(|(pid, _, _)| pid.0 == eid.0)
                .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                .unwrap_or((None, false));

            let script_data = script_query.iter()
                .find(|(sid, _)| sid.0 == eid.0)
                .and_then(|(_, sd)| sd.cloned());

            let audio_data = audio_query.iter()
                .find(|(aid, _)| aid.0 == eid.0)
                .and_then(|(_, ad)| ad.cloned());

            let (particle_data, particle_enabled) = particle_query.iter()
                .find(|(pid, _, _)| pid.0 == eid.0)
                .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                .unwrap_or((None, false));

            let shader_effect_data = shader_query.iter()
                .find(|(sid, _)| sid.0 == eid.0)
                .and_then(|(_, sed)| sed.cloned());

            let csg_mesh_data = csg_data_query.iter()
                .find(|(cid, _)| cid.0 == eid.0)
                .and_then(|(_, cmd)| cmd.cloned());

            let asset_ref = easset.cloned();

            core::history::EntitySnapshot {
                entity_id: eid.0.clone(),
                entity_type: etype.copied().unwrap_or(EntityType::Cube),
                name: ename.0.clone(),
                transform: core::history::TransformSnapshot::from(etransform),
                parent_id: None,
                visible: evisible.0,
                material_data: emat.cloned(),
                light_data,
                physics_data,
                physics_enabled,
                asset_ref,
                script_data,
                audio_data,
                particle_data,
                particle_enabled,
                shader_effect_data,
                csg_mesh_data,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: None,
            }
        };

        // Build source snapshots if we're deleting them
        let source_a_snapshot = if request.delete_sources {
            Some(build_snapshot(a_eid, a_name, a_transform, a_visible, a_etype, a_mat, a_asset_ref))
        } else {
            None
        };
        let source_b_snapshot = if request.delete_sources {
            // Get b entity data again
            let b_data = mesh_query.iter()
                .find(|(_, eid, ..)| eid.0 == request.entity_id_b)
                .unwrap();
            let (_, b_eid, b_name, b_transform, b_visible, b_etype, b_mat, _, b_asset) = b_data;
            Some(build_snapshot(b_eid, b_name, b_transform, b_visible, b_etype, b_mat, b_asset))
        } else {
            None
        };

        // Build result snapshot
        let result_snapshot = core::history::EntitySnapshot {
            entity_id: result_entity_id_str.clone(),
            entity_type: EntityType::CsgResult,
            name: result_name.clone(),
            transform: core::history::TransformSnapshot::from(&result_transform),
            parent_id: None,
            visible: true,
            material_data: Some(result_material),
            light_data: None,
            physics_data: None,
            physics_enabled: false,
            asset_ref: None,
            script_data: None,
            audio_data: None,
            particle_data: None,
            particle_enabled: false,
            shader_effect_data: None,
            csg_mesh_data: Some(mesh_data),
            terrain_data: None,
            terrain_mesh_data: None,
            procedural_mesh_data: None,
        };

        // 9. Push history action
        history.push(core::history::UndoableAction::CsgOperation {
            source_a_snapshot,
            source_b_snapshot,
            result_snapshot,
            sources_deleted: request.delete_sources,
        });

        // 10. Delete source entities if requested
        if request.delete_sources {
            commands.entity(entity_a_ent).despawn();
            commands.entity(entity_b_ent).despawn();
        }

        // 11. Select the result entity (entity not yet spawned, clear and add ID only)
        selection.clear();
        selection.entity_ids.insert(result_entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![result_entity_id_str.clone()],
            primary_id: Some(result_entity_id_str.clone()),
            primary_name: Some(result_name.clone()),
        });

        // 12. Emit completion event
        events::emit_csg_completed(&result_entity_id_str, &result_name, operation_name);

        tracing::info!("CSG operation completed: {}", result_name);
    }
}

/// System that syncs MaterialData changes to ExtendedMaterial entities (always-active).
fn sync_extended_material_data(
    query: Query<(&MaterialData, &MeshMaterial3d<ForgeMaterial>), Changed<MaterialData>>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    texture_handles: Res<crate::core::asset_manager::TextureHandleMap>,
) {
    for (data, handle) in query.iter() {
        if let Some(ext_mat) = ext_materials.get_mut(handle) {
            crate::core::material::apply_material_data_to_standard(&mut ext_mat.base, data, &texture_handles);
        }
    }
}

/// System that emits shader data when the primary selection has a ShaderEffectData component (editor-only).
#[cfg(not(feature = "runtime"))]
fn emit_shader_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ShaderEffectData), Changed<ShaderEffectData>>,
    selection_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, shader_data)) = selection_query.get(primary) {
                events::emit_shader_changed(&entity_id.0, shader_data);
            }
        }
    }

    // Emit when shader data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, shader_data)) = query.get(primary) {
            events::emit_shader_changed(&entity_id.0, Some(shader_data));
        }
    }
}

// ---------------------------------------------------------------------------
// Animation systems
// ---------------------------------------------------------------------------

/// Helper: Build an AnimationPlaybackState from the registry and player.
fn build_animation_state(
    entity_id: &str,
    registry: &AnimationRegistry,
    player_query: &Query<&AnimationPlayer>,
) -> Option<AnimationPlaybackState> {
    let entry = registry.entries.get(entity_id)?;

    let player = player_query.get(entry.player_entity).ok()?;

    // Build available clips list
    let available_clips: Vec<AnimationClipInfo> = entry.clip_names.iter().filter_map(|name| {
        let (node_index, duration) = entry.clips.get(name)?;
        Some(AnimationClipInfo {
            name: name.clone(),
            node_index: node_index.index() as u32,
            duration_secs: *duration,
        })
    }).collect();

    // Find the active animation
    let mut active_clip_name = None;
    let mut active_node_index = None;
    let mut is_playing = false;
    let mut is_paused = false;
    let mut elapsed_secs = 0.0;
    let mut speed = 1.0;
    let mut is_looping = false;
    let mut is_finished = false;

    // Check each known clip for active state
    for (name, (node_index, _duration)) in &entry.clips {
        if let Some(active) = player.animation(*node_index) {
            active_clip_name = Some(name.clone());
            active_node_index = Some(node_index.index() as u32);
            is_paused = active.is_paused();
            is_playing = !is_paused && !active.is_finished();
            elapsed_secs = active.seek_time();
            speed = active.speed();
            is_looping = matches!(active.repeat_mode(), RepeatAnimation::Forever);
            is_finished = active.is_finished();
            break;
        }
    }

    Some(AnimationPlaybackState {
        entity_id: entity_id.to_string(),
        available_clips,
        active_clip_name,
        active_node_index,
        is_playing,
        is_paused,
        elapsed_secs,
        speed,
        is_looping,
        is_finished,
    })
}

/// Helper: Build animation graph state with node weights and speeds.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationGraphState {
    entity_id: String,
    nodes: Vec<AnimationNodeState>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationNodeState {
    clip_name: String,
    node_index: u32,
    weight: f32,
    speed: f32,
    is_active: bool,
}

fn build_animation_graph_state(
    entity_id: &str,
    entry: &crate::core::animation::EntityAnimationData,
    player: &AnimationPlayer,
) -> AnimationGraphState {
    let mut nodes = Vec::new();
    for (name, (node_index, _duration)) in &entry.clips {
        let animation = player.animation(*node_index);
        let (weight, speed, is_active) = if let Some(anim) = animation {
            (anim.weight(), anim.speed(), true)
        } else {
            (1.0, 1.0, false)
        };
        nodes.push(AnimationNodeState {
            clip_name: name.clone(),
            node_index: node_index.index() as u32,
            weight,
            speed,
            is_active,
        });
    }
    AnimationGraphState {
        entity_id: entity_id.to_string(),
        nodes,
    }
}

/// System that detects newly-loaded glTF scenes with AnimationPlayer components
/// and registers their animation clips in the AnimationRegistry.
fn register_gltf_animations(
    mut animation_registry: ResMut<AnimationRegistry>,
    player_query: Query<(Entity, &AnimationPlayer), Without<HasAnimations>>,
    child_of_query: Query<&ChildOf>,
    entity_id_query: Query<&EntityId>,
    gltf_assets: Res<Assets<Gltf>>,
    gltf_handle_query: Query<&crate::core::asset_manager::GltfSourceHandle>,
    clip_assets: Res<Assets<AnimationClip>>,
    mut commands: Commands,
    mut graphs: ResMut<Assets<AnimationGraph>>,
) {
    for (player_entity, _player) in player_query.iter() {
        // Walk up the hierarchy to find the ancestor with our EntityId component
        let mut ancestor = player_entity;
        let mut found_entity_id: Option<String> = None;

        for _depth in 0..20 {
            if let Ok(eid) = entity_id_query.get(ancestor) {
                found_entity_id = Some(eid.0.clone());
                break;
            }
            if let Ok(child_of) = child_of_query.get(ancestor) {
                ancestor = child_of.parent();
            } else {
                break;
            }
        }

        let entity_id_str = match found_entity_id {
            Some(id) => id,
            None => continue, // Not one of our managed entities
        };

        // Already registered?
        if animation_registry.entries.contains_key(&entity_id_str) {
            continue;
        }

        // Try to find the Gltf asset to discover named animations
        // Walk up hierarchy again to find the entity with GltfSourceHandle
        let mut gltf_ancestor = player_entity;
        let mut gltf_handle_opt: Option<&Handle<Gltf>> = None;
        for _depth in 0..20 {
            if let Ok(source_handle) = gltf_handle_query.get(gltf_ancestor) {
                gltf_handle_opt = Some(&source_handle.0);
                break;
            }
            if let Ok(child_of) = child_of_query.get(gltf_ancestor) {
                gltf_ancestor = child_of.parent();
            } else {
                break;
            }
        }

        // Get the Gltf asset to discover animations
        let gltf_asset = gltf_handle_opt.and_then(|h| gltf_assets.get(h));
        if gltf_asset.is_none() {
            // Asset not loaded yet, try next frame
            continue;
        }
        let gltf = gltf_asset.unwrap();

        if gltf.named_animations.is_empty() {
            // No animations in this glTF, mark as processed to avoid rechecking
            commands.entity(player_entity).insert(HasAnimations);
            continue;
        }

        // Build AnimationGraph from the clips
        let mut clip_handles: Vec<Handle<AnimationClip>> = Vec::new();
        let mut clip_names_ordered: Vec<String> = Vec::new();

        for (name, handle) in &gltf.named_animations {
            clip_handles.push(handle.clone());
            clip_names_ordered.push(name.to_string());
        }

        let (graph, node_indices) = AnimationGraph::from_clips(clip_handles.iter().cloned());
        let graph_handle = graphs.add(graph);

        // Build the clips map
        let mut clips = std::collections::HashMap::new();
        for (i, name) in clip_names_ordered.iter().enumerate() {
            let node_index = node_indices[i];
            let duration = clip_handles.get(i)
                .and_then(|h| clip_assets.get(h))
                .map(|c| c.duration())
                .unwrap_or(0.0);
            clips.insert(name.clone(), (node_index, duration));
        }

        // Auto-generate names for unnamed animations
        let mut final_names = Vec::new();
        for (i, name) in clip_names_ordered.iter().enumerate() {
            let display_name = if name.is_empty() {
                format!("Animation {}", i + 1)
            } else {
                name.clone()
            };
            final_names.push(display_name);
        }

        // Insert AnimationGraphHandle and AnimationTransitions on the player entity
        commands.entity(player_entity)
            .insert(AnimationGraphHandle(graph_handle.clone()))
            .insert(AnimationTransitions::new())
            .insert(HasAnimations);

        // Register in the animation registry
        let entry = crate::core::animation::EntityAnimationData {
            clips,
            clip_names: final_names.clone(),
            player_entity,
            graph_handle,
        };
        animation_registry.entries.insert(entity_id_str.clone(), entry);

        // Build and emit the initial state
        let available_clips: Vec<AnimationClipInfo> = final_names.iter().enumerate().filter_map(|(i, name)| {
            let duration = clip_handles.get(i)
                .and_then(|h| clip_assets.get(h))
                .map(|c| c.duration())
                .unwrap_or(0.0);
            Some(AnimationClipInfo {
                name: name.clone(),
                node_index: node_indices[i].index() as u32,
                duration_secs: duration,
            })
        }).collect();

        let state = AnimationPlaybackState {
            entity_id: entity_id_str.clone(),
            available_clips,
            active_clip_name: None,
            active_node_index: None,
            is_playing: false,
            is_paused: false,
            elapsed_secs: 0.0,
            speed: 1.0,
            is_looping: false,
            is_finished: false,
        };

        events::emit_animation_list_changed(&state);
        tracing::info!("Registered {} animations for entity {}", final_names.len(), entity_id_str);
    }
}

/// System that applies pending animation requests to AnimationPlayer components.
fn apply_animation_requests(
    mut pending: ResMut<PendingCommands>,
    animation_registry: Res<AnimationRegistry>,
    mut player_query: Query<(&mut AnimationPlayer, Option<&mut AnimationTransitions>)>,
) {
    use crate::core::pending_commands::AnimationAction;

    for request in pending.animation_requests.drain(..) {
        let entry = match animation_registry.entries.get(&request.entity_id) {
            Some(e) => e,
            None => {
                tracing::warn!("No animation data for entity: {}", request.entity_id);
                continue;
            }
        };

        let (mut player, mut transitions_opt) = match player_query.get_mut(entry.player_entity) {
            Ok(p) => p,
            Err(_) => {
                tracing::warn!("AnimationPlayer not found for entity: {}", request.entity_id);
                continue;
            }
        };

        match request.action {
            AnimationAction::Play { clip_name, crossfade_secs } => {
                if let Some((node_index, _duration)) = entry.clips.get(&clip_name) {
                    if crossfade_secs > 0.0 {
                        if let Some(transitions) = transitions_opt.as_mut() {
                            transitions.play(
                                &mut player,
                                *node_index,
                                std::time::Duration::from_secs_f32(crossfade_secs),
                            ).repeat();
                        } else {
                            player.start(*node_index).repeat();
                        }
                    } else {
                        player.start(*node_index).repeat();
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
            AnimationAction::Pause => {
                player.pause_all();
            }
            AnimationAction::Resume => {
                player.resume_all();
            }
            AnimationAction::Stop => {
                player.stop_all();
            }
            AnimationAction::Seek { time_secs } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.seek_to(time_secs);
                        break;
                    }
                }
            }
            AnimationAction::SetSpeed { speed } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_speed(speed);
                        break;
                    }
                }
            }
            AnimationAction::SetLoop { looping } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        if looping {
                            active.set_repeat(RepeatAnimation::Forever);
                        } else {
                            active.set_repeat(RepeatAnimation::Never);
                        }
                        break;
                    }
                }
            }
            AnimationAction::SetBlendWeight { clip_name, weight } => {
                if let Some((node_index, _)) = entry.clips.get(&clip_name) {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_weight(weight);
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
            AnimationAction::SetClipSpeed { clip_name, speed } => {
                if let Some((node_index, _)) = entry.clips.get(&clip_name) {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_speed(speed);
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
        }
    }
}

/// Emit animation state when selection changes.
#[cfg(not(feature = "runtime"))]
fn emit_animation_on_selection(
    selection: Res<Selection>,
    animation_registry: Res<AnimationRegistry>,
    player_query: Query<&AnimationPlayer>,
    entity_id_query: Query<&EntityId>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok(eid) = entity_id_query.get(primary) {
                if let Some(state) = build_animation_state(&eid.0, &animation_registry, &player_query) {
                    events::emit_animation_state_changed(&state);
                }
            }
        }
    }
}

/// Periodically emit animation state while playing (throttled to ~200ms).
#[cfg(not(feature = "runtime"))]
fn poll_animation_state(
    selection: Res<Selection>,
    animation_registry: Res<AnimationRegistry>,
    player_query: Query<&AnimationPlayer>,
    entity_id_query: Query<&EntityId>,
    time: Res<Time>,
    mut last_emit: Local<f32>,
) {
    let elapsed = time.elapsed_secs();
    if elapsed - *last_emit < 0.2 {
        return;
    }

    if let Some(primary) = selection.primary {
        if let Ok(eid) = entity_id_query.get(primary) {
            if let Some(state) = build_animation_state(&eid.0, &animation_registry, &player_query) {
                if state.is_playing {
                    events::emit_animation_state_changed(&state);
                    *last_emit = elapsed;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// bevy_hanabi GPU particle rendering (WebGPU only)
// ---------------------------------------------------------------------------

/// Marker component on an entity that links to its child hanabi effect entity.
#[cfg(feature = "webgpu")]
#[derive(Component)]
struct HanabiEffectLink(Entity);

/// Marker component on the child hanabi effect entity pointing to its parent.
#[cfg(feature = "webgpu")]
#[derive(Component)]
struct HanabiEffectParent(Entity);

/// System that synchronises ParticleData/ParticleEnabled ECS components with
/// actual bevy_hanabi GPU particle effect entities (WebGPU only).
///
/// For each entity that has `ParticleData` + `ParticleEnabled`:
///   - If no `HanabiEffectLink` exists, create a child effect entity.
///   - If data changed, recreate the effect asset.
/// For entities that lost `ParticleEnabled` or `ParticleData`:
///   - Despawn the child effect entity and remove the link.
#[cfg(feature = "webgpu")]
fn sync_hanabi_effects(
    mut commands: Commands,
    mut effects: ResMut<Assets<bevy_hanabi::EffectAsset>>,
    // Entities with particle data — we need Added/Changed detection
    added_q: Query<
        (Entity, &ParticleData),
        (With<ParticleEnabled>, Added<ParticleEnabled>),
    >,
    changed_q: Query<
        (Entity, &ParticleData),
        (With<ParticleEnabled>, Changed<ParticleData>),
    >,
    // Entities that have the link but no longer have ParticleEnabled
    orphan_link_q: Query<
        (Entity, &HanabiEffectLink),
        Without<ParticleEnabled>,
    >,
    // All entities with link (for data-removed check)
    all_link_q: Query<(Entity, &HanabiEffectLink, Option<&ParticleData>)>,
    // Child effect entities
    effect_parent_q: Query<(Entity, &HanabiEffectParent)>,
) {
    // --- Handle newly enabled particles: spawn child effect entity ---
    for (entity, data) in added_q.iter() {
        let handle = build_hanabi_effect(data, &mut effects);
        let child = commands.spawn((
            Name::new("particle_effect"),
            bevy_hanabi::ParticleEffect::new(handle),
            HanabiEffectParent(entity),
            Transform::default(),
            Visibility::default(),
        )).id();
        commands.entity(entity).insert(HanabiEffectLink(child));
        commands.entity(entity).add_child(child);
    }

    // --- Handle data changes: recreate effect asset ---
    for (entity, data) in changed_q.iter() {
        // Skip if this entity was just added (handled above)
        if added_q.get(entity).is_ok() {
            continue;
        }
        // Find existing child effect entity
        for (child_entity, parent_link) in effect_parent_q.iter() {
            if parent_link.0 == entity {
                let new_handle = build_hanabi_effect(data, &mut effects);
                commands.entity(child_entity).insert(
                    bevy_hanabi::ParticleEffect::new(new_handle),
                );
                break;
            }
        }
    }

    // --- Handle disabled particles: despawn child effect entity ---
    for (entity, link) in orphan_link_q.iter() {
        commands.entity(link.0).despawn();
        commands.entity(entity).remove::<HanabiEffectLink>();
    }

    // --- Handle removed ParticleData: despawn child ---
    for (entity, link, data) in all_link_q.iter() {
        if data.is_none() {
            commands.entity(link.0).despawn();
            commands.entity(entity).remove::<HanabiEffectLink>();
        }
    }
}

/// Convert a `ParticleData` component into a bevy_hanabi `EffectAsset`.
#[cfg(feature = "webgpu")]
fn build_hanabi_effect(
    data: &crate::core::particles::ParticleData,
    effects: &mut Assets<bevy_hanabi::EffectAsset>,
) -> Handle<bevy_hanabi::EffectAsset> {
    use bevy_hanabi::prelude::*;
    use crate::core::particles::*;

    let writer = ExprWriter::new();

    // --- Age: always starts at 0 ---
    let init_age = SetAttributeModifier::new(Attribute::AGE, writer.lit(0.0f32).expr());

    // --- Lifetime: uniform random between min and max ---
    let lifetime_expr = if (data.lifetime_max - data.lifetime_min).abs() < 0.001 {
        writer.lit(data.lifetime_min).expr()
    } else {
        writer.lit(data.lifetime_min).uniform(writer.lit(data.lifetime_max)).expr()
    };
    let init_lifetime = SetAttributeModifier::new(Attribute::LIFETIME, lifetime_expr);

    // --- Velocity: per-component uniform random ---
    let vel_min = Vec3::new(data.velocity_min[0], data.velocity_min[1], data.velocity_min[2]);
    let vel_max = Vec3::new(data.velocity_max[0], data.velocity_max[1], data.velocity_max[2]);
    let vel_expr = if (vel_max - vel_min).length() < 0.001 {
        writer.lit(vel_min).expr()
    } else {
        writer.lit(vel_min).uniform(writer.lit(vel_max)).expr()
    };
    let init_vel = SetAttributeModifier::new(Attribute::VELOCITY, vel_expr);

    // --- Position modifier based on emission shape ---
    // We need to create expression handles before consuming the writer.
    let position_modifier: Option<Box<dyn Modifier + Send + Sync>> = match &data.emission_shape {
        EmissionShape::Point => None,
        EmissionShape::Sphere { radius } => {
            Some(Box::new(SetPositionSphereModifier {
                center: writer.lit(Vec3::ZERO).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Circle { radius } => {
            Some(Box::new(SetPositionCircleModifier {
                center: writer.lit(Vec3::ZERO).expr(),
                axis: writer.lit(Vec3::Y).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Cone { radius, height } => {
            // Approximate cone as a sphere with small radius + upward velocity bias
            // bevy_hanabi has SetPositionCone3dModifier but API may differ
            Some(Box::new(SetPositionSphereModifier {
                center: writer.lit(Vec3::new(0.0, *height * 0.5, 0.0)).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Box { half_extents } => {
            let he = Vec3::new(half_extents[0], half_extents[1], half_extents[2]);
            let pos_expr = writer.lit(-he).uniform(writer.lit(he)).expr();
            Some(Box::new(SetAttributeModifier::new(Attribute::POSITION, pos_expr)))
        }
    };

    // --- Acceleration ---
    let accel_vec = Vec3::new(data.acceleration[0], data.acceleration[1], data.acceleration[2]);
    let accel_expr = writer.lit(accel_vec).expr();

    // --- Linear drag ---
    let drag_expr = writer.lit(data.linear_drag).expr();

    // --- Finish the expression module ---
    let module = writer.finish();

    // --- Spawner settings ---
    let spawner = match &data.spawner_mode {
        SpawnerMode::Continuous { rate } => SpawnerSettings::rate((*rate).into()),
        SpawnerMode::Burst { count } => SpawnerSettings::once((*count as f32).into()),
        SpawnerMode::Once { count } => SpawnerSettings::once((*count as f32).into()),
    };

    // --- Simulation space ---
    let sim_space = if data.world_space {
        SimulationSpace::Global
    } else {
        SimulationSpace::Local
    };

    // --- Alpha mode ---
    let alpha_mode = match data.blend_mode {
        ParticleBlendMode::Additive => bevy_hanabi::AlphaMode::Add,
        ParticleBlendMode::AlphaBlend => bevy_hanabi::AlphaMode::Blend,
        ParticleBlendMode::Premultiply => bevy_hanabi::AlphaMode::Premultiply,
    };

    // --- Color gradient ---
    let mut color_gradient = Gradient::new();
    if data.color_gradient.is_empty() {
        color_gradient.add_key(0.0, Vec4::ONE);
        color_gradient.add_key(1.0, Vec4::new(1.0, 1.0, 1.0, 0.0));
    } else {
        for stop in &data.color_gradient {
            color_gradient.add_key(
                stop.position,
                Vec4::new(stop.color[0], stop.color[1], stop.color[2], stop.color[3]),
            );
        }
    }

    // --- Size gradient ---
    let mut size_gradient = Gradient::new();
    if data.size_keyframes.is_empty() {
        size_gradient.add_key(0.0, Vec3::splat(data.size_start));
        size_gradient.add_key(1.0, Vec3::splat(data.size_end));
    } else {
        for kf in &data.size_keyframes {
            size_gradient.add_key(kf.position, Vec3::splat(kf.size));
        }
    }

    // --- Orient mode ---
    let orient = match data.orientation {
        ParticleOrientation::Billboard => OrientModifier::new(OrientMode::FaceCameraPosition),
        ParticleOrientation::VelocityAligned => OrientModifier::new(OrientMode::AlongVelocity),
        ParticleOrientation::Fixed => OrientModifier::new(OrientMode::ParallelCameraDepthPlane),
    };

    // --- Build the EffectAsset ---
    let mut effect = EffectAsset::new(data.max_particles, spawner, module)
        .with_simulation_space(sim_space)
        .with_alpha_mode(alpha_mode)
        .init(init_age)
        .init(init_lifetime)
        .init(init_vel)
        .update(AccelModifier::new(accel_expr))
        .update(LinearDragModifier::new(drag_expr))
        .render(ColorOverLifetimeModifier::new(color_gradient))
        .render(SizeOverLifetimeModifier {
            gradient: size_gradient,
            screen_space_size: false,
        })
        .render(orient);

    // Add position modifier if not Point
    if let Some(pos_mod) = position_modifier {
        effect = effect.add_modifier(ModifierContext::Init, pos_mod);
    }

    effects.add(effect)
}

/// System that processes pending extrude requests.
fn apply_extrude_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::{emit_procedural_mesh_created, emit_procedural_mesh_error};

    for request in pending.extrude_requests.drain(..) {
        // Parse shape
        let shape = match request.shape.as_str() {
            "circle" => crate::core::procedural_mesh::ExtrudeShape::Circle {
                radius: request.radius,
                segments: request.segments,
            },
            "square" => crate::core::procedural_mesh::ExtrudeShape::Square {
                size: request.size.unwrap_or(1.0),
            },
            "hexagon" => crate::core::procedural_mesh::ExtrudeShape::Hexagon {
                radius: request.radius,
            },
            "star" => crate::core::procedural_mesh::ExtrudeShape::Star {
                outer_radius: request.radius,
                inner_radius: request.inner_radius.unwrap_or(request.radius * 0.5),
                points: request.star_points.unwrap_or(5),
            },
            _ => {
                emit_procedural_mesh_error(&format!("Unknown extrude shape: {}", request.shape));
                continue;
            }
        };

        // Generate mesh
        let mesh = crate::core::procedural_mesh::generate_extrude_mesh(&shape, request.length, request.segments);

        // Extract mesh data for snapshot
        let (positions, normals, uvs, indices) = {
            use bevy::render::mesh::VertexAttributeValues;
            let pos_attr = mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap();
            let norm_attr = mesh.attribute(Mesh::ATTRIBUTE_NORMAL).unwrap();
            let uv_attr = mesh.attribute(Mesh::ATTRIBUTE_UV_0).unwrap();
            let indices = mesh.indices().unwrap();

            let positions: Vec<[f32; 3]> = match pos_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let normals: Vec<[f32; 3]> = match norm_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let uvs: Vec<[f32; 2]> = match uv_attr {
                VertexAttributeValues::Float32x2(v) => v.clone(),
                _ => vec![],
            };
            let indices: Vec<u32> = match indices {
                bevy::render::mesh::Indices::U32(v) => v.clone(),
                bevy::render::mesh::Indices::U16(v) => v.iter().map(|i| *i as u32).collect(),
            };
            (positions, normals, uvs, indices)
        };

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions,
            normals,
            uvs,
            indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Extrude {
                shape: shape.clone(),
                length: request.length,
                segments: request.segments,
            },
        };

        // Create entity
        let name = request.name.unwrap_or_else(|| "Extruded Mesh".to_string());
        let position = request.position.unwrap_or(Vec3::ZERO);
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::from_translation(position),
        )).id();

        // Record in history
        history.push(UndoableAction::ExtrudeShape {
            snapshot: HistEntitySnapshot {
                entity_id: entity_id_str.clone(),
                entity_type: EntityType::ProceduralMesh,
                name: name.clone(),
                transform: TransformSnapshot {
                    position: [position.x, position.y, position.z],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                },
                parent_id: None,
                visible: true,
                material_data: Some(MaterialData::default()),
                light_data: None,
                physics_data: None,
                physics_enabled: false,
                asset_ref: None,
                script_data: None,
                audio_data: None,
                particle_data: None,
                particle_enabled: false,
                shader_effect_data: None,
                csg_mesh_data: None,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: Some(mesh_data),
            },
        });

        // Select the new entity
        selection.entities.clear();
        selection.entity_ids.clear();
        selection.entities.insert(entity);
        selection.entity_ids.insert(entity_id_str.clone());
        selection.primary = Some(entity);
        selection.primary_id = Some(entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![entity_id_str.clone()],
            primary_id: Some(entity_id_str.clone()),
            primary_name: Some(name.clone()),
        });

        emit_procedural_mesh_created(&entity_id_str, &name, "extrude");
    }
}

/// System that processes pending lathe requests.
fn apply_lathe_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::emit_procedural_mesh_created;

    for request in pending.lathe_requests.drain(..) {
        // Generate mesh
        let mesh = crate::core::procedural_mesh::generate_lathe_mesh(&request.profile, request.segments);

        // Extract mesh data for snapshot
        let (positions, normals, uvs, indices) = {
            use bevy::render::mesh::VertexAttributeValues;
            let pos_attr = mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap();
            let norm_attr = mesh.attribute(Mesh::ATTRIBUTE_NORMAL).unwrap();
            let uv_attr = mesh.attribute(Mesh::ATTRIBUTE_UV_0).unwrap();
            let indices = mesh.indices().unwrap();

            let positions: Vec<[f32; 3]> = match pos_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let normals: Vec<[f32; 3]> = match norm_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let uvs: Vec<[f32; 2]> = match uv_attr {
                VertexAttributeValues::Float32x2(v) => v.clone(),
                _ => vec![],
            };
            let indices: Vec<u32> = match indices {
                bevy::render::mesh::Indices::U32(v) => v.clone(),
                bevy::render::mesh::Indices::U16(v) => v.iter().map(|i| *i as u32).collect(),
            };
            (positions, normals, uvs, indices)
        };

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions,
            normals,
            uvs,
            indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Lathe {
                profile: request.profile,
                segments: request.segments,
            },
        };

        // Create entity
        let name = request.name.unwrap_or_else(|| "Lathed Mesh".to_string());
        let position = request.position.unwrap_or(Vec3::ZERO);
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::from_translation(position),
        )).id();

        // Record in history
        history.push(UndoableAction::LatheShape {
            snapshot: HistEntitySnapshot {
                entity_id: entity_id_str.clone(),
                entity_type: EntityType::ProceduralMesh,
                name: name.clone(),
                transform: TransformSnapshot {
                    position: [position.x, position.y, position.z],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                },
                parent_id: None,
                visible: true,
                material_data: Some(MaterialData::default()),
                light_data: None,
                physics_data: None,
                physics_enabled: false,
                asset_ref: None,
                script_data: None,
                audio_data: None,
                particle_data: None,
                particle_enabled: false,
                shader_effect_data: None,
                csg_mesh_data: None,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: Some(mesh_data),
            },
        });

        // Select the new entity
        selection.entities.clear();
        selection.entity_ids.clear();
        selection.entities.insert(entity);
        selection.entity_ids.insert(entity_id_str.clone());
        selection.primary = Some(entity);
        selection.primary_id = Some(entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![entity_id_str.clone()],
            primary_id: Some(entity_id_str.clone()),
            primary_name: Some(name.clone()),
        });

        emit_procedural_mesh_created(&entity_id_str, &name, "lathe");
    }
}

/// System that processes pending array requests (duplicate entity in pattern).
fn apply_array_requests(
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
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&core::procedural_mesh::ProceduralMeshData>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::{emit_array_completed, emit_procedural_mesh_error};

    for request in pending.array_requests.drain(..) {
        let source_found = query.iter().find(|(_, eid, ..)| eid.0 == request.entity_id);
        if source_found.is_none() {
            emit_procedural_mesh_error(&format!("Source entity not found: {}", request.entity_id));
            continue;
        }

        let (_src_entity, src_eid, src_name, src_transform, src_entity_type, mesh_h, mat_h, pl, dl, sl, mat_data, light_data, phys_data, phys_enabled, asset_ref) = source_found.unwrap();

        let src_script_data = script_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, sd)| sd.cloned());
        let src_audio_data = audio_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, ad)| ad.cloned());
        let (src_particle_data, src_particle_enabled) = particle_query.iter().find(|(eid, _, _)| eid.0 == src_eid.0).map(|(_, pd, pe)| (pd.cloned(), pe.is_some())).unwrap_or((None, false));
        let src_shader_data = shader_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, sed)| sed.cloned());
        let src_csg_data = csg_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, cmd)| cmd.cloned());
        let src_procedural_mesh_data = procedural_mesh_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, pmd)| pmd.cloned());

        let entity_type = src_entity_type.copied().unwrap_or(EntityType::Cube);

        let mut offsets: Vec<Vec3> = Vec::new();
        match request.pattern.as_str() {
            "grid" => {
                let count_x = request.count_x.unwrap_or(2).max(1);
                let count_y = request.count_y.unwrap_or(1).max(1);
                let count_z = request.count_z.unwrap_or(2).max(1);
                let spacing_x = request.spacing_x.unwrap_or(2.0);
                let spacing_y = request.spacing_y.unwrap_or(2.0);
                let spacing_z = request.spacing_z.unwrap_or(2.0);

                for x in 0..count_x {
                    for y in 0..count_y {
                        for z in 0..count_z {
                            if x == 0 && y == 0 && z == 0 {
                                continue;
                            }
                            offsets.push(Vec3::new(
                                x as f32 * spacing_x,
                                y as f32 * spacing_y,
                                z as f32 * spacing_z,
                            ));
                        }
                    }
                }
            }
            "circle" => {
                let count = request.circle_count.unwrap_or(8).max(2);
                let radius = request.circle_radius.unwrap_or(5.0);
                for i in 0..count {
                    if i == 0 {
                        continue;
                    }
                    let angle = (i as f32) * std::f32::consts::TAU / (count as f32);
                    offsets.push(Vec3::new(radius * angle.cos(), 0.0, radius * angle.sin()));
                }
            }
            _ => {
                emit_procedural_mesh_error(&format!("Unknown array pattern: {}", request.pattern));
                continue;
            }
        }

        let mut created_snapshots = Vec::new();
        let mut created_ids = Vec::new();
        for offset in offsets {
            let new_pos = src_transform.translation + offset;
            let new_name = format!("{} (Array)", src_name.0);
            let new_entity_id = EntityId::default();
            let new_entity_id_str = new_entity_id.0.clone();
            created_ids.push(new_entity_id_str.clone());

            let mut ec = commands.spawn((
                entity_type,
                new_entity_id,
                EntityName::new(&new_name),
                EntityVisible::default(),
                Transform {
                    translation: new_pos,
                    rotation: src_transform.rotation,
                    scale: src_transform.scale,
                },
            ));

            if let Some(m) = mesh_h { ec.insert(m.clone()); }
            if let Some(mat) = mat_h { ec.insert(mat.clone()); }
            if let Some(p) = pl { ec.insert(p.clone()); }
            if let Some(d) = dl { ec.insert(d.clone()); }
            if let Some(s) = sl { ec.insert(s.clone()); }
            if let Some(md) = mat_data { ec.insert(md.clone()); }
            if let Some(ld) = light_data { ec.insert(ld.clone()); }
            if let Some(pd) = phys_data { ec.insert(pd.clone()); }
            if phys_enabled.is_some() { ec.insert(PhysicsEnabled); }
            if let Some(ar) = asset_ref { ec.insert(ar.clone()); }
            if let Some(ref sd) = src_script_data { ec.insert(sd.clone()); }
            if let Some(ref ad) = src_audio_data { ec.insert(ad.clone()); ec.insert(AudioEnabled); }
            if let Some(ref pd) = src_particle_data { ec.insert(pd.clone()); }
            if src_particle_enabled { ec.insert(ParticleEnabled); }
            if let Some(ref sed) = src_shader_data { ec.insert(sed.clone()); }
            if let Some(ref cmd) = src_csg_data { ec.insert(cmd.clone()); }
            if let Some(ref pmd) = src_procedural_mesh_data { ec.insert(pmd.clone()); }

            created_snapshots.push(HistEntitySnapshot {
                entity_id: new_entity_id_str,
                entity_type,
                name: new_name,
                transform: TransformSnapshot {
                    position: [new_pos.x, new_pos.y, new_pos.z],
                    rotation: [src_transform.rotation.x, src_transform.rotation.y, src_transform.rotation.z, src_transform.rotation.w],
                    scale: [src_transform.scale.x, src_transform.scale.y, src_transform.scale.z],
                },
                parent_id: None,
                visible: true,
                material_data: mat_data.cloned(),
                light_data: light_data.cloned(),
                physics_data: phys_data.cloned(),
                physics_enabled: phys_enabled.is_some(),
                asset_ref: asset_ref.cloned(),
                script_data: src_script_data.clone(),
                audio_data: src_audio_data.clone(),
                particle_data: src_particle_data.clone(),
                particle_enabled: src_particle_enabled,
                shader_effect_data: src_shader_data.clone(),
                csg_mesh_data: src_csg_data.clone(),
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: src_procedural_mesh_data.clone(),
            });
        }

        history.push(UndoableAction::ArrayEntity {
            source_id: request.entity_id.clone(),
            created_snapshots,
        });

        emit_array_completed(&request.entity_id, &created_ids);
    }
}

/// System that processes pending combine mesh requests.
fn apply_combine_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        Option<&Mesh3d>,
        Option<&MaterialData>,
    )>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&core::procedural_mesh::ProceduralMeshData>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::{emit_procedural_mesh_created, emit_procedural_mesh_error};

    for request in pending.combine_requests.drain(..) {
        let mut mesh_list: Vec<(Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>, Transform)> = Vec::new();
        let mut source_snapshots: Vec<HistEntitySnapshot> = Vec::new();

        for entity_id in &request.entity_ids {
            if let Some((entity, eid, ename, transform, mesh_handle, mat_data)) = query.iter().find(|(_, eid, ..)| &eid.0 == entity_id) {
                if let Some(mh) = mesh_handle {
                    if let Some(mesh) = meshes.get(&mh.0) {
                        use bevy::render::mesh::VertexAttributeValues;
                        let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let normals: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let indices: Vec<u32> = match mesh.indices() {
                            Some(bevy::render::mesh::Indices::U32(v)) => v.clone(),
                            Some(bevy::render::mesh::Indices::U16(v)) => v.iter().map(|i| *i as u32).collect(),
                            None => vec![],
                        };
                        mesh_list.push((positions, normals, indices, *transform));
                    }
                }

                let src_script_data = script_query.iter().find(|(sid, _)| sid.0 == eid.0).and_then(|(_, sd)| sd.cloned());
                let src_audio_data = audio_query.iter().find(|(aid, _)| aid.0 == eid.0).and_then(|(_, ad)| ad.cloned());
                let (src_particle_data, src_particle_enabled) = particle_query.iter().find(|(pid, _, _)| pid.0 == eid.0).map(|(_, pd, pe)| (pd.cloned(), pe.is_some())).unwrap_or((None, false));
                let src_shader_data = shader_query.iter().find(|(sid, _)| sid.0 == eid.0).and_then(|(_, sed)| sed.cloned());
                let src_csg_data = csg_query.iter().find(|(cid, _)| cid.0 == eid.0).and_then(|(_, cmd)| cmd.cloned());
                let src_procedural_mesh_data = procedural_mesh_query.iter().find(|(pid, _)| pid.0 == eid.0).and_then(|(_, pmd)| pmd.cloned());

                source_snapshots.push(HistEntitySnapshot {
                    entity_id: eid.0.clone(),
                    entity_type: EntityType::Cube,
                    name: ename.0.clone(),
                    transform: TransformSnapshot::from(transform),
                    parent_id: None,
                    visible: true,
                    material_data: mat_data.cloned(),
                    light_data: None,
                    physics_data: None,
                    physics_enabled: false,
                    asset_ref: None,
                    script_data: src_script_data,
                    audio_data: src_audio_data,
                    particle_data: src_particle_data,
                    particle_enabled: src_particle_enabled,
                    shader_effect_data: src_shader_data,
                    csg_mesh_data: src_csg_data,
                    terrain_data: None,
                    terrain_mesh_data: None,
                    procedural_mesh_data: src_procedural_mesh_data,
                });

                if request.delete_sources {
                    commands.entity(entity).despawn();
                    selection.entities.remove(&entity);
                    selection.entity_ids.remove(entity_id);
                }
            }
        }

        if mesh_list.is_empty() {
            emit_procedural_mesh_error("No valid meshes to combine");
            continue;
        }

        let (combined_positions, combined_normals, combined_indices) = crate::core::procedural_mesh::combine_meshes_data(mesh_list);
        let uv_count = combined_normals.len();

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions: combined_positions,
            normals: combined_normals,
            uvs: vec![[0.0, 0.0]; uv_count],
            indices: combined_indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Combine,
        };

        let combined_mesh = crate::core::procedural_mesh::rebuild_procedural_mesh(&mesh_data);

        let name = request.name.unwrap_or_else(|| "Combined Mesh".to_string());
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(combined_mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::default(),
        )).id();

        history.push(UndoableAction::CombineMeshes {
            source_snapshots,
            result_snapshot: HistEntitySnapshot {
                entity_id: entity_id_str.clone(),
                entity_type: EntityType::ProceduralMesh,
                name: name.clone(),
                transform: TransformSnapshot {
                    position: [0.0, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                },
                parent_id: None,
                visible: true,
                material_data: Some(MaterialData::default()),
                light_data: None,
                physics_data: None,
                physics_enabled: false,
                asset_ref: None,
                script_data: None,
                audio_data: None,
                particle_data: None,
                particle_enabled: false,
                shader_effect_data: None,
                csg_mesh_data: None,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: Some(mesh_data),
            },
        });

        selection.entities.clear();
        selection.entity_ids.clear();
        selection.entities.insert(entity);
        selection.entity_ids.insert(entity_id_str.clone());
        selection.primary = Some(entity);
        selection.primary_id = Some(entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![entity_id_str.clone()],
            primary_id: Some(entity_id_str.clone()),
            primary_name: Some(name.clone()),
        });

        emit_procedural_mesh_created(&entity_id_str, &name, "combine");
    }
}

/// System that processes pending instantiate prefab requests.
fn apply_instantiate_prefab(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    for request in pending.instantiate_prefab_requests.drain(..) {
        // Deserialize the snapshot JSON
        let snapshot: HistEntitySnapshot = match serde_json::from_str(&request.snapshot_json) {
            Ok(s) => s,
            Err(e) => {
                log(&format!("Failed to deserialize prefab snapshot: {}", e));
                continue;
            }
        };

        // Create a mutable copy to apply overrides
        let mut modified_snapshot = snapshot;

        // Override position if provided
        if let Some(pos) = request.position {
            modified_snapshot.transform.position = pos;
        }

        // Override name if provided
        if let Some(name) = request.name {
            modified_snapshot.name = name;
        }

        // Spawn the entity from the snapshot
        let _entity = entity_factory::spawn_from_snapshot(
            &mut commands,
            &mut meshes,
            &mut materials,
            &modified_snapshot,
        );

        // Mark scene graph as dirty to trigger update event
        cache.dirty = true;
    }
}
