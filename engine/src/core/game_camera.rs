//! Game camera system — provides camera modes for Play mode.
//!
//! Six camera modes: ThirdPersonFollow, FirstPerson, SideScroller,
//! TopDown, Fixed, and Orbital. During Play mode, the active game camera
//! overrides PanOrbitCamera on the same entity.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::engine_mode::PlaySystemSet;
use super::entity_id::EntityId;
use super::pending_commands::PendingCommands;

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

// `PartialEq` is what lets the flat-wire round trip be asserted directly (see `flat_wire_tests`).
// Every field is a plain `f32`/`bool`/`Vec3`, and the f32 -> JSON -> f32 direction is lossless, so
// mode equality is an exact check. (The reverse is not: a literal like `1.9` does not survive f64 ->
// f32 unchanged, which is why the tests compare wire values at f32 precision rather than by bytes.)
#[derive(Reflect, Clone, Debug, PartialEq, Serialize, Deserialize)]
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

/// Read an optional `f32` from a flat command payload.
///
/// An absent (or explicitly null) key takes the variant's default. A key that is present but
/// not a number is an error rather than a silent fall back — `dispatchCommand` returns void,
/// so a rejected error message is the only signal a caller who mistyped a parameter will get.
fn flat_f32(params: &serde_json::Value, key: &str, default: f32) -> Result<f32, String> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => Ok(default),
        Some(v) => v
            .as_f64()
            .map(|n| n as f32)
            .ok_or_else(|| format!("`{}` must be a number", key)),
    }
}

/// Read an optional `bool` from a flat command payload. Same absent/wrong-type contract as [`flat_f32`].
fn flat_bool(params: &serde_json::Value, key: &str, default: bool) -> Result<bool, String> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => Ok(default),
        Some(v) => v
            .as_bool()
            .ok_or_else(|| format!("`{}` must be a boolean", key)),
    }
}

/// Read an optional fixed-length numeric array (`offset: [x, y, z]`, `pitchClamp: [min, max]`).
///
/// Returns `None` when absent so each call site can apply its own default. A wrong length is an
/// error: silently padding or truncating would let `offset: [0, 2]` configure a camera the
/// caller never asked for.
fn flat_numbers<const N: usize>(
    params: &serde_json::Value,
    key: &str,
) -> Result<Option<[f32; N]>, String> {
    let Some(v) = params.get(key) else {
        return Ok(None);
    };
    if v.is_null() {
        return Ok(None);
    }
    let arr = v
        .as_array()
        .ok_or_else(|| format!("`{}` must be an array of {} numbers", key, N))?;
    if arr.len() != N {
        return Err(format!(
            "`{}` must be an array of {} numbers, got {}",
            key,
            N,
            arr.len()
        ));
    }
    let mut out = [0.0f32; N];
    for (i, item) in arr.iter().enumerate() {
        out[i] = item
            .as_f64()
            .ok_or_else(|| format!("`{}[{}]` must be a number", key, i))? as f32;
    }
    Ok(Some(out))
}

impl GameCameraMode {
    /// Every mode discriminator the flat wire form accepts, in declaration order.
    pub const FLAT_MODES: [&'static str; 6] = [
        "thirdPersonFollow",
        "firstPerson",
        "sideScroller",
        "topDown",
        "fixed",
        "orbital",
    ];

