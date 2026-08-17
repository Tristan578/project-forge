//! 2D Physics Components
//!
//! Rapier 2D physics data structures for 2D projects.
//! Architecture mirrors physics.rs for consistency.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Main physics configuration for a 2D entity
///
/// `#[serde(default)]` is load-bearing: without it every field is required, so a
/// payload carrying a subset is a hard `from_value` failure and the whole command
/// is dropped before it is queued — `dispatchCommand` returns `void`, so that
/// looks identical to success from the browser (PF-1167).
///
/// The field names stay snake_case and the enum variants stay PascalCase because
/// this struct is embedded in `EntitySnapshot`, which is what `.forge` scene files
/// serialize. Renaming either would make every saved 2D scene fail to load. The
/// browser's camelCase/lowercase vocabulary is accepted through `Physics2dPatch`
/// and the `serde(alias)` attributes below instead, neither of which changes a
/// single byte of what gets written to a scene file.
#[derive(Component, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
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
///
/// The `alias` attributes accept the browser's lowercase spellings. They affect
/// deserialization ONLY — `Serialize` still emits the PascalCase name, so scene
/// files round-trip byte-identically and an old `.forge` keeps loading.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BodyType2d {
    #[serde(alias = "dynamic")]
    Dynamic,
    #[serde(alias = "static")]
    Static,
    #[serde(alias = "kinematic")]
    Kinematic,
}

/// Collider shape type
///
/// See `BodyType2d` — the aliases are deserialize-only. `ConvexPolygon` carries
/// both spellings because the chat schema says `convex_polygon` while a camelCase
/// producer would say `convexPolygon`.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ColliderShape2d {
    #[serde(alias = "box")]
    Box,
    #[serde(alias = "circle")]
    Circle,
    #[serde(alias = "capsule")]
    Capsule,
    #[serde(alias = "convex_polygon", alias = "convexPolygon")]
    ConvexPolygon,
    #[serde(alias = "edge")]
    Edge,
    #[serde(alias = "auto")]
    Auto,
}

/// A partial update to `Physics2dData` — every field optional.
///
/// Mirrors `PhysicsPatch` (`core/physics.rs`) for the 2D path. Two things make
/// this necessary rather than cosmetic:
///
/// 1. `set_2d_collider_shape` and `set_2d_body_type` used to build
///    `Physics2dData { <the one field>, ..Default::default() }` and queue it as a
///    whole-struct replace, so changing a platform's shape also reset its
///    friction, mass, sensor flag and conveyor velocity to defaults (PF-1167).
/// 2. There was no partial-update command at all, so the editor's only way to
///    change one field was to resend all fourteen.
///
/// `rename_all = "camelCase"` is safe here in a way it would not be on
/// `Physics2dData`: a patch only ever exists on the command wire, never in a
/// scene file, so it can speak the browser's vocabulary directly.
///
/// Trade-off, identical to the 3D patch: because nothing is required, a
/// misspelled key silently no-ops and the engine cannot detect it. The web client
/// closes that gap by building every payload through `buildUpdatePhysics2dPayload`
/// / `buildSetPhysics2dPayload` (`web/src/lib/physics/physics2dPayload.ts`), which
/// copy only allowlisted keys. `deny_unknown_fields` would be the engine-side
/// answer, but serde documents it as incompatible with `#[serde(flatten)]`, and
/// `UpdatePhysics2dPayload` (`core/commands/physics.rs`) flattens this struct
/// beside `entity_id` — that flatten is what makes the wire partial at all, so it
/// is not negotiable. The aliases are NOT the obstacle: the generated field
/// visitor knows them as field names. See `.claude/rules/gotchas.md` → the
/// "undetectable typo" bullet.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Physics2dPatch {
    #[serde(alias = "body_type")]
    pub body_type: Option<BodyType2d>,
    #[serde(alias = "collider_shape")]
    pub collider_shape: Option<ColliderShape2d>,
    pub size: Option<[f32; 2]>,
    pub radius: Option<f32>,
    pub vertices: Option<Vec<[f32; 2]>>,
    pub mass: Option<f32>,
    pub friction: Option<f32>,
    pub restitution: Option<f32>,
    #[serde(alias = "gravity_scale")]
    pub gravity_scale: Option<f32>,
    #[serde(alias = "is_sensor")]
    pub is_sensor: Option<bool>,
    #[serde(alias = "lock_rotation")]
    pub lock_rotation: Option<bool>,
    #[serde(alias = "continuous_detection")]
    pub continuous_detection: Option<bool>,
    #[serde(alias = "one_way_platform")]
    pub one_way_platform: Option<bool>,
    #[serde(alias = "surface_velocity")]
    pub surface_velocity: Option<[f32; 2]>,
}

impl Physics2dPatch {
    /// A patch that carries every field of `data` — the full-replace semantics
    /// `set_physics2d` has always had, expressed as a patch so there is only one
    /// apply path to reason about.
    pub fn full(data: &Physics2dData) -> Self {
        Self {
            body_type: Some(data.body_type),
            collider_shape: Some(data.collider_shape),
            size: Some(data.size),
            radius: Some(data.radius),
            vertices: Some(data.vertices.clone()),
            mass: Some(data.mass),
            friction: Some(data.friction),
            restitution: Some(data.restitution),
            gravity_scale: Some(data.gravity_scale),
            is_sensor: Some(data.is_sensor),
            lock_rotation: Some(data.lock_rotation),
            continuous_detection: Some(data.continuous_detection),
            one_way_platform: Some(data.one_way_platform),
            surface_velocity: Some(data.surface_velocity),
        }
    }

