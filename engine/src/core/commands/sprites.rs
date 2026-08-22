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

/// Handle spawn_sprite command.
/// Payload: { name?, textureAssetId?, position?, sortingLayer?, sortingOrder? }
fn handle_spawn_sprite(payload: serde_json::Value) -> super::CommandResult {
    let name = payload.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let texture_asset_id = payload.get("textureAssetId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let position = payload.get("position")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() >= 2 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr.get(2).and_then(|z| z.as_f64()).unwrap_or(0.0) as f32,
                ])
            } else {
                None
            }
        });

    let sorting_layer = payload.get("sortingLayer")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let sorting_order = payload.get("sortingOrder")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);

    if queue_spawn_sprite_from_bridge(SpawnSpriteRequest {
        name,
        texture_asset_id,
        position,
        sorting_layer,
        sorting_order,
    }) {
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
        local_position: [position_x, position_y, 0.0],
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
        (Some(x), Some(y)) => {
            let z = payload.get("positionZ").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            Some([x as f32, y as f32, z])
        },
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

/// Upper bound on `bones` for one IK constraint. `solve_ik_constraints_2d` is a
/// two-bone analytical solver, so anything past index 1 is inert data — the bound
/// exists to keep a caller-supplied length from becoming an allocation.
pub const MAX_IK_BONE_CHAIN_2D: usize = 64;

/// Parse a `create_ik_chain2d` payload into the constraint the bridge queues.
///
/// Split out from the handler so it is testable natively: the queue call needs a
/// thread-local `PendingCommands`, this does not.
pub(crate) fn parse_ik_chain2d(
    payload: &serde_json::Value,
) -> Result<(String, crate::core::skeleton2d::IkConstraint2d), String> {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let name = payload.get("name")
        .and_then(|v| v.as_str())
        .ok_or("Missing name")?
        .to_string();

    // A shorter chain is silently skipped by the solver (`bone_chain.len() < 2`),
    // so refusing it here is the only way the caller learns anything happened.
    let bones = payload.get("bones")
        .and_then(|v| v.as_array())
        .ok_or("Missing bones")?;
    if bones.len() < 2 {
        return Err(format!("bones needs at least 2 entries, got {}", bones.len()));
    }
    if bones.len() > MAX_IK_BONE_CHAIN_2D {
        return Err(format!(
            "bones exceeds the {} entry limit ({} given)",
            MAX_IK_BONE_CHAIN_2D,
            bones.len()
        ));
    }
    let mut bone_chain: Vec<String> = Vec::with_capacity(bones.len());
    for (index, bone) in bones.iter().enumerate() {
        let name = bone
            .as_str()
            .ok_or_else(|| format!("bones[{}] is not a string", index))?;
        if name.is_empty() {
            return Err(format!("bones[{}] is empty", index));
        }
        bone_chain.push(name.to_string());
    }

    // `IkConstraint2d::target_entity_id` is matched against `EntityId(String)`.
    // The manifest and the browser store now both say string, but older callers
    // and saved rigs still carry the number this field used to be declared as, so
    // accept either spelling rather than dropping the target and leaving a
    // constraint the solver can never resolve.
    let target = payload.get("targetEntityId").ok_or("Missing targetEntityId")?;
    let target_entity_id = match target {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => return Err("targetEntityId must be a string or a number".to_string()),
    };
    if target_entity_id.is_empty() {
        return Err("targetEntityId is empty".to_string());
    }

    // Sign is the whole meaning of this field, and a NaN would poison every bone
    // rotation it multiplies.
    let bend_direction = match payload.get("bendDirection").and_then(|v| v.as_f64()) {
        Some(v) if v < 0.0 => -1.0,
        _ => 1.0,
    };

    let mix = payload.get("mix")
        .and_then(|v| v.as_f64())
        // `serde_json` cannot represent NaN or an infinity, so this cannot fire
        // from a JSON payload today. It is kept because `clamp` returns NaN for a
        // NaN input rather than a bound, so any future non-JSON caller would
        // otherwise poison every bone rotation `mix` multiplies.
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(0.0, 1.0) as f32)
        .unwrap_or(1.0);

    Ok((
        entity_id,
        crate::core::skeleton2d::IkConstraint2d {
            name,
            bone_chain,
            target_entity_id,
            bend_direction,
            mix,
        },
    ))
}

