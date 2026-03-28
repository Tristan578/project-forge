//! Physics systems for both 3D and 2D physics, collisions, raycasts, joints, and forces.
//!
//! All functions are `pub(super)` and called from the parent bridge module.

use bevy::prelude::*;

use crate::core::{
    entity_id::EntityId,
    history::HistoryStack,
    pending_commands::{self, PendingCommands},
    physics::{DebugPhysicsEnabled, PhysicsData, PhysicsEnabled},
    physics_2d::{Physics2dData, Physics2dEnabled, PhysicsJoint2d},
    selection::{Selection, SelectionChangedEvent},
    engine_mode::EngineMode,
};

use super::events;

// ============================================================================
// 3D Physics Systems
// ============================================================================

/// System that applies pending physics updates (always-active — edit physics in any mode).
pub(super) fn apply_physics_updates(
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
                history.push(crate::core::history::UndoableAction::PhysicsChange {
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
pub(super) fn apply_physics_toggles(
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
                    } else if let Some(pd) = physics_data {
                        events::emit_physics_changed(&toggle.entity_id, pd, true);
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
pub(super) fn apply_debug_physics_toggle(
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
pub(super) fn apply_force_applications(
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

/// System that applies pending create joint requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_create_joint_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId)>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.create_joint_requests.drain(..) {
        // Find the entity to add the joint to
        for (entity, entity_id) in query.iter() {
            if entity_id.0 == request.entity_id {
                commands.entity(entity).insert(request.joint_data.clone());

                // Record for undo
                history.push(crate::core::history::UndoableAction::JointChange {
                    entity_id: request.entity_id.clone(),
                    old_joint: None,
                    new_joint: Some(request.joint_data.clone()),
                });

                // Emit change event
                events::emit_joint_changed(&request.joint_data);
                break;
            }
        }
    }
}

/// System that applies pending update joint requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_update_joint_requests(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut crate::core::physics::JointData)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.update_joint_requests.drain(..) {
        for (entity_id, mut current_joint) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_joint = current_joint.clone();

                // Apply updates
                if let Some(joint_type) = update.joint_type {
                    current_joint.joint_type = joint_type;
                }
                if let Some(connected_entity_id) = update.connected_entity_id {
                    current_joint.connected_entity_id = connected_entity_id;
                }
                if let Some(anchor_self) = update.anchor_self {
                    current_joint.anchor_self = anchor_self;
                }
                if let Some(anchor_other) = update.anchor_other {
                    current_joint.anchor_other = anchor_other;
                }
                if let Some(axis) = update.axis {
                    current_joint.axis = axis;
                }
                if let Some(limits) = update.limits {
                    current_joint.limits = limits;
                }
                if let Some(motor) = update.motor {
                    current_joint.motor = motor;
                }

                // Record for undo
                history.push(crate::core::history::UndoableAction::JointChange {
                    entity_id: update.entity_id.clone(),
                    old_joint: Some(old_joint),
                    new_joint: Some(current_joint.clone()),
                });

                // Emit change event
                events::emit_joint_changed(&current_joint);
                break;
            }
        }
    }
}

/// System that applies pending remove joint requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_remove_joint_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, &crate::core::physics::JointData)>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.remove_joint_requests.drain(..) {
        for (entity, entity_id, joint_data) in query.iter() {
            if entity_id.0 == request.entity_id {
                let old_joint = joint_data.clone();
                commands.entity(entity).remove::<crate::core::physics::JointData>();

                // Record for undo
                history.push(crate::core::history::UndoableAction::JointChange {
                    entity_id: request.entity_id.clone(),
                    old_joint: Some(old_joint),
                    new_joint: None,
                });

                // No event needed — removal is implicit
                break;
            }
        }
    }
}

// ============================================================================
// 2D Physics Systems (Metadata-only)
// ============================================================================