    /// Merge this patch into `target`, overwriting only the fields it carries.
    ///
    /// A patch carrying all 14 fields is equivalent to a whole-struct assignment,
    /// so `set_physics2d`'s pre-existing behaviour is unchanged.
    pub fn apply_to(&self, target: &mut Physics2dData) {
        if let Some(body_type) = self.body_type {
            target.body_type = body_type;
        }
        if let Some(collider_shape) = self.collider_shape {
            target.collider_shape = collider_shape;
        }
        if let Some(size) = self.size {
            target.size = size;
        }
        if let Some(radius) = self.radius {
            target.radius = radius;
        }
        if let Some(vertices) = self.vertices.clone() {
            target.vertices = vertices;
        }
        if let Some(mass) = self.mass {
            target.mass = mass;
        }
        if let Some(friction) = self.friction {
            target.friction = friction;
        }
        if let Some(restitution) = self.restitution {
            target.restitution = restitution;
        }
        if let Some(gravity_scale) = self.gravity_scale {
            target.gravity_scale = gravity_scale;
        }
        if let Some(is_sensor) = self.is_sensor {
            target.is_sensor = is_sensor;
        }
        if let Some(lock_rotation) = self.lock_rotation {
            target.lock_rotation = lock_rotation;
        }
        if let Some(continuous_detection) = self.continuous_detection {
            target.continuous_detection = continuous_detection;
        }
        if let Some(one_way_platform) = self.one_way_platform {
            target.one_way_platform = one_way_platform;
        }
        if let Some(surface_velocity) = self.surface_velocity {
            target.surface_velocity = surface_velocity;
        }
    }

    /// Merge this patch into `target` and return `(old, new)` — the value before
    /// the merge and the value after it.
    ///
    /// This exists so the ORDER of the three steps (snapshot, merge, report) is
    /// testable natively: the bridge's `apply_physics2d_updates` records
    /// `UndoableAction::Physics2dChange` and emits the JS event from the returned
    /// pair, and if the snapshot were taken after the merge then `old == new` and
    /// every undo would silently restore nothing. The bridge is wasm-only, so
    /// that ordering cannot be unit-tested there — keep the sequence here.
    ///
    /// `old == new` means the patch was a no-op. Callers must not push history or
    /// emit a change event in that case: `HistoryStack::push` clears the redo
    /// stack, so a no-op would destroy the user's redo history.
    pub fn apply_recording(&self, target: &mut Physics2dData) -> (Physics2dData, Physics2dData) {
        let old = target.clone();
        self.apply_to(target);
        let new = target.clone();
        (old, new)
    }
}

/// Marker component indicating 2D physics is active on this entity
#[derive(Component)]
pub struct Physics2dEnabled;

/// 2D Joint connecting two entities
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct PhysicsJoint2d {
    pub target_entity_id: String,
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
            target_entity_id: String::new(),
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

/// Read a finite `f32` out of a flat payload.
///
/// `Ok(None)` means "the caller did not set this field"; `Err` means the caller
/// set it to something unusable. A NaN or infinity is NOT silently dropped —
/// `f32::INFINITY` reaching Rapier as a motor force or a rope length corrupts the
/// whole simulation island, and a dropped field would look identical to the
/// caller never sending one.
fn flat_f32(payload: &serde_json::Value, key: &str) -> Result<Option<f32>, String> {
    match payload.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => {
            let n = v
                .as_f64()
                .ok_or_else(|| format!("Joint field '{}' must be a number", key))?;
            if !n.is_finite() {
                return Err(format!("Joint field '{}' must be finite", key));
            }
            Ok(Some(n as f32))
        }
    }
}

/// Read a finite `[f32; 2]` out of a flat payload, rejecting a wrong-length array.
fn flat_vec2(payload: &serde_json::Value, key: &str) -> Result<Option<[f32; 2]>, String> {
    let raw = match payload.get(key) {
        None | Some(serde_json::Value::Null) => return Ok(None),
        Some(v) => v,
    };
    let arr = raw
        .as_array()
        .ok_or_else(|| format!("Joint field '{}' must be an array of 2 numbers", key))?;
    if arr.len() != 2 {
        return Err(format!(
            "Joint field '{}' must have exactly 2 entries, got {}",
            key,
            arr.len()
        ));
    }
    let mut out = [0.0f32; 2];
    for (i, slot) in out.iter_mut().enumerate() {
        // Indexed, not `.iter().map()`: a JSON array can never be sparse, but the
        // length check above is what makes this read total, and keeping the read
        // indexed keeps the two facts adjacent.
        let n = arr[i]
            .as_f64()
            .ok_or_else(|| format!("Joint field '{}'[{}] must be a number", key, i))?;
        if !n.is_finite() {
            return Err(format!("Joint field '{}'[{}] must be finite", key, i));
        }
        *slot = n as f32;
    }
    Ok(Some(out))
}

