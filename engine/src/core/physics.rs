//! Physics system using bevy_rapier3d.
//!
//! Manages physics lifecycle: configuration in Edit mode, simulation in Play mode.
//! `PhysicsData` stores persistent config; Rapier components are attached/detached
//! on Play/Stop transitions.

use bevy::prelude::*;
use bevy_rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

use super::engine_mode::EngineMode;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Collider shape for physics entities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColliderShape {
    Cuboid,
    Ball,
    Cylinder,
    Capsule,
    Auto,
}

impl Default for ColliderShape {
    fn default() -> Self {
        Self::Auto
    }
}

/// Rigid body type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RigidBodyKind {
    Dynamic,
    Fixed,
    KinematicPosition,
    KinematicVelocity,
}

impl Default for RigidBodyKind {
    fn default() -> Self {
        Self::Dynamic
    }
}

/// Physics configuration component (stored persistently on entities).
/// This is the serializable, bridge-friendly representation of physics properties.
#[derive(Component, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsData {
    pub body_type: RigidBodyKind,
    pub collider_shape: ColliderShape,
    pub restitution: f32,
    pub friction: f32,
    pub density: f32,
    pub gravity_scale: f32,
    pub lock_translation_x: bool,
    pub lock_translation_y: bool,
    pub lock_translation_z: bool,
    pub lock_rotation_x: bool,
    pub lock_rotation_y: bool,
    pub lock_rotation_z: bool,
    pub is_sensor: bool,
}

impl Default for PhysicsData {
    fn default() -> Self {
        Self {
            body_type: RigidBodyKind::Dynamic,
            collider_shape: ColliderShape::Auto,
            restitution: 0.3,
            friction: 0.5,
            density: 1.0,
            gravity_scale: 1.0,
            lock_translation_x: false,
            lock_translation_y: false,
            lock_translation_z: false,
            lock_rotation_x: false,
            lock_rotation_y: false,
            lock_rotation_z: false,
            is_sensor: false,
        }
    }
}

/// Marker component: entity has active physics simulation enabled.
/// Separate from PhysicsData to allow toggling physics on/off without losing config.
#[derive(Component, Debug, Clone)]
pub struct PhysicsEnabled;

/// Resource controlling debug physics wireframe rendering.
#[derive(Resource, Debug, Clone)]
pub struct DebugPhysicsEnabled(pub bool);