/// System that applies pending 2D physics update requests (always-active, metadata-only).
pub(super) fn apply_physics2d_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut Physics2dData)>,
    phys2d_enabled_query: Query<&EntityId, With<Physics2dEnabled>>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.physics2d_updates.drain(..) {
        for (entity_id, mut current_physics) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_physics = current_physics.clone();
                *current_physics = update.physics_data.clone();

                // Record for undo (using Physics2dChange action)
                history.push(crate::core::history::UndoableAction::Physics2dChange {
                    entity_id: update.entity_id.clone(),
                    old_physics: Some(old_physics),
                    new_physics: Some(update.physics_data.clone()),
                });

                // Emit change event
                let enabled = phys2d_enabled_query.iter().any(|eid| eid.0 == update.entity_id);
                events::emit_physics2d_changed(&update.entity_id, &update.physics_data, enabled);
                break;
            }
        }
    }
}

/// System that applies pending 2D physics toggle requests (always-active, metadata-only).
pub(super) fn apply_physics2d_toggles(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&Physics2dData>, Option<&Physics2dEnabled>)>,
) {
    for toggle in pending.physics2d_toggles.drain(..) {
        for (entity, entity_id, physics_data, phys2d_enabled) in query.iter() {
            if entity_id.0 == toggle.entity_id {
                if toggle.enabled {
                    // Enable physics: add Physics2dEnabled marker and Physics2dData if missing
                    if phys2d_enabled.is_none() {
                        commands.entity(entity).insert(Physics2dEnabled);
                    }
                    if physics_data.is_none() {
                        commands.entity(entity).insert(Physics2dData::default());
                    }
                    let data = physics_data.cloned().unwrap_or_default();
                    events::emit_physics2d_changed(&toggle.entity_id, &data, true);
                } else {
                    // Disable physics: remove Physics2dEnabled marker
                    if phys2d_enabled.is_some() {
                        commands.entity(entity).remove::<Physics2dEnabled>();
                    }
                    if let Some(data) = physics_data {
                        events::emit_physics2d_changed(&toggle.entity_id, data, false);
                    }
                }
                break;
            }
        }
    }
}

/// System that applies 2D joint creation requests (editor-only, metadata-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_create_joint2d_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId)>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.create_joint2d_requests.drain(..) {
        // Find the entity to add the joint to
        for (entity, entity_id) in query.iter() {
            if entity_id.0 == request.entity_id {
                commands.entity(entity).insert(request.joint_data.clone());

                // Record for undo
                history.push(crate::core::history::UndoableAction::Joint2dChange {
                    entity_id: request.entity_id.clone(),
                    old_joint: None,
                    new_joint: Some(request.joint_data.clone()),
                });

                // Emit change event
                events::emit_joint2d_changed(&request.entity_id, &request.joint_data);
                break;
            }
        }
    }
}

/// System that applies 2D joint update requests (editor-only, metadata-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_update_joint2d_requests(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut PhysicsJoint2d)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.update_joint2d_requests.drain(..) {
        for (entity_id, mut current_joint) in query.iter_mut() {
            if entity_id.0 == update.entity_id {
                let old_joint = current_joint.clone();
                *current_joint = update.joint_data.clone();

                // Record for undo
                history.push(crate::core::history::UndoableAction::Joint2dChange {
                    entity_id: update.entity_id.clone(),
                    old_joint: Some(old_joint),
                    new_joint: Some(update.joint_data.clone()),
                });

                // Emit change event
                events::emit_joint2d_changed(&update.entity_id, &update.joint_data);
                break;
            }
        }
    }
}

/// System that applies 2D joint removal requests (editor-only, metadata-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_remove_joint2d_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, &PhysicsJoint2d)>,
    mut history: ResMut<HistoryStack>,
) {
    for request in pending.remove_joint2d_requests.drain(..) {
        for (entity, entity_id, joint_data) in query.iter() {
            if entity_id.0 == request.entity_id {
                let old_joint = joint_data.clone();
                commands.entity(entity).remove::<PhysicsJoint2d>();

                // Record for undo
                history.push(crate::core::history::UndoableAction::Joint2dChange {
                    entity_id: request.entity_id.clone(),
                    old_joint: Some(old_joint),
                    new_joint: None,
                });

                // No event needed — removal is implicit
                break;
            }
        }
    }
}