impl JointType2d {
    /// The flat vocabulary name for this variant, as the browser spells it.
    pub fn mode_name(&self) -> &'static str {
        match self {
            JointType2d::Revolute { .. } => "revolute",
            JointType2d::Prismatic { .. } => "prismatic",
            JointType2d::Rope { .. } => "rope",
            JointType2d::Spring { .. } => "spring",
        }
    }

    /// Build a variant from the flat authoring vocabulary the browser sends.
    ///
    /// `JointType2d` is a serde enum of struct variants with no `#[serde(tag)]`,
    /// which makes it EXTERNALLY tagged: it can only ever deserialize from
    /// `{"Revolute": {…}}`, never from a bare `"revolute"` string. The store has
    /// always sent the bare string next to flat camelCase params, so every
    /// `set_joint_2d` in the product's history was a hard `from_value` reject —
    /// and `dispatchCommand` returns `void`, so nothing anywhere reported it.
    /// Same defect as `GameCameraMode` (PF-1126), and the fix is the same shape:
    /// read the flat vocabulary explicitly instead of leaning on derived serde.
    ///
    /// OMITTING a parameter is the supported way to say "use the engine default",
    /// so no second copy of these numbers is needed on the browser side. Setting
    /// one to a non-number, a non-finite number, or a wrong-length array is an
    /// error rather than a silent fallback.
    pub fn from_flat(joint_type: &str, params: &serde_json::Value) -> Result<Self, String> {
        match joint_type {
            "revolute" => Ok(JointType2d::Revolute {
                limits: flat_vec2(params, "limits")?.map(|l| (l[0], l[1])),
                motor_velocity: flat_f32(params, "motorVelocity")?.unwrap_or(0.0),
                motor_max_force: flat_f32(params, "motorMaxForce")?.unwrap_or(0.0),
            }),
            "prismatic" => Ok(JointType2d::Prismatic {
                axis: flat_vec2(params, "axis")?.unwrap_or([1.0, 0.0]),
                limits: flat_vec2(params, "limits")?.map(|l| (l[0], l[1])),
                motor_velocity: flat_f32(params, "motorVelocity")?.unwrap_or(0.0),
                motor_max_force: flat_f32(params, "motorMaxForce")?.unwrap_or(0.0),
            }),
            "rope" => Ok(JointType2d::Rope {
                max_distance: flat_f32(params, "maxDistance")?.unwrap_or(1.0),
            }),
            "spring" => Ok(JointType2d::Spring {
                rest_length: flat_f32(params, "restLength")?.unwrap_or(1.0),
                stiffness: flat_f32(params, "stiffness")?.unwrap_or(10.0),
                damping: flat_f32(params, "damping")?.unwrap_or(0.5),
            }),
            other => Err(format!(
                "Unknown 2D joint type '{}' (expected revolute, prismatic, rope or spring)",
                other
            )),
        }
    }

    /// Write this variant's parameters into a flat map under the browser's key names.
    fn write_flat(&self, out: &mut serde_json::Map<String, serde_json::Value>) {
        fn num(v: f32) -> serde_json::Value {
            serde_json::Number::from_f64(v as f64)
                .map(serde_json::Value::Number)
                // A non-finite f32 has no JSON representation. It cannot reach here
                // through `from_flat`, but it can through a `.forge` scene file, and
                // `null` is at least a value the browser parser drops explicitly.
                .unwrap_or(serde_json::Value::Null)
        }
        fn vec2(v: [f32; 2]) -> serde_json::Value {
            serde_json::Value::Array(vec![num(v[0]), num(v[1])])
        }
        // A plain fn rather than a closure: a closure capturing `out` would hold a
        // unique borrow for the whole match, so the arms that also insert their own
        // keys would not compile.
        fn limits_out(
            out: &mut serde_json::Map<String, serde_json::Value>,
            limits: &Option<(f32, f32)>,
        ) {
            if let Some((lo, hi)) = limits {
                out.insert("limits".to_string(), vec2([*lo, *hi]));
            }
        }
        match self {
            JointType2d::Revolute {
                limits,
                motor_velocity,
                motor_max_force,
            } => {
                limits_out(out, limits);
                out.insert("motorVelocity".to_string(), num(*motor_velocity));
                out.insert("motorMaxForce".to_string(), num(*motor_max_force));
            }
            JointType2d::Prismatic {
                axis,
                limits,
                motor_velocity,
                motor_max_force,
            } => {
                out.insert("axis".to_string(), vec2(*axis));
                limits_out(out, limits);
                out.insert("motorVelocity".to_string(), num(*motor_velocity));
                out.insert("motorMaxForce".to_string(), num(*motor_max_force));
            }
            JointType2d::Rope { max_distance } => {
                out.insert("maxDistance".to_string(), num(*max_distance));
            }
            JointType2d::Spring {
                rest_length,
                stiffness,
                damping,
            } => {
                out.insert("restLength".to_string(), num(*rest_length));
                out.insert("stiffness".to_string(), num(*stiffness));
                out.insert("damping".to_string(), num(*damping));
            }
        }
    }
}

