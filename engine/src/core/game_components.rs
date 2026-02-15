//! Pre-built game components for drag-and-drop gameplay behaviors.
//!
//! This module provides 12 game component types that execute during Play mode
//! via Bevy systems. They interact with physics/collision events and are exposed
//! to the script sandbox via `forge.components.*`.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

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
}

impl Default for HealthData {
    fn default() -> Self {
        Self {
            max_hp: 100.0,
            current_hp: 100.0,
            invincibility_secs: 0.5,
            respawn_on_death: true,
            respawn_point: [0.0, 1.0, 0.0],
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

/// Build a GameComponentData from a type name and JSON properties string.
/// If properties_json is empty, uses defaults.
pub fn build_game_component(component_type: &str, properties_json: &str) -> Result<GameComponentData, String> {
    if properties_json.is_empty() || properties_json == "{}" {
        return Ok(match component_type {
            "character_controller" => GameComponentData::CharacterController(CharacterControllerData::default()),
            "health" => GameComponentData::Health(HealthData::default()),
            "collectible" => GameComponentData::Collectible(CollectibleData::default()),
            "damage_zone" => GameComponentData::DamageZone(DamageZoneData::default()),
            "checkpoint" => GameComponentData::Checkpoint(CheckpointData::default()),
            "teleporter" => GameComponentData::Teleporter(TeleporterData::default()),
            "moving_platform" => GameComponentData::MovingPlatform(MovingPlatformData::default()),
            "trigger_zone" => GameComponentData::TriggerZone(TriggerZoneData::default()),
            "spawner" => GameComponentData::Spawner(SpawnerData::default()),
            "follower" => GameComponentData::Follower(FollowerData::default()),
            "projectile" => GameComponentData::Projectile(ProjectileData::default()),
            "win_condition" => GameComponentData::WinCondition(WinConditionData::default()),
            "dialogue_trigger" => GameComponentData::DialogueTrigger(DialogueTriggerData::default()),
            other => return Err(format!("Unknown game component type: {}", other)),
        });
    }

    match component_type {
        "character_controller" => serde_json::from_str::<CharacterControllerData>(properties_json)
            .map(GameComponentData::CharacterController)
            .map_err(|e| format!("Invalid character_controller properties: {}", e)),
        "health" => serde_json::from_str::<HealthData>(properties_json)
            .map(GameComponentData::Health)
            .map_err(|e| format!("Invalid health properties: {}", e)),
        "collectible" => serde_json::from_str::<CollectibleData>(properties_json)
            .map(GameComponentData::Collectible)
            .map_err(|e| format!("Invalid collectible properties: {}", e)),
        "damage_zone" => serde_json::from_str::<DamageZoneData>(properties_json)
            .map(GameComponentData::DamageZone)
            .map_err(|e| format!("Invalid damage_zone properties: {}", e)),
        "checkpoint" => serde_json::from_str::<CheckpointData>(properties_json)
            .map(GameComponentData::Checkpoint)
            .map_err(|e| format!("Invalid checkpoint properties: {}", e)),
        "teleporter" => serde_json::from_str::<TeleporterData>(properties_json)
            .map(GameComponentData::Teleporter)
            .map_err(|e| format!("Invalid teleporter properties: {}", e)),
        "moving_platform" => serde_json::from_str::<MovingPlatformData>(properties_json)
            .map(GameComponentData::MovingPlatform)
            .map_err(|e| format!("Invalid moving_platform properties: {}", e)),
        "trigger_zone" => serde_json::from_str::<TriggerZoneData>(properties_json)
            .map(GameComponentData::TriggerZone)
            .map_err(|e| format!("Invalid trigger_zone properties: {}", e)),
        "spawner" => serde_json::from_str::<SpawnerData>(properties_json)
            .map(GameComponentData::Spawner)
            .map_err(|e| format!("Invalid spawner properties: {}", e)),
        "follower" => serde_json::from_str::<FollowerData>(properties_json)
            .map(GameComponentData::Follower)
            .map_err(|e| format!("Invalid follower properties: {}", e)),
        "projectile" => serde_json::from_str::<ProjectileData>(properties_json)
            .map(GameComponentData::Projectile)
            .map_err(|e| format!("Invalid projectile properties: {}", e)),
        "win_condition" => serde_json::from_str::<WinConditionData>(properties_json)
            .map(GameComponentData::WinCondition)
            .map_err(|e| format!("Invalid win_condition properties: {}", e)),
        "dialogue_trigger" => serde_json::from_str::<DialogueTriggerData>(properties_json)
            .map(GameComponentData::DialogueTrigger)
            .map_err(|e| format!("Invalid dialogue_trigger properties: {}", e)),
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

        // Game component systems (PlaySystemSet only) - split into groups of 4
        app.add_systems(Update, (
            system_character_controller,
            system_health,
            system_collectible,
            system_damage_zone,
        ).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_checkpoint,
            system_teleporter,
            system_moving_platform,
            system_trigger_zone,
        ).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_spawner,
            system_follower,
            system_projectile,
            system_win_condition,
        ).in_set(PlaySystemSet));

        app.add_systems(Update, (
            system_dialogue_trigger,
        ).in_set(PlaySystemSet));
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
    mut entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
) {


    let Some(input) = input else { return; };
    let Some(_runtime) = runtime else { return; };
    let dt = time.delta_secs();

    for (_eid, gc, mut transform) in entities.iter_mut() {
        for comp in &gc.components {
            if let GameComponentData::CharacterController(data) = comp {
                // Movement
                let mut movement = Vec3::ZERO;

                // Horizontal movement (X axis)
                let horizontal = input.get_axis("move_horizontal");
                if horizontal.abs() > 0.01 {
                    movement.x = horizontal;
                } else {
                    if input.is_action_active("move_right") {
                        movement.x += 1.0;
                    }
                    if input.is_action_active("move_left") {
                        movement.x -= 1.0;
                    }
                }

                // Forward/backward movement (Z axis)
                let vertical = input.get_axis("move_vertical");
                if vertical.abs() > 0.01 {
                    movement.z = -vertical; // Invert for forward = negative Z
                } else {
                    let forward = input.get_axis("move_forward");
                    if forward.abs() > 0.01 {
                        movement.z = -forward;
                    } else {
                        if input.is_action_active("move_forward") {
                            movement.z -= 1.0;
                        }
                        if input.is_action_active("move_backward") {
                            movement.z += 1.0;
                        }
                    }
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

/// Health system: tick invincibility timers, handle death
fn system_health(
    time: Res<Time>,
    runtime: Option<ResMut<GameComponentRuntime>>,
    mut entities: Query<(&EntityId, &mut GameComponents, &mut Transform)>,
) {


    let Some(mut runtime) = runtime else { return; };
    let dt = time.delta_secs();

    // Tick invincibility timers
    runtime.invincibility_timers.retain(|_, timer| {
        *timer -= dt;
        *timer > 0.0
    });

    // Check for death
    for (eid, mut gc, mut transform) in entities.iter_mut() {
        if let Some(GameComponentData::Health(health)) = gc.get_mut("health") {
            if health.current_hp <= 0.0 {
                if health.respawn_on_death {
                    // Respawn at checkpoint
                    transform.translation = Vec3::from(health.respawn_point);
                    health.current_hp = health.max_hp;

                    // Emit death event
                    runtime.pending_events.push(GameEvent {
                        event_name: "entity_death".to_string(),
                        source_entity_id: Some(eid.0.clone()),
                        target_entity_id: None,
                    });
                }
                // Note: despawn on death would require Commands, deferred for now
            }
        }
    }
}

/// Collectible system: rotate collectibles
fn system_collectible(
    time: Res<Time>,
    mut entities: Query<(&GameComponents, &mut Transform)>,
) {
    let dt = time.delta_secs();

    for (gc, mut transform) in entities.iter_mut() {
        if let Some(GameComponentData::Collectible(data)) = gc.get("collectible") {
            // Rotate around Y axis
            let rotation_speed = data.rotate_speed.to_radians();
            transform.rotate_y(rotation_speed * dt);
        }
    }
}

/// Damage zone system: stub (requires collision events from Phase G-4)
fn system_damage_zone(
    _time: Res<Time>,
    _runtime: Option<ResMut<GameComponentRuntime>>,
    _entities: Query<(&EntityId, &GameComponents)>,
) {


    // TODO Phase G-4: Read CollisionEvent, apply damage to entities with Health
    // For now, this is a stub
}

/// Checkpoint system: stub (requires collision events from Phase G-4)
fn system_checkpoint(
    _runtime: Option<ResMut<GameComponentRuntime>>,
    _entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {


    // TODO Phase G-4: On collision with CharacterController, update Health.respawn_point
}

/// Teleporter system: stub (requires collision events from Phase G-4)
fn system_teleporter(
    _time: Res<Time>,
    _runtime: Option<ResMut<GameComponentRuntime>>,
    _entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
) {


    // TODO Phase G-4: On collision, teleport entity to target_position
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

/// Trigger zone system: stub (requires collision events from Phase G-4)
fn system_trigger_zone(
    _runtime: Option<ResMut<GameComponentRuntime>>,
    _entities: Query<(&EntityId, &GameComponents)>,
) {


    // TODO Phase G-4: On collision enter/exit, emit GameEvent
}

/// Spawner system: stub (requires spawn request bridge)
fn system_spawner(
    _time: Res<Time>,
    _runtime: Option<ResMut<GameComponentRuntime>>,
    _entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {


    // TODO: Tick spawn timer, spawn entities at intervals
    // Requires bridge integration to spawn entities
}

/// Follower system: move entity toward target
fn system_follower(
    time: Res<Time>,
    _runtime: Option<Res<GameComponentRuntime>>,
    mut follower_entities: Query<(&EntityId, &GameComponents, &mut Transform)>,
    all_entities: Query<(&EntityId, &Transform)>,
) {


    let dt = time.delta_secs();

    // Collect follower data first to avoid query conflicts
    let followers: Vec<_> = follower_entities.iter()
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

    // Process each follower
    for (eid, data, current_pos) in followers {
        let Some(target_id) = &data.target_entity_id else { continue; };

        // Find target position
        let target_pos = all_entities.iter()
            .find(|(tid, _)| tid.0 == *target_id)
            .map(|(_, t)| t.translation);

        let Some(target_pos) = target_pos else { continue; };

        let direction = target_pos - current_pos;
        let distance = direction.length();

        // Stop within stop_distance
        if distance <= data.stop_distance {
            continue;
        }

        // Update transform
        if let Some((_, _, mut transform)) = follower_entities.iter_mut()
            .find(|(fid, _, _)| fid.0 == eid)
        {
            // Move toward target
            let movement = direction.normalize() * data.speed * dt;
            transform.translation += movement;

            // Optionally rotate to face target
            if data.look_at_target && distance > 0.01 {
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
fn system_win_condition(
    runtime: Option<Res<GameComponentRuntime>>,
    mut runtime_mut: Option<ResMut<GameComponentRuntime>>,
    entities: Query<(&EntityId, &GameComponents, &Transform)>,
) {


    let Some(runtime) = runtime else { return; };

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
                    // TODO Phase G-4: Check collision with target entity
                    false
                }
            };

            if condition_met && !runtime.game_won {
                // Emit game win event
                if let Some(runtime_mut) = runtime_mut.as_mut() {
                    runtime_mut.game_won = true;
                    runtime_mut.pending_events.push(GameEvent {
                        event_name: "game_win".to_string(),
                        source_entity_id: None,
                        target_entity_id: None,
                    });
                }
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
