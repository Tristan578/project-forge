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
    /// Active collision pairs tracked per frame: (entity_a_id, entity_b_id)
    /// Used for DamageZone continuous damage and TriggerZone enter/exit detection
    pub active_collisions: std::collections::HashSet<(String, String)>,
    /// Previous frame's active collisions (for detecting enter/exit transitions)
    pub prev_collisions: std::collections::HashSet<(String, String)>,
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
    _runtime: Option<Res<GameComponentRuntime>>,
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
                    // Known limitation: handled via script API (forge.physics.onCollisionEnter)
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
