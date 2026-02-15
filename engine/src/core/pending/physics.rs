//! Physics 3D and 2D pending commands.

use super::PendingCommands;
use crate::core::physics::{JointData, JointLimits, JointMotor, JointType, PhysicsData};
use crate::core::physics_2d::{Physics2dData, PhysicsJoint2d};

// === 3D Physics Request Structs ===

#[derive(Debug, Clone)]
pub struct PhysicsUpdate {
    pub entity_id: String,
    pub physics_data: PhysicsData,
}

#[derive(Debug, Clone)]
pub struct PhysicsToggle {
    pub entity_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct DebugPhysicsToggle;

#[derive(Debug, Clone)]
pub struct CreateJointRequest {
    pub entity_id: String,
    pub joint_data: JointData,
}

#[derive(Debug, Clone)]
pub struct UpdateJointRequest {
    pub entity_id: String,
    pub joint_type: Option<JointType>,
    pub connected_entity_id: Option<String>,
    pub anchor_self: Option<[f32; 3]>,
    pub anchor_other: Option<[f32; 3]>,
    pub axis: Option<[f32; 3]>,
    pub limits: Option<Option<JointLimits>>,
    pub motor: Option<Option<JointMotor>>,
}

#[derive(Debug, Clone)]
pub struct RemoveJointRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct ForceApplication {
    pub entity_id: String,
    pub force: [f32; 3],
    pub torque: [f32; 3],
    pub is_impulse: bool,
}

#[derive(Debug, Clone)]
pub struct RaycastRequest {
    pub request_id: String,
    pub origin: [f32; 3],
    pub direction: [f32; 3],
    pub max_distance: f32,
}

// === 2D Physics Request Structs ===

#[derive(Debug, Clone)]
pub struct Physics2dUpdate {
    pub entity_id: String,
    pub physics_data: Physics2dData,
}

#[derive(Debug, Clone)]
pub struct Physics2dToggle {
    pub entity_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct CreateJoint2dRequest {
    pub entity_id: String,
    pub joint_data: PhysicsJoint2d,
}

#[derive(Debug, Clone)]
pub struct RemoveJoint2dRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct ForceApplication2d {
    pub entity_id: String,
    pub force_x: f32,
    pub force_y: f32,
}

#[derive(Debug, Clone)]
pub struct ImpulseApplication2d {
    pub entity_id: String,
    pub impulse_x: f32,
    pub impulse_y: f32,
}

#[derive(Debug, Clone)]
pub struct Raycast2dRequest {
    pub origin_x: f32,
    pub origin_y: f32,
    pub dir_x: f32,
    pub dir_y: f32,
    pub max_distance: f32,
}

#[derive(Debug, Clone)]
pub struct Gravity2dUpdate {
    pub gravity_x: f32,
    pub gravity_y: f32,
}

#[derive(Debug, Clone)]
pub struct DebugPhysics2dToggle {
    pub enabled: bool,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_physics_update(&mut self, update: PhysicsUpdate) {
        self.physics_updates.push(update);
    }

    pub fn queue_physics_toggle(&mut self, toggle: PhysicsToggle) {
        self.physics_toggles.push(toggle);
    }

    pub fn queue_debug_physics_toggle(&mut self) {
        self.debug_physics_toggles.push(DebugPhysicsToggle);
    }

    pub fn queue_create_joint(&mut self, request: CreateJointRequest) {
        self.create_joint_requests.push(request);
    }

    pub fn queue_update_joint(&mut self, request: UpdateJointRequest) {
        self.update_joint_requests.push(request);
    }

    pub fn queue_remove_joint(&mut self, request: RemoveJointRequest) {
        self.remove_joint_requests.push(request);
    }

    pub fn queue_force_application(&mut self, application: ForceApplication) {
        self.force_applications.push(application);
    }

    pub fn queue_raycast(&mut self, request: RaycastRequest) {
        self.raycast_requests.push(request);
    }

    pub fn queue_physics2d_update(&mut self, update: Physics2dUpdate) {
        self.physics2d_updates.push(update);
    }

