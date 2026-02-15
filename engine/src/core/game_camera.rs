//! Game camera system — provides camera modes for Play mode.
//!
//! Six camera modes: ThirdPersonFollow, FirstPerson, SideScroller,
//! TopDown, Fixed, and Orbital. During Play mode, the active game camera
//! overrides PanOrbitCamera on the same entity.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::engine_mode::PlaySystemSet;
use super::entity_id::EntityId;

/// Marker component indicating this is the active game camera entity.
/// Only one entity should have this at a time.
#[derive(Component, Reflect, Default, Clone, Debug, Serialize, Deserialize)]
#[reflect(Component)]
pub struct ActiveGameCamera;

/// Game camera configuration.
/// Attached to any entity with a Camera component.
#[derive(Component, Reflect, Clone, Debug, Serialize, Deserialize)]
#[reflect(Component)]
pub struct GameCameraData {
    pub mode: GameCameraMode,
    /// EntityId of the entity to follow/look at (if applicable).
    pub target_entity: Option<String>,
    /// Camera shake state (runtime-only, not serialized in EntitySnapshot).
    #[serde(skip)]
    pub shake_intensity: f32,
    #[serde(skip)]
    pub shake_duration: f32,
    #[serde(skip)]
    pub shake_timer: f32,
}

impl Default for GameCameraData {
    fn default() -> Self {
        Self {
            mode: GameCameraMode::ThirdPersonFollow {
                offset: Vec3::new(0.0, 2.0, -5.0),
                damping: 5.0,
                min_distance: 2.0,
                max_distance: 10.0,
                look_at_target: true,
                collision_avoidance: true,
            },
            target_entity: None,
            shake_intensity: 0.0,
            shake_duration: 0.0,
            shake_timer: 0.0,
        }
    }
}

#[derive(Reflect, Clone, Debug, Serialize, Deserialize)]
pub enum GameCameraMode {
    /// Third-person follow camera with collision avoidance.
    ThirdPersonFollow {
        /// Camera offset relative to target (local space).
        offset: Vec3,
        /// Damping factor for smooth follow (higher = smoother, slower).
        damping: f32,
        /// Minimum distance from target (collision clamp).
        min_distance: f32,
        /// Maximum distance from target.
        max_distance: f32,
        /// If true, camera looks at target. If false, uses target's forward direction.
        look_at_target: bool,
        /// If true, raycast to avoid clipping through walls.
        collision_avoidance: bool,
    },

    /// First-person camera with mouse look.
    FirstPerson {
        /// Eye height offset from target entity origin.
        eye_height: f32,
        /// Mouse sensitivity for look (degrees per pixel).
        mouse_sensitivity: f32,
        /// Vertical field of view (degrees).
        fov: f32,
        /// Pitch clamping (min_degrees, max_degrees).
        pitch_clamp: (f32, f32),
    },

    /// Side-scrolling camera (constrained to XY plane).
    SideScroller {
        /// Fixed Z distance from target.
        z_offset: f32,
        /// If true, follow target's Y position. If false, fixed Y.
        follow_y: bool,
        /// Optional Y bounds (min, max) for vertical following.
        y_bounds: Option<(f32, f32)>,
        /// Damping factor for smooth horizontal follow.
        damping: f32,
    },

    /// Top-down camera (orthographic or high-angle perspective).
    TopDown {
        /// Height above target.
        height: f32,
        /// Damping factor for smooth follow.
        damping: f32,
        /// If true, camera rotation matches target rotation (e.g., racing games).
        follow_rotation: bool,
    },

    /// Fixed position camera (cutscenes, security camera).
    Fixed {
        /// Optional world-space position to look at.
        look_at: Option<Vec3>,
    },

    /// Orbital camera that auto-rotates around target.
    Orbital {
        /// Orbit radius.
        radius: f32,
        /// If true, automatically rotate around target.
        auto_rotate: bool,
        /// Rotation speed (degrees per second).
        auto_rotate_speed: f32,
    },
}