impl PhysicsJoint2d {
    /// Build a joint from the flat camelCase payload `set_joint_2d` carries.
    ///
    /// The derived `Deserialize` on this struct cannot be used for that payload on
    /// three independent counts: the fields are snake_case (no `rename_all`, and
    /// adding one would break every saved `.forge` scene, exactly as documented on
    /// `Physics2dData` above), `joint_type` is externally tagged, and the browser
    /// sends everything flat rather than nested under `jointData`.
    pub fn from_flat(payload: &serde_json::Value) -> Result<Self, String> {
        let target_entity_id = payload
            .get("targetEntityId")
            .and_then(|v| v.as_str())
            .ok_or("Missing targetEntityId")?
            .to_string();
        if target_entity_id.is_empty() {
            return Err("targetEntityId must not be empty".to_string());
        }
        let joint_type = payload
            .get("jointType")
            .and_then(|v| v.as_str())
            .ok_or("Missing jointType")?;

        Ok(Self {
            target_entity_id,
            joint_type: JointType2d::from_flat(joint_type, payload)?,
            local_anchor1: flat_vec2(payload, "localAnchor1")?.unwrap_or([0.0, 0.0]),
            local_anchor2: flat_vec2(payload, "localAnchor2")?.unwrap_or([0.0, 0.0]),
        })
    }

    /// Serialize into the same flat vocabulary `from_flat` reads.
    ///
    /// The inbound event uses this rather than serializing the struct directly:
    /// `emit_joint2d_changed` FLATTENS the struct into a camelCase wrapper, and
    /// `rename_all` does not propagate through `#[serde(flatten)]`, so a derived
    /// payload reaches the browser snake_case with a nested PascalCase enum —
    /// a third vocabulary, for a surface that already had two too many.
    pub fn to_flat(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        map.insert(
            "targetEntityId".to_string(),
            serde_json::Value::String(self.target_entity_id.clone()),
        );
        map.insert(
            "jointType".to_string(),
            serde_json::Value::String(self.joint_type.mode_name().to_string()),
        );
        self.joint_type.write_flat(&mut map);
        // Anchors after the variant params so a variant can never shadow them.
        for (key, value) in [
            ("localAnchor1", self.local_anchor1),
            ("localAnchor2", self.local_anchor2),
        ] {
            map.insert(
                key.to_string(),
                serde_json::Value::Array(
                    value
                        .iter()
                        .map(|v| {
                            serde_json::Number::from_f64(*v as f64)
                                .map(serde_json::Value::Number)
                                .unwrap_or(serde_json::Value::Null)
                        })
                        .collect(),
                ),
            );
        }
        serde_json::Value::Object(map)
    }
}

#[cfg(test)]
mod physics2d_patch_tests {
    use super::*;

    /// A configured platform — every field away from its default, so any
    /// unintended reset shows up as a concrete value change rather than a
    /// coincidence with `Default`.
    fn configured_platform() -> Physics2dData {
        Physics2dData {
            body_type: BodyType2d::Static,
            collider_shape: ColliderShape2d::Capsule,
            size: [8.0, 0.5],
            radius: 0.25,
            vertices: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
            mass: 12.0,
            friction: 1.75,
            restitution: 0.9,
            gravity_scale: 0.0,
            is_sensor: true,
            lock_rotation: true,
            continuous_detection: true,
            one_way_platform: true,
            surface_velocity: [3.0, -1.0],
        }
    }

    #[test]
    fn apply_to_overwrites_only_carried_fields() {
        let mut data = configured_platform();
        let patch = Physics2dPatch {
            friction: Some(0.1),
            ..Default::default()
        };

        patch.apply_to(&mut data);

        let mut expected = configured_platform();
        expected.friction = 0.1;
        assert_eq!(data, expected);
    }

    #[test]
    fn empty_patch_changes_nothing() {
        let mut data = configured_platform();
        Physics2dPatch::default().apply_to(&mut data);
        assert_eq!(data, configured_platform());
    }

    /// Two patches for one entity in a single frame must COMPOSE, not compete.
    ///
    /// `apply_physics2d_updates` accumulates successive updates for an entity that
    /// has no `Physics2dData` yet, because `Commands` is deferred and its insert is
    /// invisible to the query on the next iteration of the same drain. That is only
    /// correct if applying the second patch onto the first's result keeps the first
    /// patch's fields — i.e. if the bridge can accumulate instead of restarting
    /// from `default()`. Restarting is what the pre-fix code did, and it silently
    /// dropped the earlier patch. The bridge is wasm-only, so pin the property here.
    #[test]
    fn successive_patches_accumulate_onto_one_value() {
        let mut data = Physics2dData::default();

        Physics2dPatch { friction: Some(0.1), ..Default::default() }.apply_to(&mut data);
        Physics2dPatch { restitution: Some(0.9), ..Default::default() }.apply_to(&mut data);

        assert_eq!(data.friction, 0.1, "the second patch must not reset the first's field");
        assert_eq!(data.restitution, 0.9);

        // And the accumulated result is identical to applying both fields at once,
        // which is what makes collapsing them into a single insert sound.
        let mut at_once = Physics2dData::default();
        Physics2dPatch { friction: Some(0.1), restitution: Some(0.9), ..Default::default() }
            .apply_to(&mut at_once);
        assert_eq!(data, at_once);
    }

