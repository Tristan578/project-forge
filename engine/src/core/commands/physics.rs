//! Physics command handlers (3D physics, joints, 2D physics).

use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::core::pending_commands::*;
use crate::core::physics::{PhysicsPatch, JointData, JointType, JointLimits, JointMotor};

/// Monotonic counter for request IDs — avoids `SystemTime::now()` which panics on WASM.
static RAYCAST_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_request_id() -> String {
    let id = RAYCAST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("ray_{}", id)
}
use crate::core::physics_2d::{
    Physics2dData, Physics2dPatch, ColliderShape2d, BodyType2d, PhysicsJoint2d,
};

/// Dispatch physics-related commands.
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        // 3D Physics
        "update_physics" => Some(handle_update_physics(payload.clone())),
        "toggle_physics" => Some(handle_toggle_physics(payload.clone())),
        "toggle_debug_physics" => Some(handle_toggle_debug_physics(payload.clone())),
        "get_physics" => {
            let entity_id = payload.get("entityId")?.as_str()?.to_string();
            Some(super::handle_query(QueryRequest::PhysicsState { entity_id }))
        }
        "apply_force" => Some(handle_apply_force(payload.clone())),
        "raycast_query" => Some(handle_raycast_query(payload.clone())),

        // 3D Joints
        "create_joint" => Some(handle_create_joint(payload.clone())),
        "update_joint" => Some(handle_update_joint(payload.clone())),
        "remove_joint" => Some(handle_remove_joint(payload.clone())),
        "list_joints" => Some(super::handle_query(QueryRequest::ListJoints)),

        // 2D Physics
        "set_physics2d" => Some(handle_set_physics2d(payload.clone())),
        "update_physics2d" => Some(handle_update_physics2d(payload.clone())),
        "toggle_physics2d" => Some(handle_toggle_physics2d(payload.clone())),
        "remove_physics2d" => Some(handle_remove_physics2d(payload.clone())),
        "set_2d_collider_shape" => Some(handle_set_2d_collider_shape(payload.clone())),
        "set_2d_body_type" => Some(handle_set_2d_body_type(payload.clone())),
        "create_2d_joint" => Some(handle_create_2d_joint(payload.clone())),
        "update_2d_joint" => Some(handle_update_2d_joint(payload.clone())),
        "remove_2d_joint" => Some(handle_remove_2d_joint(payload.clone())),
        "apply_force2d" => Some(handle_apply_force2d(payload.clone())),
        "apply_impulse2d" => Some(handle_apply_impulse2d(payload.clone())),
        "raycast2d" => Some(handle_raycast2d(payload.clone())),
        "set_gravity2d" => Some(handle_set_gravity2d(payload.clone())),
        "set_debug_physics2d" => Some(handle_set_debug_physics2d(payload.clone())),
        "get_physics2d" => {
            let entity_id = payload.get("entityId")?.as_str()?.to_string();
            Some(super::handle_query(QueryRequest::Physics2dState { entity_id }))
        }

        // Stub handlers for legacy / aliased command names not yet implemented
        "set_physics" => Some(Err("Not yet implemented: set_physics (use update_physics)".to_string())),
        "remove_physics" => Some(Err("Not yet implemented: remove_physics (use toggle_physics with enabled=false)".to_string())),
        "set_physics_enabled" => Some(Err("Not yet implemented: set_physics_enabled (use toggle_physics)".to_string())),
        "enable_physics_debug" => Some(handle_set_debug_physics(true)),
        "disable_physics_debug" => Some(handle_set_debug_physics(false)),
        "apply_impulse" => {
            // Force is_impulse=true regardless of payload — this is an impulse command.
            let mut p = payload.clone();
            if let Some(obj) = p.as_object_mut() {
                obj.insert("isImpulse".to_string(), serde_json::Value::Bool(true));
            }
            Some(handle_apply_force(p))
        }
        "set_linear_velocity" => Some(Err("Not yet implemented: set_linear_velocity".to_string())),
        "set_angular_velocity" => Some(Err("Not yet implemented: set_angular_velocity".to_string())),
        "get_velocity" => Some(Err("Not yet implemented: get_velocity".to_string())),
        "raycast" => Some(handle_raycast_query(payload.clone())),
        "get_joint" => Some(super::handle_query(QueryRequest::ListJoints)),
        "set_physics_2d" => Some(handle_set_physics2d(payload.clone())),
        "update_physics_2d" => Some(handle_update_physics2d(payload.clone())),
        "toggle_physics_2d" => Some(handle_toggle_physics2d(payload.clone())),
        "remove_physics_2d" => Some(handle_remove_physics2d(payload.clone())),
        // Was `Err("Not yet implemented")` — the toggle it needed already existed
        // in the pending queue, only the arm was missing.
        "set_physics_2d_enabled" => Some(handle_toggle_physics2d(payload.clone())),
        "get_physics_2d" => {
            let entity_id = payload.get("entityId")?.as_str()?.to_string();
            Some(super::handle_query(QueryRequest::Physics2dState { entity_id }))
        }
        "set_joint_2d" => Some(handle_create_2d_joint(payload.clone())),
        "remove_joint_2d" => Some(handle_remove_2d_joint(payload.clone())),
        // Both answered `Not yet implemented` for their whole life, so 2D joint
        // state had no read path at all while the 3D surface had two (PF-1194).
        // `get_joint_2d` reads its `entityId` explicitly rather than through the
        // `payload.get(..)?` idiom its neighbours use: that `?` returns `None`
        // from `dispatch`, which the router reports as `Unknown physics command`,
        // so a malformed payload would be indistinguishable from a name the
        // engine has never had.
        "get_joint_2d" => {
            let Some(entity_id) = payload.get("entityId").and_then(|v| v.as_str()) else {
                return Some(Err("get_joint_2d requires a string entityId".to_string()));
            };
            Some(super::handle_query(QueryRequest::Joint2dState {
                entity_id: entity_id.to_string(),
            }))
        }
        "list_joints_2d" => Some(super::handle_query(QueryRequest::ListJoints2d)),
        "apply_force_2d" => Some(handle_apply_force2d(payload.clone())),
        "apply_impulse_2d" => Some(handle_apply_impulse2d(payload.clone())),
        "set_linear_velocity_2d" => Some(Err("Not yet implemented: set_linear_velocity_2d".to_string())),
        "set_angular_velocity_2d" => Some(Err("Not yet implemented: set_angular_velocity_2d".to_string())),
        "get_velocity_2d" => Some(Err("Not yet implemented: get_velocity_2d".to_string())),
        "get_collisions" => Some(Err("Not yet implemented: get_collisions".to_string())),
        "get_collisions_2d" => Some(Err("Not yet implemented: get_collisions_2d".to_string())),

        _ => None,
    }
}

