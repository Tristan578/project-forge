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
};

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
        app.init_resource::<Selection>()
            .init_resource::<SceneGraphCache>()
            .init_resource::<PendingCommands>()
            .init_resource::<HistoryStack>()
            .init_resource::<EngineMode>()
            .init_resource::<SceneSnapshot>()
            .init_resource::<SceneName>()
            .init_resource::<AssetRegistry>()
            .init_resource::<AudioBusConfig>()
            .add_event::<SelectionChangedEvent>();

        #[cfg(not(feature = "runtime"))]
        app.init_resource::<PickBuffer>();

        app
            .add_systems(Startup, (register_pending_commands_resource, register_history_stack_resource))
            // Always-active systems: run in both editor and runtime
            .add_systems(Update, (
                process_query_requests,
                apply_mode_change_requests,
                apply_input_binding_updates,
                apply_physics_updates,
                apply_physics_toggles,
                apply_force_applications,
                apply_script_updates,
                apply_script_removals,
                apply_audio_updates,
                apply_audio_removals,
                apply_audio_playback,
                apply_audio_bus_updates,
                apply_audio_bus_creates,
                apply_audio_bus_deletes,
                apply_audio_bus_effects_updates,
                entity_factory::apply_spawn_requests,
                entity_factory::apply_delete_requests,
            ))
            // Particle systems (always-active, split to stay under tuple limit)
            .add_systems(Update, (
                apply_particle_updates,
                apply_particle_toggles,
                apply_particle_removals,
                apply_particle_preset_requests,
                apply_particle_playback,
            ))
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
                    apply_post_processing_updates,
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
                    visibility::sync_visibility,
                ).chain().in_set(EditorSystemSet))
                .add_systems(Update, (
                    apply_debug_physics_toggle,
                    apply_scene_export,
                    apply_scene_load,
                    apply_new_scene,
                    apply_gltf_import,
                    apply_texture_load,
                    apply_remove_texture,
                    apply_place_asset,
                    apply_delete_asset,
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
                    *snapshot = core::engine_mode::snapshot_scene(&snapshot_query, &script_query, &audio_query, &particle_snapshot_query, &selection);
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
/// Registers the texture as an asset and updates the entity's MaterialData.
#[cfg(not(feature = "runtime"))]
fn apply_texture_load(
    mut pending: ResMut<PendingCommands>,
    mut asset_registry: ResMut<AssetRegistry>,
    mut mat_query: Query<(&EntityId, &mut MaterialData)>,
) {
    use crate::core::asset_manager::{AssetKind, AssetMetadata, AssetSource};

    for request in pending.texture_load_requests.drain(..) {
        let asset_id = uuid::Uuid::new_v4().to_string();
        let file_size = request.data_base64.len() as u64;

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
fn apply_particle_playback(
    mut pending: ResMut<PendingCommands>,
) {
    // Particle playback (play/stop/burst) would control the actual bevy_hanabi
    // EffectSpawner in a WebGPU build. For now, clear the queue.
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
