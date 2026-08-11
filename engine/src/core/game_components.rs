//! Pre-built game components for drag-and-drop gameplay behaviors.
//!
//! This module provides 12 game component types that execute during Play mode
//! via Bevy systems. They interact with physics/collision events and are exposed
//! to the script sandbox via `forge.components.*`.

use bevy::prelude::*;
use bevy_rapier3d::prelude::CollisionEvent;
use serde::{Deserialize, Serialize};

use super::engine_mode::RuntimeEntity;
use super::entity_id::EntityId;

/// A single pre-built game behavior.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GameComponentData {
    CharacterController(CharacterControllerData),
    Health(HealthData),
    Collectible(CollectibleData),
    DamageZone(DamageZoneData),
    Checkpoint(CheckpointData),
    Teleporter(TeleporterData),
    MovingPlatform(MovingPlatformData),
    TriggerZone(TriggerZoneData),
    Spawner(SpawnerData),
    Follower(FollowerData),
    Projectile(ProjectileData),
    WinCondition(WinConditionData),
    DialogueTrigger(DialogueTriggerData),
}

impl GameComponentData {
    /// Returns the string name used in the UI and MCP.
    pub fn component_name(&self) -> &'static str {
        match self {
            Self::CharacterController(_) => "character_controller",
            Self::Health(_) => "health",
            Self::Collectible(_) => "collectible",
            Self::DamageZone(_) => "damage_zone",
            Self::Checkpoint(_) => "checkpoint",
            Self::Teleporter(_) => "teleporter",
            Self::MovingPlatform(_) => "moving_platform",
            Self::TriggerZone(_) => "trigger_zone",
            Self::Spawner(_) => "spawner",
            Self::Follower(_) => "follower",
            Self::Projectile(_) => "projectile",
            Self::WinCondition(_) => "win_condition",
            Self::DialogueTrigger(_) => "dialogue_trigger",
        }
    }
}

// ---- Per-component data structs ----

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterControllerData {
    pub speed: f32,             // units/sec, default 5.0
    pub jump_height: f32,       // impulse magnitude, default 8.0
    pub gravity_scale: f32,     // multiplier, default 1.0
    pub can_double_jump: bool,  // default false
}