    pub fn queue_physics2d_toggle(&mut self, toggle: Physics2dToggle) {
        self.physics2d_toggles.push(toggle);
    }

    pub fn queue_create_joint2d(&mut self, request: CreateJoint2dRequest) {
        self.create_joint2d_requests.push(request);
    }

    pub fn queue_remove_joint2d(&mut self, request: RemoveJoint2dRequest) {
        self.remove_joint2d_requests.push(request);
    }

    pub fn queue_force_application2d(&mut self, application: ForceApplication2d) {
        self.force_applications2d.push(application);
    }

    pub fn queue_impulse_application2d(&mut self, application: ImpulseApplication2d) {
        self.impulse_applications2d.push(application);
    }

    pub fn queue_raycast2d(&mut self, request: Raycast2dRequest) {
        self.raycast2d_requests.push(request);
    }

    pub fn queue_gravity2d_update(&mut self, update: Gravity2dUpdate) {
        self.gravity2d_updates.push(update);
    }

    pub fn queue_debug_physics2d_toggle(&mut self, toggle: DebugPhysics2dToggle) {
        self.debug_physics2d_toggles.push(toggle);
    }
}

// === Bridge Functions ===

pub fn queue_physics_update_from_bridge(update: PhysicsUpdate) -> bool {
    super::with_pending(|pc| pc.queue_physics_update(update)).is_some()
}

pub fn queue_physics_toggle_from_bridge(toggle: PhysicsToggle) -> bool {
    super::with_pending(|pc| pc.queue_physics_toggle(toggle)).is_some()
}

pub fn queue_debug_physics_toggle_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_debug_physics_toggle()).is_some()
}

pub fn queue_create_joint_from_bridge(request: CreateJointRequest) -> bool {
    super::with_pending(|pc| pc.queue_create_joint(request)).is_some()
}

pub fn queue_update_joint_from_bridge(request: UpdateJointRequest) -> bool {
    super::with_pending(|pc| pc.queue_update_joint(request)).is_some()
}

pub fn queue_remove_joint_from_bridge(request: RemoveJointRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_joint(request)).is_some()
}

pub fn queue_force_application_from_bridge(application: ForceApplication) -> bool {
    super::with_pending(|pc| pc.queue_force_application(application)).is_some()
}

pub fn queue_raycast_from_bridge(request: RaycastRequest) -> bool {
    super::with_pending(|pc| pc.queue_raycast(request)).is_some()
}

pub fn queue_physics2d_update_from_bridge(update: Physics2dUpdate) -> bool {
    super::with_pending(|pc| pc.queue_physics2d_update(update)).is_some()
}

pub fn queue_physics2d_toggle_from_bridge(toggle: Physics2dToggle) -> bool {
    super::with_pending(|pc| pc.queue_physics2d_toggle(toggle)).is_some()
}

pub fn queue_create_joint2d_from_bridge(request: CreateJoint2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_create_joint2d(request)).is_some()
}

pub fn queue_remove_joint2d_from_bridge(request: RemoveJoint2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_joint2d(request)).is_some()
}

pub fn queue_force_application2d_from_bridge(application: ForceApplication2d) -> bool {
    super::with_pending(|pc| pc.queue_force_application2d(application)).is_some()
}

pub fn queue_impulse_application2d_from_bridge(application: ImpulseApplication2d) -> bool {
    super::with_pending(|pc| pc.queue_impulse_application2d(application)).is_some()
}

pub fn queue_raycast2d_from_bridge(request: Raycast2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_raycast2d(request)).is_some()
}

pub fn queue_gravity2d_update_from_bridge(update: Gravity2dUpdate) -> bool {
    super::with_pending(|pc| pc.queue_gravity2d_update(update)).is_some()
}

pub fn queue_debug_physics2d_toggle_from_bridge(toggle: DebugPhysics2dToggle) -> bool {
    super::with_pending(|pc| pc.queue_debug_physics2d_toggle(toggle)).is_some()
}