    /// The defect PF-1167 was filed for: `set_2d_collider_shape` used to queue
    /// `Physics2dData { collider_shape, ..Default::default() }`, so changing a
    /// platform's shape also reset its friction, mass, sensor flag and conveyor
    /// velocity. The narrow patch those handlers now build must leave all
    /// thirteen other fields alone.
    #[test]
    fn collider_shape_patch_preserves_every_other_field() {
        let mut data = configured_platform();
        let patch = Physics2dPatch {
            collider_shape: Some(ColliderShape2d::Circle),
            radius: Some(2.0),
            ..Default::default()
        };

        patch.apply_to(&mut data);

        let mut expected = configured_platform();
        expected.collider_shape = ColliderShape2d::Circle;
        expected.radius = 2.0;
        assert_eq!(data, expected);
    }

    #[test]
    fn body_type_patch_preserves_every_other_field() {
        let mut data = configured_platform();
        let patch = Physics2dPatch {
            body_type: Some(BodyType2d::Kinematic),
            ..Default::default()
        };

        patch.apply_to(&mut data);

        let mut expected = configured_platform();
        expected.body_type = BodyType2d::Kinematic;
        assert_eq!(data, expected);
    }

    /// `set_physics2d` keeps whole-struct replace semantics by queueing
    /// `Physics2dPatch::full`, so applying one over unrelated existing data must
    /// leave nothing of the old value behind.
    #[test]
    fn full_patch_replaces_everything() {
        let mut data = configured_platform();
        let replacement = Physics2dData {
            body_type: BodyType2d::Dynamic,
            collider_shape: ColliderShape2d::Edge,
            size: [1.0, 2.0],
            radius: 3.0,
            vertices: vec![],
            mass: 4.0,
            friction: 0.0,
            restitution: 0.0,
            gravity_scale: 2.0,
            is_sensor: false,
            lock_rotation: false,
            continuous_detection: false,
            one_way_platform: false,
            surface_velocity: [0.0, 0.0],
        };

        Physics2dPatch::full(&replacement).apply_to(&mut data);

        assert_eq!(data, replacement);
    }

    /// The ordering pin. If the snapshot were taken after the merge, `old` would
    /// equal `new` and every undo would silently restore nothing — and the bridge
    /// is wasm-only, so that sequence cannot be tested where it is consumed.
    #[test]
    fn apply_recording_returns_the_pre_merge_value_as_old() {
        let mut data = configured_platform();
        let patch = Physics2dPatch {
            mass: Some(99.0),
            ..Default::default()
        };

        let (old, new) = patch.apply_recording(&mut data);

        assert_eq!(old.mass, 12.0, "old must be the value BEFORE the merge");
        assert_eq!(new.mass, 99.0);
        assert_eq!(data, new);
        assert_eq!(old, configured_platform());
    }

    /// The no-op signal the bridge's guard depends on: without `old == new` here,
    /// `apply_physics2d_updates` would push history on every call and clear the
    /// redo stack.
    #[test]
    fn apply_recording_reports_a_no_op_patch_as_unchanged() {
        let mut data = configured_platform();

        let (old, new) = Physics2dPatch::default().apply_recording(&mut data);
        assert_eq!(old, new);

        // Same when the patch carries a field already at the requested value.
        let redundant = Physics2dPatch {
            friction: Some(1.75),
            ..Default::default()
        };
        let (old, new) = redundant.apply_recording(&mut data);
        assert_eq!(old, new);
    }

    #[test]
    fn full_then_apply_recording_round_trips_a_configured_platform() {
        let source = configured_platform();
        let mut target = Physics2dData::default();

        let (old, new) = Physics2dPatch::full(&source).apply_recording(&mut target);

        assert_eq!(old, Physics2dData::default());
        assert_eq!(new, source);
    }

    // === Wire-vocabulary tests ===
    //
    // The browser speaks camelCase keys and lowercase enum values; scene files
    // hold snake_case keys and PascalCase enum values. Both must deserialize.

    #[test]
    fn patch_accepts_camel_case_keys() {
        let patch: Physics2dPatch = serde_json::from_value(serde_json::json!({
            "bodyType": "static",
            "colliderShape": "box",
            "gravityScale": 0.0,
            "isSensor": true,
            "lockRotation": true,
            "continuousDetection": true,
            "oneWayPlatform": true,
            "surfaceVelocity": [2.0, 0.0],
        }))
        .expect("camelCase patch must deserialize");

        assert_eq!(patch.body_type, Some(BodyType2d::Static));
        assert_eq!(patch.collider_shape, Some(ColliderShape2d::Box));
        assert_eq!(patch.gravity_scale, Some(0.0));
        assert_eq!(patch.is_sensor, Some(true));
        assert_eq!(patch.lock_rotation, Some(true));
        assert_eq!(patch.continuous_detection, Some(true));
        assert_eq!(patch.one_way_platform, Some(true));
        assert_eq!(patch.surface_velocity, Some([2.0, 0.0]));
    }