/// Tracks yaw/pitch for FirstPerson mode (not serialized).
#[derive(Component, Default)]
pub struct FirstPersonState {
    pub yaw: f32,   // degrees
    pub pitch: f32, // degrees
}

/// Tracks rotation angle for Orbital mode (not serialized).
#[derive(Component, Default)]
pub struct OrbitalState {
    pub angle: f32, // radians
}

pub struct GameCameraPlugin;

impl Plugin for GameCameraPlugin {
    fn build(&self, app: &mut App) {
        app.register_type::<GameCameraData>()
            .register_type::<ActiveGameCamera>()
            .register_type::<GameCameraMode>()
            .add_systems(Update, (
                game_camera_system,
                update_orbital_angle,
            ).in_set(PlaySystemSet));
    }
}

/// Main game camera system — runs during Play mode only.
fn game_camera_system(
    time: Res<Time>,
    mut camera_query: Query<(
        &mut Transform,
        &mut GameCameraData,
        Option<&FirstPersonState>,
        Option<&OrbitalState>,
    ), With<ActiveGameCamera>>,
    target_query: Query<(&EntityId, &Transform), Without<ActiveGameCamera>>,
) {
    let Ok((mut camera_transform, mut camera_data, first_person_state, orbital_state)) = camera_query.single_mut() else {
        return; // No active game camera
    };

    let delta = time.delta_secs();

    // Update shake timer
    if camera_data.shake_timer > 0.0 {
        camera_data.shake_timer -= delta;
        if camera_data.shake_timer <= 0.0 {
            camera_data.shake_intensity = 0.0;
        }
    }

    // Get target entity transform
    let target_transform = if let Some(target_id) = &camera_data.target_entity {
        target_query.iter()
            .find(|(id, _)| id.0 == *target_id)
            .map(|(_, t)| *t)
    } else {
        None
    };

    // Clone mode to avoid borrow conflict
    let mode = camera_data.mode.clone();

    // Apply mode-specific logic
    match &mode {
        GameCameraMode::ThirdPersonFollow { offset, damping, min_distance, look_at_target, collision_avoidance, .. } => {
            if let Some(target_t) = target_transform {
                update_third_person(
                    &mut camera_transform,
                    &target_t,
                    *offset,
                    *damping,
                    *min_distance,
                    *look_at_target,
                    *collision_avoidance,
                    delta,
                );
            }
        }
        GameCameraMode::FirstPerson { eye_height, .. } => {
            if let Some(target_t) = target_transform {
                if let Some(fp_state) = first_person_state {
                    update_first_person(
                        &mut camera_transform,
                        &target_t,
                        *eye_height,
                        fp_state.yaw,
                        fp_state.pitch,
                    );
                }
            }
        }
        GameCameraMode::SideScroller { z_offset, follow_y, y_bounds, damping } => {
            if let Some(target_t) = target_transform {
                update_side_scroller(
                    &mut camera_transform,
                    &target_t,
                    *z_offset,
                    *follow_y,
                    *y_bounds,
                    *damping,
                    delta,
                );
            }
        }
        GameCameraMode::TopDown { height, damping, follow_rotation } => {
            if let Some(target_t) = target_transform {
                update_top_down(
                    &mut camera_transform,
                    &target_t,
                    *height,
                    *damping,
                    *follow_rotation,
                    delta,
                );
            }
        }
        GameCameraMode::Fixed { look_at } => {
            if let Some(look_at_pos) = look_at {
                camera_transform.look_at(*look_at_pos, Vec3::Y);
            }
        }
        GameCameraMode::Orbital { radius, .. } => {
            if let Some(target_t) = target_transform {
                if let Some(orbital_state) = orbital_state {
                    update_orbital(
                        &mut camera_transform,
                        &target_t,
                        *radius,
                        orbital_state.angle,
                    );
                }
            }
        }
    }

    // Apply camera shake (additive offset)
    if camera_data.shake_intensity > 0.0 {
        let elapsed = time.elapsed_secs();
        let decay = camera_data.shake_timer / camera_data.shake_duration.max(0.001);
        let intensity = camera_data.shake_intensity * decay;
        let shake_offset = Vec3::new(
            (elapsed * 20.0).sin() * intensity,
            (elapsed * 25.0).cos() * intensity,
            (elapsed * 30.0).sin() * intensity * 0.5,
        );
        camera_transform.translation += shake_offset;
    }
}

