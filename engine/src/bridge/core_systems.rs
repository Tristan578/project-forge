//! Core editor systems for selection, picking, mode changes, transforms, renaming, and snap settings.

use bevy::prelude::*;
use bevy::input::ButtonInput;
use bevy::input::keyboard::KeyCode;
use bevy::picking::pointer::PointerButton;
use bevy::picking::events::Pressed;
use bevy::ecs::system::ParamSet;

use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
use crate::core::pending::EntityType;
use crate::core::selection::{Selection, SelectionChangedEvent};
use crate::core::scene_graph::SceneGraphCache;
use crate::core::history::HistoryStack;
use crate::core::material::MaterialData;
use crate::core::lighting::LightData;
use crate::core::physics::{PhysicsData, PhysicsEnabled};
use crate::core::scripting::ScriptData;
use crate::core::audio::AudioData;
use crate::core::engine_mode::{EngineMode, SceneSnapshot, ModeChangeRequest};
use crate::core::snap::SnapSettings;
use crate::core::pending_commands::PendingCommands;
use crate::core::asset_manager::AssetRef;
use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled};
use crate::core::particles::{ParticleData, ParticleEnabled};
use crate::core::shader_effects::ShaderEffectData;
use crate::core::game_components::GameComponents;
use crate::core::game_camera::{GameCameraData, ActiveGameCamera};
use crate::core::{entity_factory, history, pending_commands};

use super::events;
use super::log;

/// Buffer for collecting picking hits within a frame, so we can select the closest.
#[cfg(not(feature = "runtime"))]
#[derive(Resource, Default)]
pub(super) struct PickBuffer {
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

/// System that processes mode change requests (play/stop/pause/resume).
/// Uses ParamSet because snapshot_query (read) and restore_query (write)
/// access overlapping components (Transform, EntityName, etc.).
pub(super) fn apply_mode_change_requests(
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
    script_audio_query: Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>)>,
    reverb_particle_shader_query: Query<(&EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>, Option<&ParticleData>, Option<&ParticleEnabled>, Option<&ShaderEffectData>)>,
    csg_sprite_query: Query<(&EntityId, Option<&crate::core::csg::CsgMeshData>, Option<&crate::core::sprite::SpriteData>)>,
    procedural_joint_game_query: Query<(&EntityId, Option<&crate::core::procedural_mesh::ProceduralMeshData>, Option<&crate::core::physics::JointData>, Option<&GameComponents>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    tilemap_skeleton2d_query: Query<(&EntityId, Option<&crate::core::tilemap::TilemapData>, Option<&crate::core::tilemap::TilemapEnabled>, Option<&crate::core::skeleton2d::SkeletonData2d>, Option<&crate::core::skeleton2d::SkeletonEnabled2d>, Option<&crate::core::skeletal_animation2d::SkeletalAnimation2d>)>,
    runtime_query: Query<Entity, With<crate::core::engine_mode::RuntimeEntity>>,
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
                    *snapshot = crate::core::engine_mode::snapshot_scene(&snapshot_query, &script_audio_query, &reverb_particle_shader_query, &csg_sprite_query, &procedural_joint_game_query, &tilemap_skeleton2d_query, &selection);
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
                    crate::core::engine_mode::restore_scene(
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
pub(super) fn apply_selection_requests(
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
pub(super) fn emit_transform_on_selection(
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

            let payload = crate::core::gizmo::TransformPayload {
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
pub(super) fn handle_picking_pressed(
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
pub(super) fn process_pick_buffer(
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
pub(super) fn emit_selection_events(
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

/// System that emits scene graph updates when the graph is dirty.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_scene_graph_updates(
    mut cache: ResMut<SceneGraphCache>,
) {
    if cache.dirty && events::has_event_callback() {
        events::emit_scene_graph_update(&cache.data);
        cache.dirty = false;
    }
}

/// System that emits history state updates when history changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_history_updates(
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
pub(super) fn register_pending_commands_resource(
    mut commands_res: ResMut<PendingCommands>,
) {
    let ptr = commands_res.as_mut() as *mut PendingCommands;
    pending_commands::register_pending_commands(ptr);
    log("PendingCommands resource registered for bridge access");
}

/// Startup system to register the HistoryStack resource for bridge access.
pub(super) fn register_history_stack_resource(
    mut history_res: ResMut<HistoryStack>,
) {
    let ptr = history_res.as_mut() as *mut HistoryStack;
    history::register_history_stack(ptr);
    log("HistoryStack resource registered for bridge access");
}

/// System that applies pending transform updates from the bridge.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_pending_transforms(
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
pub(super) fn apply_pending_renames(
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
pub(super) fn apply_pending_snap_settings(
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