    /// Without the `alias` attributes on the patch, a snake_case producer's keys
    /// would be ignored, deserialize to `None`, and no-op silently — the exact
    /// failure mode this whole change exists to remove.
    #[test]
    fn patch_accepts_snake_case_keys() {
        let patch: Physics2dPatch = serde_json::from_value(serde_json::json!({
            "body_type": "Static",
            "collider_shape": "convex_polygon",
            "gravity_scale": 0.5,
            "is_sensor": true,
            "lock_rotation": true,
            "continuous_detection": true,
            "one_way_platform": true,
            "surface_velocity": [1.0, 1.0],
        }))
        .expect("snake_case patch must deserialize");

        assert_eq!(patch.body_type, Some(BodyType2d::Static));
        assert_eq!(patch.collider_shape, Some(ColliderShape2d::ConvexPolygon));
        assert_eq!(patch.gravity_scale, Some(0.5));
        assert_eq!(patch.is_sensor, Some(true));
        assert_eq!(patch.lock_rotation, Some(true));
        assert_eq!(patch.continuous_detection, Some(true));
        assert_eq!(patch.one_way_platform, Some(true));
        assert_eq!(patch.surface_velocity, Some([1.0, 1.0]));
    }

    #[test]
    fn enum_aliases_accept_both_spellings() {
        for (wire, expected) in [
            ("dynamic", BodyType2d::Dynamic),
            ("Dynamic", BodyType2d::Dynamic),
            ("static", BodyType2d::Static),
            ("Static", BodyType2d::Static),
            ("kinematic", BodyType2d::Kinematic),
            ("Kinematic", BodyType2d::Kinematic),
        ] {
            let parsed: BodyType2d = serde_json::from_value(serde_json::json!(wire))
                .unwrap_or_else(|e| panic!("body type '{wire}' must deserialize: {e}"));
            assert_eq!(parsed, expected, "body type '{wire}'");
        }

        for (wire, expected) in [
            ("box", ColliderShape2d::Box),
            ("Box", ColliderShape2d::Box),
            ("circle", ColliderShape2d::Circle),
            ("Circle", ColliderShape2d::Circle),
            ("capsule", ColliderShape2d::Capsule),
            ("Capsule", ColliderShape2d::Capsule),
            ("convex_polygon", ColliderShape2d::ConvexPolygon),
            ("convexPolygon", ColliderShape2d::ConvexPolygon),
            ("ConvexPolygon", ColliderShape2d::ConvexPolygon),
            ("edge", ColliderShape2d::Edge),
            ("Edge", ColliderShape2d::Edge),
            ("auto", ColliderShape2d::Auto),
            ("Auto", ColliderShape2d::Auto),
        ] {
            let parsed: ColliderShape2d = serde_json::from_value(serde_json::json!(wire))
                .unwrap_or_else(|e| panic!("collider shape '{wire}' must deserialize: {e}"));
            assert_eq!(parsed, expected, "collider shape '{wire}'");
        }
    }

    /// `#[serde(default)]` on `Physics2dData` is what makes a partial payload a
    /// merge candidate instead of a hard `from_value` failure that drops the
    /// whole command before it is ever queued.
    #[test]
    fn physics2d_data_deserializes_from_a_partial_object() {
        let data: Physics2dData = serde_json::from_value(serde_json::json!({
            "body_type": "Static",
            "friction": 1.2,
        }))
        .expect("partial Physics2dData must deserialize");

        assert_eq!(data.body_type, BodyType2d::Static);
        assert_eq!(data.friction, 1.2);
        assert_eq!(data.mass, Physics2dData::default().mass);
    }

    /// The scene-file contract. `Physics2dData` is embedded in `EntitySnapshot`,
    /// which is what `.forge` files serialize, so its emitted key spellings and
    /// enum names are persistence format — the aliases above are deserialize-only
    /// and must not have changed a single output byte.
    #[test]
    fn physics2d_data_serializes_snake_case_keys_and_pascal_case_variants() {
        let json = serde_json::to_value(configured_platform()).expect("serialize");
        let obj = json.as_object().expect("object");

        for key in [
            "body_type",
            "collider_shape",
            "size",
            "radius",
            "vertices",
            "mass",
            "friction",
            "restitution",
            "gravity_scale",
            "is_sensor",
            "lock_rotation",
            "continuous_detection",
            "one_way_platform",
            "surface_velocity",
        ] {
            assert!(obj.contains_key(key), "scene files require the '{key}' key");
        }
        assert_eq!(obj.len(), 14, "no field may be added or dropped silently");

        assert_eq!(obj["body_type"], serde_json::json!("Static"));
        assert_eq!(obj["collider_shape"], serde_json::json!("Capsule"));
    }