/// Handle create_ik_chain2d command.
/// Payload: { entityId, name, bones: [string], targetEntityId, bendDirection?, mix? }
fn handle_create_ik_chain2d(payload: serde_json::Value) -> super::CommandResult {
    let (entity_id, constraint) = parse_ik_chain2d(&payload)?;

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

/// Handle set_sprite_sheet command.
/// Payload: { entityId, assetId, sliceMode, frames, clips }
fn handle_set_sprite_sheet(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    // Remove entityId from the payload and deserialize the rest as SpriteSheetData
    let mut obj = payload;
    if let Some(map) = obj.as_object_mut() {
        map.remove("entityId");
    }
    let sprite_sheet_data: crate::core::sprite::SpriteSheetData =
        serde_json::from_value(obj)
            .map_err(|e| format!("Invalid sprite sheet data: {}", e))?;

    if queue_sprite_sheet_update_from_bridge(SpriteSheetUpdate {
        entity_id,
        sprite_sheet_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_sprite_sheet command.
/// Payload: { entityId }
fn handle_remove_sprite_sheet(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_sprite_sheet_removal_from_bridge(SpriteSheetRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_sprite_animator command.
/// Payload: { entityId, spriteSheetId, currentClip?, frameIndex, playing, speed }
fn handle_set_sprite_animator(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let sprite_sheet_id = payload.get("spriteSheetId")
        .and_then(|v| v.as_str())
        .ok_or("Missing spriteSheetId")?
        .to_string();

    let current_clip = payload.get("currentClip")
        .and_then(|v| if v.is_null() { None } else { v.as_str() })
        .map(|s| s.to_string());

    let frame_index = payload.get("frameIndex")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    let playing = payload.get("playing")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let speed = payload.get("speed")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    let animator_data = crate::core::sprite::SpriteAnimatorData {
        sprite_sheet_id,
        current_clip,
        frame_index,
        playing,
        speed,
    };

    if queue_sprite_animator_update_from_bridge(SpriteAnimatorUpdate {
        entity_id,
        animator_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_sprite_animator command.
/// Payload: { entityId }
fn handle_remove_sprite_animator(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_sprite_animator_removal_from_bridge(SpriteAnimatorRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_animation_state_machine command.
/// Payload: { entityId, states, transitions, currentState, parameters }
fn handle_set_animation_state_machine(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let mut obj = payload;
    if let Some(map) = obj.as_object_mut() {
        map.remove("entityId");
    }
    let state_machine_data: crate::core::sprite::AnimationStateMachineData =
        serde_json::from_value(obj)
            .map_err(|e| format!("Invalid state machine data: {}", e))?;

    if queue_animation_state_machine_update_from_bridge(AnimationStateMachineUpdate {
        entity_id,
        state_machine_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_animation_state_machine command.
/// Payload: { entityId }
fn handle_remove_animation_state_machine(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_animation_state_machine_removal_from_bridge(AnimationStateMachineRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_skeleton2d_mesh_attachment command.
/// Payload: { entityId, skinName, attachmentName, vertices, uvs, triangles, weights }
fn handle_add_mesh_attachment_2d(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let skin_name = payload.get("skinName")
        .and_then(|v| v.as_str())
        .ok_or("Missing skinName")?
        .to_string();

    let attachment_name = payload.get("attachmentName")
        .and_then(|v| v.as_str())
        .ok_or("Missing attachmentName")?
        .to_string();

    let vertices: Vec<[f32; 2]> = payload.get("vertices")
        .and_then(|v| v.as_array())
        .ok_or("Missing vertices")?
        .iter()
        .map(|v| -> Result<[f32; 2], String> {
            let arr = v.as_array().ok_or("vertices: expected array")?;
            if arr.len() < 2 {
                return Err("vertices: each element must have 2 components".to_string());
            }
            let x = arr[0].as_f64().ok_or("vertices: invalid number")? as f32;
            let y = arr[1].as_f64().ok_or("vertices: invalid number")? as f32;
            Ok([x, y])
        })
        .collect::<Result<Vec<_>, _>>()?;

    let uvs: Vec<[f32; 2]> = payload.get("uvs")
        .and_then(|v| v.as_array())
        .ok_or("Missing uvs")?
        .iter()
        .map(|v| -> Result<[f32; 2], String> {
            let arr = v.as_array().ok_or("uvs: expected array")?;
            if arr.len() < 2 {
                return Err("uvs: each element must have 2 components".to_string());
            }
            let u = arr[0].as_f64().ok_or("uvs: invalid number")? as f32;
            let v_coord = arr[1].as_f64().ok_or("uvs: invalid number")? as f32;
            Ok([u, v_coord])
        })
        .collect::<Result<Vec<_>, _>>()?;

    let triangles: Vec<u16> = payload.get("triangles")
        .and_then(|v| v.as_array())
        .ok_or("Missing triangles")?
        .iter()
        .map(|v| -> Result<u16, String> {
            let n = v.as_u64().ok_or("triangles: expected integer")?;
            u16::try_from(n).map_err(|_| "triangles: index out of u16 range".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    let weights: Vec<crate::core::skeleton2d::VertexWeights> = payload.get("weights")
        .and_then(|v| v.as_array())
        .ok_or("Missing weights")?
        .iter()
        .map(|w| -> Result<crate::core::skeleton2d::VertexWeights, String> {
            let bones: Vec<String> = w.get("bones")
                .and_then(|b| b.as_array())
                .ok_or("weights: missing bones array")?
                .iter()
                .map(|b| b.as_str().ok_or("weights: bone name must be string".to_string()).map(|s| s.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            let weight_values: Vec<f32> = w.get("weights")
                .and_then(|wv| wv.as_array())
                .ok_or("weights: missing weights array")?
                .iter()
                .map(|wv| -> Result<f32, String> {
                    wv.as_f64().ok_or("weights: weight must be number".to_string()).map(|f| f as f32)
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(crate::core::skeleton2d::VertexWeights { bones, weights: weight_values })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if vertices.len() != weights.len() {
        return Err(format!(
            "vertices.length ({}) must equal weights.length ({})",
            vertices.len(),
            weights.len()
        ));
    }

    if queue_add_mesh_attachment2d_from_bridge(AddMeshAttachment2dRequest {
        entity_id,
        skin_name,
        attachment_name,
        vertices,
        uvs,
        triangles,
        weights,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_sorting_layers command.
/// Payload: { layers: ["Background", "Default", "Foreground", "UI", ...] }
fn handle_set_sorting_layers(payload: serde_json::Value) -> super::CommandResult {
    let layers = payload.get("layers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .ok_or("Missing layers array")?;

    if queue_set_sorting_layers_from_bridge(SetSortingLayersRequest { layers }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_tileset command.
/// Payload: { entityId, assetId, tileSize, gridSize, spacing, margin, tiles }
fn handle_set_tileset(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let mut obj = payload;
    if let Some(map) = obj.as_object_mut() {
        map.remove("entityId");
    }
    let tileset_data: crate::core::tileset::TilesetData =
        serde_json::from_value(obj)
            .map_err(|e| format!("Invalid tileset data: {}", e))?;

    if queue_set_tileset_from_bridge(SetTilesetRequest { entity_id, tileset_data }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_tileset command.
/// Payload: { entityId }
fn handle_remove_tileset(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_remove_tileset_from_bridge(RemoveTilesetRequest { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "spawn_sprite" => Some(handle_spawn_sprite(payload.clone())),
        "set_project_type" => Some(handle_set_project_type(payload.clone())),
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
        "set_sprite_sheet" => Some(handle_set_sprite_sheet(payload.clone())),
        "remove_sprite_sheet" => Some(handle_remove_sprite_sheet(payload.clone())),
        "set_sprite_animator" => Some(handle_set_sprite_animator(payload.clone())),
        "remove_sprite_animator" => Some(handle_remove_sprite_animator(payload.clone())),
        "set_animation_state_machine" => Some(handle_set_animation_state_machine(payload.clone())),
        "remove_animation_state_machine" => Some(handle_remove_animation_state_machine(payload.clone())),
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
        "add_skeleton2d_mesh_attachment" => Some(handle_add_mesh_attachment_2d(payload.clone())),
        "set_tilemap_data" => Some(handle_set_tilemap_data(payload.clone())),
        "remove_tilemap_data" => Some(handle_remove_tilemap_data(payload.clone())),
        "set_sorting_layers" => Some(handle_set_sorting_layers(payload.clone())),
        "set_tileset" => Some(handle_set_tileset(payload.clone())),
        "remove_tileset" => Some(handle_remove_tileset(payload.clone())),
        "get_sprite_sheet_state" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::SpriteSheetState { entity_id }))
        }
        "get_sprite_animator_state" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::SpriteAnimatorState { entity_id }))
        }
        "paint_tile" => Some(handle_paint_tile(payload.clone())),
        "erase_tile" => Some(handle_erase_tile(payload.clone())),
        "fill_tiles" => Some(handle_fill_tiles(payload.clone())),
        "set_grid_2d" => Some(handle_set_grid_2d(payload.clone())),
        _ => None,
    }
}

/// Handle set_tilemap_data command.
/// Payload: { entityId, tilesetAssetId, tileSize, mapSize, layers, origin }
fn handle_set_tilemap_data(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let mut obj = payload;
    if let Some(map) = obj.as_object_mut() {
        map.remove("entityId");
    }
    let tilemap_data: crate::core::tilemap::TilemapData =
        serde_json::from_value(obj)
            .map_err(|e| format!("Invalid tilemap data: {}", e))?;

    if queue_tilemap_data_update_from_bridge(TilemapDataUpdate {
        entity_id,
        tilemap_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_tilemap_data command.
/// Payload: { entityId }
fn handle_remove_tilemap_data(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_tilemap_data_removal_from_bridge(TilemapDataRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Read a tile coordinate, layer or index field, rejecting anything above
/// `u32::MAX`.
///
/// `v.as_u64()? as usize` TRUNCATES on wasm32, where `usize` is 32 bits: an `x`
/// of 4_294_967_299 wraps to 3. The only bounds check on this path is
/// `crate::core::tilemap::tile_flat_index` — this module carries none of its
/// own — and it is handed the already-wrapped value, so it accepts 3 as an
/// ordinary in-range cell and a tile the caller never asked for is written.
/// Nothing reports it: `dispatchCommand` returns void.
///
/// `tileIndex` was worse: it was cast `as u32`, so it wrapped on EVERY target,
/// the 64-bit test host included.
///
/// The bound is `u32` on EVERY target rather than `usize::try_from`, so the
/// native suite exercises the same rejection wasm32 gets. A `usize::try_from`
/// guard would compile to a no-op under `cargo test --lib` on a 64-bit host and
/// would pin nothing (PF-1181).
fn tile_field_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    u32::try_from(value?.as_u64()?).ok()
}

/// Parse a `paint_tile` payload: `{ entityId, layer, x, y, tileIndex }`.
///
/// Extracted from `handle_paint_tile` for the same reason `parse_fill_tiles`
/// was: the handler needs the thread-local `PendingCommands`, which no unit test
/// has, so the bounds checking would otherwise be untestable natively.
fn parse_paint_tile(payload: &serde_json::Value) -> Result<PaintTileRequest, String> {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let layer = tile_field_u32(payload.get("layer"))
        .ok_or("Missing or invalid layer")? as usize;

    let x = tile_field_u32(payload.get("x"))
        .ok_or("Missing or invalid x")? as usize;

    let y = tile_field_u32(payload.get("y"))
        .ok_or("Missing or invalid y")? as usize;

    let tile_index = tile_field_u32(payload.get("tileIndex"))
        .ok_or("Missing or invalid tileIndex")?;

    Ok(PaintTileRequest { entity_id, layer, x, y, tile_index })
}

/// Handle paint_tile command.
/// Payload: { entityId, layer, x, y, tileIndex }
fn handle_paint_tile(payload: serde_json::Value) -> super::CommandResult {
    if queue_paint_tile_from_bridge(parse_paint_tile(&payload)?) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Parse an `erase_tile` payload: `{ entityId, layer, x, y }`.
///
/// Extracted for the same testability reason as `parse_paint_tile`.
fn parse_erase_tile(payload: &serde_json::Value) -> Result<EraseTileRequest, String> {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let layer = tile_field_u32(payload.get("layer"))
        .ok_or("Missing or invalid layer")? as usize;

    let x = tile_field_u32(payload.get("x"))
        .ok_or("Missing or invalid x")? as usize;

    let y = tile_field_u32(payload.get("y"))
        .ok_or("Missing or invalid y")? as usize;

    Ok(EraseTileRequest { entity_id, layer, x, y })
}

/// Handle erase_tile command.
/// Payload: { entityId, layer, x, y }
fn handle_erase_tile(payload: serde_json::Value) -> super::CommandResult {
    if queue_erase_tile_from_bridge(parse_erase_tile(&payload)?) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Parse a `fill_tiles` payload: `{ entityId, layer, tiles: [{ x, y, tileIndex }] }`.
///
/// `tileIndex` may be an explicit `null`, which erases that cell. An ABSENT
/// `tileIndex` stays an error: `null` is a caller saying "erase", a missing key
/// is a caller who spelled it wrong, and silently erasing on a typo is exactly
/// the class of silent damage `dispatchCommand`'s void return already hides.
///
/// Extracted from `handle_fill_tiles` so it is testable natively — the handler
/// itself needs the thread-local `PendingCommands`, which no unit test has.
fn parse_fill_tiles(
    payload: &serde_json::Value,
) -> Result<(String, usize, Vec<TilePlacement>), String> {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let layer = tile_field_u32(payload.get("layer"))
        .ok_or("Missing or invalid layer")? as usize;

    let raw_tiles = payload.get("tiles")
        .and_then(|v| v.as_array())
        .ok_or("Missing tiles array")?;
    let mut tiles = Vec::with_capacity(raw_tiles.len());
    for (i, item) in raw_tiles.iter().enumerate() {
        let x = tile_field_u32(item.get("x"))
            .ok_or_else(|| format!("tiles[{}]: missing or invalid 'x'", i))? as usize;
        let y = tile_field_u32(item.get("y"))
            .ok_or_else(|| format!("tiles[{}]: missing or invalid 'y'", i))? as usize;
        let raw_index = item.get("tileIndex")
            .ok_or_else(|| format!("tiles[{}]: missing 'tileIndex'", i))?;
        let tile_index = if raw_index.is_null() {
            None
        } else {
            Some(
                tile_field_u32(Some(raw_index))
                    .ok_or_else(|| format!("tiles[{}]: invalid 'tileIndex'", i))?,
            )
        };
        tiles.push(TilePlacement { x, y, tile_index });
    }

    Ok((entity_id, layer, tiles))
}

/// Handle fill_tiles command (batch tile placement, `tileIndex: null` erases).
fn handle_fill_tiles(payload: serde_json::Value) -> super::CommandResult {
    let (entity_id, layer, tiles) = parse_fill_tiles(&payload)?;

    if queue_fill_tiles_from_bridge(FillTilesRequest { entity_id, layer, tiles }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_grid_2d command.
/// Payload: { visible, cellSize, color: [r, g, b, a] }
fn handle_set_grid_2d(payload: serde_json::Value) -> super::CommandResult {
    let visible = payload.get("visible")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let cell_size = payload.get("cellSize")
        .and_then(|v| v.as_f64())
        .unwrap_or(32.0) as f32;

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
        .unwrap_or([0.3, 0.3, 0.3, 0.5]);

    if queue_set_grid_2d_from_bridge(SetGrid2dRequest { visible, cell_size, color }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[cfg(test)]
mod ik_chain2d_tests {
    use super::{parse_ik_chain2d, MAX_IK_BONE_CHAIN_2D};
    use serde_json::json;

    fn valid() -> serde_json::Value {
        json!({
            "entityId": "ent-1",
            "name": "left_arm",
            "bones": ["upper_arm", "forearm"],
            "targetEntityId": 7,
        })
    }

    #[test]
    // Named for what it does: parse the documented `name` + `bones` shape. That the
    // manifest still PUBLISHES that shape is checked where the manifest can actually
    // be read — `web/src/lib/skeleton2d/__tests__/skeletonPayload.test.ts`.
    fn parses_the_documented_shape() {
        let (entity_id, ik) = parse_ik_chain2d(&valid()).expect("valid payload");
        assert_eq!(entity_id, "ent-1");
        assert_eq!(ik.name, "left_arm");
        assert_eq!(ik.bone_chain, vec!["upper_arm".to_string(), "forearm".to_string()]);
        // A numeric target is stringified, not dropped: `EntityId` is a String and the
        // solver skips any constraint whose target it cannot find.
        assert_eq!(ik.target_entity_id, "7");
        assert_eq!(ik.bend_direction, 1.0);
        assert_eq!(ik.mix, 1.0);
    }

    #[test]
    fn accepts_a_string_target() {
        let mut payload = valid();
        payload["targetEntityId"] = json!("ent-target");
        let (_, ik) = parse_ik_chain2d(&payload).expect("string target");
        assert_eq!(ik.target_entity_id, "ent-target");
    }

    #[test]
    fn refuses_a_chain_longer_than_the_bound() {
        let mut payload = valid();
        payload["bones"] = json!(vec!["bone"; MAX_IK_BONE_CHAIN_2D + 1]);
        let err = parse_ik_chain2d(&payload).expect_err("over the bound");
        assert!(err.contains("exceeds"), "unexpected error: {}", err);
    }

    #[test]
    fn accepts_a_chain_at_the_bound() {
        let mut payload = valid();
        payload["bones"] = json!(vec!["bone"; MAX_IK_BONE_CHAIN_2D]);
        let (_, ik) = parse_ik_chain2d(&payload).expect("at the bound");
        assert_eq!(ik.bone_chain.len(), MAX_IK_BONE_CHAIN_2D);
    }

    #[test]
    fn refuses_a_chain_the_solver_would_skip() {
        let mut payload = valid();
        payload["bones"] = json!(["upper_arm"]);
        let err = parse_ik_chain2d(&payload).expect_err("single bone");
        assert!(err.contains("at least 2"), "unexpected error: {}", err);
    }

    #[test]
    fn refuses_a_non_string_bone() {
        let mut payload = valid();
        payload["bones"] = json!(["upper_arm", 3]);
        let err = parse_ik_chain2d(&payload).expect_err("numeric bone");
        assert!(err.contains("bones[1]"), "unexpected error: {}", err);
    }

    #[test]
    fn refuses_an_empty_bone_name() {
        let mut payload = valid();
        payload["bones"] = json!(["upper_arm", ""]);
        let err = parse_ik_chain2d(&payload).expect_err("empty bone");
        assert!(err.contains("bones[1]"), "unexpected error: {}", err);
    }

    #[test]
    fn refuses_a_missing_target() {
        let mut payload = valid();
        payload.as_object_mut().unwrap().remove("targetEntityId");
        assert!(parse_ik_chain2d(&payload).is_err());
        payload["targetEntityId"] = json!("");
        assert!(parse_ik_chain2d(&payload).is_err());
        payload["targetEntityId"] = json!(true);
        assert!(parse_ik_chain2d(&payload).is_err());
    }

    #[test]
    fn refuses_missing_required_strings() {
        for key in ["entityId", "name", "bones"] {
            let mut payload = valid();
            payload.as_object_mut().unwrap().remove(key);
            assert!(parse_ik_chain2d(&payload).is_err(), "{} should be required", key);
        }
    }

    #[test]
    fn normalizes_bend_direction_to_a_sign() {
        for (given, expected) in [
            (json!(-1), -1.0_f32),
            (json!(-0.25), -1.0),
            (json!(1), 1.0),
            (json!(12.5), 1.0),
            (json!(0), 1.0),
            (json!("left"), 1.0),
        ] {
            let mut payload = valid();
            payload["bendDirection"] = given.clone();
            let (_, ik) = parse_ik_chain2d(&payload).expect("bend direction");
            assert_eq!(ik.bend_direction, expected, "bendDirection {} ", given);
        }
    }

    #[test]
    // Clamping only. The `is_finite` filter this exercises the JSON side of cannot
    // fire from a JSON payload — `serde_json` has no NaN — so claiming a rejection
    // in the name would describe coverage that does not exist; see the comment on
    // that filter for why it is kept anyway.
    fn clamps_mix_to_the_solver_range() {
        for (given, expected) in [
            (json!(0), 0.0_f32),
            (json!(0.5), 0.5),
            (json!(1), 1.0),
            (json!(4), 1.0),
            (json!(-2), 0.0),
            // Not representable in JSON, so it arrives as a string or null and the
            // default stands rather than a NaN reaching every bone rotation.
            (json!("NaN"), 1.0),
            (serde_json::Value::Null, 1.0),
        ] {
            let mut payload = valid();
            payload["mix"] = given.clone();
            let (_, ik) = parse_ik_chain2d(&payload).expect("mix");
            assert_eq!(ik.mix, expected, "mix {} ", given);
        }
    }
}

#[cfg(test)]
mod fill_tiles_tests {
    use super::parse_fill_tiles;
    use serde_json::json;

    #[test]
    fn parses_a_numeric_tile_index() {
        let (entity_id, layer, tiles) = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 2,
            "tiles": [{ "x": 1, "y": 3, "tileIndex": 7 }],
        }))
        .expect("valid payload");
        assert_eq!(entity_id, "tm-1");
        assert_eq!(layer, 2);
        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].x, 1);
        assert_eq!(tiles[0].y, 3);
        assert_eq!(tiles[0].tile_index, Some(7));
    }

    #[test]
    // The whole point of F1: a null fill is ONE command, not one erase per cell.
    fn treats_an_explicit_null_tile_index_as_an_erase() {
        let (_, _, tiles) = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [{ "x": 0, "y": 0, "tileIndex": null }],
        }))
        .expect("null tileIndex is an erase");
        assert_eq!(tiles[0].tile_index, None);
    }

    #[test]
    fn accepts_a_mixed_paint_and_erase_list_in_order() {
        let (_, _, tiles) = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [
                { "x": 0, "y": 0, "tileIndex": 4 },
                { "x": 1, "y": 0, "tileIndex": null },
                { "x": 2, "y": 0, "tileIndex": 0 },
            ],
        }))
        .expect("mixed list");
        assert_eq!(
            tiles.iter().map(|t| t.tile_index).collect::<Vec<_>>(),
            vec![Some(4), None, Some(0)],
        );
    }

    #[test]
    // A MISSING key stays an error. `null` means erase; absent means the caller
    // spelled the key wrong, and silently erasing on a typo is the failure mode
    // this whole ticket exists to remove.
    fn refuses_a_missing_tile_index() {
        let err = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [{ "x": 0, "y": 0, "tileIdx": 7 }],
        }))
        .expect_err("missing tileIndex");
        assert!(err.contains("tileIndex"), "unexpected error: {}", err);
    }

    #[test]
    fn refuses_a_negative_tile_index() {
        let err = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [{ "x": 0, "y": 0, "tileIndex": -1 }],
        }))
        .expect_err("negative tileIndex");
        assert!(err.contains("tileIndex"), "unexpected error: {}", err);
    }

    // `assert!(err.contains('x'))` would be vacuous here: "tileIndex" contains
    // an 'x', so the tileIndex error passes a bare 'x' containment check. Both
    // cases assert the EXACT message, which pins the offending axis AND the
    // element index — the two things a caller needs to find the bad cell.
    #[test]
    fn refuses_a_negative_x_coordinate() {
        let err = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [
                { "x": 0, "y": 0, "tileIndex": 7 },
                { "x": -1, "y": 0, "tileIndex": 7 },
            ],
        }))
        .expect_err("negative x");
        assert_eq!(err, "tiles[1]: missing or invalid 'x'");
    }

    #[test]
    fn refuses_a_negative_y_coordinate() {
        let err = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": 0,
            "tiles": [
                { "x": 0, "y": 0, "tileIndex": 7 },
                { "x": 0, "y": -1, "tileIndex": 7 },
            ],
        }))
        .expect_err("negative y");
        assert_eq!(err, "tiles[1]: missing or invalid 'y'");
    }

    #[test]
    fn refuses_a_missing_tiles_array() {
        let err = parse_fill_tiles(&json!({ "entityId": "tm-1", "layer": 0 }))
            .expect_err("missing tiles");
        assert!(err.contains("tiles"), "unexpected error: {}", err);
    }
}

/// The three tilemap parsers all used to read coordinates as `as_u64()? as
/// usize` / `as u32`, which TRUNCATES: on wasm32 `usize` is 32 bits, so
/// `u32::MAX + 4` reached `tile_flat_index` as `3` and was written as an
/// ordinary in-range cell. These pin the rejection at every numeric field of
/// every parser, because a bound added to one parser and not its siblings is
/// exactly the partial fix this class keeps producing (PF-1181).
///
/// `OVER` is `u32::MAX + 1` — one past the bound, so a passing test proves the
/// boundary rather than merely that a huge number is refused. The paired
/// `AT_MAX` cases prove the bound is not off by one in the other direction: a
/// guard that refused `u32::MAX` too would satisfy every rejection test here
/// while breaking legitimate callers.
#[cfg(test)]
mod tile_field_bounds_tests {
    use super::{parse_erase_tile, parse_fill_tiles, parse_paint_tile};
    use serde_json::json;

    const OVER: u64 = u32::MAX as u64 + 1;
    const AT_MAX: u64 = u32::MAX as u64;

    #[test]
    fn paint_refuses_every_numeric_field_above_u32_max() {
        for (field, expected) in [
            ("layer", "Missing or invalid layer"),
            ("x", "Missing or invalid x"),
            ("y", "Missing or invalid y"),
            ("tileIndex", "Missing or invalid tileIndex"),
        ] {
            let mut payload = json!({
                "entityId": "tm-1", "layer": 0, "x": 0, "y": 0, "tileIndex": 0,
            });
            payload[field] = json!(OVER);
            let err = parse_paint_tile(&payload)
                .expect_err("paint_tile must refuse an out-of-range field");
            assert_eq!(err, expected, "wrong error for {}", field);
        }
    }

    #[test]
    fn paint_accepts_u32_max_itself() {
        let req = parse_paint_tile(&json!({
            "entityId": "tm-1", "layer": AT_MAX, "x": AT_MAX, "y": AT_MAX, "tileIndex": AT_MAX,
        }))
        .expect("u32::MAX is inside the bound");
        assert_eq!(req.x, u32::MAX as usize);
        assert_eq!(req.y, u32::MAX as usize);
        assert_eq!(req.layer, u32::MAX as usize);
        assert_eq!(req.tile_index, u32::MAX);
    }

    #[test]
    fn erase_refuses_every_numeric_field_above_u32_max() {
        for (field, expected) in [
            ("layer", "Missing or invalid layer"),
            ("x", "Missing or invalid x"),
            ("y", "Missing or invalid y"),
        ] {
            let mut payload = json!({ "entityId": "tm-1", "layer": 0, "x": 0, "y": 0 });
            payload[field] = json!(OVER);
            let err = parse_erase_tile(&payload)
                .expect_err("erase_tile must refuse an out-of-range field");
            assert_eq!(err, expected, "wrong error for {}", field);
        }
    }

    #[test]
    fn erase_accepts_u32_max_itself() {
        let req = parse_erase_tile(&json!({
            "entityId": "tm-1", "layer": AT_MAX, "x": AT_MAX, "y": AT_MAX,
        }))
        .expect("u32::MAX is inside the bound");
        assert_eq!(req.x, u32::MAX as usize);
        assert_eq!(req.y, u32::MAX as usize);
        assert_eq!(req.layer, u32::MAX as usize);
    }

    #[test]
    fn fill_refuses_a_layer_above_u32_max() {
        let err = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": OVER,
            "tiles": [{ "x": 0, "y": 0, "tileIndex": 0 }],
        }))
        .expect_err("fill_tiles must refuse an out-of-range layer");
        assert_eq!(err, "Missing or invalid layer");
    }

    #[test]
    fn fill_refuses_a_cell_field_above_u32_max_and_names_the_cell() {
        for (field, expected) in [
            ("x", "tiles[1]: missing or invalid 'x'"),
            ("y", "tiles[1]: missing or invalid 'y'"),
            ("tileIndex", "tiles[1]: invalid 'tileIndex'"),
        ] {
            let mut payload = json!({
                "entityId": "tm-1",
                "layer": 0,
                "tiles": [
                    { "x": 0, "y": 0, "tileIndex": 7 },
                    { "x": 0, "y": 0, "tileIndex": 7 },
                ],
            });
            payload["tiles"][1][field] = json!(OVER);
            let err = parse_fill_tiles(&payload)
                .expect_err("fill_tiles must refuse an out-of-range cell field");
            assert_eq!(err, expected, "wrong error for {}", field);
        }
    }

    #[test]
    fn fill_accepts_u32_max_in_every_cell_field() {
        let (_, layer, tiles) = parse_fill_tiles(&json!({
            "entityId": "tm-1",
            "layer": AT_MAX,
            "tiles": [{ "x": AT_MAX, "y": AT_MAX, "tileIndex": AT_MAX }],
        }))
        .expect("u32::MAX is inside the bound");
        assert_eq!(layer, u32::MAX as usize);
        assert_eq!(tiles[0].x, u32::MAX as usize);
        assert_eq!(tiles[0].y, u32::MAX as usize);
        assert_eq!(tiles[0].tile_index, Some(u32::MAX));
    }
}