impl Default for DebugPhysicsEnabled {
    fn default() -> Self {
        Self(false)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert our RigidBodyKind to Rapier's RigidBody component.
fn to_rapier_body(kind: &RigidBodyKind) -> RigidBody {
    match kind {
        RigidBodyKind::Dynamic => RigidBody::Dynamic,
        RigidBodyKind::Fixed => RigidBody::Fixed,
        RigidBodyKind::KinematicPosition => RigidBody::KinematicPositionBased,
        RigidBodyKind::KinematicVelocity => RigidBody::KinematicVelocityBased,
    }
}

/// Build LockedAxes bitflags from PhysicsData booleans.
fn build_locked_axes(data: &PhysicsData) -> LockedAxes {
    let mut axes = LockedAxes::empty();
    if data.lock_translation_x { axes |= LockedAxes::TRANSLATION_LOCKED_X; }
    if data.lock_translation_y { axes |= LockedAxes::TRANSLATION_LOCKED_Y; }
    if data.lock_translation_z { axes |= LockedAxes::TRANSLATION_LOCKED_Z; }
    if data.lock_rotation_x { axes |= LockedAxes::ROTATION_LOCKED_X; }
    if data.lock_rotation_y { axes |= LockedAxes::ROTATION_LOCKED_Y; }
    if data.lock_rotation_z { axes |= LockedAxes::ROTATION_LOCKED_Z; }
    axes
}

/// Create a Rapier Collider based on shape and entity scale.
/// For Auto, defaults to cuboid (most common primitive shape).
pub fn make_collider(shape: &ColliderShape, scale: Vec3) -> Collider {
    match shape {
        ColliderShape::Cuboid | ColliderShape::Auto => {
            Collider::cuboid(scale.x * 0.5, scale.y * 0.5, scale.z * 0.5)
        }
        ColliderShape::Ball => {
            let radius: f32 = scale.x.max(scale.y).max(scale.z) * 0.5;
            Collider::ball(radius)
        }
        ColliderShape::Cylinder => {
            Collider::cylinder(scale.y * 0.5, scale.x * 0.5)
        }
        ColliderShape::Capsule => {
            Collider::capsule_y(scale.y * 0.25, scale.x * 0.25)
        }
    }
}

// ---------------------------------------------------------------------------
// Lifecycle systems
// ---------------------------------------------------------------------------

/// Unified system managing the physics simulation lifecycle.
/// Handles Edit→Play (attach), Play→Edit (detach), and Paused states.
fn manage_physics_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    to_attach: Query<(Entity, &PhysicsData, &Transform), (With<PhysicsEnabled>, Without<RigidBody>)>,
    to_detach: Query<Entity, With<RigidBody>>,
    mut rapier_config: Query<&mut RapierConfiguration>,
    mut prev_mode: Local<Option<EngineMode>>,
) {
    let current = *engine_mode;
    let prev = *prev_mode;
    *prev_mode = Some(current);

    // Sync the physics pipeline active flag:
    // Active only during Play (not Edit, not Paused).
    let should_be_active = current == EngineMode::Play;
    if let Ok(mut config) = rapier_config.single_mut() {
        if config.physics_pipeline_active != should_be_active {
            config.physics_pipeline_active = should_be_active;
        }
    }

    // Transition: Edit → Play — attach Rapier components
    let entering_play = current == EngineMode::Play
        && prev.map_or(true, |p| p == EngineMode::Edit);
    if entering_play {
        for (entity, physics_data, transform) in to_attach.iter() {
            let collider = make_collider(&physics_data.collider_shape, transform.scale);
            let rigid_body = to_rapier_body(&physics_data.body_type);
            let locked_axes = build_locked_axes(physics_data);

            let mut ec = commands.entity(entity);
            ec.insert(rigid_body)
              .insert(collider)
              .insert(Restitution::coefficient(physics_data.restitution))
              .insert(Friction::coefficient(physics_data.friction))
              .insert(ColliderMassProperties::Density(physics_data.density))
              .insert(GravityScale(physics_data.gravity_scale))
              .insert(locked_axes);

            if physics_data.is_sensor {
                ec.insert(Sensor);
            }
        }
        tracing::info!("Physics attached: {} entities", to_attach.iter().count());
    }

    // Transition: Play/Paused → Edit (Stop) — remove all Rapier components
    let entering_edit = current == EngineMode::Edit
        && prev.map_or(false, |p| p != EngineMode::Edit);
    if entering_edit {
        for entity in to_detach.iter() {
            commands.entity(entity)
                .remove::<RigidBody>()
                .remove::<Collider>()
                .remove::<Velocity>()
                .remove::<Restitution>()
                .remove::<Friction>()
                .remove::<ColliderMassProperties>()
                .remove::<GravityScale>()
                .remove::<LockedAxes>()
                .remove::<Sensor>()
                .remove::<ExternalForce>()
                .remove::<ExternalImpulse>();
        }
        tracing::info!("Physics detached");
    }
}

/// System that syncs the debug render toggle.
fn sync_debug_physics(
    debug_enabled: Res<DebugPhysicsEnabled>,
    mut debug_context: Option<ResMut<DebugRenderContext>>,
) {
    if debug_enabled.is_changed() {
        if let Some(ref mut ctx) = debug_context {
            ctx.enabled = debug_enabled.0;
        }
    }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/// Physics plugin that integrates bevy_rapier3d with the editor's mode system.
pub struct PhysicsPlugin;

impl Plugin for PhysicsPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(RapierPhysicsPlugin::<NoUserData>::default())
            .add_plugins(RapierDebugRenderPlugin::default())
            .init_resource::<DebugPhysicsEnabled>()
            .add_systems(Update, (
                manage_physics_lifecycle,
                sync_debug_physics,
            ));
    }
}