    #[test]
    fn physics2d_data_round_trips_through_json() {
        let source = configured_platform();
        let json = serde_json::to_string(&source).expect("serialize");
        let parsed: Physics2dData = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, source);
    }

    /// The drift guard's counterpart: the TS allowlist in
    /// `web/src/lib/physics/physics2dPayload.ts` is pinned against these names,
    /// so a field added here without one there is a test failure, not a silent
    /// key the engine drops.
    #[test]
    fn patch_serializes_the_camel_case_names_the_web_client_sends() {
        let json = serde_json::to_value(Physics2dPatch::full(&configured_platform()))
            .expect("serialize");
        let obj = json.as_object().expect("object");

        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "bodyType",
                "colliderShape",
                "continuousDetection",
                "friction",
                "gravityScale",
                "isSensor",
                "lockRotation",
                "mass",
                "oneWayPlatform",
                "radius",
                "restitution",
                "size",
                "surfaceVelocity",
                "vertices",
            ]
        );
    }
}

#[cfg(test)]
mod joint2d_flat_tests {
    use super::*;
    use serde_json::json;

    /// The exact payload `physicsSlice.setJoint2d` dispatches for a revolute
    /// joint: `entityId` alongside the joint's own fields, all flat, all
    /// camelCase, with `jointType` as a bare lowercase string.
    fn revolute_payload() -> serde_json::Value {
        json!({
            "entityId": "entity-a",
            "targetEntityId": "entity-b",
            "jointType": "revolute",
            "localAnchor1": [1.0, 2.0],
            "localAnchor2": [-1.0, -2.0],
            "limits": [-0.5, 0.5],
            "motorVelocity": 3.0,
            "motorMaxForce": 40.0,
        })
    }

    #[test]
    fn derived_deserialize_rejects_the_payload_the_store_sends() {
        // The regression this whole constructor exists for: the derived impl can
        // only read `{"Revolute": {…}}` with snake_case siblings, so the flat
        // payload is a hard reject rather than a partial read. If this ever
        // starts passing, `from_flat` is no longer load-bearing — but until then,
        // deleting it silently kills every 2D joint again.
        let parsed: Result<PhysicsJoint2d, _> = serde_json::from_value(revolute_payload());
        assert!(parsed.is_err(), "derived Deserialize unexpectedly accepted the flat payload");
    }

    #[test]
    fn from_flat_reads_a_revolute_joint() {
        let joint = PhysicsJoint2d::from_flat(&revolute_payload()).expect("revolute joint");
        assert_eq!(joint.target_entity_id, "entity-b");
        assert_eq!(joint.local_anchor1, [1.0, 2.0]);
        assert_eq!(joint.local_anchor2, [-1.0, -2.0]);
        match joint.joint_type {
            JointType2d::Revolute { limits, motor_velocity, motor_max_force } => {
                assert_eq!(limits, Some((-0.5, 0.5)));
                assert_eq!(motor_velocity, 3.0);
                assert_eq!(motor_max_force, 40.0);
            }
            other => panic!("expected Revolute, got {:?}", other),
        }
    }

