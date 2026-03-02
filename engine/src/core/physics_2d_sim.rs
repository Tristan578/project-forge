//! 2D Physics simulation using bevy_rapier2d.
//!
//! Manages 2D physics lifecycle: configuration in Edit mode, simulation in Play mode.
//! `Physics2dData` stores persistent config; Rapier 2D components are attached/detached
//! on Play/Stop transitions.
//!
//! Architecture mirrors `physics.rs` (3D) for consistency.

use bevy::prelude::*;
use bevy_rapier2d::prelude::*;

use super::engine_mode::EngineMode;
use super::entity_id::EntityId;
use super::physics_2d::{BodyType2d, ColliderShape2d, JointType2d, Physics2dData, Physics2dEnabled, PhysicsJoint2d};

// ---------------------------------------------------------------------------
// Resource: 2D Gravity (configurable from bridge)
// ---------------------------------------------------------------------------

/// Resource holding the desired 2D gravity vector.
/// Updated by bridge `apply_gravity2d_updates` system.
#[derive(Resource, Debug, Clone)]
pub struct Gravity2d {
    pub x: f32,
    pub y: f32,
}

impl Default for Gravity2d {
    fn default() -> Self {
        Self { x: 0.0, y: -9.81 }
    }
}

/// Resource controlling 2D debug physics wireframe rendering.
#[derive(Resource, Debug, Clone)]
pub struct DebugPhysics2dEnabled(pub bool);

impl Default for DebugPhysics2dEnabled {
    fn default() -> Self {
        Self(false)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert our BodyType2d to Rapier's RigidBody component.
fn to_rapier_body_2d(kind: &BodyType2d) -> RigidBody {
    match kind {
        BodyType2d::Dynamic => RigidBody::Dynamic,
        BodyType2d::Static => RigidBody::Fixed,
        BodyType2d::Kinematic => RigidBody::KinematicPositionBased,
    }
}

/// Create a Rapier 2D Collider based on shape and Physics2dData dimensions.
pub fn make_collider_2d(data: &Physics2dData) -> Collider {
    match data.collider_shape {
        ColliderShape2d::Box | ColliderShape2d::Auto => {
            Collider::cuboid(data.size[0] * 0.5, data.size[1] * 0.5)
        }
        ColliderShape2d::Circle => {
            Collider::ball(data.radius)
        }
        ColliderShape2d::Capsule => {
            // Capsule along Y axis: half_height from size[1], radius from radius field
            let half_height = (data.size[1] * 0.5 - data.radius).max(0.0);
            Collider::capsule_y(half_height, data.radius)
        }
        ColliderShape2d::ConvexPolygon => {
            // Build convex hull from vertices
            if data.vertices.len() >= 3 {
                let points: Vec<Vect> = data.vertices
                    .iter()
                    .map(|v| Vect::new(v[0], v[1]))
                    .collect();
                Collider::convex_hull(&points)
                    .unwrap_or_else(|| Collider::cuboid(data.size[0] * 0.5, data.size[1] * 0.5))
            } else {
                // Fallback to box if not enough vertices
                Collider::cuboid(data.size[0] * 0.5, data.size[1] * 0.5)
            }
        }
        ColliderShape2d::Edge => {
            // Edge collider: horizontal line segment based on size[0]
            let half_x = data.size[0] * 0.5;
            Collider::segment(Vect::new(-half_x, 0.0), Vect::new(half_x, 0.0))
        }
    }
}

// ---------------------------------------------------------------------------
// Lifecycle systems
// ---------------------------------------------------------------------------

/// Unified system managing the 2D physics simulation lifecycle.
/// Handles Edit->Play (attach), Play->Edit (detach), and Paused states.
fn manage_physics2d_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    to_attach: Query<(Entity, &Physics2dData, &Transform), (With<Physics2dEnabled>, Without<RigidBody>)>,
    to_detach: Query<Entity, (With<RigidBody>, With<Physics2dEnabled>)>,
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

    // Transition: Edit -> Play -- attach Rapier 2D components
    let entering_play = current == EngineMode::Play
        && prev.map_or(true, |p| p == EngineMode::Edit);
    if entering_play {
        for (entity, physics_data, _transform) in to_attach.iter() {
            let collider = make_collider_2d(physics_data);
            let rigid_body = to_rapier_body_2d(&physics_data.body_type);

            let mut locked_axes = LockedAxes::empty();
            if physics_data.lock_rotation {
                locked_axes |= LockedAxes::ROTATION_LOCKED;
            }

            let mut ec = commands.entity(entity);
            ec.insert(rigid_body)
              .insert(collider)
              .insert(Restitution::coefficient(physics_data.restitution))
              .insert(Friction::coefficient(physics_data.friction))
              .insert(ColliderMassProperties::Density(physics_data.mass))
              .insert(GravityScale(physics_data.gravity_scale))
              .insert(locked_axes)
              .insert(ActiveEvents::COLLISION_EVENTS);

            if physics_data.is_sensor {
                ec.insert(Sensor);
            }

            if physics_data.continuous_detection {
                ec.insert(Ccd::enabled());
            }
        }
        tracing::info!("Physics2D attached: {} entities", to_attach.iter().count());
    }

    // Transition: Play/Paused -> Edit (Stop) -- remove all Rapier 2D components
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
                .remove::<Ccd>()
                .remove::<ExternalForce>()
                .remove::<ExternalImpulse>()
                .remove::<ActiveEvents>()
                .remove::<ImpulseJoint>();
        }
        tracing::info!("Physics2D detached");
    }
}

