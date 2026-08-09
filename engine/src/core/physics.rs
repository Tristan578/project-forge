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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColliderShape {
    Cuboid,
    Ball,
    Cylinder,
    Capsule,
    #[default]
    Auto,
}

/// Rigid body type.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RigidBodyKind {
    #[default]
    Dynamic,
    Fixed,
    KinematicPosition,
    KinematicVelocity,
}

/// Physics configuration component (stored persistently on entities).
/// This is the serializable, bridge-friendly representation of physics properties.
#[derive(Component, Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// Partial [`PhysicsData`] update.
///
/// Every field is optional so a caller can change one property without having
/// to know (or resend) the other twelve. A missing field means "leave the
/// current value alone" — it never means "reset to the default".
///
/// This exists because the web store keeps physics config only for the
/// *selected* entity, so it cannot reconstruct a complete 13-field payload for
/// an arbitrary entity without inventing the other twelve from defaults — which
/// would, for example, flip a Fixed platform to Dynamic.
///
/// Trade-off: because nothing is required, a misspelled key (`gravtiyScale`)
/// silently no-ops instead of erroring. Callers go through a fully-typed
/// TypeScript wrapper, which is where that class of typo is caught.
/// `deny_unknown_fields` is not an option here — it is incompatible with the
/// `#[serde(flatten)]` used by the `update_physics` payload.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PhysicsPatch {
    pub body_type: Option<RigidBodyKind>,
    pub collider_shape: Option<ColliderShape>,
    pub restitution: Option<f32>,
    pub friction: Option<f32>,
    pub density: Option<f32>,
    pub gravity_scale: Option<f32>,
    pub lock_translation_x: Option<bool>,
    pub lock_translation_y: Option<bool>,
    pub lock_translation_z: Option<bool>,
    pub lock_rotation_x: Option<bool>,
    pub lock_rotation_y: Option<bool>,
    pub lock_rotation_z: Option<bool>,
    pub is_sensor: Option<bool>,
}

impl PhysicsPatch {
    /// Merge this patch into `target`, overwriting only the fields it carries.
    ///
    /// A patch carrying all 13 fields is equivalent to a whole-struct
    /// assignment, so pre-existing full-payload callers are unaffected.
    pub fn apply_to(&self, target: &mut PhysicsData) {
        if let Some(body_type) = self.body_type.clone() {
            target.body_type = body_type;
        }
        if let Some(collider_shape) = self.collider_shape.clone() {
            target.collider_shape = collider_shape;
        }
        if let Some(restitution) = self.restitution {
            target.restitution = restitution;
        }
        if let Some(friction) = self.friction {
            target.friction = friction;
        }
        if let Some(density) = self.density {
            target.density = density;
        }
        if let Some(gravity_scale) = self.gravity_scale {
            target.gravity_scale = gravity_scale;
        }
        if let Some(lock_translation_x) = self.lock_translation_x {
            target.lock_translation_x = lock_translation_x;
        }
        if let Some(lock_translation_y) = self.lock_translation_y {
            target.lock_translation_y = lock_translation_y;
        }
        if let Some(lock_translation_z) = self.lock_translation_z {
            target.lock_translation_z = lock_translation_z;
        }
        if let Some(lock_rotation_x) = self.lock_rotation_x {
            target.lock_rotation_x = lock_rotation_x;
        }
        if let Some(lock_rotation_y) = self.lock_rotation_y {
            target.lock_rotation_y = lock_rotation_y;
        }
        if let Some(lock_rotation_z) = self.lock_rotation_z {
            target.lock_rotation_z = lock_rotation_z;
        }
        if let Some(is_sensor) = self.is_sensor {
            target.is_sensor = is_sensor;
        }
    }
}

/// Marker component: entity has active physics simulation enabled.
/// Separate from PhysicsData to allow toggling physics on/off without losing config.
#[derive(Component, Debug, Clone)]
pub struct PhysicsEnabled;

/// Resource controlling debug physics wireframe rendering.
#[derive(Resource, Debug, Clone, Default)]
pub struct DebugPhysicsEnabled(pub bool);

/// Joint type for connecting physics bodies.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JointType {
    Fixed,
    Revolute,
    Spherical,
    Prismatic,
    Rope,
    Spring,
}

/// Joint limits for constrained motion.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointLimits {
    pub min: f32,
    pub max: f32,
}

/// Joint motor configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointMotor {
    pub target_velocity: f32,
    pub max_force: f32,
}