// ============================================================================
// 3D Physics Handlers
// ============================================================================

/// Payload for update_physics command.
///
/// The physics fields are flattened as a [`PhysicsPatch`], so a caller may send
/// any subset (down to none at all) and the untouched properties keep their
/// current values. A full 13-field payload behaves exactly as before.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePhysicsPayload {
    entity_id: String,
    #[serde(flatten)]
    patch: PhysicsPatch,
}

/// Handle update_physics command.
fn handle_update_physics(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdatePhysicsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_physics payload: {}", e))?;

    let update = PhysicsUpdate {
        entity_id: data.entity_id.clone(),
        patch: data.patch,
    };

    if queue_physics_update_from_bridge(update) {
        tracing::info!("Queued physics update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for toggle_physics command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TogglePhysicsPayload {
    entity_id: String,
    enabled: bool,
}

/// Handle toggle_physics command.
fn handle_toggle_physics(payload: serde_json::Value) -> super::CommandResult {
    let data: TogglePhysicsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid toggle_physics payload: {}", e))?;

    let toggle = PhysicsToggle {
        entity_id: data.entity_id.clone(),
        enabled: data.enabled,
    };

    if queue_physics_toggle_from_bridge(toggle) {
        tracing::info!("Queued physics toggle for entity: {} -> {}", data.entity_id, data.enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle toggle_debug_physics command — toggles the current state.
fn handle_toggle_debug_physics(_payload: serde_json::Value) -> super::CommandResult {
    if queue_debug_physics_toggle_from_bridge(DebugPhysicsToggle { enabled: None }) {
        tracing::info!("Queued debug physics toggle");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle enable_physics_debug / disable_physics_debug — sets explicit state.
fn handle_set_debug_physics(enabled: bool) -> super::CommandResult {
    if queue_debug_physics_toggle_from_bridge(DebugPhysicsToggle { enabled: Some(enabled) }) {
        tracing::info!("Queued debug physics set enabled={}", enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_force command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyForcePayload {
    entity_id: String,
    #[serde(default)]
    force: [f32; 3],
    #[serde(default)]
    torque: [f32; 3],
    #[serde(default)]
    is_impulse: bool,
}

/// Handle apply_force command (Play mode only).
fn handle_apply_force(payload: serde_json::Value) -> super::CommandResult {
    let data: ApplyForcePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_force payload: {}", e))?;

    let application = ForceApplication {
        entity_id: data.entity_id.clone(),
        force: data.force,
        torque: data.torque,
        is_impulse: data.is_impulse,
    };

    if queue_force_application_from_bridge(application) {
        tracing::info!("Queued force application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RaycastPayload {
    request_id: Option<String>,
    origin: [f32; 3],
    direction: [f32; 3],
    max_distance: Option<f32>,
}

/// Handle raycast_query command.
fn handle_raycast_query(payload: serde_json::Value) -> super::CommandResult {
    let data: RaycastPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid raycast_query payload: {}", e))?;

    let request_id = data.request_id.unwrap_or_else(next_request_id);
    let max_distance = data.max_distance.unwrap_or(100.0);

    let request = RaycastRequest {
        request_id: request_id.clone(),
        origin: data.origin,
        direction: data.direction,
        max_distance,
    };

    if queue_raycast_from_bridge(request) {
        tracing::info!("Queued raycast query: {}", request_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ============================================================================
// 3D Joint Handlers
// ============================================================================

/// Handle create_joint command.
/// Payload: { entityId, jointType, connectedEntityId, anchorSelf?, anchorOther?, axis?, limits?, motor? }
fn handle_create_joint(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let joint_type_str = payload.get("jointType")
        .and_then(|v| v.as_str())
        .ok_or("Missing jointType")?;

    let joint_type = match joint_type_str {
        "fixed" => JointType::Fixed,
        "revolute" => JointType::Revolute,
        "spherical" => JointType::Spherical,
        "prismatic" => JointType::Prismatic,
        "rope" => JointType::Rope,
        "spring" => JointType::Spring,
        _ => return Err(format!("Invalid joint type: {}", joint_type_str)),
    };

    let connected_entity_id = payload.get("connectedEntityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing connectedEntityId")?
        .to_string();

    let anchor_self = payload.get("anchorSelf")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 0.0, 0.0]);

    let anchor_other = payload.get("anchorOther")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 0.0, 0.0]);

    let axis = payload.get("axis")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 1.0, 0.0]);

    let limits = payload.get("limits").and_then(|v| {
        let obj = v.as_object()?;
        let min = obj.get("min")?.as_f64()? as f32;
        let max = obj.get("max")?.as_f64()? as f32;
        if !min.is_finite() || !max.is_finite() || min > max {
            return None;
        }
        Some(JointLimits { min, max })
    });

    let motor = payload.get("motor").and_then(|v| {
        let obj = v.as_object()?;
        let target_velocity = obj.get("targetVelocity")?.as_f64()? as f32;
        let max_force = obj.get("maxForce")?.as_f64()? as f32;
        if !target_velocity.is_finite() || !max_force.is_finite() {
            return None;
        }
        Some(JointMotor { target_velocity, max_force })
    });

    let joint_data = JointData {
        joint_type,
        connected_entity_id,
        anchor_self,
        anchor_other,
        axis,
        limits,
        motor,
    };

    let request = CreateJointRequest {
        entity_id,
        joint_data,
    };

    if queue_create_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_joint command.
/// Payload: { entityId, jointType?, connectedEntityId?, anchorSelf?, anchorOther?, axis?, limits?, motor? }
fn handle_update_joint(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let joint_type = payload.get("jointType").and_then(|v| {
        let type_str = v.as_str()?;
        match type_str {
            "fixed" => Some(JointType::Fixed),
            "revolute" => Some(JointType::Revolute),
            "spherical" => Some(JointType::Spherical),
            "prismatic" => Some(JointType::Prismatic),
            "rope" => Some(JointType::Rope),
            "spring" => Some(JointType::Spring),
            _ => None,
        }
    });

    let connected_entity_id = payload.get("connectedEntityId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let anchor_self = payload.get("anchorSelf").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let anchor_other = payload.get("anchorOther").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let axis = payload.get("axis").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    // Limits: None means "no update", Some(None) means "clear limits", Some(Some(limits)) means "set limits"
    let limits = if let Some(limits_val) = payload.get("limits") {
        if limits_val.is_null() {
            // Explicit null: clear limits
            Some(None)
        } else {
            let obj = limits_val.as_object()
                .ok_or("Invalid joint limits: expected object")?;
            let min = obj.get("min").and_then(|v| v.as_f64()).map(|v| v as f32)
                .ok_or("Invalid joint limits: missing or non-numeric min")?;
            let max = obj.get("max").and_then(|v| v.as_f64()).map(|v| v as f32)
                .ok_or("Invalid joint limits: missing or non-numeric max")?;
            if !min.is_finite() || !max.is_finite() || min > max {
                return Err("Invalid joint limits: min must be <= max and both must be finite".to_string());
            }
            Some(Some(JointLimits { min, max }))
        }
    } else {
        None
    };

    // Motor: None means "no update", Some(None) means "clear motor", Some(Some(motor)) means "set motor"
    let motor = if let Some(motor_val) = payload.get("motor") {
        if motor_val.is_null() {
            Some(None) // Explicit null = clear motor
        } else if let Some(obj) = motor_val.as_object() {
            // Both fields required — a motor with max_force=0 can't apply force (silent failure)
            let target_velocity = match obj.get("targetVelocity").and_then(|v| v.as_f64()) {
                Some(v) => v as f32,
                None => return Err("Motor requires targetVelocity".into()),
            };
            let max_force = match obj.get("maxForce").and_then(|v| v.as_f64()) {
                Some(v) => v as f32,
                None => return Err("Motor requires maxForce".into()),
            };
            if !target_velocity.is_finite() || !max_force.is_finite() {
                return Err("Motor values must be finite".into());
            }
            Some(Some(JointMotor { target_velocity, max_force }))
        } else {
            None // Invalid motor shape, ignore
        }
    } else {
        None
    };

    let request = UpdateJointRequest {
        entity_id,
        joint_type,
        connected_entity_id,
        anchor_self,
        anchor_other,
        axis,
        limits,
        motor,
    };

    if queue_update_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_joint command.
/// Payload: { entityId }
fn handle_remove_joint(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = RemoveJointRequest {
        entity_id,
    };

    if queue_remove_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ============================================================================
// 2D Physics Handlers
// ============================================================================

/// Payload for set_physics2d command.
///
/// `physics_data` is a `Physics2dPatch` rather than a `Physics2dData` so the
/// command wire speaks one vocabulary (camelCase, with snake_case aliases) across
/// both `set_physics2d` and `update_physics2d`. The full-replace meaning is
/// preserved below by applying the patch onto `Physics2dData::default()`, so an
/// omitted field still resets rather than being left alone — that is the
/// documented difference between this command and `update_physics2d`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPhysics2dPayload {
    entity_id: String,
    physics_data: Physics2dPatch,
    /// Whether 2D physics should be simulating for this entity.
    ///
    /// Optional, and absent means "leave the current enabled state alone" —
    /// configuring a collider must not be able to silently stop an already-running
    /// body. When present it queues a `Physics2dToggle` alongside the data update,
    /// so a caller that wants "configure and turn on" needs one command rather than
    /// two. The apply systems are `.chain()`ed toggle-before-update precisely so
    /// this pair cannot race on a fresh entity (see `bridge/mod.rs`).
    enabled: Option<bool>,
}

/// Handle set_physics2d command.
fn handle_set_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let data: SetPhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_physics2d payload: {}", e))?;

    let mut resolved = Physics2dData::default();
    data.physics_data.apply_to(&mut resolved);

    if let Some(enabled) = data.enabled {
        // Queued before the update, and CHECKED rather than discarded. Both queues
        // read the same thread-local today, so in practice they fail together and
        // the update arm below would report it — but that is a property of the
        // current implementation, not of this function, and the failure mode it
        // buys is the bad kind: a dropped enable reported as `Ok`, i.e. a body the
        // caller believes is simulating and never is.
        if !queue_physics2d_toggle_from_bridge(Physics2dToggle {
            entity_id: data.entity_id.clone(),
            enabled,
        }) {
            return Err("PendingCommands resource not initialized".to_string());
        }
    }

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        patch: Physics2dPatch::full(&resolved),
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D physics update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_physics2d command — a partial update.
///
/// Flattened, mirroring the 3D `update_physics` payload, so a caller sends
/// `{ entityId, friction: 0.9 }` rather than nesting the changed fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePhysics2dPayload {
    entity_id: String,
    #[serde(flatten)]
    patch: Physics2dPatch,
}

/// Handle update_physics2d command.
///
/// This command did not exist. The editor and the chat tools both dispatched
/// `update_physics_2d` regardless, which reached `Err("Unknown command")` and was
/// dropped — a total no-op that nothing surfaced, because `dispatchCommand`
/// returns `void` (PF-1167).
fn handle_update_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdatePhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_physics2d payload: {}", e))?;

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        patch: data.patch,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued partial 2D physics update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Read the `enabled` flag off a `toggle_physics2d` payload.
///
/// Absent means "turn it on": every caller of this command is doing so to enable
/// physics, and `remove_physics2d` is the documented way to disable. Defaulting
/// to `false` would make a missing key destructive — the same class of silent
/// damage this whole change removes. A non-boolean value is treated as absent
/// rather than as `false` for the same reason.
///
/// Extracted from the handler so the default is assertable: the handler itself
/// can only be observed through the pending queue, which does not exist under
/// native `cargo test`.
fn resolve_toggle_enabled(payload: &serde_json::Value) -> bool {
    payload.get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// Handle toggle_physics2d command.
///
/// Also previously missing, despite `Physics2dToggle` already existing in the
/// pending queue and `remove_physics2d` already queueing one with `enabled:
/// false` — there was simply no way to turn 2D physics back on.
fn handle_toggle_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let enabled = resolve_toggle_enabled(&payload);

    let toggle = Physics2dToggle {
        entity_id: entity_id.clone(),
        enabled,
    };

    if queue_physics2d_toggle_from_bridge(toggle) {
        tracing::info!("Queued 2D physics toggle for entity {}: {}", entity_id, enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_physics2d command.
fn handle_remove_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let toggle = Physics2dToggle {
        entity_id: entity_id.clone(),
        enabled: false,
    };

    if queue_physics2d_toggle_from_bridge(toggle) {
        tracing::info!("Queued 2D physics removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_2d_collider_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Set2dColliderShapePayload {
    entity_id: String,
    collider_shape: ColliderShape2d,
    size: Option<[f32; 2]>,
    radius: Option<f32>,
    vertices: Option<Vec<[f32; 2]>>,
}

/// Handle set_2d_collider_shape command.
fn handle_set_2d_collider_shape(payload: serde_json::Value) -> super::CommandResult {
    let data: Set2dColliderShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_2d_collider_shape payload: {}", e))?;

    // A patch, not a `Physics2dData { .., ..Default::default() }`: this command
    // means "change the collider shape", and building a whole struct made it also
    // reset mass, friction, restitution, gravity scale, the sensor/lock/CCD flags
    // and the conveyor velocity to their defaults (PF-1167). `size`, `radius` and
    // `vertices` stay optional and are only sent when the caller supplied them,
    // so a Box→Circle change does not clobber a radius the caller did not mention.
    let patch = Physics2dPatch {
        collider_shape: Some(data.collider_shape),
        size: data.size,
        radius: data.radius,
        vertices: data.vertices,
        ..Default::default()
    };

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        patch,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D collider shape update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_2d_body_type command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Set2dBodyTypePayload {
    entity_id: String,
    body_type: BodyType2d,
}

/// Handle set_2d_body_type command.
fn handle_set_2d_body_type(payload: serde_json::Value) -> super::CommandResult {
    let data: Set2dBodyTypePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_2d_body_type payload: {}", e))?;

    // Same defect as `set_2d_collider_shape` — flipping a platform to Static must
    // not reset its friction and conveyor velocity along the way (PF-1167).
    let patch = Physics2dPatch {
        body_type: Some(data.body_type),
        ..Default::default()
    };

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        patch,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D body type update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Read the `{ entityId, ...jointFields }` payload both 2D joint commands carry.
///
/// This used to be a `#[derive(Deserialize)]` struct expecting the joint NESTED
/// under `jointData`, which nothing has ever sent: the store dispatches
/// `set_joint_2d` with the joint's fields flat next to `entityId`. That was a
/// hard serde reject on three counts at once — nesting, snake_case field names,
/// and an externally-tagged `JointType2d` that cannot read a bare mode string —
/// so the entire outbound 2D joint surface was inert (PF-1167). One flat
/// vocabulary now serves every joint command, in both directions.
fn parse_joint_2d_payload(
    payload: &serde_json::Value,
    command: &str,
) -> Result<(String, PhysicsJoint2d), String> {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("Invalid {} payload: missing entityId", command))?
        .to_string();
    let joint_data = PhysicsJoint2d::from_flat(payload)
        .map_err(|e| format!("Invalid {} payload: {}", command, e))?;
    Ok((entity_id, joint_data))
}

/// Handle create_2d_joint / set_joint_2d.
fn handle_create_2d_joint(payload: serde_json::Value) -> super::CommandResult {
    let (entity_id, joint_data) = parse_joint_2d_payload(&payload, "create_2d_joint")?;

    let request = CreateJoint2dRequest {
        entity_id: entity_id.clone(),
        joint_data,
    };

    if queue_create_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint creation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_2d_joint command.
/// Payload: { entityId, targetEntityId, jointType, ...typeSpecificParams }
fn handle_update_2d_joint(payload: serde_json::Value) -> super::CommandResult {
    let (entity_id, joint_data) = parse_joint_2d_payload(&payload, "update_2d_joint")?;

    let request = UpdateJoint2dRequest {
        entity_id: entity_id.clone(),
        joint_data,
    };

    if queue_update_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint update for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_2d_joint command.
fn handle_remove_2d_joint(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = RemoveJoint2dRequest {
        entity_id: entity_id.clone(),
    };

    if queue_remove_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_force2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyForce2dPayload {
    entity_id: String,
    force_x: f32,
    force_y: f32,
}

/// Handle apply_force2d command.
fn handle_apply_force2d(payload: serde_json::Value) -> super::CommandResult {
    let data: ApplyForce2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_force2d payload: {}", e))?;

    let application = ForceApplication2d {
        entity_id: data.entity_id.clone(),
        force_x: data.force_x,
        force_y: data.force_y,
    };

    if queue_force_application2d_from_bridge(application) {
        tracing::info!("Queued 2D force application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_impulse2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyImpulse2dPayload {
    entity_id: String,
    impulse_x: f32,
    impulse_y: f32,
}

/// Handle apply_impulse2d command.
fn handle_apply_impulse2d(payload: serde_json::Value) -> super::CommandResult {
    let data: ApplyImpulse2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_impulse2d payload: {}", e))?;

    let application = ImpulseApplication2d {
        entity_id: data.entity_id.clone(),
        impulse_x: data.impulse_x,
        impulse_y: data.impulse_y,
    };

    if queue_impulse_application2d_from_bridge(application) {
        tracing::info!("Queued 2D impulse application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for raycast2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raycast2dPayload {
    origin_x: f32,
    origin_y: f32,
    dir_x: f32,
    dir_y: f32,
    max_distance: f32,
}

/// Handle raycast2d command.
fn handle_raycast2d(payload: serde_json::Value) -> super::CommandResult {
    let data: Raycast2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid raycast2d payload: {}", e))?;

    let request = Raycast2dRequest {
        origin_x: data.origin_x,
        origin_y: data.origin_y,
        dir_x: data.dir_x,
        dir_y: data.dir_y,
        max_distance: data.max_distance,
    };

    if queue_raycast2d_from_bridge(request) {
        tracing::info!("Queued 2D raycast");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_gravity2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetGravity2dPayload {
    gravity_x: f32,
    gravity_y: f32,
}

/// Handle set_gravity2d command.
fn handle_set_gravity2d(payload: serde_json::Value) -> super::CommandResult {
    let data: SetGravity2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_gravity2d payload: {}", e))?;

    let update = Gravity2dUpdate {
        gravity_x: data.gravity_x,
        gravity_y: data.gravity_y,
    };

    if queue_gravity2d_update_from_bridge(update) {
        tracing::info!("Queued 2D gravity update: ({}, {})", data.gravity_x, data.gravity_y);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_debug_physics2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDebugPhysics2dPayload {
    enabled: bool,
}

/// Handle set_debug_physics2d command.
fn handle_set_debug_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let data: SetDebugPhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_debug_physics2d payload: {}", e))?;

    let toggle = DebugPhysics2dToggle {
        enabled: data.enabled,
    };

    if queue_debug_physics2d_toggle_from_bridge(toggle) {
        tracing::info!("Queued 2D debug physics toggle: {}", data.enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::physics::{ColliderShape, PhysicsData, RigidBodyKind};
    use serde_json::json;

    fn run(command: &str, payload: serde_json::Value) -> Result<(), String> {
        dispatch(command, &payload).expect("physics dispatch returned None for known command")
    }

    // === update_physics ===

    #[test]
    fn update_physics_rejects_missing_entity_id() {
        let result = run("update_physics", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    #[test]
    fn update_physics_accepts_full_physics_payload() {
        // PhysicsData has required non-optional fields (bodyType, colliderShape)
        let result = run("update_physics", json!({
            "entityId": "entity-1",
            "bodyType": "dynamic",
            "colliderShape": "auto",
            "restitution": 0.3,
            "friction": 0.5,
            "density": 1.0,
            "gravityScale": 1.0,
            "lockTranslationX": false,
            "lockTranslationY": false,
            "lockTranslationZ": false,
            "lockRotationX": false,
            "lockRotationY": false,
            "lockRotationZ": false,
            "isSensor": false
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn update_physics_accepts_entity_id_only() {
        // Every physics field is optional: an entityId-only payload is a valid
        // (empty) patch. It used to be a hard `Invalid update_physics payload`
        // parse failure, which meant the command never reached the queue.
        let result = run("update_physics", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("not initialized"),
            "Expected the payload to parse and reach the queue, got: {}",
            err
        );
    }

    #[test]
    fn update_physics_accepts_partial_payload() {
        // The exact three-field shape `applyPhysicsProfile` dispatches.
        let result = run("update_physics", json!({
            "entityId": "entity-1",
            "gravityScale": 0.5,
            "friction": 0.9,
            "restitution": 0.2
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("not initialized"),
            "Expected the partial payload to parse and reach the queue, got: {}",
            err
        );
    }

    #[test]
    fn update_physics_payload_deserializes_partial_fields() {
        // Proves the parse itself succeeds (not just that dispatch stopped at
        // the uninitialized queue) and that only the sent fields are Some.
        let payload: UpdatePhysicsPayload = serde_json::from_value(json!({
            "entityId": "entity-1",
            "gravityScale": 0.5,
            "friction": 0.9,
            "restitution": 0.2
        }))
        .expect("partial update_physics payload must parse");

        assert_eq!(payload.entity_id, "entity-1");
        assert_eq!(payload.patch.gravity_scale, Some(0.5));
        assert_eq!(payload.patch.friction, Some(0.9));
        assert_eq!(payload.patch.restitution, Some(0.2));
        assert!(payload.patch.body_type.is_none());
        assert!(payload.patch.collider_shape.is_none());
        assert!(payload.patch.density.is_none());
        assert!(payload.patch.is_sensor.is_none());
    }

    #[test]
    fn update_physics_payload_deserializes_full_thirteen_fields() {
        // Existing-caller compatibility: a full payload still populates all 13.
        let payload: UpdatePhysicsPayload = serde_json::from_value(json!({
            "entityId": "entity-1",
            "bodyType": "fixed",
            "colliderShape": "ball",
            "restitution": 0.3,
            "friction": 0.5,
            "density": 1.0,
            "gravityScale": 1.0,
            "lockTranslationX": true,
            "lockTranslationY": true,
            "lockTranslationZ": true,
            "lockRotationX": true,
            "lockRotationY": true,
            "lockRotationZ": true,
            "isSensor": true
        }))
        .expect("full update_physics payload must parse");

        let mut applied = PhysicsData::default();
        payload.patch.apply_to(&mut applied);
        assert_eq!(applied.body_type, RigidBodyKind::Fixed);
        assert_eq!(applied.collider_shape, ColliderShape::Ball);
        assert_eq!(applied.restitution, 0.3);
        assert_eq!(applied.friction, 0.5);
        assert_eq!(applied.density, 1.0);
        assert_eq!(applied.gravity_scale, 1.0);
        assert!(applied.lock_translation_x);
        assert!(applied.lock_translation_y);
        assert!(applied.lock_translation_z);
        assert!(applied.lock_rotation_x);
        assert!(applied.lock_rotation_y);
        assert!(applied.lock_rotation_z);
        assert!(applied.is_sensor);
    }

    #[test]
    fn update_physics_ignores_unknown_key_and_still_applies_other_fields() {
        // Companion to `PhysicsPatch`'s own
        // `unknown_key_is_ignored_and_other_fields_still_apply`, pinned here at
        // the layer that actually has the `#[serde(flatten)]`: a misspelled key
        // is absorbed by flatten (never an error, never a write), and the
        // correctly-spelled siblings in the SAME payload still apply.
        // `deny_unknown_fields` is incompatible with flatten, so this leniency
        // is the accepted contract, not an oversight — a serde upgrade or a
        // future attempt to tighten it must break this test, not ship silently.
        let payload: UpdatePhysicsPayload = serde_json::from_value(json!({
            "entityId": "entity-1",
            "gravtiyScale": 99.0,       // typo — must be ignored, not applied
            "totallyUnknownKey": "junk",
            "friction": 0.9
        }))
        .expect("an unknown key must be ignored, not rejected");

        assert_eq!(payload.entity_id, "entity-1");
        assert!(
            payload.patch.gravity_scale.is_none(),
            "a typo'd key must not populate its intended field"
        );
        assert_eq!(payload.patch.friction, Some(0.9));

        let mut applied = PhysicsData::default();
        payload.patch.apply_to(&mut applied);
        assert_eq!(applied.friction, 0.9);
        assert_eq!(
            applied.gravity_scale,
            PhysicsData::default().gravity_scale,
            "the unknown key must write nothing"
        );
    }

    #[test]
    fn update_physics_rejects_invalid_field_value() {
        // Optional fields relax MISSING keys, not INVALID values.
        let result = run("update_physics", json!({
            "entityId": "entity-1",
            "bodyType": "not_a_body_type"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Invalid"),
            "Expected parse error for an unknown bodyType token, got: {}",
            err
        );
    }

    // === toggle_physics ===

    #[test]
    fn toggle_physics_accepts_valid_payload() {
        let result = run("toggle_physics", json!({
            "entityId": "entity-1",
            "enabled": true
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn toggle_physics_rejects_missing_enabled() {
        let result = run("toggle_physics", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("enabled") || err.contains("Invalid"),
            "Expected parse error for missing enabled, got: {}",
            err
        );
    }

    // === toggle_debug_physics ===

    #[test]
    fn toggle_debug_physics_accepts_any_payload() {
        let result = run("toggle_debug_physics", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === apply_force ===

    #[test]
    fn apply_force_accepts_entity_id_with_default_force() {
        // force and torque have #[serde(default)] so they're optional
        let result = run("apply_force", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn apply_force_accepts_full_payload() {
        let result = run("apply_force", json!({
            "entityId": "entity-1",
            "force": [0.0, 10.0, 0.0],
            "torque": [0.0, 0.0, 0.0],
            "isImpulse": false
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn apply_force_rejects_missing_entity_id() {
        let result = run("apply_force", json!({"force": [0.0, 10.0, 0.0]}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    // === set_physics2d ===

    #[test]
    fn set_physics2d_rejects_missing_entity_id() {
        let result = run("set_physics2d", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    /// `physicsData` stays REQUIRED here — the `serde(default)` is on the patch's
    /// fields, not on the outer payload — so an entity id alone is a payload error,
    /// not a full reset to defaults. The old assertion here was
    /// `!err.contains("Unknown")`, which this deserialization failure satisfies just
    /// as happily as a real handler would; name the actual error instead.
    #[test]
    fn set_physics2d_requires_a_physics_data_block() {
        let err = run("set_physics2d", json!({"entityId": "entity-1"})).unwrap_err();
        assert!(
            err.contains("Invalid set_physics2d payload") && err.contains("physicsData"),
            "expected a missing-physicsData payload error, got: {err}"
        );
    }

    // === 2D partial update / toggle (PF-1167) ===
    //
    // These commands were dispatched by the web client for their whole life and
    // were never known to the engine, so every call hit `Unknown command` and the
    // browser saw nothing — `dispatchCommand` returns `void`. Both spellings must
    // resolve to a real handler, so the assertion is that the payload gets far
    // enough to fail on the missing pending queue (which native tests never have)
    // rather than on the command name.

    /// `run` panics when `dispatch` returns `None`, so reaching this assertion at
    /// all proves the arm exists. The assertion itself proves the PAYLOAD got
    /// through, and it has to be a POSITIVE one.
    ///
    /// A negative exclusion (`!err.contains("Unknown")`) is satisfied by a hard
    /// deserialization reject as readily as by a real handler: handlers format
    /// those as `Invalid <cmd> payload: {e}`, and serde's own text is lowercase
    /// (`unknown variant ...`, `missing field ...`), which a case-sensitive
    /// `contains("Unknown")` never sees. So a renamed field or a dropped
    /// `serde(alias)` — the exact PF-1167 regression — would have passed.
    ///
    /// The one error only a command that got past deserialization can produce is
    /// the missing thread-local queue, which native tests never have.
    fn assert_reaches_handler(command: &str, payload: serde_json::Value) {
        let err = run(command, payload).expect_err("no pending queue under native test");
        assert!(
            err.contains("PendingCommands resource not initialized"),
            "{command} must deserialize and reach the pending queue, got: {err}"
        );
    }

    #[test]
    fn update_physics2d_is_a_known_command_under_both_spellings() {
        for command in ["update_physics2d", "update_physics_2d"] {
            assert_reaches_handler(command, json!({"entityId": "entity-1", "friction": 0.9}));
        }
    }

    #[test]
    fn update_physics2d_accepts_a_single_field() {
        // The point of the command: one field, thirteen left alone. A payload this
        // partial used to be a hard deserialization failure.
        assert_reaches_handler("update_physics2d", json!({"entityId": "e", "bodyType": "static"}));
        assert_reaches_handler("update_physics2d", json!({"entityId": "e"}));
    }

    #[test]
    fn update_physics2d_rejects_missing_entity_id() {
        let err = run("update_physics2d", json!({"friction": 0.5})).unwrap_err();
        assert!(
            err.contains("Invalid update_physics2d payload"),
            "expected a payload error, got: {err}"
        );
    }

    #[test]
    fn toggle_physics2d_is_a_known_command_under_all_three_spellings() {
        for command in ["toggle_physics2d", "toggle_physics_2d", "set_physics_2d_enabled"] {
            assert_reaches_handler(command, json!({"entityId": "entity-1", "enabled": true}));
        }
    }

    #[test]
    fn toggle_physics2d_rejects_missing_entity_id() {
        let err = run("toggle_physics2d", json!({"enabled": true})).unwrap_err();
        assert!(err.contains("Missing entityId"), "got: {err}");
    }

    /// An absent (or non-boolean) `enabled` must mean "turn it on". Defaulting to
    /// `false` would make a missing key silently disable physics.
    #[test]
    fn toggle_enabled_defaults_to_true_when_absent_or_unusable() {
        assert!(resolve_toggle_enabled(&json!({"entityId": "e"})));
        assert!(resolve_toggle_enabled(&json!({"entityId": "e", "enabled": null})));
        assert!(resolve_toggle_enabled(&json!({"entityId": "e", "enabled": "false"})));
        assert!(resolve_toggle_enabled(&json!({"entityId": "e", "enabled": true})));
        assert!(!resolve_toggle_enabled(&json!({"entityId": "e", "enabled": false})));
    }

    /// The granular commands accept the browser's lowercase enum spellings. Before
    /// the `serde(alias)` attributes these were hard rejects, so no shape or body
    /// type change from the editor ever reached the engine.
    #[test]
    fn granular_2d_commands_accept_lowercase_enum_values() {
        assert_reaches_handler(
            "set_2d_collider_shape",
            json!({"entityId": "e", "colliderShape": "circle", "radius": 2.0}),
        );
        assert_reaches_handler("set_2d_body_type", json!({"entityId": "e", "bodyType": "static"}));
    }

    #[test]
    fn granular_2d_commands_still_accept_pascal_case_enum_values() {
        assert_reaches_handler(
            "set_2d_collider_shape",
            json!({"entityId": "e", "colliderShape": "ConvexPolygon"}),
        );
        assert_reaches_handler("set_2d_body_type", json!({"entityId": "e", "bodyType": "Kinematic"}));
    }

    #[test]
    fn set_physics2d_accepts_a_partial_physics_data_block() {
        // `physicsData` stays REQUIRED (the `serde(default)` is on the patch, not
        // on the outer payload) but the block itself may now be partial.
        assert_reaches_handler(
            "set_physics2d",
            json!({"entityId": "e", "physicsData": {"bodyType": "static"}}),
        );
    }

    // === remove_joint ===

    #[test]
    fn remove_joint_reaches_physics_handler() {
        let result = run("remove_joint", json!({"jointId": "joint-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown"), "Should reach remove_joint handler, got: {}", err);
    }

    // === list_joints (query) ===

    #[test]
    fn list_joints_queues_query() {
        let result = run("list_joints", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === dispatch returns None for unknown commands ===

    #[test]
    fn dispatch_returns_none_for_unknown_command() {
        let result = dispatch("definitely_not_physics", &json!({}));
        assert!(result.is_none(), "Unknown command should return None");
    }

    // === the REAL entry point (PF-1167 round 2) ===
    //
    // Every test above calls this module's own `dispatch`, which is NOT how a
    // command arrives. `commands::dispatch` matches `route_domain` FIRST, and
    // `route_domain` ends in `_ => 255` whose arm returns `Unknown command`. So a
    // perfect arm in this file is dead code unless the router also names it, and
    // a domain-level test passes either way.
    //
    // That is not hypothetical: `update_physics2d` and `toggle_physics2d` (both
    // spellings each) had complete handlers, four green tests above, and no
    // router entry — so every call from the browser hit `Unknown command` and
    // `dispatchCommand` swallowed it. These tests go through the real front door.

    /// Reaching the pending queue is the only outcome that proves BOTH gates were
    /// passed. A name-only assertion (`!err.contains("Unknown command")`) would be
    /// satisfied by a deserialization reject, which is the other half of this
    /// defect class.
    fn assert_routed_and_reaches_handler(command: &str, payload: serde_json::Value) {
        let err = super::super::dispatch(command, payload)
            .expect_err("no pending queue under native test");
        assert!(
            err.contains("PendingCommands resource not initialized"),
            "{command} must be routed by route_domain AND deserialize, got: {err}"
        );
    }

    #[test]
    fn every_2d_physics_command_is_routed_by_the_real_dispatch() {
        for command in ["update_physics2d", "update_physics_2d"] {
            assert_routed_and_reaches_handler(command, json!({"entityId": "e", "friction": 0.9}));
        }
        for command in ["toggle_physics2d", "toggle_physics_2d", "set_physics_2d_enabled"] {
            assert_routed_and_reaches_handler(command, json!({"entityId": "e", "enabled": true}));
        }
        for command in ["set_physics2d", "set_physics_2d"] {
            assert_routed_and_reaches_handler(
                command,
                json!({"entityId": "e", "physicsData": {"bodyType": "static"}}),
            );
        }
        for command in ["set_2d_collider_shape", "set_2d_body_type"] {
            assert_routed_and_reaches_handler(
                command,
                json!({"entityId": "e", "colliderShape": "circle", "bodyType": "static"}),
            );
        }
    }

    // === 2D joint reads (PF-1194) ===

    /// Both names were routed AND armed, and the arm answered
    /// `Not yet implemented` — so 2D joint state had no read path at all while
    /// the 3D surface had two. Reaching the pending queue is the only outcome
    /// that proves the arm now queues a real query instead of refusing.
    #[test]
    fn two_d_joint_reads_queue_a_query() {
        assert_routed_and_reaches_handler("list_joints_2d", json!({}));
        assert_routed_and_reaches_handler("get_joint_2d", json!({"entityId": "e1"}));
    }

    /// Neither name may go back to refusing. `assert_routed_and_reaches_handler`
    /// would catch that too, but only by reporting the wrong reason — a stub and
    /// an unrouted name both fail it, and the message matters when it fires.
    #[test]
    fn two_d_joint_reads_are_not_stubs() {
        for command in ["get_joint_2d", "list_joints_2d"] {
            let err = super::super::dispatch(command, json!({"entityId": "e1"}))
                .expect_err("no pending queue under native test");
            assert!(
                !err.contains("Not yet implemented"),
                "{command} is advertising a name it refuses to answer again: {err}"
            );
        }
    }

    /// `get_joint_2d` is per-entity, so a payload with no `entityId` has to say
    /// so. The 3D `get_joint` arm is the counter-example this deliberately does
    /// not copy: it ignores its `entityId` and answers `ListJoints`, i.e. every
    /// joint in the scene, which no caller reading the name would expect.
    ///
    /// The `Unknown command` half is the load-bearing one. The neighbouring
    /// `get_physics2d` arm extracts its id with `payload.get("entityId")?`, and
    /// that `?` returns `None` from `dispatch` — which the router reads as "this
    /// domain does not know the name" and reports as `Unknown physics command`.
    /// A malformed payload then looks exactly like a name the engine has never
    /// had, which is the diagnosis this whole ticket family exists to prevent.
    #[test]
    fn get_joint_2d_without_an_entity_id_is_a_named_error() {
        let err = super::super::dispatch("get_joint_2d", json!({}))
            .expect_err("a payload with no entityId must not queue a query");
        assert!(err.contains("entityId"), "the error must name the missing field, got: {err}");
        assert!(
            !err.contains("Unknown"),
            "a malformed payload must not read as an unknown command name, got: {err}"
        );
    }

    /// The router's fallthrough, so the assertion above is not vacuously true for
    /// any string at all.
    #[test]
    fn an_unrouted_name_is_rejected_by_the_real_dispatch() {
        let err = super::super::dispatch("update_physics3d", json!({"entityId": "e"}))
            .expect_err("an unrouted name must not dispatch");
        assert!(err.contains("Unknown command"), "got: {err}");
    }
}
