//! Helper functions for building GameComponentData from JSON.

use super::game_components::*;

/// Build a GameComponentData from a component type string and JSON properties.
/// Starts with default, then merges properties from JSON.
pub fn build_game_component(component_type: &str, properties_json: &str) -> Result<GameComponentData, String> {
    // Parse properties JSON
    let props: serde_json::Value = serde_json::from_str(properties_json)
        .map_err(|e| format!("Failed to parse properties JSON: {}", e))?;

    match component_type {
        "character_controller" => {
            let mut data = CharacterControllerData::default();
            if let Some(v) = props.get("speed").and_then(|v| v.as_f64()) { data.speed = v as f32; }
            if let Some(v) = props.get("jumpHeight").and_then(|v| v.as_f64()) { data.jump_height = v as f32; }
            if let Some(v) = props.get("gravityScale").and_then(|v| v.as_f64()) { data.gravity_scale = v as f32; }
            if let Some(v) = props.get("canDoubleJump").and_then(|v| v.as_bool()) { data.can_double_jump = v; }
            Ok(GameComponentData::CharacterController(data))
        }
        "health" => {
            let mut data = HealthData::default();
            if let Some(v) = props.get("maxHp").and_then(|v| v.as_f64()) { data.max_hp = v as f32; }
            if let Some(v) = props.get("currentHp").and_then(|v| v.as_f64()) { data.current_hp = v as f32; }
            if let Some(v) = props.get("invincibilitySecs").and_then(|v| v.as_f64()) { data.invincibility_secs = v as f32; }
            if let Some(v) = props.get("respawnOnDeath").and_then(|v| v.as_bool()) { data.respawn_on_death = v; }
            if let Some(arr) = props.get("respawnPoint").and_then(|v| v.as_array()) {
                if arr.len() == 3 {
                    data.respawn_point = [
                        arr[0].as_f64().unwrap_or(0.0) as f32,
                        arr[1].as_f64().unwrap_or(1.0) as f32,
                        arr[2].as_f64().unwrap_or(0.0) as f32,
                    ];
                }
            }
            Ok(GameComponentData::Health(data))
        }
        "collectible" => {
            let mut data = CollectibleData::default();
            if let Some(v) = props.get("value").and_then(|v| v.as_u64()) { data.value = v as u32; }
            if let Some(v) = props.get("destroyOnCollect").and_then(|v| v.as_bool()) { data.destroy_on_collect = v; }
            if let Some(v) = props.get("pickupSoundAsset").and_then(|v| v.as_str()) { data.pickup_sound_asset = Some(v.to_string()); }
            if let Some(v) = props.get("rotateSpeed").and_then(|v| v.as_f64()) { data.rotate_speed = v as f32; }
            Ok(GameComponentData::Collectible(data))
        }
        "damage_zone" => {
            let mut data = DamageZoneData::default();
            if let Some(v) = props.get("damagePerSecond").and_then(|v| v.as_f64()) { data.damage_per_second = v as f32; }
            if let Some(v) = props.get("oneShot").and_then(|v| v.as_bool()) { data.one_shot = v; }
            Ok(GameComponentData::DamageZone(data))
        }
        "checkpoint" => {
            let mut data = CheckpointData::default();
            if let Some(v) = props.get("autoSave").and_then(|v| v.as_bool()) { data.auto_save = v; }
            Ok(GameComponentData::Checkpoint(data))
        }
        "teleporter" => {
            let mut data = TeleporterData::default();
            if let Some(arr) = props.get("targetPosition").and_then(|v| v.as_array()) {
                if arr.len() == 3 {
                    data.target_position = [
                        arr[0].as_f64().unwrap_or(0.0) as f32,
                        arr[1].as_f64().unwrap_or(1.0) as f32,
                        arr[2].as_f64().unwrap_or(0.0) as f32,
                    ];
                }
            }
            if let Some(v) = props.get("cooldownSecs").and_then(|v| v.as_f64()) { data.cooldown_secs = v as f32; }
            Ok(GameComponentData::Teleporter(data))
        }
        "moving_platform" => {
            let mut data = MovingPlatformData::default();
            if let Some(v) = props.get("speed").and_then(|v| v.as_f64()) { data.speed = v as f32; }
            if let Some(arr) = props.get("waypoints").and_then(|v| v.as_array()) {
                let waypoints: Vec<[f32; 3]> = arr.iter().filter_map(|w| {
                    let wp = w.as_array()?;
                    if wp.len() == 3 {
                        Some([
                            wp[0].as_f64()? as f32,
                            wp[1].as_f64()? as f32,
                            wp[2].as_f64()? as f32,
                        ])
                    } else {
                        None
                    }
                }).collect();
                if !waypoints.is_empty() {
                    data.waypoints = waypoints;
                }
            }
            if let Some(v) = props.get("pauseDuration").and_then(|v| v.as_f64()) { data.pause_duration = v as f32; }
            if let Some(v) = props.get("loopMode").and_then(|v| v.as_str()) {
                data.loop_mode = match v {
                    "pingPong" => PlatformLoopMode::PingPong,
                    "loop" => PlatformLoopMode::Loop,
                    "once" => PlatformLoopMode::Once,
                    _ => PlatformLoopMode::PingPong,
                };
            }
            Ok(GameComponentData::MovingPlatform(data))
        }
        "trigger_zone" => {
            let mut data = TriggerZoneData::default();
            if let Some(v) = props.get("eventName").and_then(|v| v.as_str()) { data.event_name = v.to_string(); }
            if let Some(v) = props.get("oneShot").and_then(|v| v.as_bool()) { data.one_shot = v; }
            Ok(GameComponentData::TriggerZone(data))
        }
        "spawner" => {
            let mut data = SpawnerData::default();
            if let Some(v) = props.get("entityType").and_then(|v| v.as_str()) { data.entity_type = v.to_string(); }
            if let Some(v) = props.get("intervalSecs").and_then(|v| v.as_f64()) { data.interval_secs = v as f32; }
            if let Some(v) = props.get("maxCount").and_then(|v| v.as_u64()) { data.max_count = v as u32; }
            if let Some(arr) = props.get("spawnOffset").and_then(|v| v.as_array()) {
                if arr.len() == 3 {
                    data.spawn_offset = [
                        arr[0].as_f64().unwrap_or(0.0) as f32,
                        arr[1].as_f64().unwrap_or(1.0) as f32,
                        arr[2].as_f64().unwrap_or(0.0) as f32,
                    ];
                }
            }
            if let Some(v) = props.get("onTrigger").and_then(|v| v.as_str()) { data.on_trigger = Some(v.to_string()); }
            Ok(GameComponentData::Spawner(data))
        }
        "follower" => {
            let mut data = FollowerData::default();
            if let Some(v) = props.get("targetEntityId").and_then(|v| v.as_str()) { data.target_entity_id = Some(v.to_string()); }
            if let Some(v) = props.get("speed").and_then(|v| v.as_f64()) { data.speed = v as f32; }
            if let Some(v) = props.get("stopDistance").and_then(|v| v.as_f64()) { data.stop_distance = v as f32; }
            if let Some(v) = props.get("lookAtTarget").and_then(|v| v.as_bool()) { data.look_at_target = v; }
            Ok(GameComponentData::Follower(data))
        }
        "projectile" => {
            let mut data = ProjectileData::default();
            if let Some(v) = props.get("speed").and_then(|v| v.as_f64()) { data.speed = v as f32; }
            if let Some(v) = props.get("damage").and_then(|v| v.as_f64()) { data.damage = v as f32; }
            if let Some(v) = props.get("lifetimeSecs").and_then(|v| v.as_f64()) { data.lifetime_secs = v as f32; }
            if let Some(v) = props.get("gravity").and_then(|v| v.as_bool()) { data.gravity = v; }
            if let Some(v) = props.get("destroyOnHit").and_then(|v| v.as_bool()) { data.destroy_on_hit = v; }
            Ok(GameComponentData::Projectile(data))
        }
        "win_condition" => {
            let mut data = WinConditionData::default();
            if let Some(v) = props.get("conditionType").and_then(|v| v.as_str()) {
                data.condition_type = match v {
                    "score" => WinConditionType::Score,
                    "collectAll" => WinConditionType::CollectAll,
                    "reachGoal" => WinConditionType::ReachGoal,
                    _ => WinConditionType::Score,
                };
            }
            if let Some(v) = props.get("targetScore").and_then(|v| v.as_u64()) { data.target_score = Some(v as u32); }
            if let Some(v) = props.get("targetEntityId").and_then(|v| v.as_str()) { data.target_entity_id = Some(v.to_string()); }
            Ok(GameComponentData::WinCondition(data))
        }
        "dialogue_trigger" => {
            let mut data = DialogueTriggerData::default();
            if let Some(v) = props.get("dialogueTreeId").and_then(|v| v.as_str()) { data.dialogue_tree_id = v.to_string(); }
            if let Some(v) = props.get("interactionRadius").and_then(|v| v.as_f64()) { data.interaction_radius = v as f32; }
            if let Some(v) = props.get("autoStart").and_then(|v| v.as_bool()) { data.auto_start = v; }
            if let Some(v) = props.get("oneShot").and_then(|v| v.as_bool()) { data.one_shot = v; }
            if let Some(v) = props.get("interactionKey").and_then(|v| v.as_str()) { data.interaction_key = v.to_string(); }
            Ok(GameComponentData::DialogueTrigger(data))
        }
        _ => Err(format!("Unknown component type: {}", component_type))
    }
}