/// Physics joint component (stored persistently on entities).
/// Connects this entity to another entity with physics constraints.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointData {
    pub joint_type: JointType,
    pub connected_entity_id: String,
    pub anchor_self: [f32; 3],
    pub anchor_other: [f32; 3],
    pub axis: [f32; 3],  // For revolute/prismatic
    pub limits: Option<JointLimits>,
    pub motor: Option<JointMotor>,
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

/// Entities that have physics enabled but no Rapier body attached yet.
type PhysicsAttachQuery<'w, 's> = Query<
    'w,
    's,
    (Entity, &'static PhysicsData, &'static Transform),
    (With<PhysicsEnabled>, Without<RigidBody>),
>;

/// Unified system managing the physics simulation lifecycle.
/// Handles Edit→Play (attach), Play→Edit (detach), and Paused states.
fn manage_physics_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    to_attach: PhysicsAttachQuery,
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
        && prev.is_none_or(|p| p == EngineMode::Edit);
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
              .insert(locked_axes)
              .insert(ActiveEvents::COLLISION_EVENTS);

            if physics_data.is_sensor {
                ec.insert(Sensor);
            }
        }
        tracing::info!("Physics attached: {} entities", to_attach.iter().count());
    }

    // Transition: Play/Paused → Edit (Stop) — remove all Rapier components
    let entering_edit = current == EngineMode::Edit
        && prev.is_some_and(|p| p != EngineMode::Edit);
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
                .remove::<ExternalImpulse>()
                .remove::<ActiveEvents>();
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