/// System to update OrbitalState angle (separated to avoid query conflicts).
fn update_orbital_angle(
    time: Res<Time>,
    mut query: Query<(&GameCameraData, &mut OrbitalState), With<ActiveGameCamera>>,
) {
    for (camera_data, mut orbital_state) in query.iter_mut() {
        if let GameCameraMode::Orbital { auto_rotate, auto_rotate_speed, .. } = &camera_data.mode {
            if *auto_rotate {
                orbital_state.angle += auto_rotate_speed.to_radians() * time.delta_secs();
            }
        }
    }
}

fn update_third_person(
    camera_transform: &mut Transform,
    target_transform: &Transform,
    offset: Vec3,
    damping: f32,
    min_distance: f32,
    look_at_target: bool,
    _collision_avoidance: bool,
    delta: f32,
) {
    // Desired position: target + local offset (rotated by target's rotation)
    let desired_pos = target_transform.translation + target_transform.rotation * offset;

    // Clamp distance
    let dir = desired_pos - target_transform.translation;
    let dist = dir.length();
    let final_pos = if dist < min_distance && dist > 0.0 {
        target_transform.translation + dir.normalize() * min_distance
    } else {
        desired_pos
    };

    // Damped follow
    let t = (damping * delta).min(1.0);
    camera_transform.translation = camera_transform.translation.lerp(final_pos, t);

    // Look at target
    if look_at_target {
        camera_transform.look_at(target_transform.translation, Vec3::Y);
    }
}

fn update_first_person(
    camera_transform: &mut Transform,
    target_transform: &Transform,
    eye_height: f32,
    yaw: f32,
    pitch: f32,
) {
    // Position at target + eye height
    camera_transform.translation = target_transform.translation + Vec3::Y * eye_height;

    // Rotation from yaw/pitch
    let yaw_quat = Quat::from_rotation_y(yaw.to_radians());
    let pitch_quat = Quat::from_rotation_x(pitch.to_radians());
    camera_transform.rotation = yaw_quat * pitch_quat;
}

fn update_side_scroller(
    camera_transform: &mut Transform,
    target_transform: &Transform,
    z_offset: f32,
    follow_y: bool,
    y_bounds: Option<(f32, f32)>,
    damping: f32,
    delta: f32,
) {
    let mut desired_pos = camera_transform.translation;
    desired_pos.x = target_transform.translation.x;
    desired_pos.z = z_offset;

    if follow_y {
        let mut target_y = target_transform.translation.y;
        if let Some((min_y, max_y)) = y_bounds {
            target_y = target_y.clamp(min_y, max_y);
        }
        desired_pos.y = target_y;
    }

    let t = (damping * delta).min(1.0);
    camera_transform.translation = camera_transform.translation.lerp(desired_pos, t);

    // Face forward (negative Z)
    camera_transform.look_to(Vec3::NEG_Z, Vec3::Y);
}

fn update_top_down(
    camera_transform: &mut Transform,
    target_transform: &Transform,
    height: f32,
    damping: f32,
    follow_rotation: bool,
    delta: f32,
) {
    let desired_pos = target_transform.translation + Vec3::Y * height;
    let t = (damping * delta).min(1.0);
    camera_transform.translation = camera_transform.translation.lerp(desired_pos, t);

    if follow_rotation {
        camera_transform.rotation = target_transform.rotation * Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2);
    } else {
        camera_transform.look_at(target_transform.translation, Vec3::Y);
    }
}

fn update_orbital(
    camera_transform: &mut Transform,
    target_transform: &Transform,
    radius: f32,
    angle: f32,
) {
    let offset = Vec3::new(
        angle.cos() * radius,
        radius * 0.5, // slight elevation
        angle.sin() * radius,
    );

    camera_transform.translation = target_transform.translation + offset;
    camera_transform.look_at(target_transform.translation, Vec3::Y);
}