    #[test]
    fn from_flat_reads_every_variant() {
        let prismatic = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "prismatic",
            "axis": [0.0, 1.0],
            "limits": [0.0, 4.0],
            "motorVelocity": 1.5,
            "motorMaxForce": 20.0,
        }))
        .expect("prismatic joint");
        match prismatic.joint_type {
            JointType2d::Prismatic { axis, limits, motor_velocity, motor_max_force } => {
                assert_eq!(axis, [0.0, 1.0]);
                assert_eq!(limits, Some((0.0, 4.0)));
                assert_eq!(motor_velocity, 1.5);
                assert_eq!(motor_max_force, 20.0);
            }
            other => panic!("expected Prismatic, got {:?}", other),
        }

        let rope = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "rope",
            "maxDistance": 7.5,
        }))
        .expect("rope joint");
        match rope.joint_type {
            JointType2d::Rope { max_distance } => assert_eq!(max_distance, 7.5),
            other => panic!("expected Rope, got {:?}", other),
        }

        let spring = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "spring",
            "restLength": 2.0,
            "stiffness": 55.0,
            "damping": 0.25,
        }))
        .expect("spring joint");
        match spring.joint_type {
            JointType2d::Spring { rest_length, stiffness, damping } => {
                assert_eq!(rest_length, 2.0);
                assert_eq!(stiffness, 55.0);
                assert_eq!(damping, 0.25);
            }
            other => panic!("expected Spring, got {:?}", other),
        }
    }

    #[test]
    fn omitted_params_fall_back_to_engine_defaults() {
        // Omission is the supported way to say "engine default", which is what
        // keeps the browser from carrying a second copy of these numbers.
        let joint = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "spring",
        }))
        .expect("spring joint");
        assert_eq!(joint.local_anchor1, [0.0, 0.0]);
        assert_eq!(joint.local_anchor2, [0.0, 0.0]);
        match joint.joint_type {
            JointType2d::Spring { rest_length, stiffness, damping } => {
                assert_eq!(rest_length, 1.0);
                assert_eq!(stiffness, 10.0);
                assert_eq!(damping, 0.5);
            }
            other => panic!("expected Spring, got {:?}", other),
        }

        let prismatic = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "prismatic",
        }))
        .expect("prismatic joint");
        match prismatic.joint_type {
            JointType2d::Prismatic { axis, limits, .. } => {
                assert_eq!(axis, [1.0, 0.0]);
                assert_eq!(limits, None);
            }
            other => panic!("expected Prismatic, got {:?}", other),
        }
    }

    #[test]
    fn missing_or_unusable_identity_fields_are_errors() {
        for payload in [
            json!({ "jointType": "revolute" }),
            json!({ "targetEntityId": "", "jointType": "revolute" }),
            json!({ "targetEntityId": "b" }),
            json!({ "targetEntityId": "b", "jointType": "Revolute" }),
            json!({ "targetEntityId": "b", "jointType": "welded" }),
        ] {
            assert!(
                PhysicsJoint2d::from_flat(&payload).is_err(),
                "expected rejection for {}",
                payload
            );
        }
    }

    #[test]
    fn non_finite_and_malformed_numbers_are_errors_not_silent_drops() {
        // `f32::INFINITY` reaching Rapier as a motor force or a rope length
        // corrupts the simulation island; dropping the field instead would be
        // indistinguishable from the caller never sending it.
        let cases = [
            json!({ "targetEntityId": "b", "jointType": "rope", "maxDistance": "far" }),
            json!({ "targetEntityId": "b", "jointType": "revolute", "motorMaxForce": [1.0] }),
            json!({ "targetEntityId": "b", "jointType": "revolute", "limits": [1.0] }),
            json!({ "targetEntityId": "b", "jointType": "revolute", "limits": [1.0, 2.0, 3.0] }),
            json!({ "targetEntityId": "b", "jointType": "revolute", "localAnchor1": ["a", "b"] }),
            json!({ "targetEntityId": "b", "jointType": "prismatic", "axis": 3.0 }),
        ];
        for payload in cases {
            assert!(
                PhysicsJoint2d::from_flat(&payload).is_err(),
                "expected rejection for {}",
                payload
            );
        }

        // serde_json parses a bare `Infinity` literal as an error, so the only way
        // a non-finite value reaches the guard is through a constructed Value.
        let mut payload = json!({ "targetEntityId": "b", "jointType": "rope" });
        payload["maxDistance"] = serde_json::Value::Number(
            serde_json::Number::from_f64(1.0).expect("finite"),
        );
        assert!(PhysicsJoint2d::from_flat(&payload).is_ok());
    }

    #[test]
    fn explicit_null_means_omitted() {
        let joint = PhysicsJoint2d::from_flat(&json!({
            "targetEntityId": "b",
            "jointType": "rope",
            "maxDistance": null,
            "localAnchor1": null,
        }))
        .expect("rope joint");
        assert_eq!(joint.local_anchor1, [0.0, 0.0]);
        match joint.joint_type {
            JointType2d::Rope { max_distance } => assert_eq!(max_distance, 1.0),
            other => panic!("expected Rope, got {:?}", other),
        }
    }

    #[test]
    fn to_flat_round_trips_through_from_flat() {
        let originals = [
            JointType2d::Revolute {
                limits: Some((-1.0, 1.0)),
                motor_velocity: 2.0,
                motor_max_force: 30.0,
            },
            JointType2d::Revolute {
                limits: None,
                motor_velocity: 0.0,
                motor_max_force: 0.0,
            },
            JointType2d::Prismatic {
                axis: [0.0, 1.0],
                limits: Some((0.0, 3.0)),
                motor_velocity: 1.0,
                motor_max_force: 9.0,
            },
            JointType2d::Rope { max_distance: 4.5 },
            JointType2d::Spring {
                rest_length: 2.5,
                stiffness: 60.0,
                damping: 0.75,
            },
        ];
        for joint_type in originals {
            let joint = PhysicsJoint2d {
                target_entity_id: "entity-b".to_string(),
                joint_type,
                local_anchor1: [0.5, -0.5],
                local_anchor2: [-0.25, 0.25],
            };
            let wire = joint.to_flat();
            let parsed = PhysicsJoint2d::from_flat(&wire)
                .unwrap_or_else(|e| panic!("round trip failed for {}: {}", wire, e));
            assert_eq!(format!("{:?}", parsed), format!("{:?}", joint));
        }
    }

    #[test]
    fn to_flat_emits_the_browser_vocabulary() {
        let joint = PhysicsJoint2d {
            target_entity_id: "entity-b".to_string(),
            joint_type: JointType2d::Rope { max_distance: 4.0 },
            local_anchor1: [1.0, 0.0],
            local_anchor2: [0.0, 1.0],
        };
        let wire = joint.to_flat();
        // Every key camelCase, `jointType` a bare lowercase string, nothing nested.
        let mut keys: Vec<&str> = wire
            .as_object()
            .expect("object")
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["jointType", "localAnchor1", "localAnchor2", "maxDistance", "targetEntityId"]
        );
        assert_eq!(wire["jointType"], json!("rope"));
    }

    #[test]
    fn limits_are_omitted_rather_than_written_as_null() {
        // A `null` on the wire and an absent key both parse back to `None`, but
        // only omission survives a consumer that treats `null` as a value.
        let joint = PhysicsJoint2d {
            target_entity_id: "entity-b".to_string(),
            joint_type: JointType2d::Revolute {
                limits: None,
                motor_velocity: 0.0,
                motor_max_force: 0.0,
            },
            local_anchor1: [0.0, 0.0],
            local_anchor2: [0.0, 0.0],
        };
        assert!(joint.to_flat().get("limits").is_none());
    }
}