impl Default for CharacterControllerData {
    fn default() -> Self {
        Self { speed: 5.0, jump_height: 8.0, gravity_scale: 1.0, can_double_jump: false }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthData {
    pub max_hp: f32,            // default 100.0
    pub current_hp: f32,        // runtime state, default == max_hp
    pub invincibility_secs: f32, // post-damage invincibility, default 0.5
    pub respawn_on_death: bool,  // default true
    pub respawn_point: [f32; 3], // world coords, default [0, 1, 0]
    #[serde(default = "default_true")]
    pub despawn_on_death: bool,  // despawn entity when hp <= 0 (if not respawning), default true
}

fn default_true() -> bool { true }

impl Default for HealthData {
    fn default() -> Self {
        Self {
            max_hp: 100.0,
            current_hp: 100.0,
            invincibility_secs: 0.5,
            respawn_on_death: true,
            respawn_point: [0.0, 1.0, 0.0],
            despawn_on_death: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectibleData {
    pub value: u32,             // score increment, default 1
    pub destroy_on_collect: bool, // default true
    pub pickup_sound_asset: Option<String>, // asset ID for sound
    pub rotate_speed: f32,      // degrees/sec visual spin, default 90.0
}

impl Default for CollectibleData {
    fn default() -> Self {
        Self { value: 1, destroy_on_collect: true, pickup_sound_asset: None, rotate_speed: 90.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageZoneData {
    pub damage_per_second: f32, // default 25.0
    pub one_shot: bool,         // kills instantly, default false
}

impl Default for DamageZoneData {
    fn default() -> Self {
        Self { damage_per_second: 25.0, one_shot: false }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointData {
    pub auto_save: bool,        // default true
}

impl Default for CheckpointData {
    fn default() -> Self {
        Self { auto_save: true }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeleporterData {
    pub target_position: [f32; 3], // destination, default [0, 1, 0]
    pub cooldown_secs: f32,     // prevents re-trigger, default 1.0
}

impl Default for TeleporterData {
    fn default() -> Self {
        Self { target_position: [0.0, 1.0, 0.0], cooldown_secs: 1.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovingPlatformData {
    pub speed: f32,             // units/sec, default 2.0
    pub waypoints: Vec<[f32; 3]>, // at least 2 points
    pub pause_duration: f32,    // seconds at each waypoint, default 0.5
    pub loop_mode: PlatformLoopMode, // default PingPong
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum PlatformLoopMode {
    #[default]
    PingPong,  // A -> B -> A -> B
    Loop,      // A -> B -> (teleport) A -> B
    Once,      // A -> B (stops)
}

impl Default for MovingPlatformData {
    fn default() -> Self {
        Self {
            speed: 2.0,
            waypoints: vec![[0.0, 0.0, 0.0], [0.0, 3.0, 0.0]],
            pause_duration: 0.5,
            loop_mode: PlatformLoopMode::PingPong,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerZoneData {
    pub event_name: String,     // event fired on enter, default "trigger"
    pub one_shot: bool,         // fires once then disables, default false
}

impl Default for TriggerZoneData {
    fn default() -> Self {
        Self { event_name: "trigger".to_string(), one_shot: false }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnerData {
    pub entity_type: String,    // EntityType as string, default "cube"
    pub interval_secs: f32,     // seconds between spawns, default 3.0
    pub max_count: u32,         // max alive entities from this spawner, default 5
    pub spawn_offset: [f32; 3], // offset from spawner position, default [0, 1, 0]
    pub on_trigger: Option<String>, // if set, only spawns when this event fires
}

impl Default for SpawnerData {
    fn default() -> Self {
        Self {
            entity_type: "cube".to_string(),
            interval_secs: 3.0,
            max_count: 5,
            spawn_offset: [0.0, 1.0, 0.0],
            on_trigger: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowerData {
    pub target_entity_id: Option<String>, // EntityId of target, default None
    pub speed: f32,             // movement speed, default 3.0
    pub stop_distance: f32,     // stops within this range, default 1.5
    pub look_at_target: bool,   // rotate to face target, default true
}

impl Default for FollowerData {
    fn default() -> Self {
        Self { target_entity_id: None, speed: 3.0, stop_distance: 1.5, look_at_target: true }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectileData {
    pub speed: f32,             // units/sec, default 15.0
    pub damage: f32,            // applied to Health on impact, default 10.0
    pub lifetime_secs: f32,     // auto-destroy after, default 5.0
    pub gravity: bool,          // affected by gravity, default false
    pub destroy_on_hit: bool,   // default true
}

impl Default for ProjectileData {
    fn default() -> Self {
        Self { speed: 15.0, damage: 10.0, lifetime_secs: 5.0, gravity: false, destroy_on_hit: true }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinConditionData {
    pub condition_type: WinConditionType,
    pub target_score: Option<u32>,          // for Score type
    pub target_entity_id: Option<String>,   // for ReachGoal type
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WinConditionType {
    #[default]
    Score,        // score >= target_score
    CollectAll,   // all Collectible entities collected
    ReachGoal,    // CharacterController touches target_entity_id
}

impl Default for WinConditionData {
    fn default() -> Self {
        Self {
            condition_type: WinConditionType::Score,
            target_score: Some(10),
            target_entity_id: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueTriggerData {
    pub dialogue_tree_id: String,
    pub interaction_radius: f32,
    pub auto_start: bool,
    pub one_shot: bool,
    pub interaction_key: String,
}

impl Default for DialogueTriggerData {
    fn default() -> Self {
        Self {
            dialogue_tree_id: String::new(),
            interaction_radius: 3.0,
            auto_start: false,
            one_shot: false,
            interaction_key: "interact".to_string(),
        }
    }
}

// ---- ECS Components ----

/// Holds all game components attached to an entity.
/// Stored persistently in Edit mode; systems read this during Play mode.
#[derive(Component, Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameComponents {
    pub components: Vec<GameComponentData>,
}

impl GameComponents {
    pub fn has(&self, name: &str) -> bool {
        self.components.iter().any(|c| c.component_name() == name)
    }

    pub fn get(&self, name: &str) -> Option<&GameComponentData> {
        self.components.iter().find(|c| c.component_name() == name)
    }

    pub fn get_mut(&mut self, name: &str) -> Option<&mut GameComponentData> {
        self.components.iter_mut().find(|c| c.component_name() == name)
    }

    pub fn add(&mut self, component: GameComponentData) {
        // Prevent duplicates of the same type
        let name = component.component_name();
        self.components.retain(|c| c.component_name() != name);
        self.components.push(component);
    }

    pub fn remove(&mut self, name: &str) -> Option<GameComponentData> {
        let idx = self.components.iter().position(|c| c.component_name() == name)?;
        Some(self.components.remove(idx))
    }
}

/// Read a finite `f32` out of a properties bag, clamped to the range the engine
/// can actually simulate. A missing, wrongly-typed, or non-finite value yields
/// `None` so the caller keeps the field's default rather than propagating a NaN
/// into a transform.
fn prop_f32(props: &serde_json::Value, key: &str, min: f32, max: f32) -> Option<f32> {
    let v = props.get(key)?.as_f64()? as f32;
    v.is_finite().then(|| v.clamp(min, max))
}

fn prop_bool(props: &serde_json::Value, key: &str) -> Option<bool> {
    props.get(key)?.as_bool()
}

fn prop_string(props: &serde_json::Value, key: &str) -> Option<String> {
    props.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// Read a whole-number field out of a properties bag, clamped to `0..=max`.
///
/// Parsed via `as_f64` rather than `as_u64` on purpose: JSON has one number type
/// and every producer here spells integers differently — JS `JSON.stringify(10)`
/// emits `10`, but anything that has been through a float (a slider, an LLM
/// writing `10.0`, a `.forge` scene round-tripped through `f64`) emits `10.0`.
/// `as_u64` answers `None` for the second spelling, which silently reverted the
/// field to its default. Out-of-range values clamp instead of dropping, matching
/// [`prop_f32`] — but since `as_f64` accepts negatives that `as_u64` used to
/// reject outright, the zero floor has to be re-established explicitly.
fn prop_u32(props: &serde_json::Value, key: &str, max: u32) -> Option<u32> {
    let v = props.get(key)?.as_f64()?;
    v.is_finite().then(|| v.round().clamp(0.0, max as f64) as u32)
}

/// A 3-element vector, or `None` if the key is absent, not a 3-element array, or
/// carries a component the engine cannot use. Partial application would place an
/// entity somewhere the caller never asked for, so the vector is all-or-nothing.
fn prop_vec3(props: &serde_json::Value, key: &str) -> Option<[f32; 3]> {
    let arr = props.get(key)?.as_array()?;
    if arr.len() != 3 {
        return None;
    }
    let mut out = [0.0f32; 3];
    for (slot, value) in out.iter_mut().zip(arr) {
        let v = value.as_f64()? as f32;
        if !v.is_finite() {
            return None;
        }
        *slot = v;
    }
    Some(out)
}

/// Build a `GameComponentData` from a type name and a JSON properties bag.
///
/// Every caller is a wire boundary — JS editor commands, MCP, the AI
/// orchestrator, and `.forge` scenes written by an older build — so a bag can
/// legitimately name any subset of a type's fields. Each recognised field is
/// merged onto the type's default and anything missing, unknown, wrongly typed,
/// or out of range leaves its default standing. Only two things are errors: a
/// component type the engine has no systems for, and a body that is not a JSON
/// object at all. Both mean the caller sent something structurally wrong that no
/// amount of field defaulting can repair.
pub fn build_game_component(component_type: &str, properties_json: &str) -> Result<GameComponentData, String> {
    let props = if properties_json.trim().is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        serde_json::from_str::<serde_json::Value>(properties_json)
            .map_err(|e| format!("Invalid {} properties: {}", component_type, e))?
    };
    if !props.is_object() {
        return Err(format!(
            "Invalid {} properties: expected a JSON object",
            component_type
        ));
    }

    match component_type {
        "character_controller" => {
            let mut data = CharacterControllerData::default();
            if let Some(v) = prop_f32(&props, "speed", 0.0, 1000.0) {
                data.speed = v;
            }
            if let Some(v) = prop_f32(&props, "jumpHeight", 0.0, 100.0) {
                data.jump_height = v;
            }
            if let Some(v) = prop_f32(&props, "gravityScale", -10.0, 10.0) {
                data.gravity_scale = v;
            }
            if let Some(v) = prop_bool(&props, "canDoubleJump") {
                data.can_double_jump = v;
            }
            Ok(GameComponentData::CharacterController(data))
        }
        "health" => {
            let mut data = HealthData::default();
            let max_hp = prop_f32(&props, "maxHp", 1.0, 1_000_000.0);
            if let Some(v) = max_hp {
                data.max_hp = v;
            }
            match prop_f32(&props, "currentHp", 0.0, 1_000_000.0) {
                Some(v) => data.current_hp = v,
                // A raised cap with no explicit current value means a full-health
                // entity. Leaving the default would spawn a 250-hp enemy at 100.
                None => {
                    if let Some(v) = max_hp {
                        data.current_hp = v;
                    }
                }
            }
            if let Some(v) = prop_f32(&props, "invincibilitySecs", 0.0, 60.0) {
                data.invincibility_secs = v;
            }
            if let Some(v) = prop_bool(&props, "respawnOnDeath") {
                data.respawn_on_death = v;
            }
            if let Some(v) = prop_vec3(&props, "respawnPoint") {
                data.respawn_point = v;
            }
            if let Some(v) = prop_bool(&props, "despawnOnDeath") {
                data.despawn_on_death = v;
            }
            Ok(GameComponentData::Health(data))
        }
        "collectible" => {
            let mut data = CollectibleData::default();
            if let Some(v) = prop_u32(&props, "value", 1_000_000) {
                data.value = v;
            }
            if let Some(v) = prop_bool(&props, "destroyOnCollect") {
                data.destroy_on_collect = v;
            }
            if let Some(v) = prop_string(&props, "pickupSoundAsset") {
                data.pickup_sound_asset = Some(v);
            }
            if let Some(v) = prop_f32(&props, "rotateSpeed", -100.0, 100.0) {
                data.rotate_speed = v;
            }
            Ok(GameComponentData::Collectible(data))
        }
        "damage_zone" => {
            let mut data = DamageZoneData::default();
            if let Some(v) = prop_f32(&props, "damagePerSecond", 0.0, 10_000.0) {
                data.damage_per_second = v;
            }
            if let Some(v) = prop_bool(&props, "oneShot") {
                data.one_shot = v;
            }
            Ok(GameComponentData::DamageZone(data))
        }
        "checkpoint" => {
            let mut data = CheckpointData::default();
            if let Some(v) = prop_bool(&props, "autoSave") {
                data.auto_save = v;
            }
            Ok(GameComponentData::Checkpoint(data))
        }
        "teleporter" => {
            let mut data = TeleporterData::default();
            if let Some(v) = prop_vec3(&props, "targetPosition") {
                data.target_position = v;
            }
            if let Some(v) = prop_f32(&props, "cooldownSecs", 0.0, 300.0) {
                data.cooldown_secs = v;
            }
            Ok(GameComponentData::Teleporter(data))
        }
        "moving_platform" => {
            let mut data = MovingPlatformData::default();
            if let Some(v) = prop_f32(&props, "speed", 0.0, 1000.0) {
                data.speed = v;
            }
            if let Some(arr) = props.get("waypoints").and_then(|v| v.as_array()) {
                let waypoints: Vec<[f32; 3]> = arr
                    .iter()
                    .filter_map(|w| {
                        let wp = w.as_array()?;
                        if wp.len() != 3 {
                            return None;
                        }
                        let mut out = [0.0f32; 3];
                        for (slot, value) in out.iter_mut().zip(wp) {
                            let v = value.as_f64()? as f32;
                            if !v.is_finite() {
                                return None;
                            }
                            *slot = v;
                        }
                        Some(out)
                    })
                    .collect();
                if !waypoints.is_empty() {
                    data.waypoints = waypoints;
                }
            }
            if let Some(v) = prop_f32(&props, "pauseDuration", 0.0, 60.0) {
                data.pause_duration = v;
            }
            if let Some(v) = props.get("loopMode").and_then(|v| v.as_str()) {
                data.loop_mode = match v {
                    "loop" => PlatformLoopMode::Loop,
                    "once" => PlatformLoopMode::Once,
                    _ => PlatformLoopMode::PingPong,
                };
            }
            Ok(GameComponentData::MovingPlatform(data))
        }
        "trigger_zone" => {
            let mut data = TriggerZoneData::default();
            if let Some(v) = prop_string(&props, "eventName") {
                data.event_name = v;
            }
            if let Some(v) = prop_bool(&props, "oneShot") {
                data.one_shot = v;
            }
            Ok(GameComponentData::TriggerZone(data))
        }
        "spawner" => {
            let mut data = SpawnerData::default();
            if let Some(v) = prop_string(&props, "entityType") {
                data.entity_type = v;
            }
            if let Some(v) = prop_f32(&props, "intervalSecs", 0.1, 3600.0) {
                data.interval_secs = v;
            }
            if let Some(v) = prop_u32(&props, "maxCount", 1000) {
                data.max_count = v;
            }
            if let Some(v) = prop_vec3(&props, "spawnOffset") {
                data.spawn_offset = v;
            }
            if let Some(v) = prop_string(&props, "onTrigger") {
                data.on_trigger = Some(v);
            }
            Ok(GameComponentData::Spawner(data))
        }
        "follower" => {
            let mut data = FollowerData::default();
            if let Some(v) = prop_string(&props, "targetEntityId") {
                data.target_entity_id = Some(v);
            }
            if let Some(v) = prop_f32(&props, "speed", 0.0, 1000.0) {
                data.speed = v;
            }
            if let Some(v) = prop_f32(&props, "stopDistance", 0.0, 1000.0) {
                data.stop_distance = v;
            }
            if let Some(v) = prop_bool(&props, "lookAtTarget") {
                data.look_at_target = v;
            }
            Ok(GameComponentData::Follower(data))
        }
        "projectile" => {
            let mut data = ProjectileData::default();
            if let Some(v) = prop_f32(&props, "speed", 0.0, 10_000.0) {
                data.speed = v;
            }
            if let Some(v) = prop_f32(&props, "damage", 0.0, 100_000.0) {
                data.damage = v;
            }
            if let Some(v) = prop_f32(&props, "lifetimeSecs", 0.0, 300.0) {
                data.lifetime_secs = v;
            }
            if let Some(v) = prop_bool(&props, "gravity") {
                data.gravity = v;
            }
            if let Some(v) = prop_bool(&props, "destroyOnHit") {
                data.destroy_on_hit = v;
            }
            Ok(GameComponentData::Projectile(data))
        }
        "win_condition" => {
            let mut data = WinConditionData::default();
            if let Some(v) = props.get("conditionType").and_then(|v| v.as_str()) {
                data.condition_type = match v {
                    "collectAll" => WinConditionType::CollectAll,
                    "reachGoal" => WinConditionType::ReachGoal,
                    _ => WinConditionType::Score,
                };
            }
            if let Some(v) = prop_u32(&props, "targetScore", u32::MAX) {
                data.target_score = Some(v);
            }
            if let Some(v) = prop_string(&props, "targetEntityId") {
                data.target_entity_id = Some(v);
            }
            Ok(GameComponentData::WinCondition(data))
        }
        "dialogue_trigger" => {
            let mut data = DialogueTriggerData::default();
            if let Some(v) = prop_string(&props, "dialogueTreeId") {
                data.dialogue_tree_id = v;
            }
            if let Some(v) = prop_f32(&props, "interactionRadius", 0.0, 100.0) {
                data.interaction_radius = v;
            }
            if let Some(v) = prop_bool(&props, "autoStart") {
                data.auto_start = v;
            }
            if let Some(v) = prop_bool(&props, "oneShot") {
                data.one_shot = v;
            }
            if let Some(v) = prop_string(&props, "interactionKey") {
                data.interaction_key = v;
            }
            Ok(GameComponentData::DialogueTrigger(data))
        }
        other => Err(format!("Unknown game component type: {}", other)),
    }
}

// ---- Runtime State (only exists during Play mode) ----

/// Runtime state for game component systems. Created on Play, destroyed on Stop.
#[derive(Resource, Default)]
pub struct GameComponentRuntime {
    pub score: u32,
    pub total_collectibles: u32,
    pub collected_count: u32,
    /// IDs of collectibles already picked up this play session. Prevents a
    /// single collectible from being counted on every frame it overlaps the
    /// player (and double-scoring when `destroy_on_collect` is false).
    pub collected_ids: std::collections::HashSet<String>,
    pub game_won: bool,
    /// Invincibility timers: entity_id -> remaining seconds
    pub invincibility_timers: std::collections::HashMap<String, f32>,
    /// Teleporter cooldowns: entity_id -> remaining seconds
    pub teleporter_cooldowns: std::collections::HashMap<String, f32>,
    /// Moving platform state: entity_id -> (current_waypoint_index, direction, pause_timer)
    pub platform_states: std::collections::HashMap<String, PlatformState>,
    /// Spawner state: entity_id -> (timer, Vec<spawned_entity_ids>)
    pub spawner_states: std::collections::HashMap<String, SpawnerState>,
    /// Projectile state: entity_id -> (direction, remaining_lifetime)
    pub projectile_states: std::collections::HashMap<String, ProjectileState>,
    /// Trigger fired flags (for one_shot triggers): entity_id -> bool
    pub trigger_fired: std::collections::HashMap<String, bool>,
    /// Double jump tracking: entity_id -> jumps_remaining
    pub double_jump_states: std::collections::HashMap<String, u32>,
    /// Named game events emitted this frame (consumed by scripts)
    pub pending_events: Vec<GameEvent>,
    /// Active collision pairs tracked per frame: (entity_a_id, entity_b_id)
    /// Used for DamageZone continuous damage and TriggerZone enter/exit detection
    pub active_collisions: std::collections::HashSet<(String, String)>,
    /// Previous frame's active collisions (for detecting enter/exit transitions)
    pub prev_collisions: std::collections::HashSet<(String, String)>,
}

impl GameComponentRuntime {
    /// Drain every queued game event, leaving `pending_events` empty.
    ///
    /// This is the native, testable seam for the bridge drain: the bridge's
    /// `emit_game_events_system` only compiles under `wasm32` (it calls the JS
    /// `emit_event` callback), so the "take all events and clear the queue"
    /// behaviour cannot be asserted there. Extracting it here lets a native
    /// unit test prove the queue is emptied while the bridge stays a thin
    /// `for event in runtime.take_pending_events() { emit_event(...) }` loop.
    pub fn take_pending_events(&mut self) -> Vec<GameEvent> {
        std::mem::take(&mut self.pending_events)
    }
}

#[derive(Clone, Debug)]
pub struct PlatformState {
    pub current_index: usize,
    pub direction: i32,     // +1 or -1 for ping-pong
    pub pause_timer: f32,
    pub origin: [f32; 3],   // edit-mode position for offset calculation
}

#[derive(Clone, Debug)]
pub struct SpawnerState {
    pub timer: f32,
    pub spawned_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ProjectileState {
    pub direction: [f32; 3],
    pub remaining_lifetime: f32,
}

/// A named game event for script communication.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEvent {
    pub event_name: String,
    pub source_entity_id: Option<String>,
    pub target_entity_id: Option<String>,
}

// ---- Plugin ----

pub struct GameComponentsPlugin;

impl Plugin for GameComponentsPlugin {
    fn build(&self, app: &mut App) {
        use super::engine_mode::PlaySystemSet;

        // Lifecycle systems (always active)
        app.add_systems(Update, (
            init_game_component_runtime,
            cleanup_game_component_runtime,
        ));

        // Collision tracking must run first so game component systems see fresh data
        app.add_systems(Update, system_track_collisions.in_set(PlaySystemSet));

        // Game component systems (PlaySystemSet only) - split into groups of 4
        // These run after collision tracking
        app.add_systems(Update, (
            system_character_controller,
            system_health,
            system_collectible,
            system_damage_zone,
        ).after(system_track_collisions).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_checkpoint,
            system_teleporter,
            system_moving_platform,
            system_trigger_zone,
        ).after(system_track_collisions).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_spawner,
            system_follower,
            system_projectile,
            system_win_condition,
        ).after(system_track_collisions).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_dialogue_trigger,
        ).after(system_track_collisions).in_set(PlaySystemSet));
    }
}

// ---- Lifecycle Systems ----

/// Initialize runtime on Edit -> Play transition
fn init_game_component_runtime(
    mut commands: Commands,
    mode: Res<super::engine_mode::EngineMode>,
    mut was_playing: Local<bool>,
    entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {


    let is_playing = mode.is_playing();
    if is_playing && !*was_playing {
        let mut runtime = GameComponentRuntime::default();

        // Count collectibles and init states
        for (eid, gc, transform) in entities.iter() {
            for comp in &gc.components {
                match comp {
                    GameComponentData::Collectible(_) => {
                        runtime.total_collectibles += 1;
                    }
                    GameComponentData::MovingPlatform(_) => {
                        let pos = transform.translation;
                        runtime.platform_states.insert(eid.0.clone(), PlatformState {
                            current_index: 0,
                            direction: 1,
                            pause_timer: 0.0,
                            origin: [pos.x, pos.y, pos.z],
                        });
                    }
                    GameComponentData::Spawner(_) => {
                        runtime.spawner_states.insert(eid.0.clone(), SpawnerState {
                            timer: 0.0,
                            spawned_ids: Vec::new(),
                        });
                    }
                    _ => {}
                }
            }
        }

        commands.insert_resource(runtime);
    }
    *was_playing = is_playing;
}

/// Clean up runtime on Play -> Edit transition
fn cleanup_game_component_runtime(
    mut commands: Commands,
    mode: Res<super::engine_mode::EngineMode>,
    mut was_playing: Local<bool>,
    runtime: Option<Res<GameComponentRuntime>>,
) {
    let is_playing = mode.is_playing();
    if !is_playing && *was_playing {
        if runtime.is_some() {
            commands.remove_resource::<GameComponentRuntime>();
        }
    }
    *was_playing = is_playing;
}

// ---- Game Component Systems ----

/// Character controller: apply WASD movement and jump
fn system_character_controller(
    time: Res<Time>,
    input: Option<Res<super::input::InputState>>,
    runtime: Option<Res<GameComponentRuntime>>,
    project_type: Option<Res<super::project_type::ProjectType>>,
    mut entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
) {
    let Some(input) = input else { return; };
    let Some(_runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // The resource is absent until the first `set_project_type`, and the
    // engine's own default is 3D — so absent must behave exactly like 3D.
    let is_2d = matches!(
        project_type.as_deref(),
        Some(super::project_type::ProjectType::TwoD)
    );

    for (_eid, gc, mut transform) in entities.iter_mut() {
        for comp in &gc.components {
            if let GameComponentData::CharacterController(data) = comp {
                // Movement
                let mut movement = Vec3::ZERO;

                // Horizontal movement (X axis). Reads the same three-tier
                // fallback as the forward branch below, and the middle tier is
                // load-bearing: the `fps` preset binds `move_right` as an AXIS
                // (D positive, A negative) and binds no `move_left` at all.
                // `capture_input` sets `pressed = axis_value.abs() > 0.0` for an
                // axis, so a digital-only read saw A as "move_right pressed" and
                // added +1.0 — both keys strafed the SAME way and moving left was
                // impossible in every generated 3D game (PF-1124).
                let horizontal = input.get_axis("move_horizontal");
                if horizontal.abs() > 0.01 {
                    movement.x = horizontal;
                } else {
                    // Safe for a digital `move_right` too: `capture_input` gives a
                    // digital action `axis_value = if pressed { 1.0 } else { 0.0 }`,
                    // so an unpressed key falls through to the reads below.
                    let right_axis = input.get_axis("move_right");
                    if right_axis.abs() > 0.01 {
                        movement.x = right_axis;
                    } else {
                        if input.is_action_active("move_right") {
                            movement.x += 1.0;
                        }
                        if input.is_action_active("move_left") {
                            movement.x -= 1.0;
                        }
                    }
                }

                // Forward/backward movement. In 3D this is depth. In a 2D scene
                // the sprites live in the XY plane under an orthographic camera
                // looking down -Z, so depth is invisible — the same input has to
                // move the player along Y instead, or pressing "up" walks the
                // sprite toward the camera and nothing appears to happen
                // (PF-1124).
                let mut forward_amount = 0.0;
                let vertical = input.get_axis("move_vertical");
                if vertical.abs() > 0.01 {
                    forward_amount = vertical;
                } else {
                    let forward = input.get_axis("move_forward");
                    if forward.abs() > 0.01 {
                        forward_amount = forward;
                    } else {
                        if input.is_action_active("move_forward") {
                            forward_amount += 1.0;
                        }
                        if input.is_action_active("move_backward") {
                            forward_amount -= 1.0;
                        }
                    }
                }

                if is_2d {
                    movement.y = forward_amount;
                } else {
                    movement.z = -forward_amount; // Invert for forward = negative Z
                }

                if movement.length_squared() > 0.0 {
                    movement = movement.normalize() * data.speed * dt;
                    transform.translation += movement;
                }

                // Jump
                if input.is_action_just_pressed("jump") {
                    // Simple jump: apply instant upward movement
                    transform.translation.y += data.jump_height * 0.5 * dt;
                }
            }
        }
    }
}

/// Health system: tick invincibility timers, handle death/despawn
fn system_health(
    mut commands: Commands,
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(
        Entity,
        &EntityId,
        &mut GameComponents,
        &mut Transform,
        Option<&super::engine_mode::RuntimeEntity>,
    ), Without<super::entity_factory::Undeletable>>,
) {


    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // Tick invincibility timers
    runtime.invincibility_timers.retain(|_, timer| {
        *timer -= dt;
        *timer > 0.0
    });

    // Collect entities to despawn (cannot despawn while iterating a mutable query)
    let mut to_despawn: Vec<Entity> = Vec::new();

    // Check for death
    for (entity, eid, mut gc, mut transform, runtime_marker) in entities.iter_mut() {
        if let Some(GameComponentData::Health(health)) = gc.get_mut("health") {
            if health.current_hp <= 0.0 {
                // Emit death event regardless of respawn/despawn behavior
                runtime.pending_events.push(GameEvent {
                    event_name: "entity_death".to_string(),
                    source_entity_id: Some(eid.0.clone()),
                    target_entity_id: None,
                });

                if health.respawn_on_death {
                    // Respawn at checkpoint
                    transform.translation = Vec3::from(health.respawn_point);
                    health.current_hp = health.max_hp;
                } else if health.despawn_on_death && runtime_marker.is_some() {
                    // Only despawn RuntimeEntity entities (spawned during play mode).
                    // Undeletable entities are already excluded via Without<Undeletable>.
                    to_despawn.push(entity);
                }
            }
        }
    }

    // Despawn dead entities outside the query loop
    for entity in to_despawn {
        commands.entity(entity).despawn();
    }
}

/// Collectible system: spin collectibles for visual feedback and, during Play,
/// pick them up when a CharacterController-bearing entity overlaps them.
///
/// Pickup is the engine's score writer: each collected item adds its `value` to
/// `runtime.score` (feeding the `Score` win condition), bumps `collected_count`
/// (feeding the `CollectAll` win condition), emits a `collectible_collected`
/// event for scripts, and — when `destroy_on_collect` is set — despawns the
/// collectible. `collected_ids` guards against re-counting the same item while it
/// stays in contact for multiple frames. Despawned collectibles are restored on
/// Stop via `engine_mode::restore_scene` (step 5 respawns from the snapshot).
fn system_collectible(
    mut commands: Commands,
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(Entity, &EntityId, &GameComponents, &mut Transform)>,
) {
    let dt = time.delta_secs();

    // Visual spin — runs whether or not the runtime exists (e.g. Edit preview).
    for (_entity, _eid, gc, mut transform) in entities.iter_mut() {
        if let Some(GameComponentData::Collectible(data)) = gc.get("collectible") {
            let rotation_speed = data.rotate_speed.to_radians();
            transform.rotate_y(rotation_speed * dt);
        }
    }

    // Pickup logic only runs during Play (when the runtime resource exists).
    let Some(mut runtime) = runtime else { return; };

    // Entities that can pick collectibles up: those with a CharacterController.
    let player_ids: std::collections::HashSet<String> = entities
        .iter()
        .filter_map(|(_e, eid, gc, _t)| gc.has("character_controller").then(|| eid.0.clone()))
        .collect();

    // Uncollected collectibles: (entity, id, value, destroy_on_collect).
    let collectibles: Vec<(Entity, String, u32, bool)> = entities
        .iter()
        .filter_map(|(entity, eid, gc, _t)| match gc.get("collectible") {
            Some(GameComponentData::Collectible(data)) if !runtime.collected_ids.contains(&eid.0) => {
                Some((entity, eid.0.clone(), data.value, data.destroy_on_collect))
            }
            _ => None,
        })
        .collect();

    // A collectible is picked up when it shares an active collision pair with a player.
    let picked_up: Vec<(Entity, String, u32, bool)> = collectibles
        .into_iter()
        .filter(|(_e, cid, _v, _d)| {
            runtime.active_collisions.iter().any(|(a, b)| {
                (a == cid && player_ids.contains(b)) || (b == cid && player_ids.contains(a))
            })
        })
        .collect();

    for (entity, cid, value, destroy_on_collect) in picked_up {
        runtime.collected_ids.insert(cid.clone());
        runtime.collected_count += 1;
        runtime.score = runtime.score.saturating_add(value);
        runtime.pending_events.push(GameEvent {
            event_name: "collectible_collected".to_string(),
            source_entity_id: Some(cid),
            target_entity_id: None,
        });
        if destroy_on_collect {
            commands.entity(entity).despawn();
        }
    }
}

/// Collision tracking system: reads Rapier CollisionEvents and updates the runtime's
/// active_collisions set. Must run before all game component systems that need overlap info.
fn system_track_collisions(
    mut collision_events: MessageReader<CollisionEvent>,
    entity_id_query: Query<&EntityId>,
    runtime: Option<ResMut<GameComponentRuntime>>,
) {
    let Some(mut runtime) = runtime else {
        collision_events.clear();
        return;
    };

    // Rotate: current -> prev, then rebuild current from events
    runtime.prev_collisions = runtime.active_collisions.clone();

    // Process collision events: Started adds pairs, Stopped removes them
    for event in collision_events.read() {
        match event {
            CollisionEvent::Started(a, b, _) => {
                if let (Ok(id_a), Ok(id_b)) = (entity_id_query.get(*a), entity_id_query.get(*b)) {
                    // Store in canonical order for consistent lookups
                    let pair = if id_a.0 <= id_b.0 {
                        (id_a.0.clone(), id_b.0.clone())
                    } else {
                        (id_b.0.clone(), id_a.0.clone())
                    };
                    runtime.active_collisions.insert(pair);
                }
            }
            CollisionEvent::Stopped(a, b, _) => {
                if let (Ok(id_a), Ok(id_b)) = (entity_id_query.get(*a), entity_id_query.get(*b)) {
                    let pair = if id_a.0 <= id_b.0 {
                        (id_a.0.clone(), id_b.0.clone())
                    } else {
                        (id_b.0.clone(), id_a.0.clone())
                    };
                    runtime.active_collisions.remove(&pair);
                }
            }
        }
    }
}

/// Damage zone system: on physics overlap, reduce Health by damage_per_second * dt.
/// If one_shot is true, sets health to 0 instantly.
fn system_damage_zone(
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(&EntityId, &mut GameComponents)>,
) {
    let Some(runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // Collect damage zone data: (entity_id, damage_per_second, one_shot)
    let damage_zones: Vec<(String, f32, bool)> = entities
        .iter()
        .filter_map(|(eid, gc)| {
            if let Some(GameComponentData::DamageZone(data)) = gc.get("damage_zone") {
                Some((eid.0.clone(), data.damage_per_second, data.one_shot))
            } else {
                None
            }
        })
        .collect();

    // For each active collision pair, check if one side is a damage zone
    // and the other has Health
    for (id_a, id_b) in &runtime.active_collisions {
        for (dz_id, dps, one_shot) in &damage_zones {
            // Determine which entity is the damage zone and which is the target
            let target_id = if dz_id == id_a {
                id_b
            } else if dz_id == id_b {
                id_a
            } else {
                continue;
            };

            // Check invincibility
            if runtime.invincibility_timers.contains_key(target_id) {
                continue;
            }

            // Apply damage to the target entity's Health component
            if let Some((_eid, mut gc)) = entities.iter_mut().find(|(eid, _)| eid.0 == *target_id) {
                if let Some(GameComponentData::Health(health)) = gc.get_mut("health") {
                    if health.current_hp > 0.0 {
                        if *one_shot {
                            health.current_hp = 0.0;
                        } else {
                            health.current_hp -= dps * dt;
                            if health.current_hp < 0.0 {
                                health.current_hp = 0.0;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Checkpoint system: when an entity with CharacterController overlaps a checkpoint,
/// update that entity's Health respawn_point to the checkpoint's position.
fn system_checkpoint(
    runtime: Option<Res<GameComponentRuntime>>,
    mut entities: Query<(&EntityId, &mut GameComponents, &Transform)>,
) {
    let Some(runtime) = runtime else { return; };

    // Collect checkpoint positions: (entity_id, auto_save, position)
    let checkpoints: Vec<(String, bool, Vec3)> = entities
        .iter()
        .filter_map(|(eid, gc, transform)| {
            if let Some(GameComponentData::Checkpoint(data)) = gc.get("checkpoint") {
                if data.auto_save {
                    Some((eid.0.clone(), data.auto_save, transform.translation))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    // For each active collision, check if a checkpoint overlaps with a character controller
    for (id_a, id_b) in &runtime.active_collisions {
        for (cp_id, _auto_save, cp_pos) in &checkpoints {
            let target_id = if cp_id == id_a {
                id_b
            } else if cp_id == id_b {
                id_a
            } else {
                continue;
            };

            // Update the target's Health respawn_point if it has both CharacterController and Health
            if let Some((_eid, mut gc, _transform)) = entities
                .iter_mut()
                .find(|(eid, _, _)| eid.0 == *target_id)
            {
                if gc.has("character_controller") {
                    if let Some(GameComponentData::Health(health)) = gc.get_mut("health") {
                        health.respawn_point = [cp_pos.x, cp_pos.y + 1.0, cp_pos.z];
                    }
                }
            }
        }
    }
}

/// Teleporter system: on trigger enter, teleport the colliding entity to target_position.
/// Respects cooldown to prevent rapid re-triggering.
fn system_teleporter(
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
) {
    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // Tick teleporter cooldowns
    runtime.teleporter_cooldowns.retain(|_, timer| {
        *timer -= dt;
        *timer > 0.0
    });

    // Collect teleporter data: (entity_id, target_position, cooldown_secs)
    let teleporters: Vec<(String, [f32; 3], f32)> = entities
        .iter()
        .filter_map(|(eid, gc, _)| {
            if let Some(GameComponentData::Teleporter(data)) = gc.get("teleporter") {
                Some((eid.0.clone(), data.target_position, data.cooldown_secs))
            } else {
                None
            }
        })
        .collect();

    // Detect new collision enters (in active_collisions but NOT in prev_collisions)
    let new_enters: Vec<(String, String)> = runtime
        .active_collisions
        .iter()
        .filter(|pair| !runtime.prev_collisions.contains(*pair))
        .cloned()
        .collect();

    for (id_a, id_b) in &new_enters {
        for (tp_id, target_pos, cooldown) in &teleporters {
            let target_id = if tp_id == id_a {
                id_b
            } else if tp_id == id_b {
                id_a
            } else {
                continue;
            };

            // Check cooldown: use a key combining teleporter + target
            let cooldown_key = format!("{}_{}", tp_id, target_id);
            if runtime.teleporter_cooldowns.contains_key(&cooldown_key) {
                continue;
            }

            // Teleport the target entity
            if let Some((_eid, _gc, mut transform)) = entities
                .iter_mut()
                .find(|(eid, _, _)| eid.0 == *target_id)
            {
                transform.translation = Vec3::from(*target_pos);
            }

            // Set cooldown
            runtime.teleporter_cooldowns.insert(cooldown_key, *cooldown);
        }
    }
}

/// Moving platform system: interpolate between waypoints
fn system_moving_platform(
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
) {


    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    for (eid, gc, mut transform) in entities.iter_mut() {
        if let Some(GameComponentData::MovingPlatform(data)) = gc.get("moving_platform") {
            if data.waypoints.len() < 2 {
                continue;
            }

            // Get or init state
            let state = runtime.platform_states.entry(eid.0.clone()).or_insert_with(|| {
                let pos = transform.translation;
                PlatformState {
                    current_index: 0,
                    direction: 1,
                    pause_timer: 0.0,
                    origin: [pos.x, pos.y, pos.z],
                }
            });

            // If paused, tick timer and return
            if state.pause_timer > 0.0 {
                state.pause_timer -= dt;
                continue;
            }

            // Compute target position (waypoint + origin offset)
            let origin = Vec3::from(state.origin);
            let waypoint = Vec3::from(data.waypoints[state.current_index]);
            let target = origin + waypoint;

            // Move toward target
            let direction = (target - transform.translation).normalize_or_zero();
            let step = data.speed * dt;
            let distance = transform.translation.distance(target);

            if distance <= step {
                // Reached waypoint
                transform.translation = target;
                state.pause_timer = data.pause_duration;

                // Advance to next waypoint
                match data.loop_mode {
                    PlatformLoopMode::PingPong => {
                        let next_index = (state.current_index as i32 + state.direction) as usize;
                        if next_index >= data.waypoints.len() {
                            state.direction = -1;
                            state.current_index = data.waypoints.len() - 2;
                        } else if next_index == 0 && state.direction == -1 {
                            state.direction = 1;
                            state.current_index = 1;
                        } else {
                            state.current_index = next_index;
                        }
                    }
                    PlatformLoopMode::Loop => {
                        state.current_index = (state.current_index + 1) % data.waypoints.len();
                    }
                    PlatformLoopMode::Once => {
                        if state.current_index < data.waypoints.len() - 1 {
                            state.current_index += 1;
                        }
                    }
                }
            } else {
                // Move toward target
                transform.translation += direction * step;
            }
        }
    }
}

/// Trigger zone system: on collision enter/exit, emit named events for scripts.
/// Supports one_shot mode (fires once then disables).
fn system_trigger_zone(
    runtime: Option<ResMut<GameComponentRuntime>>,
    entities: Query<(&EntityId, &GameComponents)>,
) {
    let Some(mut runtime) = runtime else { return; };

    // Collect trigger zone data: (entity_id, event_name, one_shot)
    let trigger_zones: Vec<(String, String, bool)> = entities
        .iter()
        .filter_map(|(eid, gc)| {
            if let Some(GameComponentData::TriggerZone(data)) = gc.get("trigger_zone") {
                Some((eid.0.clone(), data.event_name.clone(), data.one_shot))
            } else {
                None
            }
        })
        .collect();

    // Detect new enters: in active but not in prev
    let new_enters: Vec<(String, String)> = runtime
        .active_collisions
        .iter()
        .filter(|pair| !runtime.prev_collisions.contains(*pair))
        .cloned()
        .collect();

    // Detect new exits: in prev but not in active
    let new_exits: Vec<(String, String)> = runtime
        .prev_collisions
        .iter()
        .filter(|pair| !runtime.active_collisions.contains(*pair))
        .cloned()
        .collect();

    // Process enters
    for (id_a, id_b) in &new_enters {
        for (tz_id, event_name, one_shot) in &trigger_zones {
            let other_id = if tz_id == id_a {
                id_b
            } else if tz_id == id_b {
                id_a
            } else {
                continue;
            };

            // Check one_shot fired
            if *one_shot && runtime.trigger_fired.get(tz_id).copied().unwrap_or(false) {
                continue;
            }

            runtime.pending_events.push(GameEvent {
                event_name: format!("{}_enter", event_name),
                source_entity_id: Some(tz_id.clone()),
                target_entity_id: Some(other_id.clone()),
            });

            if *one_shot {
                runtime.trigger_fired.insert(tz_id.clone(), true);
            }
        }
    }

    // Process exits
    for (id_a, id_b) in &new_exits {
        for (tz_id, event_name, one_shot) in &trigger_zones {
            let other_id = if tz_id == id_a {
                id_b
            } else if tz_id == id_b {
                id_a
            } else {
                continue;
            };

            // Don't emit exit for one_shot triggers that have already fired
            if *one_shot && runtime.trigger_fired.get(tz_id).copied().unwrap_or(false) {
                continue;
            }

            runtime.pending_events.push(GameEvent {
                event_name: format!("{}_exit", event_name),
                source_entity_id: Some(tz_id.clone()),
                target_entity_id: Some(other_id.clone()),
            });
        }
    }
}

/// Spawner system: timer-based entity spawning at intervals.
/// Spawns basic mesh entities with RuntimeEntity marker so they are cleaned up on Stop.
fn system_spawner(
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    entities: Query<(&EntityId, &GameComponents, &Transform)>,
    spawned_query: Query<&EntityId, With<RuntimeEntity>>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // Collect spawner info first to avoid borrow issues
    let spawners: Vec<(String, SpawnerData, Vec3)> = entities
        .iter()
        .filter_map(|(eid, gc, transform)| {
            if let Some(GameComponentData::Spawner(data)) = gc.get("spawner") {
                Some((eid.0.clone(), data.clone(), transform.translation))
            } else {
                None
            }
        })
        .collect();

    for (spawner_id, data, spawner_pos) in &spawners {
        // Skip if this spawner needs a trigger event and none was received
        if let Some(trigger_name) = &data.on_trigger {
            let has_trigger = runtime.pending_events.iter().any(|e| e.event_name == *trigger_name);
            if !has_trigger {
                // Still tick the timer but skip spawning
                let state = runtime.spawner_states.entry(spawner_id.clone())
                    .or_insert_with(|| SpawnerState { timer: 0.0, spawned_ids: Vec::new() });
                state.timer = 0.0; // Reset timer — trigger-based spawners don't auto-tick
                continue;
            }
        }

        let state = runtime.spawner_states.entry(spawner_id.clone())
            .or_insert_with(|| SpawnerState { timer: 0.0, spawned_ids: Vec::new() });

        // Clean up references to despawned entities
        state.spawned_ids.retain(|id| {
            spawned_query.iter().any(|eid| eid.0 == *id)
        });

        // Tick timer
        state.timer += dt;

        // Check if it's time to spawn and we haven't reached max
        if state.timer >= data.interval_secs && (state.spawned_ids.len() as u32) < data.max_count {
            state.timer = 0.0;

            // Calculate spawn position
            let spawn_pos = *spawner_pos + Vec3::from(data.spawn_offset);

            // Generate a unique ID for the spawned entity
            let spawn_id = format!("spawned_{}_{}", spawner_id, uuid::Uuid::new_v4());

            // Spawn a basic entity based on entity_type
            let mesh_handle = match data.entity_type.as_str() {
                "sphere" => meshes.add(Sphere::new(0.5)),
                "cylinder" => meshes.add(Cylinder::new(0.5, 1.0)),
                "capsule" => meshes.add(Capsule3d::new(0.25, 0.5)),
                _ => meshes.add(Cuboid::new(1.0, 1.0, 1.0)), // Default: cube
            };

            let material_handle = materials.add(StandardMaterial {
                base_color: Color::srgb(0.8, 0.4, 0.2),
                ..Default::default()
            });

            commands.spawn((
                Mesh3d(mesh_handle),
                MeshMaterial3d(material_handle),
                Transform::from_translation(spawn_pos),
                EntityId(spawn_id.clone()),
                super::entity_id::EntityName(format!("Spawned {}", data.entity_type)),
                super::entity_id::EntityVisible(true),
                super::pending_commands::EntityType::Cube,
                RuntimeEntity,
            ));

            state.spawned_ids.push(spawn_id);
        }
    }
}

/// Follower system: move entity toward target
fn system_follower(
    time: Res<Time>,
    mut queries: ParamSet<(
        Query<(&EntityId, &GameComponents, &mut Transform)>,
        Query<(&EntityId, &Transform)>,
    )>,
) {


    let dt = time.delta_secs();

    // Phase 1: Collect follower data (entity id, follower config, current position)
    let followers: Vec<_> = queries.p0().iter()
        .filter_map(|(eid, gc, transform)| {
            gc.get("follower").and_then(|comp| {
                if let GameComponentData::Follower(data) = comp {
                    Some((eid.0.clone(), data.clone(), transform.translation))
                } else {
                    None
                }
            })
        })
        .collect();

    // Phase 2: Collect target positions using the read-only query
    let mut target_positions: Vec<(String, Vec3, Vec3, f32, f32, bool)> = Vec::new();
    for (eid, data, current_pos) in followers {
        let Some(target_id) = &data.target_entity_id else { continue; };

        // Find target position
        let target_pos = queries.p1().iter()
            .find(|(tid, _)| tid.0 == *target_id)
            .map(|(_, t)| t.translation);

        let Some(target_pos) = target_pos else { continue; };

        let direction = target_pos - current_pos;
        let distance = direction.length();

        // Stop within stop_distance
        if distance <= data.stop_distance {
            continue;
        }

        target_positions.push((eid, target_pos, direction, distance, data.speed, data.look_at_target));
    }

    // Phase 3: Apply movement using the mutable query
    for (eid, target_pos, direction, distance, speed, look_at_target) in target_positions {
        if let Some((_, _, mut transform)) = queries.p0().iter_mut()
            .find(|(fid, _, _)| fid.0 == eid)
        {
            // Move toward target
            let movement = direction.normalize() * speed * dt;
            transform.translation += movement;

            // Optionally rotate to face target
            if look_at_target && distance > 0.01 {
                transform.look_at(target_pos, Vec3::Y);
            }
        }
    }
}

/// Projectile system: move in direction, tick lifetime
fn system_projectile(
    time: Res<Time>,
    mut commands: Commands,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(Entity, &EntityId, &GameComponents, &mut Transform)>,
) {


    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    let mut to_despawn = Vec::new();

    for (entity, eid, gc, mut transform) in entities.iter_mut() {
        if let Some(GameComponentData::Projectile(data)) = gc.get("projectile") {
            // Get or init state
            let state = runtime.projectile_states.entry(eid.0.clone()).or_insert_with(|| {
                ProjectileState {
                    direction: [0.0, 0.0, -1.0], // Default forward
                    remaining_lifetime: data.lifetime_secs,
                }
            });

            // Move in direction
            let dir = Vec3::from(state.direction).normalize_or_zero();
            transform.translation += dir * data.speed * dt;

            // Tick lifetime
            state.remaining_lifetime -= dt;
            if state.remaining_lifetime <= 0.0 {
                to_despawn.push(entity);
            }
        }
    }

    // Despawn expired projectiles
    for entity in to_despawn {
        commands.entity(entity).despawn();
    }
}

/// Win condition system: check score/collectAll/reachGoal
///
/// Reads and writes `GameComponentRuntime` through a single `ResMut` binding.
/// Declaring both `Res` and `ResMut` of the same resource in one system is the
/// canonical B0002 access conflict and panics the schedule on Play (see #8661).
fn system_win_condition(
    runtime: Option<ResMut<GameComponentRuntime>>,
    entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {
    let Some(mut runtime) = runtime else { return; };

    // Entities that count as "the player" for ReachGoal: CharacterController holders.
    // Precomputed before the win-condition loop so the immutable `entities` borrow
    // is released before we mutate the runtime resource.
    let player_ids: std::collections::HashSet<String> = entities
        .iter()
        .filter_map(|(eid, gc, _t)| gc.has("character_controller").then(|| eid.0.clone()))
        .collect();

    for (_eid, gc, _transform) in entities.iter() {
        if let Some(GameComponentData::WinCondition(data)) = gc.get("win_condition") {
            let condition_met = match &data.condition_type {
                WinConditionType::Score => {
                    data.target_score.map_or(false, |target| runtime.score >= target)
                }
                WinConditionType::CollectAll => {
                    runtime.total_collectibles > 0 && runtime.collected_count >= runtime.total_collectibles
                }
                WinConditionType::ReachGoal => {
                    // Win when a player (CharacterController) overlaps the goal entity.
                    // `system_track_collisions` populates `active_collisions` from
                    // Rapier events each frame; we look for a pair linking the goal
                    // id with any player id.
                    match &data.target_entity_id {
                        Some(goal_id) => runtime.active_collisions.iter().any(|(a, b)| {
                            (a == goal_id && player_ids.contains(b))
                                || (b == goal_id && player_ids.contains(a))
                        }),
                        None => false,
                    }
                }
            };

            if condition_met && !runtime.game_won {
                // Emit game win event
                runtime.game_won = true;
                runtime.pending_events.push(GameEvent {
                    event_name: "game_win".to_string(),
                    source_entity_id: None,
                    target_entity_id: None,
                });
            }
        }
    }
}

/// DialogueTrigger system: check player proximity to dialogue triggers
fn system_dialogue_trigger(
    runtime: Option<ResMut<GameComponentRuntime>>,
    input: Option<Res<super::input::InputState>>,
    entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {
    let Some(mut runtime) = runtime else { return; };
    let Some(input) = input else { return; };

    // Find player entity (has CharacterController)
    let player_pos = entities.iter()
        .find(|(_, gc, _)| gc.has("character_controller"))
        .map(|(_, _, t)| t.translation);

    let Some(player_pos) = player_pos else { return; };

    for (trigger_id, gc, trigger_transform) in entities.iter() {
        if let Some(GameComponentData::DialogueTrigger(data)) = gc.get("dialogue_trigger") {
            if data.dialogue_tree_id.is_empty() { continue; }

            let distance = player_pos.distance(trigger_transform.translation);

            if distance <= data.interaction_radius {
                // Check if one-shot already fired
                if data.one_shot && runtime.trigger_fired.get(&trigger_id.0).copied().unwrap_or(false) {
                    continue;
                }

                let should_trigger = if data.auto_start {
                    // For auto_start, only trigger once per entry (use trigger_fired)
                    !runtime.trigger_fired.get(&trigger_id.0).copied().unwrap_or(false)
                } else {
                    input.is_action_just_pressed(&data.interaction_key)
                };

                if should_trigger {
                    runtime.pending_events.push(GameEvent {
                        event_name: "dialogue_trigger".to_string(),
                        source_entity_id: Some(trigger_id.0.clone()),
                        target_entity_id: Some(data.dialogue_tree_id.clone()),
                    });

                    if data.one_shot || data.auto_start {
                        runtime.trigger_fired.insert(trigger_id.0.clone(), true);
                    }
                }
            } else if data.auto_start {
                // Reset auto_start trigger when leaving radius
                runtime.trigger_fired.remove(&trigger_id.0);
            }
        }
    }
}

#[cfg(test)]
mod win_condition_tests {
    use super::{
        system_collectible, system_follower, system_projectile, system_spawner,
        system_win_condition, CharacterControllerData, CollectibleData, GameComponentData,
        GameComponentRuntime, GameComponents, GameEvent, WinConditionData, WinConditionType,
    };
    use crate::core::entity_id::EntityId;
    use bevy::prelude::*;

    // ---- Shared test entity builders ----

    fn player_entity(id: &str) -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::CharacterController(
            CharacterControllerData::default(),
        ));
        (EntityId::new(id), gc, Transform::default())
    }

    fn collectible_entity(
        id: &str,
        value: u32,
        destroy_on_collect: bool,
    ) -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::Collectible(CollectibleData {
            value,
            destroy_on_collect,
            pickup_sound_asset: None,
            rotate_speed: 0.0,
        }));
        (EntityId::new(id), gc, Transform::default())
    }

    fn reach_goal_entity(target: &str) -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::ReachGoal,
            target_score: None,
            target_entity_id: Some(target.to_string()),
        }));
        (EntityId::new("mgr"), gc, Transform::default())
    }

    /// Canonical-ordered collision pair, matching `system_track_collisions`
    /// (which stores the lexicographically smaller id first).
    fn pair(a: &str, b: &str) -> (String, String) {
        if a <= b {
            (a.to_string(), b.to_string())
        } else {
            (b.to_string(), a.to_string())
        }
    }

    fn win_condition_entity(score_target: u32) -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::Score,
            target_score: Some(score_target),
            target_entity_id: None,
        }));
        (EntityId::new("player"), gc, Transform::default())
    }

    fn collect_all_entity() -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::CollectAll,
            target_score: None,
            target_entity_id: None,
        }));
        (EntityId::new("player"), gc, Transform::default())
    }

    /// Regression for B0002 (acceptance criteria 1, 2, 4):
    /// `system_win_condition` must declare the `GameComponentRuntime` resource
    /// with exactly ONE access kind. If it declares both `Res` and `ResMut`,
    /// Bevy aborts with the canonical access-conflict the instant the schedule
    /// initialises and runs the system. A panic here is a test failure — which
    /// is precisely the failing-first state we want before the fix.
    #[test]
    fn system_win_condition_has_no_resource_access_conflict() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime::default());

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);

        // Initialising + running the schedule validates the system's world
        // access. The buggy signature (Res + ResMut of the same resource)
        // aborts here with the canonical B0002 conflict.
        schedule.run(&mut world);
    }

    /// Behavioural guarantee (acceptance criterion 3): once the score meets the
    /// target, the system flips `game_won` and emits a `game_win` event. This
    /// proves the parameter merge does not regress win detection.
    #[test]
    fn win_condition_score_emits_game_win_event() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime {
            score: 50,
            ..Default::default()
        });
        world.spawn(win_condition_entity(10));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(runtime.game_won, "win condition met but game_won was not set");
        assert!(
            runtime.pending_events.iter().any(|e| e.event_name == "game_win"),
            "win condition met but no game_win event was emitted",
        );
    }

    /// The win event must fire exactly once. A second tick after winning must
    /// not push another `game_win` (guards the `!game_won` short-circuit that
    /// the merged single `ResMut` binding must preserve).
    #[test]
    fn win_condition_does_not_re_emit_after_won() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime {
            score: 50,
            ..Default::default()
        });
        world.spawn(win_condition_entity(10));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        let win_events = runtime
            .pending_events
            .iter()
            .filter(|e| e.event_name == "game_win")
            .count();
        assert_eq!(win_events, 1, "game_win must fire exactly once, fired {win_events}");
    }

    /// A score below target must not win the game (no false positives).
    #[test]
    fn win_condition_not_met_below_target() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime {
            score: 5,
            ..Default::default()
        });
        world.spawn(win_condition_entity(10));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(!runtime.game_won, "game should not be won below the score target");
        assert!(runtime.pending_events.is_empty(), "no events expected when not won");
    }

    /// CollectAll wins once every collectible is gathered (`collected >= total`,
    /// `total > 0`). Exercises the previously-untested `CollectAll` branch so the
    /// merged single-`ResMut` binding is proven across more than the `Score` path.
    #[test]
    fn win_condition_collect_all_emits_when_all_collected() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime {
            total_collectibles: 3,
            collected_count: 3,
            ..Default::default()
        });
        world.spawn(collect_all_entity());

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(runtime.game_won, "collectAll met (3/3) but game_won was not set");
        assert!(
            runtime.pending_events.iter().any(|e| e.event_name == "game_win"),
            "collectAll met but no game_win event was emitted",
        );
    }

    /// A partial collection (2 of 3) must not win — guards the `collected >= total`
    /// comparison against an off-by-one regression.
    #[test]
    fn win_condition_collect_all_not_met_when_partial() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime {
            total_collectibles: 3,
            collected_count: 2,
            ..Default::default()
        });
        world.spawn(collect_all_entity());

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(!runtime.game_won, "collectAll partial (2/3) must not win");
        assert!(runtime.pending_events.is_empty(), "no events expected when not won");
    }

    /// CollectAll with zero collectibles defined must NOT auto-win (the
    /// `total_collectibles > 0` guard). A scene with no collectibles configured
    /// would otherwise win instantly on Play.
    #[test]
    fn win_condition_collect_all_not_met_when_none_defined() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime::default()); // total = collected = 0
        world.spawn(collect_all_entity());

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(!runtime.game_won, "no collectibles defined must not auto-win");
    }

    /// The real `PlaySystemSet` registration tuple — `system_spawner`,
    /// `system_follower`, `system_projectile`, `system_win_condition` — must build
    /// and run as a single schedule without an access-conflict panic. This guards
    /// the inter-system registration boundary that the isolated single-system
    /// tests cannot: a within-system `Res`+`ResMut` regression in ANY of these
    /// (the #8661 bug class) aborts schedule init here, so the whole Play-mode
    /// group is covered, not just `system_win_condition` in isolation.
    #[test]
    fn play_systemset_group_schedules_without_conflict() {
        let mut world = World::new();
        world.insert_resource(Time::<()>::default());
        world.insert_resource(GameComponentRuntime::default());
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());

        let mut schedule = Schedule::default();
        schedule.add_systems((
            system_spawner,
            system_follower,
            system_projectile,
            system_win_condition,
        ));
        schedule.run(&mut world);
    }

    // ---- ReachGoal win condition ----

    /// ReachGoal wins the instant a CharacterController entity shares a collision
    /// pair with the goal entity. This is the #8764 fix: the arm previously
    /// hardcoded `false`, so a goal-touch game could never be won.
    #[test]
    fn win_condition_reach_goal_emits_on_player_touch() {
        let mut world = World::new();
        let mut rt = GameComponentRuntime::default();
        rt.active_collisions.insert(pair("goal", "player"));
        world.insert_resource(rt);
        world.spawn(player_entity("player"));
        world.spawn(reach_goal_entity("goal"));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(runtime.game_won, "player touched the goal but game_won was not set");
        assert!(
            runtime.pending_events.iter().any(|e| e.event_name == "game_win"),
            "goal reached but no game_win event was emitted",
        );
    }

    /// Without a collision touching the goal, ReachGoal must not win.
    #[test]
    fn win_condition_reach_goal_not_met_without_touch() {
        let mut world = World::new();
        world.insert_resource(GameComponentRuntime::default());
        world.spawn(player_entity("player"));
        world.spawn(reach_goal_entity("goal"));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(!runtime.game_won, "no goal contact must not win");
        assert!(runtime.pending_events.is_empty(), "no events expected when not won");
    }

    /// Only a CharacterController entity counts as reaching the goal. A non-player
    /// object resting against the goal (e.g. a crate) must not trigger the win.
    #[test]
    fn win_condition_reach_goal_ignores_non_player_touch() {
        let mut world = World::new();
        let mut rt = GameComponentRuntime::default();
        rt.active_collisions.insert(pair("goal", "crate"));
        world.insert_resource(rt);
        world.spawn(player_entity("player")); // exists but not touching the goal
        world.spawn((EntityId::new("crate"), GameComponents::default(), Transform::default()));
        world.spawn(reach_goal_entity("goal"));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert!(!runtime.game_won, "a non-player touching the goal must not win");
    }

    /// A ReachGoal with no `target_entity_id` configured cannot be satisfied and
    /// must never auto-win (guards the `None` arm).
    #[test]
    fn win_condition_reach_goal_no_target_never_wins() {
        let mut world = World::new();
        let mut rt = GameComponentRuntime::default();
        rt.active_collisions.insert(pair("goal", "player"));
        world.insert_resource(rt);
        world.spawn(player_entity("player"));
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::ReachGoal,
            target_score: None,
            target_entity_id: None,
        }));
        world.spawn((EntityId::new("mgr"), gc, Transform::default()));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_win_condition);
        schedule.run(&mut world);

        assert!(
            !world.resource::<GameComponentRuntime>().game_won,
            "ReachGoal with no target must not win",
        );
    }

    // ---- Collectible pickup (engine score writer) ----

    /// Picking up a collectible increments `collected_count`, adds its `value` to
    /// `score`, emits `collectible_collected`, and despawns it when
    /// `destroy_on_collect` is set.
    #[test]
    fn collectible_pickup_scores_counts_emits_and_despawns() {
        let mut world = World::new();
        world.insert_resource(Time::<()>::default());
        let mut rt = GameComponentRuntime { total_collectibles: 1, ..Default::default() };
        rt.active_collisions.insert(pair("coin", "player"));
        world.insert_resource(rt);
        let coin = world.spawn(collectible_entity("coin", 5, true)).id();
        world.spawn(player_entity("player"));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_collectible);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert_eq!(runtime.collected_count, 1, "pickup must increment collected_count");
        assert_eq!(runtime.score, 5, "pickup must add the collectible value to score");
        assert!(runtime.collected_ids.contains("coin"), "collected id must be recorded");
        assert!(
            runtime.pending_events.iter().any(|e| e.event_name == "collectible_collected"),
            "pickup must emit a collectible_collected event",
        );
        assert!(
            world.get_entity(coin).is_err(),
            "destroy_on_collect collectible must be despawned after pickup",
        );
    }

    /// A collectible that stays in contact (destroy_on_collect = false) must be
    /// counted and scored exactly once across multiple frames.
    #[test]
    fn collectible_pickup_does_not_double_count() {
        let mut world = World::new();
        world.insert_resource(Time::<()>::default());
        let mut rt = GameComponentRuntime { total_collectibles: 1, ..Default::default() };
        rt.active_collisions.insert(pair("coin", "player"));
        world.insert_resource(rt);
        world.spawn(collectible_entity("coin", 3, false));
        world.spawn(player_entity("player"));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_collectible);
        schedule.run(&mut world);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert_eq!(runtime.collected_count, 1, "a persistent collectible must count once");
        assert_eq!(runtime.score, 3, "a persistent collectible must score once");
    }

    /// A collectible overlapping a non-player entity (no CharacterController) must
    /// not be collected.
    #[test]
    fn collectible_not_collected_without_player_overlap() {
        let mut world = World::new();
        world.insert_resource(Time::<()>::default());
        let mut rt = GameComponentRuntime { total_collectibles: 1, ..Default::default() };
        rt.active_collisions.insert(pair("coin", "wall"));
        world.insert_resource(rt);
        world.spawn(collectible_entity("coin", 1, true));
        world.spawn((EntityId::new("wall"), GameComponents::default(), Transform::default()));

        let mut schedule = Schedule::default();
        schedule.add_systems(system_collectible);
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert_eq!(runtime.collected_count, 0, "no player overlap must not collect");
        assert_eq!(runtime.score, 0);
    }

    /// End-to-end: a player picking up the final collectible drives `collected_count`
    /// to `total_collectibles`, and the CollectAll win condition fires in the same
    /// schedule run. Proves pickup → win wiring, not just the systems in isolation.
    #[test]
    fn collectible_pickup_then_collect_all_wins() {
        let mut world = World::new();
        world.insert_resource(Time::<()>::default());
        let mut rt = GameComponentRuntime { total_collectibles: 1, ..Default::default() };
        rt.active_collisions.insert(pair("coin", "player"));
        world.insert_resource(rt);
        world.spawn(collectible_entity("coin", 1, true));
        // Player carries the CollectAll win condition.
        let mut gc = GameComponents::default();
        gc.components.push(GameComponentData::CharacterController(CharacterControllerData::default()));
        gc.components.push(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::CollectAll,
            target_score: None,
            target_entity_id: None,
        }));
        world.spawn((EntityId::new("player"), gc, Transform::default()));

        let mut schedule = Schedule::default();
        schedule.add_systems((system_collectible, system_win_condition).chain());
        schedule.run(&mut world);

        let runtime = world.resource::<GameComponentRuntime>();
        assert_eq!(runtime.collected_count, 1, "final collectible must be collected");
        assert!(runtime.game_won, "collecting all items must win the game");
        assert!(
            runtime.pending_events.iter().any(|e| e.event_name == "game_win"),
            "collectAll completion must emit game_win",
        );
    }

    /// The bridge drain (`emit_game_events_system`, wasm-only) forwards each
    /// queued event to JS via `take_pending_events`. This proves the seam returns
    /// every queued event in order AND leaves the queue empty — without it, the
    /// win event never reaches scripts/UI and `pending_events` grows unbounded
    /// for the whole play session.
    #[test]
    fn take_pending_events_returns_all_and_empties_queue() {
        let mut runtime = GameComponentRuntime::default();
        runtime.pending_events.push(GameEvent {
            event_name: "collectible_collected".into(),
            source_entity_id: Some("coin".into()),
            target_entity_id: Some("player".into()),
        });
        runtime.pending_events.push(GameEvent {
            event_name: "game_win".into(),
            source_entity_id: None,
            target_entity_id: None,
        });

        let drained = runtime.take_pending_events();

        assert_eq!(drained.len(), 2, "every queued event must be returned");
        assert_eq!(drained[0].event_name, "collectible_collected", "order preserved");
        assert_eq!(drained[1].event_name, "game_win", "order preserved");
        assert!(
            runtime.pending_events.is_empty(),
            "queue must be empty after draining so events are not re-emitted",
        );

        // Draining an already-empty queue is a safe no-op (matches the bridge's
        // every-frame call when nothing happened).
        assert!(runtime.take_pending_events().is_empty());
    }
}

#[cfg(test)]
mod build_game_component_tests {
    use super::{build_game_component, GameComponentData, PlatformLoopMode, WinConditionType};

    /// Every caller of `build_game_component` is a wire boundary: JS commands, MCP,
    /// and `.forge` scenes authored by an older version of the editor. A properties
    /// bag from any of them can legitimately carry a subset of the fields, so a
    /// missing field must fall back to the type's default rather than rejecting the
    /// whole component.
    #[test]
    fn a_partial_properties_bag_fills_the_rest_from_defaults() {
        let built = build_game_component("character_controller", r#"{"speed":9.0}"#)
            .expect("a partial bag is a valid bag");
        let GameComponentData::CharacterController(data) = built else {
            panic!("wrong variant");
        };
        assert_eq!(data.speed, 9.0);
        assert_eq!(data.jump_height, 8.0);
        assert_eq!(data.gravity_scale, 1.0);
        assert!(!data.can_double_jump);
    }

    #[test]
    fn an_empty_bag_is_all_defaults() {
        for bag in ["", "{}"] {
            let built = build_game_component("health", bag).expect("empty bag builds defaults");
            let GameComponentData::Health(data) = built else {
                panic!("wrong variant")
            };
            assert_eq!(data.max_hp, 100.0);
            assert!(data.despawn_on_death);
        }
    }

    /// A value the engine cannot use must not take the whole component down with
    /// it — the field is skipped and its default stands. This mirrors the
    /// allowlist-and-guard rule the JS side already follows for LLM-authored input.
    #[test]
    fn a_wrongly_typed_field_is_skipped_not_fatal() {
        let built = build_game_component(
            "character_controller",
            r#"{"speed":"very fast","jumpHeight":3.0}"#,
        )
        .expect("one bad field does not sink the component");
        let GameComponentData::CharacterController(data) = built else {
            panic!("wrong variant");
        };
        assert_eq!(data.speed, 5.0, "the unusable value falls back to the default");
        assert_eq!(data.jump_height, 3.0, "the usable sibling still applies");
    }

    #[test]
    fn an_unknown_field_is_ignored() {
        let built = build_game_component("checkpoint", r#"{"autoSave":false,"colour":"red"}"#)
            .expect("an unknown key is not an error");
        let GameComponentData::Checkpoint(data) = built else {
            panic!("wrong variant")
        };
        assert!(!data.auto_save);
    }

    /// Out-of-range numbers reach the engine as physics inputs. Clamping keeps a
    /// hallucinated 1e30 from producing a non-finite transform downstream.
    #[test]
    fn out_of_range_numbers_are_clamped_to_the_usable_range() {
        let built = build_game_component("character_controller", r#"{"speed":1e30}"#)
            .expect("an extreme value clamps rather than failing");
        let GameComponentData::CharacterController(data) = built else {
            panic!("wrong variant");
        };
        assert_eq!(data.speed, 1000.0);

        let built = build_game_component("projectile", r#"{"lifetimeSecs":-4.0}"#)
            .expect("a negative lifetime clamps");
        let GameComponentData::Projectile(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.lifetime_secs, 0.0);
    }

    #[test]
    fn vector_fields_apply_only_at_the_right_arity() {
        let built = build_game_component("teleporter", r#"{"targetPosition":[1.0,2.0,3.0]}"#)
            .expect("a 3-element vector applies");
        let GameComponentData::Teleporter(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.target_position, [1.0, 2.0, 3.0]);

        let built = build_game_component("teleporter", r#"{"targetPosition":[1.0,2.0]}"#)
            .expect("a short vector is skipped, not fatal");
        let GameComponentData::Teleporter(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.target_position, [0.0, 1.0, 0.0]);
    }

    #[test]
    fn enum_valued_fields_map_from_their_camel_case_names() {
        let built = build_game_component("moving_platform", r#"{"loopMode":"once"}"#)
            .expect("a known loop mode applies");
        let GameComponentData::MovingPlatform(data) = built else {
            panic!("wrong variant")
        };
        assert!(matches!(data.loop_mode, PlatformLoopMode::Once));

        let built = build_game_component("win_condition", r#"{"conditionType":"collectAll"}"#)
            .expect("a known condition type applies");
        let GameComponentData::WinCondition(data) = built else {
            panic!("wrong variant")
        };
        assert!(matches!(data.condition_type, WinConditionType::CollectAll));
    }

    #[test]
    fn a_win_condition_keeps_its_target_score() {
        let built =
            build_game_component("win_condition", r#"{"conditionType":"score","targetScore":42}"#)
                .expect("builds");
        let GameComponentData::WinCondition(data) = built else {
            panic!("wrong variant")
        };
        assert!(matches!(data.condition_type, WinConditionType::Score));
        assert_eq!(data.target_score, Some(42));
    }

    /// The two things that ARE errors: a component type the engine has no systems
    /// for, and a body that is not JSON at all. Both mean the caller sent something
    /// structurally wrong, which no amount of field defaulting can repair.
    #[test]
    fn an_unknown_component_type_is_an_error() {
        let err = build_game_component("teleporter_deluxe", "{}").unwrap_err();
        assert!(err.contains("teleporter_deluxe"), "error names the type: {err}");
    }

    #[test]
    fn malformed_json_is_an_error() {
        let err = build_game_component("health", "{not json").unwrap_err();
        assert!(!err.is_empty());
    }

    /// Valid JSON that is not an object has no fields to merge, so treating it as
    /// an empty bag would silently hand back defaults for a call that was wrong.
    #[test]
    fn a_non_object_body_is_an_error() {
        for body in ["[1,2,3]", "\"health\"", "42", "null"] {
            let err = build_game_component("health", body)
                .expect_err(&format!("{body} must be rejected"));
            assert!(err.contains("expected a JSON object"), "{err}");
        }
    }

    /// Raising the cap without naming a current value means a full-health entity.
    /// Keeping the default would spawn a 250-hp enemy already at 100.
    #[test]
    fn raising_max_hp_alone_starts_the_entity_at_full_health() {
        let built = build_game_component("health", r#"{"maxHp":250.0}"#).expect("builds");
        let GameComponentData::Health(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.max_hp, 250.0);
        assert_eq!(data.current_hp, 250.0);

        // An explicit current value still wins — a wounded enemy stays wounded.
        let built =
            build_game_component("health", r#"{"maxHp":250.0,"currentHp":30.0}"#).expect("builds");
        let GameComponentData::Health(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.current_hp, 30.0);
    }

    /// Every type the engine dispatches on must be constructible from an empty bag,
    /// or a caller can add a component the engine will never accept.
    #[test]
    fn every_component_type_builds_from_an_empty_bag() {
        for name in [
            "character_controller",
            "health",
            "collectible",
            "damage_zone",
            "checkpoint",
            "teleporter",
            "moving_platform",
            "trigger_zone",
            "spawner",
            "follower",
            "projectile",
            "win_condition",
            "dialogue_trigger",
        ] {
            let built = build_game_component(name, "{}")
                .unwrap_or_else(|e| panic!("{name} must build from an empty bag: {e}"));
            assert_eq!(built.component_name(), name);
        }
    }

    /// JSON has one number type, and every producer here formats integers
    /// differently: JS `JSON.stringify(10)` emits `10`, but a value that has been
    /// through a float (a slider, an LLM writing `10.0`, a `.forge` scene round-
    /// tripped through `f64`) emits `10.0`. `as_u64()` answers `None` for the
    /// second form, so the count silently fell back to its default — the exact
    /// "unusable value" outcome the permissive builder exists to avoid, and
    /// inconsistent with the sibling float/vector readers, which both take either
    /// spelling.
    #[test]
    fn integer_fields_accept_a_float_spelling() {
        let built = build_game_component("collectible", r#"{"value":10.0}"#).expect("builds");
        let GameComponentData::Collectible(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.value, 10, "10.0 names the same score as 10");

        let built = build_game_component("spawner", r#"{"maxCount":3.0}"#).expect("builds");
        let GameComponentData::Spawner(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.max_count, 3);

        let built =
            build_game_component("win_condition", r#"{"targetScore":42.0}"#).expect("builds");
        let GameComponentData::WinCondition(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.target_score, Some(42));
    }

    /// A fractional count has no meaning to a system that iterates it, so it
    /// rounds to the nearest whole rather than truncating — 2.6 spawners is much
    /// closer to 3 than to 2.
    #[test]
    fn a_fractional_integer_field_rounds_to_nearest() {
        for (bag, expected) in [(r#"{"value":10.4}"#, 10), (r#"{"value":10.6}"#, 11)] {
            let built = build_game_component("collectible", bag).expect("builds");
            let GameComponentData::Collectible(data) = built else {
                panic!("wrong variant")
            };
            assert_eq!(data.value, expected, "{bag}");
        }
    }

    /// Same clamp-don't-drop rule the float reader follows: an out-of-range count
    /// lands on the nearest usable value instead of silently reverting to the
    /// default. Negative is the floor case — it used to be rejected outright by
    /// `as_u64`, so the floor has to be re-established explicitly.
    #[test]
    fn out_of_range_integer_fields_clamp_to_the_usable_range() {
        let built = build_game_component("collectible", r#"{"value":1e12}"#).expect("builds");
        let GameComponentData::Collectible(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.value, 1_000_000, "clamped to the cap, not defaulted");

        let built = build_game_component("collectible", r#"{"value":-5}"#).expect("builds");
        let GameComponentData::Collectible(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.value, 0, "a negative score floors at zero");

        let built = build_game_component("spawner", r#"{"maxCount":99999}"#).expect("builds");
        let GameComponentData::Spawner(data) = built else {
            panic!("wrong variant")
        };
        assert_eq!(data.max_count, 1000);
    }

    /// Widening the accepted spelling must not widen it to non-numbers: a string
    /// or a bool still leaves the default standing.
    #[test]
    fn a_non_numeric_integer_field_is_still_skipped() {
        for bag in [r#"{"value":"ten"}"#, r#"{"value":true}"#, r#"{"value":null}"#] {
            let built = build_game_component("collectible", bag).expect("builds");
            let GameComponentData::Collectible(data) = built else {
                panic!("wrong variant")
            };
            assert_eq!(data.value, 1, "{bag} leaves the default standing");
        }
    }
}

#[cfg(test)]
mod character_controller_axis_tests {
    use super::{
        system_character_controller, CharacterControllerData, GameComponentData,
        GameComponentRuntime, GameComponents,
    };
    use crate::core::entity_id::EntityId;
    use crate::core::input::{ActionValue, InputState};
    use crate::core::project_type::ProjectType;
    use bevy::prelude::*;
    use std::time::Duration;

    /// `system_character_controller` is the ONLY input-driven movement system the
    /// engine has — there is no 2D counterpart — so a generated 2D player has to
    /// use it. But it was written for 3D: it maps the vertical axis onto Z, which
    /// in a 2D scene is depth. An orthographic 2D camera looks down -Z, so
    /// pressing "up" in a generated top-down 2D game moved the sprite toward or
    /// away from the camera and NOTHING appeared to happen (PF-1124).
    fn player(controller: CharacterControllerData) -> (EntityId, GameComponents, Transform) {
        let mut gc = GameComponents::default();
        gc.components
            .push(GameComponentData::CharacterController(controller));
        (EntityId::new("player"), gc, Transform::default())
    }

    fn action(name: &str, pressed: bool, axis_value: f32) -> InputState {
        let mut input = InputState::default();
        input.actions.insert(
            name.to_string(),
            ActionValue { pressed, just_pressed: false, just_released: false, axis_value },
        );
        input
    }

    fn axis(name: &str, value: f32) -> InputState {
        action(name, false, value)
    }

    fn held(name: &str) -> InputState {
        action(name, true, 0.0)
    }

    /// Several actions at once — the cancellation and diagonal cases need more
    /// than one entry, and `action` builds a fresh map each call.
    fn combined(parts: &[(&str, bool, f32)]) -> InputState {
        let mut input = InputState::default();
        for (name, pressed, axis_value) in parts {
            input.actions.insert(
                (*name).to_string(),
                ActionValue {
                    pressed: *pressed,
                    just_pressed: false,
                    just_released: false,
                    axis_value: *axis_value,
                },
            );
        }
        input
    }

    /// Jump reads `is_action_just_pressed`, which `held` does not set.
    fn jump_tapped() -> InputState {
        let mut input = InputState::default();
        input.actions.insert(
            "jump".to_string(),
            ActionValue { pressed: true, just_pressed: true, just_released: false, axis_value: 0.0 },
        );
        input
    }

    /// Speed × dt must not come out to 1.0. At 10.0 over 0.1 s it does, and then
    /// every distance assertion below is numerically identical to the raw
    /// unscaled input — deleting the `* speed * dt` scaling entirely would keep
    /// the suite green. 7.0 over 0.1 s gives 0.7, which only the real scaling
    /// produces.
    const TEST_SPEED: f32 = 7.0;
    const TEST_DT_MS: u64 = 100;
    /// The distance a full-throttle single-axis frame must cover.
    const EXPECTED_TRAVEL: f32 = 0.7;

    /// Runs one frame with a non-zero delta. `Time::default()` has a zero delta,
    /// which multiplies every movement to nothing — a test that forgets to
    /// advance it passes whatever the mapping does.
    fn run_frame(project_type: Option<ProjectType>, input: InputState) -> Vec3 {
        let mut world = World::new();
        let mut time = Time::<()>::default();
        time.advance_by(Duration::from_millis(TEST_DT_MS));
        world.insert_resource(time);
        world.insert_resource(GameComponentRuntime::default());
        world.insert_resource(input);
        if let Some(pt) = project_type {
            world.insert_resource(pt);
        }

        let entity = world
            .spawn(player(CharacterControllerData { speed: TEST_SPEED, ..Default::default() }))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(system_character_controller);
        schedule.run(&mut world);

        world.get::<Transform>(entity).expect("player still exists").translation
    }

    #[test]
    fn in_3d_the_vertical_axis_moves_along_z() {
        let moved = run_frame(Some(ProjectType::ThreeD), axis("move_vertical", 1.0));
        assert!(moved.z < 0.0, "forward is -Z in 3D, got {moved:?}");
        assert_eq!(moved.y, 0.0, "3D vertical input must not lift the player");
        assert_eq!(moved.x, 0.0);
    }

    /// The resource is absent in unit contexts and until the first
    /// `set_project_type`, and the engine's own `ProjectType::default()` is
    /// `ThreeD`, so absent must behave exactly like 3D rather than picking the 2D
    /// mapping by accident.
    #[test]
    fn an_absent_project_type_keeps_the_3d_mapping() {
        let moved = run_frame(None, axis("move_vertical", 1.0));
        assert!(moved.z < 0.0, "absent must match ThreeD, got {moved:?}");
        assert_eq!(moved.y, 0.0);
    }

    #[test]
    fn in_2d_the_vertical_axis_moves_along_y() {
        let moved = run_frame(Some(ProjectType::TwoD), axis("move_vertical", 1.0));
        assert!(moved.y > 0.0, "up is +Y in 2D, got {moved:?}");
        assert_eq!(moved.z, 0.0, "2D movement must never touch depth");
        assert_eq!(moved.x, 0.0);
    }

    /// The digital fallback is a separate code path from the analog axis, and it
    /// is the one a keyboard preset actually exercises.
    #[test]
    fn in_2d_the_digital_forward_action_moves_along_y() {
        let moved = run_frame(Some(ProjectType::TwoD), held("move_forward"));
        assert!(moved.y > 0.0, "move_forward is up in 2D, got {moved:?}");
        assert_eq!(moved.z, 0.0);
    }

    #[test]
    fn in_2d_the_digital_backward_action_moves_down_y() {
        let moved = run_frame(Some(ProjectType::TwoD), held("move_backward"));
        assert!(moved.y < 0.0, "move_backward is down in 2D, got {moved:?}");
        assert_eq!(moved.z, 0.0);
    }

    /// The analog `move_forward` axis is a third path again — distinct from both
    /// `move_vertical` and the digital actions.
    #[test]
    fn in_2d_the_analog_forward_axis_moves_along_y() {
        let moved = run_frame(Some(ProjectType::TwoD), axis("move_forward", 1.0));
        assert!(moved.y > 0.0, "got {moved:?}");
        assert_eq!(moved.z, 0.0);
    }

    /// Horizontal is the one axis both project types agree on, so it is also the
    /// one a mapping change could silently break.
    #[test]
    fn horizontal_movement_is_identical_in_both_project_types() {
        let in_2d = run_frame(Some(ProjectType::TwoD), axis("move_horizontal", 1.0));
        let in_3d = run_frame(Some(ProjectType::ThreeD), axis("move_horizontal", 1.0));
        assert!(in_2d.x > 0.0, "got {in_2d:?}");
        assert_eq!(in_2d, in_3d);
    }

    /// Speed still scales the 2D vector. Without this, a mapping that wrote a raw
    /// `1.0` into Y would satisfy every assertion above.
    #[test]
    fn the_2d_vertical_distance_scales_with_speed() {
        let moved = run_frame(Some(ProjectType::TwoD), axis("move_vertical", 1.0));
        assert!(
            (moved.y - EXPECTED_TRAVEL).abs() < 1e-5,
            "expected {EXPECTED_TRAVEL} units of travel, got {moved:?}"
        );
    }

    // The three input paths — analog `move_vertical`, analog `move_forward`, and
    // the digital `move_forward`/`move_backward` fallback — are three separate
    // branches, and this change rewrote the fallback chain that feeds all of
    // them. Covering them only under `TwoD` would let a 3D regression through:
    // collapsing the whole chain back to a bare `move_vertical` read keeps every
    // 2D assertion green while deleting keyboard forward/back from every 3D game.

    #[test]
    fn in_3d_the_digital_forward_action_moves_along_z() {
        let moved = run_frame(Some(ProjectType::ThreeD), held("move_forward"));
        assert!(moved.z < 0.0, "digital forward is -Z in 3D, got {moved:?}");
        assert_eq!(moved.y, 0.0, "walking must not lift the player");
    }

    #[test]
    fn in_3d_the_digital_backward_action_moves_along_positive_z() {
        let moved = run_frame(Some(ProjectType::ThreeD), held("move_backward"));
        assert!(moved.z > 0.0, "digital backward is +Z in 3D, got {moved:?}");
        assert_eq!(moved.y, 0.0);
    }

    #[test]
    fn in_3d_the_analog_forward_axis_moves_along_z() {
        let moved = run_frame(Some(ProjectType::ThreeD), axis("move_forward", 1.0));
        assert!(moved.z < 0.0, "analog forward is -Z in 3D, got {moved:?}");
        assert_eq!(moved.y, 0.0);
    }

    #[test]
    fn in_2d_a_negative_vertical_axis_moves_down_y() {
        let moved = run_frame(Some(ProjectType::TwoD), axis("move_vertical", -1.0));
        assert!(
            (moved.y + EXPECTED_TRAVEL).abs() < 1e-5,
            "a full-throttle pull-down must travel {EXPECTED_TRAVEL} down, got {moved:?}"
        );
        assert_eq!(moved.z, 0.0);
    }

    /// The digital fallback accumulates with `+=` / `-=`, so holding both must
    /// cancel rather than pick a winner — in either project type.
    #[test]
    fn holding_forward_and_backward_together_cancels() {
        let both = combined(&[("move_forward", true, 0.0), ("move_backward", true, 0.0)]);
        assert_eq!(run_frame(Some(ProjectType::TwoD), both), Vec3::ZERO);

        let both = combined(&[("move_forward", true, 0.0), ("move_backward", true, 0.0)]);
        assert_eq!(run_frame(Some(ProjectType::ThreeD), both), Vec3::ZERO);
    }

    /// A diagonal is the only case where `normalize()` does real work: two
    /// full-throttle axes must still cover one frame's worth of distance, not
    /// √2 times it. In 2D both components land in the screen plane, so this is
    /// also what proves the 2D mapping shares the same vector as X rather than
    /// being scaled separately.
    #[test]
    fn in_2d_a_diagonal_is_normalized_to_one_frame_of_travel() {
        let diagonal = combined(&[("move_horizontal", false, 1.0), ("move_vertical", false, 1.0)]);
        let moved = run_frame(Some(ProjectType::TwoD), diagonal);
        assert!(
            (moved.length() - EXPECTED_TRAVEL).abs() < 1e-5,
            "a diagonal must cover {EXPECTED_TRAVEL}, got {moved:?} (len {})",
            moved.length()
        );
        assert!((moved.x - moved.y).abs() < 1e-5, "a 45° diagonal is symmetric, got {moved:?}");
        assert_eq!(moved.z, 0.0, "2D movement must never touch depth");
    }

    /// Jump writes Y directly, which under `TwoD` is now the same axis walking
    /// writes. Pinning the sum keeps that collision honest: a jump adds to a
    /// walk instead of replacing it, and a jump alone still leaves X and Z
    /// untouched.
    ///
    /// This pins the CURRENT jump, which is a frame-rate-scaled instant nudge
    /// with no velocity and no gravity — broken identically in 3D, tracked
    /// separately. The assertion is deliberately written against
    /// `jump_height * 0.5 * dt` so that giving jump a real arc fails here and
    /// has to be looked at, rather than silently changing 2D walking.
    #[test]
    fn in_2d_a_jump_adds_to_the_vertical_walk_on_the_same_axis() {
        let default_jump_height = CharacterControllerData::default().jump_height;
        let dt = TEST_DT_MS as f32 / 1000.0;
        let jump_rise = default_jump_height * 0.5 * dt;

        let jump_only = run_frame(Some(ProjectType::TwoD), jump_tapped());
        assert!(
            (jump_only.y - jump_rise).abs() < 1e-5,
            "a bare jump rises {jump_rise}, got {jump_only:?}"
        );
        assert_eq!(jump_only.x, 0.0, "a jump must not drift sideways");
        assert_eq!(jump_only.z, 0.0, "a jump must not touch depth in 2D");

        let mut walk_and_jump = combined(&[("move_vertical", false, 1.0)]);
        walk_and_jump.actions.insert(
            "jump".to_string(),
            ActionValue { pressed: true, just_pressed: true, just_released: false, axis_value: 0.0 },
        );
        let both = run_frame(Some(ProjectType::TwoD), walk_and_jump);
        assert!(
            (both.y - (EXPECTED_TRAVEL + jump_rise)).abs() < 1e-5,
            "walk and jump share Y in 2D and must sum, got {both:?}"
        );
    }

    /// The `fps` preset — the preset every generated 3D game is now bound to —
    /// binds `move_right` as an AXIS with A on the negative side, and binds no
    /// `move_left` at all. `capture_input` marks an axis `pressed` whenever
    /// `axis_value.abs() > 0.0`, so this is byte-for-byte what a real A press
    /// produces: pressed AND negative.
    ///
    /// Reading only the digital form saw that as "move_right is pressed" and
    /// added +1.0, so A and D both strafed right and moving left was impossible.
    /// The `+ EXPECTED_TRAVEL` form is deliberate — it fails on the old
    /// behaviour rather than merely on a zero.
    #[test]
    fn a_negative_move_right_axis_strafes_left() {
        let moved = run_frame(Some(ProjectType::ThreeD), action("move_right", true, -1.0));
        assert!(
            (moved.x + EXPECTED_TRAVEL).abs() < 1e-5,
            "a negative move_right axis must travel {EXPECTED_TRAVEL} to -X, got {moved:?}"
        );
        assert_eq!(moved.z, 0.0, "strafing must not move the player in depth");
    }

    #[test]
    fn a_positive_move_right_axis_strafes_right() {
        let moved = run_frame(Some(ProjectType::ThreeD), action("move_right", true, 1.0));
        assert!(
            (moved.x - EXPECTED_TRAVEL).abs() < 1e-5,
            "a positive move_right axis must travel {EXPECTED_TRAVEL} to +X, got {moved:?}"
        );
    }

    /// The digital horizontal arm is what `platformer` and `topdown` reach when a
    /// binding is digital rather than an axis, and it survived the axis fix
    /// above only because the axis read falls through on `axis_value == 0.0`.
    #[test]
    fn the_digital_right_action_moves_along_positive_x() {
        let moved = run_frame(Some(ProjectType::TwoD), held("move_right"));
        assert!(
            (moved.x - EXPECTED_TRAVEL).abs() < 1e-5,
            "digital move_right is +X, got {moved:?}"
        );
        assert_eq!(moved.y, 0.0);
    }

    #[test]
    fn the_digital_left_action_moves_along_negative_x() {
        let moved = run_frame(Some(ProjectType::TwoD), held("move_left"));
        assert!(
            (moved.x + EXPECTED_TRAVEL).abs() < 1e-5,
            "digital move_left is -X, got {moved:?}"
        );
        assert_eq!(moved.y, 0.0);
    }

    /// Same `+=` / `-=` accumulation as the forward pair, so the same
    /// cancellation has to hold.
    #[test]
    fn holding_left_and_right_together_cancels() {
        let both = combined(&[("move_right", true, 0.0), ("move_left", true, 0.0)]);
        assert_eq!(run_frame(Some(ProjectType::TwoD), both), Vec3::ZERO);
    }

    /// `move_horizontal` must still win over `move_right`, or a preset binding
    /// both would be resolved by whichever branch happened to run first.
    #[test]
    fn the_horizontal_axis_takes_priority_over_move_right() {
        let conflicting =
            combined(&[("move_horizontal", true, -1.0), ("move_right", true, 1.0)]);
        let moved = run_frame(Some(ProjectType::ThreeD), conflicting);
        assert!(
            (moved.x + EXPECTED_TRAVEL).abs() < 1e-5,
            "move_horizontal must win, got {moved:?}"
        );
    }
}