    /// Build a mode from the flat wire form: a `mode` discriminator string plus sibling params.
    ///
    /// This enum is externally tagged with struct variants, and `GameCameraData` is persisted
    /// into `.forge` scene files — so its serde representation is load-bearing and must not be
    /// retagged to match the wire. The translation lives here, at the command boundary, and
    /// [`to_flat`](Self::to_flat) is its inverse for the event and query paths.
    ///
    /// Every parameter is optional and falls back to this variant's default, so a bare
    /// `{"mode": "topDown"}` is a complete, valid payload.
    pub fn from_flat(mode: &str, params: &serde_json::Value) -> Result<Self, String> {
        match mode {
            "thirdPersonFollow" => Ok(Self::ThirdPersonFollow {
                offset: flat_numbers::<3>(params, "offset")?
                    .map(Vec3::from)
                    .unwrap_or(Vec3::new(0.0, 2.0, -5.0)),
                damping: flat_f32(params, "damping", 5.0)?,
                min_distance: flat_f32(params, "minDistance", 2.0)?,
                max_distance: flat_f32(params, "maxDistance", 10.0)?,
                look_at_target: flat_bool(params, "lookAtTarget", true)?,
                collision_avoidance: flat_bool(params, "collisionAvoidance", true)?,
            }),
            "firstPerson" => Ok(Self::FirstPerson {
                eye_height: flat_f32(params, "eyeHeight", 1.7)?,
                mouse_sensitivity: flat_f32(params, "mouseSensitivity", 0.1)?,
                fov: flat_f32(params, "fov", 75.0)?,
                pitch_clamp: flat_numbers::<2>(params, "pitchClamp")?
                    .map(|c| (c[0], c[1]))
                    .unwrap_or((-89.0, 89.0)),
            }),
            "sideScroller" => Ok(Self::SideScroller {
                z_offset: flat_f32(params, "zOffset", 10.0)?,
                follow_y: flat_bool(params, "followY", true)?,
                y_bounds: flat_numbers::<2>(params, "yBounds")?.map(|b| (b[0], b[1])),
                damping: flat_f32(params, "damping", 5.0)?,
            }),
            "topDown" => Ok(Self::TopDown {
                height: flat_f32(params, "height", 15.0)?,
                damping: flat_f32(params, "damping", 5.0)?,
                follow_rotation: flat_bool(params, "followRotation", false)?,
            }),
            "fixed" => Ok(Self::Fixed {
                look_at: flat_numbers::<3>(params, "lookAt")?.map(Vec3::from),
            }),
            "orbital" => Ok(Self::Orbital {
                radius: flat_f32(params, "radius", 8.0)?,
                auto_rotate: flat_bool(params, "autoRotate", true)?,
                auto_rotate_speed: flat_f32(params, "autoRotateSpeed", 15.0)?,
            }),
            other => Err(format!(
                "unknown camera mode `{}`, expected one of {}",
                other,
                Self::FLAT_MODES.join(", ")
            )),
        }
    }

    /// Flatten back to the wire form, so an event or query answer carries the same shape the
    /// caller sent. Without this the engine emits the externally-tagged enum and every JS
    /// consumer reads `mode` as an object where it expects a string.
    pub fn to_flat(&self) -> serde_json::Value {
        match self {
            Self::ThirdPersonFollow {
                offset,
                damping,
                min_distance,
                max_distance,
                look_at_target,
                collision_avoidance,
            } => serde_json::json!({
                "mode": "thirdPersonFollow",
                "offset": [offset.x, offset.y, offset.z],
                "damping": damping,
                "minDistance": min_distance,
                "maxDistance": max_distance,
                "lookAtTarget": look_at_target,
                "collisionAvoidance": collision_avoidance,
            }),
            Self::FirstPerson {
                eye_height,
                mouse_sensitivity,
                fov,
                pitch_clamp,
            } => serde_json::json!({
                "mode": "firstPerson",
                "eyeHeight": eye_height,
                "mouseSensitivity": mouse_sensitivity,
                "fov": fov,
                "pitchClamp": [pitch_clamp.0, pitch_clamp.1],
            }),
            Self::SideScroller {
                z_offset,
                follow_y,
                y_bounds,
                damping,
            } => serde_json::json!({
                "mode": "sideScroller",
                "zOffset": z_offset,
                "followY": follow_y,
                "yBounds": y_bounds.map(|b| vec![b.0, b.1]),
                "damping": damping,
            }),
            Self::TopDown {
                height,
                damping,
                follow_rotation,
            } => serde_json::json!({
                "mode": "topDown",
                "height": height,
                "damping": damping,
                "followRotation": follow_rotation,
            }),
            Self::Fixed { look_at } => serde_json::json!({
                "mode": "fixed",
                "lookAt": look_at.map(|p| vec![p.x, p.y, p.z]),
            }),
            Self::Orbital {
                radius,
                auto_rotate,
                auto_rotate_speed,
            } => serde_json::json!({
                "mode": "orbital",
                "radius": radius,
                "autoRotate": auto_rotate,
                "autoRotateSpeed": auto_rotate_speed,
            }),
        }
    }
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
                first_person_mouse_look,
                game_camera_system,
            ).chain().in_set(PlaySystemSet))
            .add_systems(Update, update_orbital_angle.in_set(PlaySystemSet));
    }
}