/// System that applies 2D force applications (only works during Play mode).
pub(super) fn apply_force_applications2d(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    engine_mode: Res<EngineMode>,
    query: Query<(Entity, &EntityId), With<bevy_rapier2d::prelude::RigidBody>>,
) {
    if !engine_mode.is_playing() {
        pending.force_applications2d.clear();
        return;
    }

    for application in pending.force_applications2d.drain(..) {
        for (entity, entity_id) in query.iter() {
            if entity_id.0 == application.entity_id {
                commands.entity(entity).insert(
                    bevy_rapier2d::prelude::ExternalForce {
                        force: bevy_rapier2d::prelude::Vect::new(
                            application.force_x,
                            application.force_y,
                        ),
                        torque: 0.0,
                    }
                );
                break;
            }
        }
    }
}

/// System that applies 2D impulse applications (only works during Play mode).
pub(super) fn apply_impulse_applications2d(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    engine_mode: Res<EngineMode>,
    query: Query<(Entity, &EntityId), With<bevy_rapier2d::prelude::RigidBody>>,
) {
    if !engine_mode.is_playing() {
        pending.impulse_applications2d.clear();
        return;
    }

    for application in pending.impulse_applications2d.drain(..) {
        for (entity, entity_id) in query.iter() {
            if entity_id.0 == application.entity_id {
                commands.entity(entity).insert(
                    bevy_rapier2d::prelude::ExternalImpulse {
                        impulse: bevy_rapier2d::prelude::Vect::new(
                            application.impulse_x,
                            application.impulse_y,
                        ),
                        torque_impulse: 0.0,
                    }
                );
                break;
            }
        }
    }
}

/// System that processes 2D raycast requests using Rapier 2D context.
pub(super) fn apply_raycast2d_requests(
    mut pending: ResMut<PendingCommands>,
    rapier_context: bevy_rapier2d::prelude::ReadRapierContext,
    entity_id_query: Query<&EntityId>,
) {
    for request in pending.raycast2d_requests.drain(..) {
        let Ok(rapier_context) = rapier_context.single() else {
            events::emit_raycast2d_miss();
            continue;
        };

        let origin = bevy_rapier2d::prelude::Vect::new(request.origin_x, request.origin_y);
        let direction = bevy_rapier2d::prelude::Vect::new(request.dir_x, request.dir_y);

        if let Some((entity, toi)) = rapier_context.cast_ray(
            origin,
            direction,
            request.max_distance,
            true,
            bevy_rapier2d::prelude::QueryFilter::default(),
        ) {
            let hit_point = origin + direction * toi;
            if let Ok(eid) = entity_id_query.get(entity) {
                // Compute a simple 2D normal (perpendicular to ray direction)
                let dir_len = (direction.x * direction.x + direction.y * direction.y).sqrt();
                let normal_x = if dir_len > 0.0 { -direction.y / dir_len } else { 0.0 };
                let normal_y = if dir_len > 0.0 { direction.x / dir_len } else { 1.0 };
                events::emit_raycast2d_hit(
                    &eid.0,
                    hit_point.x,
                    hit_point.y,
                    normal_x,
                    normal_y,
                    toi,
                );
            } else {
                events::emit_raycast2d_miss();
            }
        } else {
            events::emit_raycast2d_miss();
        }
    }
}

/// System that applies 2D gravity updates to the Gravity2d resource.
pub(super) fn apply_gravity2d_updates(
    mut pending: ResMut<PendingCommands>,
    mut gravity: ResMut<crate::core::physics_2d_sim::Gravity2d>,
) {
    for update in pending.gravity2d_updates.drain(..) {
        gravity.x = update.gravity_x;
        gravity.y = update.gravity_y;
        tracing::info!(
            "2D gravity updated: ({}, {})",
            update.gravity_x,
            update.gravity_y
        );
    }
}