/// System that syncs the 2D debug render toggle.
fn sync_debug_physics2d(
    debug_enabled: Res<DebugPhysics2dEnabled>,
    mut debug_context: Option<ResMut<DebugRenderContext>>,
) {
    if debug_enabled.is_changed() {
        if let Some(ref mut ctx) = debug_context {
            ctx.enabled = debug_enabled.0;
        }
    }
}

/// System that syncs the 2D gravity resource to the Rapier configuration.
fn sync_gravity2d(
    gravity: Res<Gravity2d>,
    mut rapier_config: Query<&mut RapierConfiguration>,
) {
    if gravity.is_changed() {
        if let Ok(mut config) = rapier_config.single_mut() {
            config.gravity = Vect::new(gravity.x, gravity.y);
        }
    }
}

// ---------------------------------------------------------------------------
// Joint lifecycle
// ---------------------------------------------------------------------------

/// Unified system managing the 2D joint lifecycle.
/// Handles Edit→Play (attach ImpulseJoint), Play→Edit (detach).
/// Mirrors `manage_joint_lifecycle` from `physics.rs` (3D).
fn manage_joint2d_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    to_attach: Query<(Entity, &PhysicsJoint2d), Without<ImpulseJoint>>,
    to_detach: Query<Entity, (With<ImpulseJoint>, With<PhysicsJoint2d>)>,
    entity_id_query: Query<(Entity, &EntityId)>,
    mut prev_mode: Local<Option<EngineMode>>,
) {
    let current = *engine_mode;
    let prev = *prev_mode;
    *prev_mode = Some(current);

    // Transition: Edit → Play — attach Rapier2D joints
    let entering_play = current == EngineMode::Play
        && prev.map_or(true, |p| p == EngineMode::Edit);
    if entering_play {
        for (entity, joint_data) in to_attach.iter() {
            // Resolve target entity ID (u32) to Bevy Entity
            let target_id_str = joint_data.target_entity_id.to_string();
            let connected_entity = entity_id_query
                .iter()
                .find(|(_, eid)| eid.0 == target_id_str)
                .map(|(e, _)| e);

            let Some(connected_entity) = connected_entity else {
                tracing::warn!(
                    "2D Joint connected entity not found: {}",
                    joint_data.target_entity_id
                );
                continue;
            };

            let anchor1 = Vec2::new(joint_data.local_anchor1[0], joint_data.local_anchor1[1]);
            let anchor2 = Vec2::new(joint_data.local_anchor2[0], joint_data.local_anchor2[1]);

            let joint: TypedJoint = match &joint_data.joint_type {
                JointType2d::Revolute { limits, motor_velocity, motor_max_force } => {
                    let mut builder = RevoluteJointBuilder::new()
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2);
                    if let Some((min, max)) = limits {
                        builder = builder.limits([*min, *max]);
                    }
                    if *motor_max_force > 0.0 {
                        builder = builder
                            .motor_velocity(*motor_velocity, 0.5)
                            .motor_max_force(*motor_max_force);
                    }
                    builder.build().into()
                }
                JointType2d::Prismatic { axis, limits, motor_velocity, motor_max_force } => {
                    let axis_vec = Vec2::new(axis[0], axis[1]);
                    let mut builder = PrismaticJointBuilder::new(axis_vec)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2);
                    if let Some((min, max)) = limits {
                        builder = builder.limits([*min, *max]);
                    }
                    if *motor_max_force > 0.0 {
                        builder = builder
                            .motor_velocity(*motor_velocity, 0.5)
                            .motor_max_force(*motor_max_force);
                    }
                    builder.build().into()
                }
                JointType2d::Rope { max_distance } => {
                    RopeJointBuilder::new(*max_distance)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
                JointType2d::Spring { rest_length, stiffness, damping } => {
                    SpringJointBuilder::new(*rest_length, *stiffness, *damping)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
            };

            commands.entity(entity).insert(ImpulseJoint::new(connected_entity, joint));
        }
        tracing::info!("2D joints attached: {} joints", to_attach.iter().count());
    }

    // Transition: Play/Paused → Edit (Stop) — remove all ImpulseJoint components
    let entering_edit = current == EngineMode::Edit
        && prev.map_or(false, |p| p != EngineMode::Edit);
    if entering_edit {
        for entity in to_detach.iter() {
            commands.entity(entity).remove::<ImpulseJoint>();
        }
        tracing::info!("2D joints detached");
    }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/// 2D Physics plugin that integrates bevy_rapier2d with the editor's mode system.
pub struct Physics2dPlugin;

impl Plugin for Physics2dPlugin {
    fn build(&self, app: &mut App) {
        use super::engine_mode::PlaySystemSet;

        app.add_plugins(RapierPhysicsPlugin::<NoUserData>::default())
            .add_plugins(RapierDebugRenderPlugin::default())
            .init_resource::<Gravity2d>()
            .init_resource::<DebugPhysics2dEnabled>()
            .add_systems(Update, (
                manage_physics2d_lifecycle,
                sync_debug_physics2d,
                sync_gravity2d,
            ))
            .add_systems(Update, manage_joint2d_lifecycle.in_set(PlaySystemSet));
    }
}
