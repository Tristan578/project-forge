//! Physics command handlers (3D physics, joints, 2D physics).

use serde::Deserialize;

use crate::core::pending_commands::*;
use crate::core::physics::{PhysicsData, JointData, JointType, JointLimits, JointMotor};
use crate::core::physics_2d::{
    Physics2dData, ColliderShape2d, BodyType2d, PhysicsJoint2d,
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
        "remove_physics2d" => Some(handle_remove_physics2d(payload.clone())),
        "set_2d_collider_shape" => Some(handle_set_2d_collider_shape(payload.clone())),
        "set_2d_body_type" => Some(handle_set_2d_body_type(payload.clone())),
        "create_2d_joint" => Some(handle_create_2d_joint(payload.clone())),
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

        _ => None,
    }
}

// ============================================================================
// 3D Physics Handlers
// ============================================================================

/// Payload for update_physics command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePhysicsPayload {
    entity_id: String,
    #[serde(flatten)]
    physics_data: PhysicsData,
}

/// Handle update_physics command.
fn handle_update_physics(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdatePhysicsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_physics payload: {}", e))?;

    let update = PhysicsUpdate {
        entity_id: data.entity_id.clone(),
        physics_data: data.physics_data,
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

/// Handle toggle_debug_physics command.
fn handle_toggle_debug_physics(_payload: serde_json::Value) -> super::CommandResult {
    if queue_debug_physics_toggle_from_bridge() {
        tracing::info!("Queued debug physics toggle");
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

    let request_id = data.request_id.unwrap_or_else(|| format!("ray_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()));
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
        Some(JointLimits {
            min: obj.get("min")?.as_f64()? as f32,
            max: obj.get("max")?.as_f64()? as f32,
        })
    });

    let motor = payload.get("motor").and_then(|v| {
        let obj = v.as_object()?;
        Some(JointMotor {
            target_velocity: obj.get("targetVelocity")?.as_f64()? as f32,
            max_force: obj.get("maxForce")?.as_f64()? as f32,
        })
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
    let limits = if payload.get("limits").is_some() {
        Some(payload.get("limits").and_then(|v| {
            let obj = v.as_object()?;
            Some(JointLimits {
                min: obj.get("min")?.as_f64()? as f32,
                max: obj.get("max")?.as_f64()? as f32,
            })
        }))
    } else {
        None
    };

    // Motor: None means "no update", Some(None) means "clear motor", Some(Some(motor)) means "set motor"
    let motor = if payload.get("motor").is_some() {
        Some(payload.get("motor").and_then(|v| {
            let obj = v.as_object()?;
            Some(JointMotor {
                target_velocity: obj.get("targetVelocity")?.as_f64()? as f32,
                max_force: obj.get("maxForce")?.as_f64()? as f32,
            })
        }))
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPhysics2dPayload {
    entity_id: String,
    physics_data: Physics2dData,
}

/// Handle set_physics2d command.
fn handle_set_physics2d(payload: serde_json::Value) -> super::CommandResult {
    let data: SetPhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_physics2d payload: {}", e))?;

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data: data.physics_data,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D physics update for entity: {}", data.entity_id);
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

    // Build minimal physics data with just the shape change
    let mut physics_data = Physics2dData::default();
    physics_data.collider_shape = data.collider_shape;
    if let Some(size) = data.size {
        physics_data.size = size;
    }
    if let Some(radius) = data.radius {
        physics_data.radius = radius;
    }
    if let Some(vertices) = data.vertices {
        physics_data.vertices = vertices;
    }

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data,
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

    let mut physics_data = Physics2dData::default();
    physics_data.body_type = data.body_type;

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D body type update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for create_2d_joint command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Create2dJointPayload {
    entity_id: String,
    joint_data: PhysicsJoint2d,
}

/// Handle create_2d_joint command.
fn handle_create_2d_joint(payload: serde_json::Value) -> super::CommandResult {
    let data: Create2dJointPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid create_2d_joint payload: {}", e))?;

    let request = CreateJoint2dRequest {
        entity_id: data.entity_id.clone(),
        joint_data: data.joint_data,
    };

    if queue_create_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint creation for entity: {}", data.entity_id);
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