/// Unified system managing the joint lifecycle.
/// Handles Edit→Play (attach), Play→Edit (detach).
fn manage_joint_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    to_attach: Query<(Entity, &JointData), (Without<ImpulseJoint>,)>,
    to_detach: Query<Entity, With<ImpulseJoint>>,
    entity_id_query: Query<(Entity, &super::entity_id::EntityId)>,
    mut prev_mode: Local<Option<EngineMode>>,
) {
    let current = *engine_mode;
    let prev = *prev_mode;
    *prev_mode = Some(current);

    // Transition: Edit → Play — attach Rapier joints
    let entering_play = current == EngineMode::Play
        && prev.is_none_or(|p| p == EngineMode::Edit);
    if entering_play {
        for (entity, joint_data) in to_attach.iter() {
            // Resolve connected entity ID to Bevy Entity
            let connected_entity = entity_id_query
                .iter()
                .find(|(_, eid)| eid.0 == joint_data.connected_entity_id)
                .map(|(e, _)| e);

            let Some(connected_entity) = connected_entity else {
                tracing::warn!(
                    "Joint connected entity not found: {}",
                    joint_data.connected_entity_id
                );
                continue;
            };

            // Build the appropriate Rapier joint
            let anchor1 = Vec3::from(joint_data.anchor_self);
            let anchor2 = Vec3::from(joint_data.anchor_other);
            let axis = Vec3::from(joint_data.axis);

            let joint: TypedJoint = match &joint_data.joint_type {
                JointType::Fixed => {
                    FixedJointBuilder::new()
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
                JointType::Revolute => {
                    let mut builder = RevoluteJointBuilder::new(axis)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2);
                    if let Some(limits) = &joint_data.limits {
                        builder = builder.limits([limits.min, limits.max]);
                    }
                    if let Some(motor) = &joint_data.motor {
                        builder = builder
                            .motor_velocity(motor.target_velocity, 0.5)
                            .motor_max_force(motor.max_force);
                    }
                    builder.build().into()
                }
                JointType::Spherical => {
                    SphericalJointBuilder::new()
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
                JointType::Prismatic => {
                    let mut builder = PrismaticJointBuilder::new(axis)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2);
                    if let Some(limits) = &joint_data.limits {
                        builder = builder.limits([limits.min, limits.max]);
                    }
                    if let Some(motor) = &joint_data.motor {
                        builder = builder
                            .motor_velocity(motor.target_velocity, 0.5)
                            .motor_max_force(motor.max_force);
                    }
                    builder.build().into()
                }
                JointType::Rope => {
                    let max_distance = joint_data.limits.as_ref().map(|l| l.max).unwrap_or(1.0);
                    RopeJointBuilder::new(max_distance)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
                JointType::Spring => {
                    let rest_length = joint_data.limits.as_ref().map(|l| l.min).unwrap_or(1.0);
                    let stiffness = joint_data.motor.as_ref().map(|m| m.target_velocity).unwrap_or(1.0);
                    let damping = joint_data.motor.as_ref().map(|m| m.max_force).unwrap_or(0.1);
                    SpringJointBuilder::new(rest_length, stiffness, damping)
                        .local_anchor1(anchor1)
                        .local_anchor2(anchor2)
                        .build()
                        .into()
                }
            };

            commands.entity(entity).insert(ImpulseJoint::new(connected_entity, joint));
        }
        tracing::info!("Joints attached: {} joints", to_attach.iter().count());
    }

    // Transition: Play/Paused → Edit (Stop) — remove all ImpulseJoint components
    let entering_edit = current == EngineMode::Edit
        && prev.is_some_and(|p| p != EngineMode::Edit);
    if entering_edit {
        for entity in to_detach.iter() {
            commands.entity(entity).remove::<ImpulseJoint>();
        }
        tracing::info!("Joints detached");
    }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/// Physics plugin that integrates bevy_rapier3d with the editor's mode system.
pub struct PhysicsPlugin;

impl Plugin for PhysicsPlugin {
    fn build(&self, app: &mut App) {
        use super::engine_mode::PlaySystemSet;

        app.add_plugins(RapierPhysicsPlugin::<NoUserData>::default())
            .add_plugins(RapierDebugRenderPlugin::default())
            .init_resource::<DebugPhysicsEnabled>()
            .add_systems(Update, (
                manage_physics_lifecycle,
                sync_debug_physics,
            ))
            .add_systems(Update, manage_joint_lifecycle.in_set(PlaySystemSet));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The two physics enums get their `Default` from a `#[default]` variant
    /// attribute rather than a hand-written `impl`. That is terser but positional:
    /// moving the attribute to another variant silently changes what every
    /// `..Default::default()` in the codebase produces. Pin the values.
    #[test]
    fn enum_defaults_are_auto_and_dynamic() {
        assert_eq!(ColliderShape::default(), ColliderShape::Auto);
        assert_eq!(RigidBodyKind::default(), RigidBodyKind::Dynamic);
    }

    /// A `PhysicsData` whose every field differs from `PhysicsData::default()`,
    /// so a test that accidentally resets a field cannot pass by coincidence.
    fn seeded() -> PhysicsData {
        PhysicsData {
            body_type: RigidBodyKind::Fixed,
            collider_shape: ColliderShape::Capsule,
            restitution: 0.77,
            friction: 0.11,
            density: 4.25,
            gravity_scale: 2.5,
            lock_translation_x: true,
            lock_translation_y: true,
            lock_translation_z: true,
            lock_rotation_x: true,
            lock_rotation_y: true,
            lock_rotation_z: true,
            is_sensor: true,
        }
    }

    #[test]
    fn seeded_fixture_differs_from_default_in_every_field() {
        // Guards the other tests: if this ever overlaps with the defaults, a
        // "field untouched" assertion could pass for the wrong reason.
        let s = seeded();
        let d = PhysicsData::default();
        assert_ne!(s.body_type, d.body_type);
        assert_ne!(s.collider_shape, d.collider_shape);
        assert_ne!(s.restitution, d.restitution);
        assert_ne!(s.friction, d.friction);
        assert_ne!(s.density, d.density);
        assert_ne!(s.gravity_scale, d.gravity_scale);
        assert_ne!(s.lock_translation_x, d.lock_translation_x);
        assert_ne!(s.lock_translation_y, d.lock_translation_y);
        assert_ne!(s.lock_translation_z, d.lock_translation_z);
        assert_ne!(s.lock_rotation_x, d.lock_rotation_x);
        assert_ne!(s.lock_rotation_y, d.lock_rotation_y);
        assert_ne!(s.lock_rotation_z, d.lock_rotation_z);
        assert_ne!(s.is_sensor, d.is_sensor);
    }

    // === 1. Empty patch is a no-op ===

    #[test]
    fn empty_patch_leaves_every_field_untouched() {
        let mut target = seeded();
        PhysicsPatch::default().apply_to(&mut target);
        assert_eq!(target, seeded());
    }

    #[test]
    fn empty_json_object_deserializes_to_an_all_none_patch() {
        let patch: PhysicsPatch = serde_json::from_value(json!({})).expect("empty object must parse");
        let mut target = seeded();
        patch.apply_to(&mut target);
        assert_eq!(target, seeded());
    }

    // === 2. Single-field patches touch exactly one field ===

    #[test]
    fn single_field_patch_changes_only_that_field() {
        // gravityScale is the field `applyPhysicsProfile` actually sends.
        let mut target = seeded();
        let patch = PhysicsPatch {
            gravity_scale: Some(0.25),
            ..Default::default()
        };
        patch.apply_to(&mut target);

        let mut expected = seeded();
        expected.gravity_scale = 0.25;
        assert_eq!(target, expected);
    }

    #[test]
    fn single_field_patch_never_resets_body_type_to_default() {
        // The regression that made a web-side "fill in the other 12 from
        // defaults" workaround unacceptable: a Fixed platform must stay Fixed.
        let mut target = seeded();
        assert_eq!(target.body_type, RigidBodyKind::Fixed);
        PhysicsPatch { friction: Some(0.9), ..Default::default() }.apply_to(&mut target);
        assert_eq!(target.body_type, RigidBodyKind::Fixed);
        assert_ne!(target.body_type, PhysicsData::default().body_type);
    }

    #[test]
    fn every_single_field_patch_changes_exactly_its_own_field() {
        // One case per field — a patch that writes the DEFAULT value over the
        // seeded value, so an accidental cross-field write is visible.
        let d = PhysicsData::default();

        macro_rules! case {
            ($field:ident, $patch:expr) => {{
                let mut target = seeded();
                let patch: PhysicsPatch = $patch;
                patch.apply_to(&mut target);
                let mut expected = seeded();
                expected.$field = d.$field.clone();
                assert_eq!(
                    target,
                    expected,
                    concat!("patching ", stringify!($field), " changed another field")
                );
            }};
        }

        case!(body_type, PhysicsPatch { body_type: Some(d.body_type.clone()), ..Default::default() });
        case!(collider_shape, PhysicsPatch { collider_shape: Some(d.collider_shape.clone()), ..Default::default() });
        case!(restitution, PhysicsPatch { restitution: Some(d.restitution), ..Default::default() });
        case!(friction, PhysicsPatch { friction: Some(d.friction), ..Default::default() });
        case!(density, PhysicsPatch { density: Some(d.density), ..Default::default() });
        case!(gravity_scale, PhysicsPatch { gravity_scale: Some(d.gravity_scale), ..Default::default() });
        case!(lock_translation_x, PhysicsPatch { lock_translation_x: Some(d.lock_translation_x), ..Default::default() });
        case!(lock_translation_y, PhysicsPatch { lock_translation_y: Some(d.lock_translation_y), ..Default::default() });
        case!(lock_translation_z, PhysicsPatch { lock_translation_z: Some(d.lock_translation_z), ..Default::default() });
        case!(lock_rotation_x, PhysicsPatch { lock_rotation_x: Some(d.lock_rotation_x), ..Default::default() });
        case!(lock_rotation_y, PhysicsPatch { lock_rotation_y: Some(d.lock_rotation_y), ..Default::default() });
        case!(lock_rotation_z, PhysicsPatch { lock_rotation_z: Some(d.lock_rotation_z), ..Default::default() });
        case!(is_sensor, PhysicsPatch { is_sensor: Some(d.is_sensor), ..Default::default() });
    }

    // === 3. A full 13-field patch still sets all 13 (existing-caller guarantee) ===

    #[test]
    fn full_patch_sets_all_thirteen_fields() {
        let mut target = PhysicsData::default();
        let s = seeded();
        let patch = PhysicsPatch {
            body_type: Some(s.body_type.clone()),
            collider_shape: Some(s.collider_shape.clone()),
            restitution: Some(s.restitution),
            friction: Some(s.friction),
            density: Some(s.density),
            gravity_scale: Some(s.gravity_scale),
            lock_translation_x: Some(s.lock_translation_x),
            lock_translation_y: Some(s.lock_translation_y),
            lock_translation_z: Some(s.lock_translation_z),
            lock_rotation_x: Some(s.lock_rotation_x),
            lock_rotation_y: Some(s.lock_rotation_y),
            lock_rotation_z: Some(s.lock_rotation_z),
            is_sensor: Some(s.is_sensor),
        };
        patch.apply_to(&mut target);
        assert_eq!(target, seeded());
    }

    #[test]
    fn full_camel_case_json_payload_sets_all_thirteen_fields() {
        // The wire shape every pre-existing caller sends — must be unaffected.
        let patch: PhysicsPatch = serde_json::from_value(json!({
            "bodyType": "fixed",
            "colliderShape": "capsule",
            "restitution": 0.77,
            "friction": 0.11,
            "density": 4.25,
            "gravityScale": 2.5,
            "lockTranslationX": true,
            "lockTranslationY": true,
            "lockTranslationZ": true,
            "lockRotationX": true,
            "lockRotationY": true,
            "lockRotationZ": true,
            "isSensor": true
        }))
        .expect("full camelCase payload must parse");

        let mut target = PhysicsData::default();
        patch.apply_to(&mut target);
        assert_eq!(target, seeded());
    }

    // === 4. Partial camelCase JSON — the case that used to be a hard error ===

    #[test]
    fn partial_camel_case_json_yields_some_for_exactly_those_fields() {
        let patch: PhysicsPatch =
            serde_json::from_value(json!({ "gravityScale": 0.5, "friction": 0.9 }))
                .expect("partial payload must parse (this used to be a hard error)");

        assert_eq!(patch.gravity_scale, Some(0.5));
        assert_eq!(patch.friction, Some(0.9));

        assert!(patch.body_type.is_none());
        assert!(patch.collider_shape.is_none());
        assert!(patch.restitution.is_none());
        assert!(patch.density.is_none());
        assert!(patch.lock_translation_x.is_none());
        assert!(patch.lock_translation_y.is_none());
        assert!(patch.lock_translation_z.is_none());
        assert!(patch.lock_rotation_x.is_none());
        assert!(patch.lock_rotation_y.is_none());
        assert!(patch.lock_rotation_z.is_none());
        assert!(patch.is_sensor.is_none());
    }

    #[test]
    fn applying_the_physics_feel_profile_shape_preserves_the_other_ten_fields() {
        // Exactly what `applyPhysicsProfile` sends: gravityScale + friction + restitution.
        let patch: PhysicsPatch = serde_json::from_value(json!({
            "gravityScale": 0.5,
            "friction": 0.9,
            "restitution": 0.2
        }))
        .expect("physics-feel payload must parse");

        let mut target = seeded();
        patch.apply_to(&mut target);

        let mut expected = seeded();
        expected.gravity_scale = 0.5;
        expected.friction = 0.9;
        expected.restitution = 0.2;
        assert_eq!(target, expected);
    }

    // === 5. Enum fields round-trip through their snake_case serde form ===

    #[test]
    fn body_type_round_trips_through_snake_case() {
        for (wire, expected) in [
            ("dynamic", RigidBodyKind::Dynamic),
            ("fixed", RigidBodyKind::Fixed),
            ("kinematic_position", RigidBodyKind::KinematicPosition),
            ("kinematic_velocity", RigidBodyKind::KinematicVelocity),
        ] {
            let patch: PhysicsPatch = serde_json::from_value(json!({ "bodyType": wire }))
                .unwrap_or_else(|e| panic!("bodyType {wire} must parse: {e}"));
            assert_eq!(patch.body_type, Some(expected.clone()), "bodyType {wire}");

            let mut target = seeded();
            patch.apply_to(&mut target);
            assert_eq!(target.body_type, expected);

            // Serializing PhysicsData must emit the same wire token back.
            assert_eq!(
                serde_json::to_value(&target).expect("PhysicsData serializes")["bodyType"],
                json!(wire)
            );
        }
    }

    #[test]
    fn collider_shape_round_trips_through_snake_case() {
        for (wire, expected) in [
            ("cuboid", ColliderShape::Cuboid),
            ("ball", ColliderShape::Ball),
            ("cylinder", ColliderShape::Cylinder),
            ("capsule", ColliderShape::Capsule),
            ("auto", ColliderShape::Auto),
        ] {
            let patch: PhysicsPatch = serde_json::from_value(json!({ "colliderShape": wire }))
                .unwrap_or_else(|e| panic!("colliderShape {wire} must parse: {e}"));
            assert_eq!(patch.collider_shape, Some(expected.clone()), "colliderShape {wire}");

            let mut target = seeded();
            patch.apply_to(&mut target);
            assert_eq!(target.collider_shape, expected);

            assert_eq!(
                serde_json::to_value(&target).expect("PhysicsData serializes")["colliderShape"],
                json!(wire)
            );
        }
    }

    #[test]
    fn unknown_enum_token_is_still_rejected() {
        // All-Option fields relax MISSING keys, not INVALID values.
        let err = serde_json::from_value::<PhysicsPatch>(json!({ "bodyType": "not_a_body_type" }));
        assert!(err.is_err(), "an unknown bodyType token must not silently parse");
    }

    #[test]
    fn wrong_typed_value_is_still_rejected() {
        let err = serde_json::from_value::<PhysicsPatch>(json!({ "friction": "slippery" }));
        assert!(err.is_err(), "a non-numeric friction must not silently parse");
    }

    #[test]
    fn explicit_null_is_treated_as_absent() {
        // `Option<T>` accepts JSON null as None; that must mean "leave alone",
        // never "reset to default".
        let patch: PhysicsPatch = serde_json::from_value(json!({ "friction": null }))
            .expect("explicit null must parse");
        assert!(patch.friction.is_none());

        let mut target = seeded();
        patch.apply_to(&mut target);
        assert_eq!(target, seeded());
    }
}