/// Reads mouse delta commands from the pending queue and updates FirstPersonState yaw/pitch.
/// Runs in PlaySystemSet, BEFORE game_camera_system so updated values are used same frame.
fn first_person_mouse_look(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&GameCameraData, &mut FirstPersonState), With<ActiveGameCamera>>,
) {
    // Drain all queued mouse deltas
    let deltas: Vec<_> = pending.mouse_delta_requests.drain(..).collect();
    if deltas.is_empty() {
        return;
    }

    let Ok((camera_data, mut fp_state)) = query.single_mut() else {
        return;
    };

    let (sensitivity, pitch_clamp) = match &camera_data.mode {
        GameCameraMode::FirstPerson { mouse_sensitivity, pitch_clamp, .. } => {
            (*mouse_sensitivity, *pitch_clamp)
        }
        _ => return, // Not in FirstPerson mode — ignore deltas
    };

    for delta in deltas {
        // Apply sensitivity-scaled delta to yaw and pitch (in degrees)
        // dx -> yaw (horizontal), dy -> pitch (vertical)
        fp_state.yaw -= delta.dx * sensitivity;
        fp_state.pitch -= delta.dy * sensitivity;

        // Yaw: unlimited rotation, wrap at 360 degrees
        fp_state.yaw = fp_state.yaw.rem_euclid(360.0);

        // Pitch: clamp to prevent gimbal lock
        let (min_pitch, max_pitch) = pitch_clamp;
        fp_state.pitch = fp_state.pitch.clamp(min_pitch, max_pitch);
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

#[cfg(test)]
mod flat_wire_tests {
    use super::*;
    use serde_json::json;

    /// Every discriminator the command layer accepts must round-trip back to itself, or an event
    /// consumer would read a mode the caller can never re-send.
    #[test]
    fn every_mode_round_trips_through_flat_form() {
        for name in GameCameraMode::FLAT_MODES {
            let mode = GameCameraMode::from_flat(name, &json!({}))
                .unwrap_or_else(|e| panic!("`{}` must be constructible from a bare payload: {}", name, e));
            let flat = mode.to_flat();
            assert_eq!(flat["mode"], json!(name), "flattened discriminator drifted for `{}`", name);

            let back = GameCameraMode::from_flat(name, &flat)
                .unwrap_or_else(|e| panic!("`{}` failed to re-parse its own flat form: {}", name, e));
            assert_eq!(back, mode, "`{}` did not survive the round trip", name);
        }
    }

    /// Re-render a JSON value at f32 precision so a wire literal can be compared against the value
    /// that came back through an `f32` field. A JSON number is an f64, and narrowing it is lossy
    /// (`1.9` becomes `1.899999976158142`) — that is storage precision, not a lost value, so
    /// comparing at f32 is the honest check. Everything else is compared unchanged.
    fn at_f32_precision(v: &serde_json::Value) -> serde_json::Value {
        match v {
            serde_json::Value::Number(n) => n
                .as_f64()
                .and_then(|f| serde_json::Number::from_f64(f as f32 as f64))
                .map(serde_json::Value::Number)
                .unwrap_or_else(|| v.clone()),
            serde_json::Value::Array(items) => {
                serde_json::Value::Array(items.iter().map(at_f32_precision).collect())
            }
            other => other.clone(),
        }
    }

    /// Every mode-specific parameter must survive the round trip. A key the flattener omits is a
    /// value silently lost from every event and query answer.
    #[test]
    fn mode_specific_params_survive_the_round_trip() {
        let cases = [
            ("thirdPersonFollow", json!({
                "offset": [1.0, 3.0, -7.0], "damping": 4.0, "minDistance": 1.5,
                "maxDistance": 12.0, "lookAtTarget": false, "collisionAvoidance": false,
            })),
            ("firstPerson", json!({
                "eyeHeight": 1.9, "mouseSensitivity": 0.25, "fov": 90.0, "pitchClamp": [-70.0, 70.0],
            })),
            ("sideScroller", json!({
                "zOffset": 14.0, "followY": false, "yBounds": [-2.0, 8.0], "damping": 3.0,
            })),
            ("topDown", json!({"height": 22.0, "damping": 2.5, "followRotation": true})),
            ("fixed", json!({"lookAt": [4.0, 0.0, -1.0]})),
            ("orbital", json!({"radius": 11.0, "autoRotate": false, "autoRotateSpeed": 30.0})),
        ];

        for (name, params) in cases {
            let mode = GameCameraMode::from_flat(name, &params)
                .unwrap_or_else(|e| panic!("`{}` rejected its own documented params: {}", name, e));
            let flat = mode.to_flat();

            for (key, sent) in params.as_object().expect("params is an object") {
                assert_eq!(
                    at_f32_precision(&flat[key]),
                    at_f32_precision(sent),
                    "`{}` lost or altered `{}` on the way back out",
                    name,
                    key
                );
            }
            assert_eq!(
                GameCameraMode::from_flat(name, &flat).expect("re-parse"),
                mode,
                "`{}` did not survive the round trip with params",
                name
            );
        }
    }

    /// An absent parameter takes the variant default; a present-but-wrong-typed one is an error.
    /// `dispatchCommand` returns void, so this error string is the only signal a caller who
    /// mistyped a parameter will ever get — silently defaulting would configure the wrong camera.
    #[test]
    fn wrong_typed_params_are_errors_not_silent_defaults() {
        let err = GameCameraMode::from_flat("topDown", &json!({"height": "tall"})).unwrap_err();
        assert!(err.contains("height"), "error must name the offending key: {}", err);

        let err = GameCameraMode::from_flat("topDown", &json!({"followRotation": "yes"})).unwrap_err();
        assert!(err.contains("followRotation"), "error must name the offending key: {}", err);

        let err = GameCameraMode::from_flat("thirdPersonFollow", &json!({"offset": [0.0, 2.0]})).unwrap_err();
        assert!(err.contains("offset"), "error must name the offending key: {}", err);

        let err = GameCameraMode::from_flat("thirdPersonFollow", &json!({"offset": [0.0, 2.0, "z"]})).unwrap_err();
        assert!(err.contains("offset"), "error must name the offending key: {}", err);
    }

    /// An explicit null is "not supplied", so a serializer that emits every optional key as null
    /// cannot accidentally override a default.
    #[test]
    fn null_params_take_the_default() {
        let with_null = GameCameraMode::from_flat("topDown", &json!({"height": null})).unwrap();
        let absent = GameCameraMode::from_flat("topDown", &json!({})).unwrap();
        assert_eq!(with_null, absent);
    }

    /// The optional-array modes must distinguish "no bounds" from a supplied pair in both directions.
    #[test]
    fn absent_optional_arrays_flatten_to_null() {
        let side = GameCameraMode::from_flat("sideScroller", &json!({})).unwrap();
        assert_eq!(side.to_flat()["yBounds"], json!(null));

        let fixed = GameCameraMode::from_flat("fixed", &json!({})).unwrap();
        assert_eq!(fixed.to_flat()["lookAt"], json!(null));
    }

    /// The default mode a camera is created with must itself be expressible on the wire, or a
    /// freshly-spawned camera would emit a state no caller could reproduce.
    #[test]
    fn default_mode_flattens_to_a_reparseable_form() {
        let default = GameCameraData::default().mode;
        let flat = default.to_flat();
        let name = flat["mode"].as_str().expect("flattened mode is a string");
        assert!(GameCameraMode::FLAT_MODES.contains(&name), "default mode `{}` is not on the wire", name);
        assert_eq!(GameCameraMode::from_flat(name, &flat).unwrap(), default);
    }
}