/// System that applies 2D debug physics toggles.
pub(super) fn apply_debug_physics2d_toggle(
    mut pending: ResMut<PendingCommands>,
    mut debug_enabled: ResMut<crate::core::physics_2d_sim::DebugPhysics2dEnabled>,
) {
    for toggle in pending.debug_physics2d_toggles.drain(..) {
        debug_enabled.0 = toggle.enabled;
        tracing::info!("2D debug physics rendering: {}", toggle.enabled);
    }
}

/// System that handles 2D physics query requests (editor-only).
pub(super) fn handle_physics2d_query(
    mut pending: ResMut<PendingCommands>,
    physics_query: Query<(&EntityId, &Physics2dData, Option<&Physics2dEnabled>)>,
) {
    let requests: Vec<pending_commands::QueryRequest> = pending.query_requests
        .drain(..)
        .filter(|req| matches!(req, pending_commands::QueryRequest::Physics2dState { .. }))
        .collect();

    for request in requests {
        if let pending_commands::QueryRequest::Physics2dState { entity_id } = request {
            // Find the entity
            let found = physics_query.iter().find(|(eid, _, _)| eid.0 == entity_id);
            if let Some((eid, physics_data, phys2d_enabled)) = found {
                let enabled = phys2d_enabled.is_some();
                events::emit_physics2d_changed(&eid.0, physics_data, enabled);
            }
        }
    }
}

// ============================================================================
// Collision & Raycast Systems
// ============================================================================

/// System that reads collision events from Rapier and emits them to JS.
/// Runs always (mode-gated internally by checking if physics is active).
pub(super) fn read_collision_events(
    mut collision_events: MessageReader<bevy_rapier3d::prelude::CollisionEvent>,
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

/// System that reads 2D collision events from Rapier 2D and emits them to JS.
/// Runs always (mode-gated internally by checking if physics is active).
pub(super) fn read_collision_events_2d(
    mut collision_events: MessageReader<bevy_rapier2d::prelude::CollisionEvent>,
    entity_id_query: Query<&EntityId>,
    engine_mode: Res<EngineMode>,
) {
    if !engine_mode.is_playing() {
        collision_events.clear();
        return;
    }

    for event in collision_events.read() {
        let (entity_a, entity_b, started) = match event {
            bevy_rapier2d::prelude::CollisionEvent::Started(a, b, _) => (*a, *b, true),
            bevy_rapier2d::prelude::CollisionEvent::Stopped(a, b, _) => (*a, *b, false),
        };

        if let (Ok(id_a), Ok(id_b)) = (entity_id_query.get(entity_a), entity_id_query.get(entity_b)) {
            events::emit_collision_event(&id_a.0, &id_b.0, started);
        }
    }
}

/// System that processes raycast requests.
/// Runs always-active (AI/MCP might raycast from edit mode too).
pub(super) fn apply_raycast_queries(
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

// ============================================================================
// Editor-Only Selection Emit Systems
// ============================================================================

/// System that emits physics data when the primary selection changes or physics data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_physics_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &PhysicsData, Option<&PhysicsEnabled>), Changed<PhysicsData>>,
    selection_query: Query<(&EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
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

/// System that emits joint data when selection changes or joint changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_joint_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &crate::core::physics::JointData), Changed<crate::core::physics::JointData>>,
    selection_query: Query<(&EntityId, Option<&crate::core::physics::JointData>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((_, joint_data)) = selection_query.get(primary) {
                if let Some(jd) = joint_data {
                    events::emit_joint_changed(jd);
                }
            }
        }
    }

    // Emit when joint data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((_, joint_data)) = query.get(primary) {
            events::emit_joint_changed(joint_data);
        }
    }
}
