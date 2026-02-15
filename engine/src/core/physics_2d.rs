//! 2D Physics Components
//!
//! Rapier 2D physics data structures for 2D projects.
//! Architecture mirrors physics.rs for consistency.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Main physics configuration for a 2D entity
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct Physics2dData {
    pub body_type: BodyType2d,
    pub collider_shape: ColliderShape2d,
    /// Width and height for box/capsule
    pub size: [f32; 2],
    /// Radius for circle/capsule
    pub radius: f32,
    /// Vertices for polygon (max 8 for perf)
    pub vertices: Vec<[f32; 2]>,
    /// Mass (dynamic bodies only)
    pub mass: f32,
    /// Surface friction (0-2)
    pub friction: f32,
    /// Bounciness (0-1)
    pub restitution: f32,
    /// Gravity multiplier
    pub gravity_scale: f32,
    /// Trigger volume (no collision response)
    pub is_sensor: bool,
    /// Prevent rotation
    pub lock_rotation: bool,
    /// Continuous collision detection for fast objects
    pub continuous_detection: bool,
    /// Platform that only collides from above
    pub one_way_platform: bool,
    /// Conveyor belt velocity (static bodies only)
    pub surface_velocity: [f32; 2],
}

impl Default for Physics2dData {
    fn default() -> Self {
        Self {
            body_type: BodyType2d::Dynamic,
            collider_shape: ColliderShape2d::Box,
            size: [1.0, 1.0],
            radius: 0.5,
            vertices: vec![],
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
            gravity_scale: 1.0,
            is_sensor: false,
            lock_rotation: false,
            continuous_detection: false,
            one_way_platform: false,
            surface_velocity: [0.0, 0.0],
        }
    }
}

/// Rigid body type
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BodyType2d {
    Dynamic,
    Static,
    Kinematic,
}

/// Collider shape type
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ColliderShape2d {
    Box,
    Circle,
    Capsule,
    ConvexPolygon,
    Edge,
    Auto,
}

/// Marker component indicating 2D physics is active on this entity
#[derive(Component)]
pub struct Physics2dEnabled;

/// 2D Joint connecting two entities
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct PhysicsJoint2d {
    pub target_entity_id: u32,
    pub joint_type: JointType2d,
    pub local_anchor1: [f32; 2],
    pub local_anchor2: [f32; 2],
}

/// Joint type variants with type-specific data
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum JointType2d {
    Revolute {
        limits: Option<(f32, f32)>,
        motor_velocity: f32,
        motor_max_force: f32,
    },
    Prismatic {
        axis: [f32; 2],
        limits: Option<(f32, f32)>,
        motor_velocity: f32,
        motor_max_force: f32,
    },
    Rope {
        max_distance: f32,
    },
    Spring {
        rest_length: f32,
        stiffness: f32,
        damping: f32,
    },
}

impl Default for PhysicsJoint2d {
    fn default() -> Self {
        Self {
            target_entity_id: 0,
            joint_type: JointType2d::Revolute {
                limits: None,
                motor_velocity: 0.0,
                motor_max_force: 0.0,
            },
            local_anchor1: [0.0, 0.0],
            local_anchor2: [0.0, 0.0],
        }
    }
}
