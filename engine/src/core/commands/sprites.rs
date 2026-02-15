//! 2D sprite and skeleton command handlers.

use crate::core::pending_commands::*;

/// Handle set_project_type command.
/// Payload: { projectType: "2d" | "3d" }
fn handle_set_project_type(payload: serde_json::Value) -> super::CommandResult {
    let project_type = payload.get("projectType")
        .and_then(|v| v.as_str())
        .ok_or("Missing projectType")?
        .to_string();

    if queue_set_project_type_from_bridge(SetProjectTypeRequest { project_type }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_sprite_data command.
/// Payload: { entityId, textureAssetId?, colorTint?, flipX?, flipY?, customSize?, sortingLayer?, sortingOrder?, anchor? }
fn handle_set_sprite_data(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let texture_asset_id = payload.get("textureAssetId")
        .map(|v| v.as_str().map(|s| s.to_string()));

    let color_tint = payload.get("colorTint")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        });

    let flip_x = payload.get("flipX").and_then(|v| v.as_bool());
    let flip_y = payload.get("flipY").and_then(|v| v.as_bool());

    let custom_size = payload.get("customSize")
        .map(|v| {
            v.as_array().and_then(|arr| {
                if arr.len() == 2 {
                    Some([
                        arr[0].as_f64()? as f32,
                        arr[1].as_f64()? as f32,
                    ])
                } else {
                    None
                }
            })
        });

    let sorting_layer = payload.get("sortingLayer")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let sorting_order = payload.get("sortingOrder")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);

    let anchor = payload.get("anchor")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if queue_sprite_data_update_from_bridge(SpriteDataUpdate {
        entity_id,
        texture_asset_id,
        color_tint,
        flip_x,
        flip_y,
        custom_size,
        sorting_layer,
        sorting_order,
        anchor,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_sprite command.
/// Payload: { entityId }
fn handle_remove_sprite(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_sprite_removal_from_bridge(SpriteRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_camera_2d command.
/// Payload: { zoom?, pixelPerfect?, bounds? }
fn handle_update_camera_2d(payload: serde_json::Value) -> super::CommandResult {
    let zoom = payload.get("zoom").and_then(|v| v.as_f64()).map(|f| f as f32);
    let pixel_perfect = payload.get("pixelPerfect").and_then(|v| v.as_bool());

    let bounds = payload.get("bounds")
        .map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_object().and_then(|obj| {
                    Some(Camera2dBounds {
                        min_x: obj.get("minX")?.as_f64()? as f32,
                        max_x: obj.get("maxX")?.as_f64()? as f32,
                        min_y: obj.get("minY")?.as_f64()? as f32,
                        max_y: obj.get("maxY")?.as_f64()? as f32,
                    })
                })
            }
        });

    if queue_camera_2d_data_update_from_bridge(Camera2dDataUpdate {
        zoom,
        pixel_perfect,
        bounds,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_skeleton2d command.
/// Payload: { entityId, skeletonData? }
fn handle_create_skeleton2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let skeleton_data = payload.get("skeletonData")
        .map(|v| serde_json::from_value(v.clone()))
        .transpose()
        .map_err(|e| format!("Invalid skeletonData: {}", e))?
        .unwrap_or_default();

    if queue_create_skeleton2d_from_bridge(CreateSkeleton2dRequest {
        entity_id,
        skeleton_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_bone2d command.
/// Payload: { entityId, boneName, parentBone?, positionX, positionY, rotation, length, order? }
fn handle_add_bone2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let parent_bone = payload.get("parentBone")
        .and_then(|v| if v.is_null() { None } else { v.as_str() })
        .map(|s| s.to_string());

    let position_x = payload.get("positionX")
        .and_then(|v| v.as_f64())
        .ok_or("Missing positionX")? as f32;

    let position_y = payload.get("positionY")
        .and_then(|v| v.as_f64())
        .ok_or("Missing positionY")? as f32;

    let rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .ok_or("Missing rotation")? as f32;

    let length = payload.get("length")
        .and_then(|v| v.as_f64())
        .ok_or("Missing length")? as f32;

    let color = payload.get("color")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        })
        .unwrap_or([1.0, 1.0, 1.0, 1.0]);

    let bone = crate::core::skeleton2d::Bone2dDef {
        name: bone_name,
        parent_bone,
        local_position: [position_x, position_y],
        local_rotation: rotation,
        local_scale: [1.0, 1.0],
        length,
        color,
    };

    if queue_add_bone2d_from_bridge(AddBone2dRequest { entity_id, bone }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_bone2d command.
/// Payload: { entityId, boneName }
fn handle_remove_bone2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    if queue_remove_bone2d_from_bridge(RemoveBone2dRequest {
        entity_id,
        bone_name,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_bone2d command.
/// Payload: { entityId, boneName, positionX?, positionY?, rotation?, length? }
fn handle_update_bone2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let local_position = match (
        payload.get("positionX").and_then(|v| v.as_f64()),
        payload.get("positionY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let local_rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32);

    let length = payload.get("length")
        .and_then(|v| v.as_f64())
        .map(|l| l as f32);

    let color = payload.get("color")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        });

    if queue_update_bone2d_from_bridge(UpdateBone2dRequest {
        entity_id,
        bone_name,
        local_position,
        local_rotation,
        local_scale: None,
        length,
        color,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_skeletal_animation2d command.
/// Payload: { entityId, animationName, duration, looping }
fn handle_create_skeletal_animation2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let duration = payload.get("duration")
        .and_then(|v| v.as_f64())
        .ok_or("Missing duration")? as f32;

    let looping = payload.get("looping")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let animation = crate::core::skeletal_animation2d::SkeletalAnimation2d {
        name: animation_name,
        duration,
        looping,
        tracks: Default::default(),
    };

    if queue_create_skeletal_animation2d_from_bridge(CreateSkeletalAnimation2dRequest {
        entity_id,
        animation,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_keyframe2d command.
/// Payload: { entityId, animationName, boneName, time, positionX?, positionY?, rotation?, scaleX?, scaleY?, easing? }
fn handle_add_keyframe2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let time = payload.get("time")
        .and_then(|v| v.as_f64())
        .ok_or("Missing time")? as f32;

    let position = match (
        payload.get("positionX").and_then(|v| v.as_f64()),
        payload.get("positionY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32);

    let scale = match (
        payload.get("scaleX").and_then(|v| v.as_f64()),
        payload.get("scaleY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let easing_str = payload.get("easing")
        .and_then(|v| v.as_str())
        .unwrap_or("linear");

    let easing = match easing_str {
        "easeIn" => crate::core::skeletal_animation2d::EasingType2d::EaseIn,
        "easeOut" => crate::core::skeletal_animation2d::EasingType2d::EaseOut,
        "easeInOut" => crate::core::skeletal_animation2d::EasingType2d::EaseInOut,
        "step" => crate::core::skeletal_animation2d::EasingType2d::Step,
        _ => crate::core::skeletal_animation2d::EasingType2d::Linear,
    };

    let keyframe = crate::core::skeletal_animation2d::BoneKeyframe {
        time,
        position,
        rotation,
        scale,
        easing,
    };

    if queue_add_keyframe2d_from_bridge(AddKeyframe2dRequest {
        entity_id,
        animation_name,
        bone_name,
        keyframe,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle play_skeletal_animation2d command.
/// Payload: { entityId, animationName, loop?, speed? }
fn handle_play_skeletal_animation2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let loop_animation = payload.get("loop")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let speed = payload.get("speed")
        .and_then(|v| v.as_f64())
        .map(|s| s as f32)
        .unwrap_or(1.0);

    if queue_play_skeletal_animation2d_from_bridge(PlaySkeletalAnimation2dRequest {
        entity_id,
        animation_name,
        loop_animation,
        speed,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_skeleton2d_skin command.
/// Payload: { entityId, skinName }
fn handle_set_skeleton2d_skin(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let skin_name = payload.get("skinName")
        .and_then(|v| v.as_str())
        .ok_or("Missing skinName")?
        .to_string();

    if queue_set_skeleton2d_skin_from_bridge(SetSkeleton2dSkinRequest {
        entity_id,
        skin_name,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_ik_chain2d command.
/// Payload: { entityId, chainName, targetBone, chainLength, bendPositive }
fn handle_create_ik_chain2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let chain_name = payload.get("chainName")
        .and_then(|v| v.as_str())
        .ok_or("Missing chainName")?
        .to_string();

    let target_bone = payload.get("targetBone")
        .and_then(|v| v.as_str())
        .ok_or("Missing targetBone")?
        .to_string();

    let _chain_length = payload.get("chainLength")
        .and_then(|v| v.as_u64())
        .ok_or("Missing chainLength")? as usize;

    let bend_positive = payload.get("bendPositive")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    // For now, create a placeholder constraint
    let constraint = crate::core::skeleton2d::IkConstraint2d {
        name: chain_name,
        bone_chain: vec![target_bone],
        target_entity_id: 0, // Placeholder
        bend_direction: if bend_positive { 1.0 } else { -1.0 },
        mix: 1.0,
    };

    if queue_create_ik_chain2d_from_bridge(CreateIkChain2dRequest {
        entity_id,
        constraint,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle auto_weight_skeleton2d command.
/// Payload: { entityId, method?, iterations? }
fn handle_auto_weight_skeleton2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let method = payload.get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("heat")
        .to_string();

    let iterations = payload.get("iterations")
        .and_then(|v| v.as_u64())
        .map(|i| i as u32)
        .unwrap_or(10);

    if queue_auto_weight_skeleton2d_from_bridge(AutoWeightSkeleton2dRequest {
        entity_id,
        method,
        iterations,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "set_project_type" => Some(handle_set_project_type(payload.clone())),
        "get_project_type" => Some(super::handle_query(QueryRequest::ProjectType)),
        "set_sprite_data" => Some(handle_set_sprite_data(payload.clone())),
        "remove_sprite" => Some(handle_remove_sprite(payload.clone())),
        "get_sprite" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::SpriteState { entity_id }))
        }
        "update_camera_2d" => Some(handle_update_camera_2d(payload.clone())),
        "get_camera_2d" => Some(super::handle_query(QueryRequest::Camera2dState)),
        "create_skeleton2d" => Some(handle_create_skeleton2d(payload.clone())),
        "add_bone2d" => Some(handle_add_bone2d(payload.clone())),
        "remove_bone2d" => Some(handle_remove_bone2d(payload.clone())),
        "update_bone2d" => Some(handle_update_bone2d(payload.clone())),
        "create_skeletal_animation2d" => Some(handle_create_skeletal_animation2d(payload.clone())),
        "add_keyframe2d" => Some(handle_add_keyframe2d(payload.clone())),
        "play_skeletal_animation2d" => Some(handle_play_skeletal_animation2d(payload.clone())),
        "set_skeleton2d_skin" => Some(handle_set_skeleton2d_skin(payload.clone())),
        "create_ik_chain2d" => Some(handle_create_ik_chain2d(payload.clone())),
        "get_skeleton2d" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::Skeleton2dState { entity_id }))
        }
        "auto_weight_skeleton2d" => Some(handle_auto_weight_skeleton2d(payload.clone())),
        _ => None,
    }
}
