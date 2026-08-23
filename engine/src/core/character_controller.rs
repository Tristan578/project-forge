//! Kinematic character controller.
//!
//! Before PF-1214 the player was moved by adding straight onto
//! `Transform.translation`: no gravity, no ground contact, no collision
//! response, and a "jump" that was a one-frame translation tween. A generated
//! 3D game therefore had a player that walked through walls and never fell,
//! which made every score/win condition that depends on landing on something
//! unreachable.
//!
//! This module drives the player through `bevy_rapier3d`'s
//! [`KinematicCharacterController`] instead. The split is deliberate:
//!
//! * [`step_character`] is pure — it owns gravity integration, the grounded
//!   bookkeeping and the jump gating, and is unit-testable natively.
//! * [`manage_character_controller_lifecycle`] is the thin ECS wrapper that
//!   attaches/detaches the Rapier components on the Edit↔Play transition.
//!
//! The controller only exists in 3D projects. A 2D project keeps the legacy
//! direct-translation path in `game_components::system_character_controller`
//! (its movement is authored in the XY plane against `physics_2d_sim`, which is
//! a completely separate simulation).

use bevy::prelude::*;
use bevy_rapier3d::prelude::*;
use std::collections::HashMap;

use super::engine_mode::EngineMode;
use super::entity_id::EntityId;
use super::game_components::{GameComponentData, GameComponents};
use super::project_type::ProjectType;

/// Downward acceleration applied to an airborne character, in units/s².
///
/// Deliberately the same magnitude as Rapier's own default world gravity, so a
/// character falls at the same rate as the dynamic props around it. A character
/// that fell at a different rate than the crate it just knocked off a ledge
/// reads as a bug to a player even though neither number is "wrong".
pub const GRAVITY_ACCEL: f32 = -9.81;

/// Downward speed cap, in units/s. Without it a long fall accumulates enough
/// per-frame translation to tunnel straight through the floor collider.
pub const TERMINAL_VELOCITY: f32 = -50.0;

/// Upward speed cap, in units/s — the mirror of [`TERMINAL_VELOCITY`].
///
/// The downward cap alone is a bound on the SIGNED velocity, not on its
/// magnitude, and that is not the same thing here. `gravityScale` is authored
/// and `prop_f32` clamps it to `[-10, 10]`, so a NEGATIVE scale makes
/// `GRAVITY_ACCEL * scale` point UP: the vertical velocity then integrates
/// toward `+inf` with nothing in its way, the per-frame translation grows
/// without limit, and the character tunnels through every ceiling collider
/// before its coordinates saturate. Rapier is handed a translation it cannot
/// resolve, so the symptom is a player that has silently vanished rather than
/// one that is merely moving fast.
pub const MAX_RISE_VELOCITY: f32 = -TERMINAL_VELOCITY;

/// How long after leaving the ground a ground jump is still accepted, in
/// seconds — "coyote time".
///
/// Without it the jump input has to land inside the single frame the character
/// is still touching the ledge. At 60fps that is a ~16ms window, and a player
/// who presses one frame late gets no jump, no feedback, and no way to tell a
/// mistimed input from a broken one. 0.1s is the genre convention: long enough
/// to absorb human timing, short enough that it never reads as a free mid-air
/// jump.
pub const COYOTE_TIME_SECONDS: f32 = 0.1;

/// How long a jump press is remembered while it cannot yet be spent, in
/// seconds — the mirror of [`COYOTE_TIME_SECONDS`].
///
/// A player who presses jump just BEFORE landing would otherwise have the press
/// swallowed by the airborne frames and have to press again. Buffering re-tries
/// it on each subsequent frame until it is spendable or the window expires.
pub const JUMP_BUFFER_SECONDS: f32 = 0.1;

/// Minimum upward component of a contact normal for the surface to count as
/// something the character is standing ON, for carry purposes.
///
/// `cos(45°) ≈ 0.707`, i.e. exactly the [`MAX_SLOPE_CLIMB_DEGREES`] the
/// controller will walk up — a surface too steep to climb is a wall, and a wall
/// must never drag the character sideways. Not written as `cos()` because
/// `f32::cos` is not a `const fn`; the `ground_normal_threshold_tracks_the_climb_angle`
/// test pins the literal against the angle so the two cannot drift.
pub const GROUND_NORMAL_MIN_Y: f32 = 0.707;

/// Vertical speed held while grounded, in units/s.
///
/// A hard zero lets a character walk off a ledge with no downward component at
/// all, so `snap_to_ground` never disengages and the first airborne frame reads
/// as still grounded. A small bias keeps the capsule pressed into the floor.
pub const GROUND_STICK_VELOCITY: f32 = -2.0;

/// Steepest slope, in degrees, the character can walk up. Anything steeper is
/// treated as a wall and slid along instead of climbed.
pub const MAX_SLOPE_CLIMB_DEGREES: f32 = 45.0;

/// Shallowest slope, in degrees, the character slides back down.
pub const MIN_SLOPE_SLIDE_DEGREES: f32 = 30.0;

/// Tallest step the character is lifted over automatically, in world units.
pub const STEP_HEIGHT: f32 = 0.3;

/// Minimum free width on top of a step before autostep will take it. Without a
/// width requirement the character climbs onto ledges too thin to stand on.
pub const MIN_STEP_WIDTH: f32 = 0.05;

/// Distance below the feet searched for ground each frame, in world units.
/// Keeps the character glued to the floor when running down a shallow ramp
/// instead of launching off every seam.
pub const SNAP_TO_GROUND: f32 = 0.2;

/// Skin width kept between the character shape and the geometry it touches.
pub const CONTROLLER_OFFSET: f32 = 0.02;

/// Fraction of a requested upward move that must actually happen before the
/// frame counts as unobstructed.
///
/// Not `1.0`: the skin width, a grazing wall contact and the slide projection
/// all shave a little off a legitimate rise, and cancelling a jump for that
/// would make every jump taken next to a wall die on frame one. Half is far
/// above that noise and far below anything a real ceiling leaves through.
pub const VERTICAL_BLOCK_FRACTION: f32 = 0.5;

/// Requested upward motion at or below this, in world units, is treated as no
/// request at all.
///
/// A frame with `dt` near zero asks for a vertical move of the same order as
/// float noise, and comparing noise against a fraction of itself decides
/// nothing — without the floor a standing character could be reported as
/// ceiling-blocked.
pub const VERTICAL_BLOCK_EPSILON: f32 = 1e-4;

/// Whether Rapier refused this frame's UPWARD motion, given the translation the
/// controller asked for and the one it was actually allowed.
///
/// Rapier reports the clamp (`desired_translation` vs `effective_translation`
/// on [`KinematicCharacterControllerOutput`]) but never writes it back into our
/// velocity, and there is no "hit a ceiling" flag. Without this, a jump that
/// meets an overhead surface keeps its whole upward speed: the controller
/// re-requests `+v*dt` every frame, Rapier clamps every frame, and the
/// character glides along the underside of the platform until gravity has eaten
/// the velocity — roughly 0.8s and ~48 frames at the default `jumpHeight` of
/// 8.0. Rapier still prevents penetration, so the symptom is a stuck-looking
/// player rather than tunnelling.
///
/// Only upward is considered. A refused DOWNWARD move is the floor, which
/// `grounded` already owns; treating it as a block would cancel
/// [`GROUND_STICK_VELOCITY`] and make `snap_to_ground` release on ramp seams.
pub fn vertical_motion_blocked(desired: Vec3, effective: Vec3) -> bool {
    if !desired.y.is_finite() || !effective.y.is_finite() {
        return false;
    }
    if desired.y <= VERTICAL_BLOCK_EPSILON {
        return false;
    }
    effective.y < desired.y * VERTICAL_BLOCK_FRACTION
}

/// Per-entity motion state for a kinematic character.
///
/// Inserted alongside the [`KinematicCharacterController`] on Edit→Play and
/// removed again on Play→Edit, so a character never carries stale fall speed
/// from a previous play session into the next one.
#[derive(Component, Debug, Clone, PartialEq)]
pub struct CharacterMotionState {
    /// Current vertical speed in units/s. Negative is falling.
    pub vertical_velocity: f32,
    /// Whether the character is standing on something.
    ///
    /// Seeded each frame from the contact state Rapier reported for the
    /// previous frame, then CORRECTED to `false` on the frame a jump is
    /// accepted — Rapier writes its output in `PostUpdate`, so its raw value
    /// still reads `true` while the character is already rising.
    ///
    /// This is the value the bridge emits as `CHARACTER_GROUNDED_CHANGED`
    /// (`bridge::game::emit_character_grounded_system`), so a script's
    /// `forge.physics.isGrounded()` and this module's own jump gating can never
    /// disagree about whether a character is airborne.
    pub grounded: bool,
    /// Jumps consumed since the character last stood on the ground. Walking off
    /// a ledge spends the ground jump ONCE [`coyote_timer`] has run out, so
    /// `canDoubleJump` grants exactly one air jump either way.
    ///
    /// [`coyote_timer`]: CharacterMotionState::coyote_timer
    pub jumps_used: u32,
    /// Seconds of [`COYOTE_TIME_SECONDS`] left, counted down while airborne.
    ///
    /// While this is above zero the ground jump has not been spent yet, which
    /// is the entire mechanism: nothing special-cases "just walked off a
    /// ledge", the ground jump simply stays available a moment longer.
    pub coyote_timer: f32,
    /// Seconds of [`JUMP_BUFFER_SECONDS`] left on a press that has not been
    /// spent yet.
    ///
    /// Zeroed the frame a jump is accepted, so one press can never be spent
    /// twice — with `canDoubleJump` a single press would otherwise be re-tried
    /// on the next frame and consume the air jump too.
    pub jump_buffer_timer: f32,
}

impl Default for CharacterMotionState {
    fn default() -> Self {
        Self {
            vertical_velocity: 0.0,
            // Starting "not grounded" is the safe default: the very first frame
            // then applies gravity and Rapier corrects it immediately if the
            // character is in fact standing on something. Starting `true` would
            // hand out a free mid-air jump to a character spawned in the air.
            grounded: false,
            jumps_used: 0,
            // No coyote grace on the first frame: the character has not been on
            // the ground yet, so there is nothing to be lenient about. A
            // non-zero value here would hand a spawned-in-air character a free
            // ground jump.
            coyote_timer: 0.0,
            jump_buffer_timer: 0.0,
        }
    }
}

/// Everything one frame of character motion depends on.
#[derive(Debug, Clone, Copy)]
pub struct CharacterStepInput {
    /// Frame delta in seconds.
    pub dt: f32,
    /// Desired horizontal direction. Magnitude is ignored — it is normalized
    /// and scaled by `speed` — and the Y component is discarded, because
    /// vertical motion is owned entirely by gravity and jumping.
    pub move_dir: Vec3,
    /// True only on the frame the jump action went down.
    pub jump_just_pressed: bool,
    /// Whether Rapier reported the character standing on something last frame.
    pub grounded: bool,
    /// Horizontal speed in units/s.
    pub speed: f32,
    /// Initial upward speed given by a jump, in units/s.
    pub jump_speed: f32,
    /// Multiplier on [`GRAVITY_ACCEL`].
    pub gravity_scale: f32,
    /// Whether one extra mid-air jump is allowed.
    pub can_double_jump: bool,
    /// Whether Rapier refused last frame's upward motion — see
    /// [`vertical_motion_blocked`]. Carries the same one-frame latency as
    /// `grounded`, because it is read from the same `PostUpdate` output.
    pub vertical_blocked: bool,
}

/// Advances one frame of character motion and returns the translation to hand
/// to the Rapier controller.
///
/// Pure: everything it needs is in `state` and `input`, which is what makes
/// gravity, grounding and jump gating testable without running the physics
/// pipeline.
pub fn step_character(state: &mut CharacterMotionState, input: CharacterStepInput) -> Vec3 {
    let dt = if input.dt.is_finite() && input.dt > 0.0 { input.dt } else { 0.0 };

    state.grounded = input.grounded;

    // `vertical_velocity <= 0.0` is what distinguishes a real landing from the
    // frame right after a jump: Rapier reports its contact state from PostUpdate,
    // so the frame after a ground jump still reads `grounded == true` while the
    // character is already rising. Refilling the jump budget there would hand a
    // `canDoubleJump` character a third jump.
    if input.grounded && state.vertical_velocity <= 0.0 {
        state.jumps_used = 0;
        state.vertical_velocity = GROUND_STICK_VELOCITY;
        // Refilled on every grounded frame rather than only on the landing
        // frame, so the window always measures time since the character LEFT
        // the ground, whatever it did while standing there.
        state.coyote_timer = COYOTE_TIME_SECONDS;
    } else {
        // Airborne (or rising through a stale `grounded` report). The coyote
        // window is what keeps the ground jump spendable for a moment after
        // walking off a ledge; only once it expires is the ground jump
        // considered spent, so `canDoubleJump` still means exactly one mid-air
        // jump rather than two.
        state.coyote_timer = (state.coyote_timer - dt).max(0.0);
        if state.jumps_used == 0 && state.coyote_timer <= 0.0 {
            state.jumps_used = 1;
        }
    }

    // A rise Rapier refused loses its upward speed here. This is the only place
    // it can happen: Rapier clamps the translation and reports the clamp, but it
    // never touches our velocity, so an uncancelled jump keeps re-requesting the
    // same blocked rise for its whole ~0.8s ascent (see
    // [`vertical_motion_blocked`]).
    //
    // Deliberately BEFORE the jump gating: the report is last frame's, so a jump
    // accepted THIS frame has to win over a stale block. And deliberately AFTER
    // the grounded bookkeeping above, so zeroing the velocity here can never be
    // mistaken for a landing and refill the jump budget.
    if input.vertical_blocked && state.vertical_velocity > 0.0 {
        state.vertical_velocity = 0.0;
    }

    // A press is REMEMBERED rather than consumed on the spot. Without this a
    // press one frame before touching down is spent against a `jumps_used` that
    // has not been refilled yet, and is silently lost; the player experiences it
    // as the game dropping inputs.
    if input.jump_just_pressed {
        state.jump_buffer_timer = JUMP_BUFFER_SECONDS;
    } else {
        state.jump_buffer_timer = (state.jump_buffer_timer - dt).max(0.0);
    }

    if state.jump_buffer_timer > 0.0 {
        let max_jumps = if input.can_double_jump { 2 } else { 1 };
        if state.jumps_used < max_jumps {
            state.jumps_used += 1;
            // An authored `jumpHeight` of 0 must not fling the character
            // downward, and the clamp range allows a negative to be sent.
            state.vertical_velocity = input.jump_speed.max(0.0);
            state.grounded = false;
            // Both windows close on a spent jump. The buffer so one press
            // cannot also be re-tried next frame against a `canDoubleJump`
            // budget; the coyote timer so the ledge grace cannot outlive the
            // jump it was granted for.
            state.jump_buffer_timer = 0.0;
            state.coyote_timer = 0.0;
        }
    }

    let gravity_scale = if input.gravity_scale.is_finite() { input.gravity_scale } else { 1.0 };
    state.vertical_velocity += GRAVITY_ACCEL * gravity_scale * dt;
    // Bound the MAGNITUDE, not just the fall. A negative `gravityScale` is
    // authorable and accelerates the character upward instead, so a one-sided
    // floor leaves the rise unbounded — see [`MAX_RISE_VELOCITY`]. Written as
    // explicit branches rather than `f32::clamp` deliberately: `clamp` panics on
    // a NaN bound and would also rewrite a NaN velocity into a finite one,
    // hiding a non-finite state this function is careful to pass through
    // untouched everywhere else.
    if state.vertical_velocity < TERMINAL_VELOCITY {
        state.vertical_velocity = TERMINAL_VELOCITY;
    } else if state.vertical_velocity > MAX_RISE_VELOCITY {
        state.vertical_velocity = MAX_RISE_VELOCITY;
    }

    let mut horizontal = input.move_dir;
    horizontal.y = 0.0;
    let horizontal = if horizontal.length_squared() > 0.0 {
        horizontal.normalize() * input.speed
    } else {
        Vec3::ZERO
    };

    Vec3::new(
        horizontal.x * dt,
        state.vertical_velocity * dt,
        horizontal.z * dt,
    )
}

/// Initial upward speed that carries a character to `height` units under
/// `GRAVITY_ACCEL * gravity_scale`, from `v² = 2·g·h`.
///
/// `CharacterControllerData::jump_height` is authored as a HEIGHT — the
/// inspector labels it one, the GDD pipeline writes one, and the runner
/// template means one — so feeding it straight in as a velocity made the
/// apex depend on the gravity scale and quietly turned an authored 2-unit hop
/// into a 0.2-unit one. A non-finite or non-positive gravity scale falls back
/// to 1.0 (zero gravity has no finite answer, and [`step_character`] treats an
/// unusable scale the same way); a non-finite or negative height is a zero
/// jump, matching the `max(0.0)` guard on the speed itself.
pub fn jump_speed_for_height(height: f32, gravity_scale: f32) -> f32 {
    let scale = if gravity_scale.is_finite() && gravity_scale > 0.0 { gravity_scale } else { 1.0 };
    let h = if height.is_finite() { height.max(0.0) } else { 0.0 };
    (2.0 * GRAVITY_ACCEL.abs() * scale * h).sqrt()
}

/// True when the entity carries a character-controller game component.
pub fn has_character_controller(components: &GameComponents) -> bool {
    components
        .components
        .iter()
        .any(|c| matches!(c, GameComponentData::CharacterController(_)))
}

/// The Rapier controller configuration every SpawnForge character uses.
fn make_controller() -> KinematicCharacterController {
    KinematicCharacterController {
        up: Vec3::Y,
        offset: CharacterLength::Absolute(CONTROLLER_OFFSET),
        slide: true,
        autostep: Some(CharacterAutostep {
            max_height: CharacterLength::Absolute(STEP_HEIGHT),
            min_width: CharacterLength::Absolute(MIN_STEP_WIDTH),
            include_dynamic_bodies: true,
        }),
        max_slope_climb_angle: MAX_SLOPE_CLIMB_DEGREES.to_radians(),
        min_slope_slide_angle: MIN_SLOPE_SLIDE_DEGREES.to_radians(),
        snap_to_ground: Some(CharacterLength::Absolute(SNAP_TO_GROUND)),
        apply_impulse_to_dynamic_bodies: true,
        ..default()
    }
}

/// The entities eligible to gain a controller: a character with a collider that
/// does not already have one. Aliased because the inline form trips
/// `clippy::type_complexity`.
type CharacterAttachTargets<'w, 's> = Query<
    'w,
    's,
    (Entity, &'static GameComponents),
    (With<Collider>, Without<KinematicCharacterController>),
>;

/// The entities that WANTED a controller and did not get one: a character with
/// no collider.
///
/// Colliders only ever arrive from `manage_physics_lifecycle`, whose query is
/// filtered `With<PhysicsEnabled>`, so this is exactly the set whose physics was
/// never enabled.
type CharacterMissingColliderTargets<'w, 's> = Query<
    'w,
    's,
    (Entity, Option<&'static EntityId>, &'static GameComponents),
    (Without<Collider>, Without<KinematicCharacterController>),
>;

/// Characters that entered Play with no collider and therefore kept the legacy
/// raw-translation path.
///
/// Skipping them is correct — Rapier's controller ignores an entity with no
/// collider handle, so attaching one would freeze the player rather than move
/// it. Skipping them in SILENCE is not: such an entity never matches
/// [`CharacterAttachTargets`] at all, so it is not rejected, it is never
/// considered, and there is no log, no event and no
/// `CHARACTER_GROUNDED_CHANGED` to distinguish it from a working character. That
/// is the PF-1214 golden-path failure exactly — the generation pipeline did not
/// enable physics on the player, and the player walked through walls in a scene
/// that looked healthy from every angle.
///
/// Written on every 3D Edit→Play transition even when empty, so "nothing was
/// skipped" is distinguishable from "the lifecycle never ran". 2D projects use
/// the legacy path by design and are never recorded. This is the programmatic
/// half of the `tracing::warn!` beside it: the warning is what a developer sees,
/// this is what a test — or a future editor diagnostic — can read.
#[derive(Resource, Debug, Clone, Default, PartialEq, Eq)]
pub struct CharacterControllerDiagnostics {
    /// Identifiers of the skipped characters, sorted. Sorted because ECS query
    /// iteration order is unspecified, and a diagnostic that reshuffles between
    /// runs can be neither asserted on nor matched against a bug report — the
    /// same reason [`diff_grounded`] sorts.
    pub skipped_without_collider: Vec<String>,
}

/// Attaches the Rapier character controller on Edit→Play and removes it on
/// Play→Edit.
///
/// MUST be `.chain()`ed after `manage_physics_lifecycle`:
///
/// * Rapier's `update_character_controls` skips any entity without a collider
///   handle, so the `With<Collider>` filter here only matches once the physics
///   lifecycle's deferred `Collider` insert has been flushed — and an explicit
///   ordering edge is what inserts that flush.
/// * Both systems insert `RigidBody` and `LockedAxes` on the same entity. A
///   character must be `KinematicPositionBased` (a dynamic body would be
///   simulated and fight the controller for the transform) and rotation-locked
///   (otherwise it tips over on the first contact). Running second is what
///   makes those the values that survive.
pub fn manage_character_controller_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    project_type: Option<Res<ProjectType>>,
    to_attach: CharacterAttachTargets,
    missing_collider: CharacterMissingColliderTargets,
    to_detach: Query<Entity, With<KinematicCharacterController>>,
    mut prev_mode: Local<Option<EngineMode>>,
) {
    let current = *engine_mode;
    let prev = *prev_mode;
    *prev_mode = Some(current);

    // The resource is absent until the first `set_project_type`, and the
    // engine's own default is 3D — so absent must behave exactly like 3D.
    let is_2d = matches!(project_type.as_deref(), Some(ProjectType::TwoD));

    let entering_play = current == EngineMode::Play && prev.is_none_or(|p| p == EngineMode::Edit);
    if entering_play && !is_2d {
        let mut attached = 0usize;
        for (entity, components) in to_attach.iter() {
            if !has_character_controller(components) {
                continue;
            }
            commands
                .entity(entity)
                .insert(make_controller())
                .insert(CharacterMotionState::default())
                .insert(RigidBody::KinematicPositionBased)
                .insert(LockedAxes::ROTATION_LOCKED)
                // Rapier's narrow phase only generates contacts for the body
                // pairs named here, and the DEFAULT set is dynamic-vs-anything
                // only. A `KinematicPositionBased` character therefore produces
                // no `CollisionEvent::Started` against the FIXED bodies and
                // sensors that every gameplay component is built on: with the
                // controller attached and nothing else, collectibles are never
                // picked up, ReachGoal never wins, checkpoints never arm, damage
                // zones never hurt and `forge.physics.onCollisionEnter` never
                // fires. The kinematic pairs have to be opted into explicitly.
                //
                // `default() | ...` rather than a bare pair: dynamic props still
                // need their own contacts, and dropping the defaults here would
                // trade one silent break for another.
                .insert(
                    ActiveCollisionTypes::default()
                        | ActiveCollisionTypes::KINEMATIC_STATIC
                        | ActiveCollisionTypes::KINEMATIC_KINEMATIC,
                );
            attached += 1;
        }
        if attached > 0 {
            tracing::info!("Character controllers attached: {} entities", attached);
        }

        // The negative case. An entity with no collider never reaches the loop
        // above at all, so without this it keeps the legacy raw-translation path
        // in complete silence (see [`CharacterControllerDiagnostics`]).
        let mut skipped: Vec<String> = missing_collider
            .iter()
            .filter(|(_, _, components)| has_character_controller(components))
            // `EntityId` is read as an Option so a character that is missing one
            // is still reported, under its Bevy entity. Requiring the component
            // would filter it out of the query and reintroduce the very silence
            // this closes, one entity at a time.
            .map(|(entity, id, _)| id.map_or_else(|| format!("{entity}"), |id| id.0.clone()))
            .collect();
        skipped.sort();
        if !skipped.is_empty() {
            tracing::warn!(
                "Character controller NOT attached to {} entities ({}): they have no collider, \
                 so physics is not enabled on them. They keep the legacy raw-translation path - \
                 no gravity, no ground contact and no collision response.",
                skipped.len(),
                skipped.join(", ")
            );
        }
        commands.insert_resource(CharacterControllerDiagnostics {
            skipped_without_collider: skipped,
        });
    }

    let entering_edit = current == EngineMode::Edit && prev.is_some_and(|p| p != EngineMode::Edit);
    if entering_edit {
        for entity in to_detach.iter() {
            commands
                .entity(entity)
                .remove::<KinematicCharacterController>()
                .remove::<KinematicCharacterControllerOutput>()
                .remove::<CharacterMotionState>()
                // Removed with the rest of the play-only kit. Left behind it
                // would widen the contact set of an entity that is no longer a
                // character for the whole editing session, and survive into the
                // next Play as state the attach path never wrote.
                .remove::<ActiveCollisionTypes>();
        }
    }
}

/// The grounded changes to emit this frame, given the state JS was last told
/// about and the state now.
///
/// Emitting every character's flag every frame would be one event per character
/// per frame for the whole play session, so only changes go out. Two properties
/// make this safe to consume as a running mirror:
///
/// * A character that has DISAPPEARED from `current` (despawned, or Play->Edit
///   stripped its controller) is reported as `false` rather than dropped. A
///   consumer that only ever saw `true` would otherwise keep a stale "grounded"
///   forever, and the caller's `prev` map would grow for the whole session.
/// * Order is sorted by entity id, so the emission sequence is deterministic —
///   `HashMap` iteration order is not, and a nondeterministic event stream is
///   untestable and unreproducible from a bug report.
pub fn diff_grounded(
    prev: &HashMap<String, bool>,
    current: &HashMap<String, bool>,
) -> Vec<(String, bool)> {
    let mut changes: Vec<(String, bool)> = Vec::new();

    for (id, grounded) in current {
        if prev.get(id) != Some(grounded) {
            changes.push((id.clone(), *grounded));
        }
    }
    for (id, was_grounded) in prev {
        if !current.contains_key(id) && *was_grounded {
            changes.push((id.clone(), false));
        }
    }

    changes.sort_by(|a, b| a.0.cmp(&b.0));
    changes
}

/// The platform motion to carry the character by this frame, given every
/// contact it had, as `(contact normal, that entity's movement this frame)`.
///
/// A `KinematicPositionBased` character is moved only by the translation we
/// hand Rapier, so standing on a moving platform means standing STILL in world
/// space while the platform slides out from under it. The platform's collider
/// then shoves the capsule on the next step and the player skates, jitters, or
/// falls off something they are visibly standing on.
///
/// Only a SUPPORTING contact carries. A wall the character is pressed against
/// is also a contact, and a moving wall must push, not carry — hence the
/// [`GROUND_NORMAL_MIN_Y`] gate, which is the same 45° the controller will walk
/// up. Where several supporting contacts qualify (a seam between two
/// platforms), the most upward-facing one wins: it is the surface bearing the
/// character's weight, and picking deterministically matters because contact
/// order is unspecified.
///
/// Non-finite input is skipped rather than propagated: one NaN normal would
/// otherwise poison the character's translation for the rest of the session.
pub fn select_carry_delta(contacts: &[(Vec3, Vec3)]) -> Vec3 {
    let mut best: Option<(f32, Vec3)> = None;

    for (normal, delta) in contacts {
        if !normal.is_finite() || !delta.is_finite() {
            continue;
        }
        if normal.y < GROUND_NORMAL_MIN_Y {
            continue;
        }
        if *delta == Vec3::ZERO {
            continue;
        }
        if best.is_none_or(|(best_y, _)| normal.y > best_y) {
            best = Some((normal.y, *delta));
        }
    }

    best.map_or(Vec3::ZERO, |(_, delta)| delta)
}

/// The JS-side mirror of every character's grounded flag.
///
/// Exists in `core/` rather than as a `Local<HashMap<..>>` inside the bridge
/// system because the bridge is `#[cfg(target_arch = "wasm32")]` and is never
/// compiled by `cargo test` — a state machine living there cannot be asserted
/// on at all, and this one has a behaviour worth asserting: it must FORGET
/// everything when play stops, so a stop-then-restart re-emits the initial
/// state instead of silently agreeing with a mirror the JS side has already
/// discarded.
#[derive(Debug, Default)]
pub struct GroundedMirror {
    prev: HashMap<String, bool>,
}

impl GroundedMirror {
    /// Folds this frame's grounded map in and returns the changes to emit.
    ///
    /// `play_active` false clears the mirror and emits nothing: the runtime is
    /// gone, so there are no characters to report on, and any `true` still held
    /// here would be re-emitted as a spurious `false` the moment play resumed.
    pub fn observe(
        &mut self,
        play_active: bool,
        current: HashMap<String, bool>,
    ) -> Vec<(String, bool)> {
        if !play_active {
            self.prev.clear();
            return Vec::new();
        }

        let changes = diff_grounded(&self.prev, &current);
        self.prev = current;
        changes
    }
}

/// The JS-side mirror of [`CharacterControllerDiagnostics`].
///
/// Same reasoning as [`GroundedMirror`]: the emit lives in the bridge, so the
/// "only when it changed" logic has to live here to be testable. Change-gated
/// because the resource is read every frame while the warning it carries is
/// authored once per play session — emitting it per frame would bury the
/// editor's toast under thousands of duplicates.
#[derive(Debug, Default)]
pub struct DiagnosticsMirror {
    prev: Option<Vec<String>>,
}

impl DiagnosticsMirror {
    /// Returns the skipped-entity list to emit, or `None` when nothing changed.
    ///
    /// The EMPTY list is a real value that must be emitted once: "this play
    /// session skipped nobody" is what clears a warning left over from the
    /// previous one. `None` means only "no news".
    pub fn observe(&mut self, play_active: bool, current: &[String]) -> Option<Vec<String>> {
        if !play_active {
            self.prev = None;
            return None;
        }
        if self.prev.as_deref() == Some(current) {
            return None;
        }
        self.prev = Some(current.to_vec());
        Some(current.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::game_components::CharacterControllerData;

    fn base_input() -> CharacterStepInput {
        CharacterStepInput {
            dt: 0.1,
            move_dir: Vec3::ZERO,
            jump_just_pressed: false,
            grounded: false,
            speed: 5.0,
            jump_speed: 8.0,
            gravity_scale: 1.0,
            can_double_jump: false,
            vertical_blocked: false,
        }
    }

    /// `jumpHeight` is a height. Integrating a jump from the ground with the
    /// derived speed must peak at (about) that height — not at whatever
    /// `v²/2g` happens to be for the raw number, and not at a different apex
    /// when the gravity scale changes.
    #[test]
    fn jump_speed_for_height_reaches_the_authored_apex() {
        for (height, gravity_scale) in [(2.0_f32, 1.0_f32), (0.5, 1.0), (3.0, 2.0), (1.0, 0.5)] {
            let dt = 1.0 / 240.0;
            let mut state = CharacterMotionState { vertical_velocity: 0.0, ..Default::default() };
            let mut input = CharacterStepInput {
                dt,
                grounded: true,
                jump_just_pressed: true,
                jump_speed: jump_speed_for_height(height, gravity_scale),
                gravity_scale,
                ..base_input()
            };
            let mut y = 0.0_f32;
            let mut apex = 0.0_f32;
            for _ in 0..10_000 {
                y += step_character(&mut state, input).y;
                apex = apex.max(y);
                input.grounded = false;
                input.jump_just_pressed = false;
                if state.vertical_velocity <= 0.0 {
                    break;
                }
            }
            // Semi-implicit Euler applies gravity before the displacement, so
            // it undershoots the analytic apex by at most one frame of launch
            // speed; a raw-velocity reading would miss by a factor of `2g`.
            let tolerance = input.jump_speed * dt + 1e-3;
            assert!(
                (apex - height).abs() <= tolerance,
                "height {height} at gravity {gravity_scale}: apex {apex} (tolerance {tolerance})"
            );
        }
    }

    #[test]
    fn jump_speed_for_height_is_zero_for_unusable_heights_and_ignores_bad_gravity() {
        assert_eq!(jump_speed_for_height(0.0, 1.0), 0.0);
        assert_eq!(jump_speed_for_height(-3.0, 1.0), 0.0);
        assert_eq!(jump_speed_for_height(f32::NAN, 1.0), 0.0);
        let unit = jump_speed_for_height(2.0, 1.0);
        assert_eq!(jump_speed_for_height(2.0, 0.0), unit, "zero gravity falls back to 1.0");
        assert_eq!(jump_speed_for_height(2.0, -1.0), unit, "negative gravity falls back to 1.0");
        assert_eq!(jump_speed_for_height(2.0, f32::INFINITY), unit, "non-finite gravity falls back to 1.0");
        assert!(jump_speed_for_height(2.0, 2.0) > unit, "heavier gravity needs a faster launch");
    }

    /// The whole point of the ticket: an airborne character must accelerate
    /// downward. The pre-fix system produced exactly Vec3::ZERO here.
    #[test]
    fn gravity_pulls_an_airborne_character_down() {
        let mut state = CharacterMotionState::default();
        let first = step_character(&mut state, base_input());
        assert!(first.y < 0.0, "first airborne frame must move down, got {}", first.y);

        let second = step_character(&mut state, base_input());
        assert!(
            second.y < first.y,
            "fall must accelerate: frame 2 ({}) should exceed frame 1 ({})",
            second.y,
            first.y
        );
    }

    #[test]
    fn fall_speed_is_capped_at_terminal_velocity() {
        let mut state = CharacterMotionState::default();
        for _ in 0..1000 {
            step_character(&mut state, base_input());
        }
        assert_eq!(state.vertical_velocity, TERMINAL_VELOCITY);
    }

    #[test]
    fn a_grounded_character_does_not_accumulate_fall_speed() {
        let mut state = CharacterMotionState::default();
        let grounded = CharacterStepInput { grounded: true, ..base_input() };
        for _ in 0..100 {
            step_character(&mut state, grounded);
        }
        assert!(
            state.vertical_velocity > TERMINAL_VELOCITY,
            "standing still must not build up fall speed, got {}",
            state.vertical_velocity
        );
        assert!(state.grounded);
    }

    #[test]
    fn jump_rises_when_grounded() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(out.y > 0.0, "a grounded jump must move up, got {}", out.y);
        assert!(state.vertical_velocity > 0.0);
        assert_eq!(state.jumps_used, 1);
    }

    /// The frame a jump is accepted must report NOT grounded, even though the
    /// input said grounded — Rapier writes its contact output in `PostUpdate`,
    /// so its raw flag still reads `true` while the character is already
    /// rising. `bridge::game::emit_character_grounded_system` emits THIS field,
    /// so without the correction `forge.physics.isGrounded()` answers `true`
    /// for the first frame of every jump.
    #[test]
    fn an_accepted_jump_reports_not_grounded_on_the_same_frame() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(!state.grounded, "takeoff frame must not report grounded");
    }

    /// The mirror image: with no jump accepted, the reported contact state is
    /// exactly what the engine reported, in BOTH directions. A one-way pin
    /// would be satisfied by a field hardwired to `false`, which is precisely
    /// the shape the bug would take.
    #[test]
    fn without_a_jump_the_reported_contact_follows_the_engine() {
        let mut state = CharacterMotionState::default();

        step_character(&mut state, CharacterStepInput { grounded: true, ..base_input() });
        assert!(state.grounded, "standing on something must report grounded");

        step_character(&mut state, base_input());
        assert!(!state.grounded, "leaving the ground must stop reporting grounded");

        step_character(&mut state, CharacterStepInput { grounded: true, ..base_input() });
        assert!(state.grounded, "landing must report grounded again");
    }

    /// A jump the gating REFUSES must not fake a takeoff: the character is
    /// still exactly where it was, so a script must not be told it left the
    /// ground.
    #[test]
    fn a_refused_mid_air_jump_does_not_fake_a_takeoff() {
        let mut state = CharacterMotionState::default();
        // Airborne, ground jump spent, no double jump — the next jump is refused.
        step_character(&mut state, base_input());
        assert_eq!(state.jumps_used, 1);

        step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..base_input() },
        );
        assert_eq!(state.jumps_used, 1, "the refused jump must not spend budget");
        assert!(!state.grounded);
    }

    #[test]
    fn jump_is_ignored_in_mid_air_without_double_jump() {
        let mut state = CharacterMotionState::default();
        // Fall for a frame so the character is unambiguously airborne.
        step_character(&mut state, base_input());
        let falling = state.vertical_velocity;

        let out = step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..base_input() },
        );
        assert!(out.y < 0.0, "mid-air jump must not lift the character, got {}", out.y);
        assert!(state.vertical_velocity < falling);
    }

    #[test]
    fn double_jump_allows_exactly_one_air_jump() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };

        // Ground jump.
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..input },
        );
        assert_eq!(state.jumps_used, 1);

        // Air jump — allowed.
        let air = step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..input },
        );
        assert!(air.y > 0.0, "the second jump must lift, got {}", air.y);
        assert_eq!(state.jumps_used, 2);

        // Third jump — refused.
        let before = state.vertical_velocity;
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(
            state.vertical_velocity < before,
            "a third jump must be refused, velocity went {} -> {}",
            before,
            state.vertical_velocity
        );
    }

    /// Walking off a ledge spends the ground jump. Without this, holding
    /// `canDoubleJump` gives a character that never jumped TWO air jumps.
    #[test]
    fn walking_off_a_ledge_spends_the_ground_jump() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };

        step_character(&mut state, CharacterStepInput { grounded: true, ..input });
        assert_eq!(state.jumps_used, 0);

        // First airborne frame — no jump pressed.
        step_character(&mut state, input);
        assert_eq!(state.jumps_used, 1, "leaving the ground must consume the ground jump");

        // One air jump is granted.
        let air = step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(air.y > 0.0);
        assert_eq!(state.jumps_used, 2);

        // And only one.
        let before = state.vertical_velocity;
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(state.vertical_velocity < before);
    }

    #[test]
    fn landing_clears_the_jump_budget() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };
        step_character(&mut state, CharacterStepInput { grounded: true, jump_just_pressed: true, ..input });
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert_eq!(state.jumps_used, 2);

        // Fall back down. The budget must NOT refill while still rising.
        while state.vertical_velocity > 0.0 {
            step_character(&mut state, input);
            assert_eq!(state.jumps_used, 2, "rising is not landing");
        }

        step_character(&mut state, CharacterStepInput { grounded: true, ..input });
        assert_eq!(state.jumps_used, 0, "landing must refill the jump budget");
    }

    /// Diagonal input must not travel faster than a single axis, and the
    /// distance must be `speed * dt` — not the raw unscaled input.
    #[test]
    fn horizontal_movement_is_normalized_and_speed_scaled() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput {
                grounded: true,
                move_dir: Vec3::new(1.0, 0.0, -1.0),
                speed: 7.0,
                dt: 0.1,
                ..base_input()
            },
        );
        let planar = Vec3::new(out.x, 0.0, out.z).length();
        assert!(
            (planar - 0.7).abs() < 1e-4,
            "diagonal travel must be speed*dt = 0.7, got {planar}"
        );
    }

    /// The Y component of an authored move direction is discarded — vertical
    /// motion belongs to gravity and jumping alone, and letting input add to it
    /// is exactly the "jump is a translation tween" bug this replaced.
    #[test]
    fn vertical_input_never_contributes_to_motion() {
        let mut state_with = CharacterMotionState::default();
        let with_y = step_character(
            &mut state_with,
            CharacterStepInput { grounded: true, move_dir: Vec3::new(1.0, 5.0, 0.0), ..base_input() },
        );
        let mut state_without = CharacterMotionState::default();
        let without_y = step_character(
            &mut state_without,
            CharacterStepInput { grounded: true, move_dir: Vec3::new(1.0, 0.0, 0.0), ..base_input() },
        );
        assert_eq!(with_y, without_y);
    }

    #[test]
    fn gravity_scale_scales_the_fall() {
        let mut normal = CharacterMotionState::default();
        step_character(&mut normal, base_input());
        let mut heavy = CharacterMotionState::default();
        step_character(&mut heavy, CharacterStepInput { gravity_scale: 2.0, ..base_input() });
        assert!(
            heavy.vertical_velocity < normal.vertical_velocity,
            "gravityScale 2 must fall faster: {} vs {}",
            heavy.vertical_velocity,
            normal.vertical_velocity
        );
    }

    #[test]
    fn a_zero_delta_frame_moves_nothing() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput { dt: 0.0, move_dir: Vec3::X, ..base_input() },
        );
        assert_eq!(out, Vec3::ZERO);
    }

    // ---- Ceiling ----

    /// Rapier refuses the motion but never writes the refusal back into our
    /// velocity, so without this the character keeps requesting `+v*dt` for the
    /// whole ascent and glides along the ceiling. At the default jump height
    /// (8.0) that is ~0.8s and ~48 frames of the player stuck to the underside
    /// of a platform.
    #[test]
    fn a_jump_into_a_ceiling_stops_rising_immediately() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(state.vertical_velocity > 0.0, "precondition: the character is rising");

        let out = step_character(
            &mut state,
            CharacterStepInput { vertical_blocked: true, ..base_input() },
        );
        assert!(out.y < 0.0, "a blocked rise must turn into a fall, got {}", out.y);
        assert!(state.vertical_velocity < 0.0);
    }

    /// The clamp must leave the character in EXACTLY the state of an
    /// unobstructed fall from rest — no residue of the cancelled jump — so it
    /// reaches the ground in the same number of frames as a character that
    /// simply stepped off the ledge at that height.
    #[test]
    fn a_blocked_rise_falls_exactly_like_a_fall_from_rest() {
        let mut blocked = CharacterMotionState::default();
        step_character(
            &mut blocked,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        step_character(&mut blocked, CharacterStepInput { vertical_blocked: true, ..base_input() });

        let mut from_rest = CharacterMotionState { vertical_velocity: 0.0, ..Default::default() };
        step_character(&mut from_rest, base_input());

        assert_eq!(
            blocked.vertical_velocity, from_rest.vertical_velocity,
            "a cancelled jump must fall exactly like a fall from rest"
        );
    }

    /// The clamp is one-directional. A downward request Rapier refuses is the
    /// floor, and the floor is `grounded`'s job — zeroing the fall here would
    /// cancel `GROUND_STICK_VELOCITY` and make `snap_to_ground` let go on the
    /// first ramp seam.
    #[test]
    fn a_blocked_fall_is_left_alone() {
        let mut blocked = CharacterMotionState::default();
        step_character(&mut blocked, CharacterStepInput { vertical_blocked: true, ..base_input() });

        let mut free = CharacterMotionState::default();
        step_character(&mut free, base_input());

        assert_eq!(blocked.vertical_velocity, free.vertical_velocity);
        assert!(blocked.vertical_velocity < 0.0);
    }

    /// The block report is last frame's — Rapier writes its output in
    /// `PostUpdate`, exactly like `grounded`. A jump accepted THIS frame must
    /// therefore win over it, or a character standing under a low ceiling that
    /// blocked it a moment ago can never jump again.
    #[test]
    fn a_jump_accepted_this_frame_beats_a_stale_block() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput {
                grounded: true,
                jump_just_pressed: true,
                vertical_blocked: true,
                ..base_input()
            },
        );
        assert!(out.y > 0.0, "a fresh jump must still rise, got {}", out.y);
        assert!(state.vertical_velocity > 0.0);
    }

    /// A clamped ascent must not refill the jump budget: the character is still
    /// in the air, pressed against a ceiling, and `canDoubleJump` must still
    /// grant exactly one air jump.
    #[test]
    fn a_blocked_rise_does_not_refill_the_jump_budget() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..input },
        );
        assert_eq!(state.jumps_used, 1);

        step_character(&mut state, CharacterStepInput { vertical_blocked: true, ..input });
        assert_eq!(state.jumps_used, 1, "hitting a ceiling is not landing");
    }

    // ---- vertical_motion_blocked ----

    #[test]
    fn an_upward_request_rapier_swallowed_is_blocked() {
        assert!(vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.0, 0.0)));
    }

    #[test]
    fn an_upward_request_rapier_honoured_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.8, 0.0)));
    }

    /// A rise partly eaten by the skin width or a grazing contact is still a
    /// rise. Only a rise that mostly did not happen counts as a ceiling.
    #[test]
    fn a_mostly_honoured_rise_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.79, 0.0)));
    }

    /// Downward is the floor, not a ceiling — `grounded` owns that case.
    #[test]
    fn a_swallowed_downward_request_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, -0.8, 0.0), Vec3::ZERO));
    }

    /// A frame with no vertical request at all (standing still, dt 0) must not
    /// be read as a ceiling: `0.0 < 0.0 * 0.5` is false, but a hair of float
    /// noise on either side would flip it, so the epsilon is the real guard.
    #[test]
    fn a_frame_with_no_vertical_request_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::ZERO, Vec3::ZERO));
        assert!(!vertical_motion_blocked(
            Vec3::new(0.0, VERTICAL_BLOCK_EPSILON * 0.5, 0.0),
            Vec3::new(0.0, -1.0, 0.0)
        ));
    }

    /// A NaN reaching the predicate must not be read as a ceiling — every
    /// comparison against NaN is false, so the guard has to be explicit.
    #[test]
    fn a_non_finite_translation_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, f32::NAN, 0.0), Vec3::ZERO));
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, f32::NAN, 0.0)));
        assert!(!vertical_motion_blocked(Vec3::new(0.0, f32::INFINITY, 0.0), Vec3::ZERO));
    }

    // ---- Lifecycle ----

    fn character() -> GameComponents {
        let mut gc = GameComponents::default();
        gc.components
            .push(GameComponentData::CharacterController(CharacterControllerData::default()));
        gc
    }

    fn run_lifecycle(world: &mut World, schedule: &mut Schedule, mode: EngineMode) {
        world.insert_resource(mode);
        schedule.run(world);
    }

    #[test]
    fn entering_play_attaches_the_controller_to_a_character_with_a_collider() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_some());
        assert!(world.get::<CharacterMotionState>(entity).is_some());
        assert!(matches!(
            world.get::<RigidBody>(entity),
            Some(RigidBody::KinematicPositionBased)
        ));
        assert_eq!(world.get::<LockedAxes>(entity).copied(), Some(LockedAxes::ROTATION_LOCKED));
        assert!(
            world.get::<ActiveCollisionTypes>(entity).is_some(),
            "a kinematic body needs widened collision pairs to generate events at all"
        );
    }

    /// Every field of the attached controller, asserted individually.
    ///
    /// The slope, autostep and snap-to-ground configuration IS the ticket's
    /// "slope/step" deliverable, and `snap_to_ground` is what makes the
    /// `grounded` flag the whole JS-side feature reads correct at all — without
    /// it the flag flickers on every seam in a ramp. None of it is observable
    /// from the outside, so a representative field is not enough: deleting ANY
    /// one of these must turn a test red.
    #[test]
    fn the_attached_controller_carries_the_full_slope_and_step_configuration() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        let controller = world
            .get::<KinematicCharacterController>(entity)
            .expect("controller attached");

        assert_eq!(controller.up, Vec3::Y, "up must be world up");
        assert!(
            matches!(controller.offset, CharacterLength::Absolute(v) if v == CONTROLLER_OFFSET),
            "skin width must be {CONTROLLER_OFFSET}, got {:?}",
            controller.offset
        );
        assert!(controller.slide, "a character must slide along walls, not stick to them");
        assert_eq!(
            controller.max_slope_climb_angle,
            MAX_SLOPE_CLIMB_DEGREES.to_radians(),
            "climb angle is configured in degrees and must reach Rapier as radians"
        );
        assert_eq!(
            controller.min_slope_slide_angle,
            MIN_SLOPE_SLIDE_DEGREES.to_radians(),
            "slide angle is configured in degrees and must reach Rapier as radians"
        );
        assert!(
            matches!(
                controller.snap_to_ground,
                Some(CharacterLength::Absolute(v)) if v == SNAP_TO_GROUND
            ),
            "snap-to-ground is what keeps `grounded` stable on a ramp, got {:?}",
            controller.snap_to_ground
        );
        assert!(
            matches!(
                controller.autostep,
                Some(CharacterAutostep {
                    max_height: CharacterLength::Absolute(h),
                    min_width: CharacterLength::Absolute(w),
                    include_dynamic_bodies: true,
                }) if h == STEP_HEIGHT && w == MIN_STEP_WIDTH
            ),
            "autostep must lift the character over a {STEP_HEIGHT} step, got {:?}",
            controller.autostep
        );
        assert!(
            controller.apply_impulse_to_dynamic_bodies,
            "walking into a crate must push it"
        );

        // Non-vacuity, and its honest bound. Four of the fields above differ
        // from `KinematicCharacterController::default()` (measured against
        // bevy_rapier3d 0.34 / rapier3d 0.32), so deleting the line that sets
        // one of them turns this test red — which is the whole point, since
        // `make_controller` was previously unasserted in full.
        //
        // The other four (`up`, `slide`, `max_slope_climb_angle`,
        // `apply_impulse_to_dynamic_bodies`) RESTATE Rapier's default, so
        // deleting those lines cannot be caught here by any assertion. Stated
        // rather than left for a reader to assume otherwise. These four
        // `assert_ne!`s fail if a future Rapier bump moves a default onto one
        // of our values, which is the signal that the bound has widened.
        let stock = KinematicCharacterController::default();
        assert_ne!(
            controller.offset, stock.offset,
            "skin width must be a deliberate value, not Rapier's default"
        );
        assert_ne!(
            controller.autostep, stock.autostep,
            "autostep is off by default in Rapier; this PR turns it on"
        );
        assert_ne!(
            controller.min_slope_slide_angle, stock.min_slope_slide_angle,
            "the slide angle must be our 30 degrees, not Rapier's 45"
        );
        assert_ne!(
            controller.snap_to_ground, stock.snap_to_ground,
            "snap must be absolute metres, not Rapier's relative default"
        );
    }

    #[test]
    fn a_collider_less_character_is_skipped() {
        // Rapier's controller silently ignores an entity with no collider
        // handle, so attaching to one would freeze the player instead of moving
        // it — the legacy translation path has to keep it.
        let mut world = World::new();
        let entity = world.spawn((character(), Transform::default())).id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
    }

    /// ...and the skip must be REPORTED. Skipping is correct; skipping in
    /// SILENCE is the PF-1214 golden-path break itself — the generation
    /// pipeline never enabled physics on the player, so the player kept the raw
    /// translation path and walked through every wall, with nothing anywhere
    /// saying so.
    #[test]
    fn a_collider_less_character_is_reported_not_silently_dropped() {
        let mut world = World::new();
        world.spawn((EntityId::new("player"), character(), Transform::default()));

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert_eq!(
            world.resource::<CharacterControllerDiagnostics>().skipped_without_collider,
            vec!["player".to_string()],
        );
    }

    /// Non-vacuity in the other direction: a character that DID get a controller
    /// must not be named. The record is still written, so a reader can tell
    /// "nothing was skipped" from "the lifecycle never ran".
    #[test]
    fn a_character_that_got_a_controller_is_not_reported() {
        let mut world = World::new();
        world.spawn((
            EntityId::new("player"),
            character(),
            Collider::cuboid(0.5, 0.5, 0.5),
            Transform::default(),
        ));

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert_eq!(
            world.resource::<CharacterControllerDiagnostics>().skipped_without_collider,
            Vec::<String>::new(),
        );
    }

    /// A prop with no collider is not a character. A warning that names every
    /// static decoration in the scene is one nobody reads, which would put us
    /// back where we started.
    #[test]
    fn a_non_character_without_a_collider_is_not_reported() {
        let mut world = World::new();
        world.spawn((EntityId::new("crate"), GameComponents::default(), Transform::default()));

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert_eq!(
            world.resource::<CharacterControllerDiagnostics>().skipped_without_collider,
            Vec::<String>::new(),
        );
    }

    /// A character missing its `EntityId` must still be reported, under its Bevy
    /// entity as a label. Requiring the component would filter it out of the
    /// query and reintroduce the silence one entity at a time.
    #[test]
    fn a_character_without_an_entity_id_is_still_reported() {
        let mut world = World::new();
        let entity = world.spawn((character(), Transform::default())).id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        // Assert the CONTENT, not just the count: the fallback label is the
        // only thing that lets a creator find an unnamed entity in the
        // hierarchy, and a length check passes just as happily on an empty
        // string or on the debug form of the wrong entity.
        assert_eq!(
            world.resource::<CharacterControllerDiagnostics>().skipped_without_collider,
            vec![format!("{entity}")],
        );
    }

    /// Deterministic order: ECS query iteration order is unspecified, and a
    /// warning whose entity list reshuffles between runs cannot be matched
    /// against a bug report or asserted on.
    #[test]
    fn the_reported_characters_are_sorted() {
        let mut world = World::new();
        for id in ["c", "a", "b"] {
            world.spawn((EntityId::new(id), character(), Transform::default()));
        }

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert_eq!(
            world.resource::<CharacterControllerDiagnostics>().skipped_without_collider,
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
        );
    }

    #[test]
    fn a_non_character_entity_is_skipped() {
        let mut world = World::new();
        let entity = world
            .spawn((GameComponents::default(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
    }

    #[test]
    fn a_2d_project_keeps_the_legacy_path() {
        let mut world = World::new();
        world.insert_resource(ProjectType::TwoD);
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
        assert!(world.get::<CharacterMotionState>(entity).is_none());
        // 2D uses the legacy path by design, so nothing is skipped and nothing
        // is recorded - a warning on every 2D character would be pure noise.
        assert!(world.get_resource::<CharacterControllerDiagnostics>().is_none());
    }

    /// A `KinematicPositionBased` body is NOT a dynamic body, and Rapier's
    /// DEFAULT `ActiveCollisionTypes` covers dynamic-vs-anything only. Without
    /// the two kinematic pairs the character generates no collision events
    /// against static level geometry or against other kinematic bodies (moving
    /// platforms, hazards, pickups) — so every `on_collision` script, every
    /// damage zone and every collectible silently stops firing the moment the
    /// character controller is attached. Nothing else in the engine reports it.
    #[test]
    fn the_kinematic_body_can_collide_with_static_and_kinematic_geometry() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        let types = world
            .get::<ActiveCollisionTypes>(entity)
            .copied()
            .expect("a kinematic character must declare its collision pairs");
        assert!(
            types.contains(ActiveCollisionTypes::KINEMATIC_STATIC),
            "the character must collide with static level geometry"
        );
        assert!(
            types.contains(ActiveCollisionTypes::KINEMATIC_KINEMATIC),
            "the character must collide with moving platforms and other kinematic bodies"
        );
        assert!(
            types.contains(ActiveCollisionTypes::default()),
            "widening must not drop the dynamic pairs the default already covered"
        );

        // Play -> Edit must hand the entity back exactly as it was found, or the
        // widened pairs leak into the editor and outlive the play session.
        run_lifecycle(&mut world, &mut schedule, EngineMode::Edit);
        assert!(
            world.get::<ActiveCollisionTypes>(entity).is_none(),
            "the widened collision pairs must be removed on Play -> Edit"
        );
    }

    #[test]
    fn returning_to_edit_removes_the_controller_and_its_state() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);
        assert!(world.get::<KinematicCharacterController>(entity).is_some());

        run_lifecycle(&mut world, &mut schedule, EngineMode::Edit);
        assert!(world.get::<KinematicCharacterController>(entity).is_none());
        assert!(world.get::<CharacterMotionState>(entity).is_none());
    }

    fn grounded_map(entries: &[(&str, bool)]) -> HashMap<String, bool> {
        entries.iter().map(|(id, g)| ((*id).to_string(), *g)).collect()
    }

    #[test]
    fn an_unchanged_frame_emits_nothing() {
        let prev = grounded_map(&[("player", true), ("enemy", false)]);
        let current = grounded_map(&[("player", true), ("enemy", false)]);
        assert!(diff_grounded(&prev, &current).is_empty());
    }

    #[test]
    fn a_first_sighting_is_a_change_in_both_directions() {
        assert_eq!(
            diff_grounded(&HashMap::new(), &grounded_map(&[("player", true)])),
            vec![("player".to_string(), true)]
        );
        // False matters as much as true: a script asking on frame one must not
        // read "unknown" as "grounded".
        assert_eq!(
            diff_grounded(&HashMap::new(), &grounded_map(&[("player", false)])),
            vec![("player".to_string(), false)]
        );
    }

    #[test]
    fn only_the_character_that_moved_is_reported() {
        let prev = grounded_map(&[("player", true), ("enemy", true)]);
        let current = grounded_map(&[("player", false), ("enemy", true)]);
        assert_eq!(diff_grounded(&prev, &current), vec![("player".to_string(), false)]);
    }

    /// A despawned character must not leave a stale `true` behind in the
    /// consumer's mirror, and must not keep growing the caller's `prev` map.
    #[test]
    fn a_vanished_character_is_reported_as_not_grounded() {
        let prev = grounded_map(&[("player", true)]);
        assert_eq!(
            diff_grounded(&prev, &HashMap::new()),
            vec![("player".to_string(), false)]
        );
    }

    /// It was already `false`, so the mirror is already right — re-announcing it
    /// would emit an event per despawned character forever.
    #[test]
    fn a_vanished_character_that_was_already_airborne_emits_nothing() {
        let prev = grounded_map(&[("player", false)]);
        assert!(diff_grounded(&prev, &HashMap::new()).is_empty());
    }

    #[test]
    fn changes_are_emitted_in_a_deterministic_order() {
        let current = grounded_map(&[("c", true), ("a", true), ("b", true)]);
        let changes = diff_grounded(&HashMap::new(), &current);
        let ids: Vec<&str> = changes.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    // ---- Coyote time (finding #4) ---------------------------------------

    /// The shared fixture runs at `dt = 0.1`, which is exactly the length of
    /// both grace windows — one frame wide, so neither can be observed. These
    /// tests run at 60Hz, where a 0.1s window is the ~6 frames a player
    /// actually gets.
    fn frame_60hz() -> CharacterStepInput {
        CharacterStepInput { dt: 1.0 / 60.0, ..base_input() }
    }

    /// The window measures time since LEAVING ground, so it must be refilled on
    /// every grounded frame, not only the frame the character first lands.
    #[test]
    fn a_jump_lands_just_after_walking_off_a_ledge() {
        let mut state = CharacterMotionState::default();
        // Stand for a while, then walk off.
        for _ in 0..5 {
            step_character(&mut state, CharacterStepInput { grounded: true, ..frame_60hz() });
        }
        // Three airborne frames at 60Hz is 0.05s — half the window.
        for _ in 0..3 {
            step_character(&mut state, frame_60hz());
        }
        assert_eq!(state.jumps_used, 0, "coyote time must not have spent the ground jump yet");

        let out = step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..frame_60hz() },
        );
        assert!(out.y > 0.0, "a jump inside the coyote window must rise, got {}", out.y);
        assert_eq!(state.jumps_used, 1);
    }

    #[test]
    fn a_jump_after_the_coyote_window_is_refused() {
        let mut state = CharacterMotionState::default();
        step_character(&mut state, CharacterStepInput { grounded: true, ..frame_60hz() });
        // Ten airborne frames at 60Hz is 0.167s — well past the 0.1s window.
        for _ in 0..10 {
            step_character(&mut state, frame_60hz());
        }
        assert_eq!(state.jumps_used, 1, "the ground jump must be spent once the window lapses");

        let before = state.vertical_velocity;
        step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..frame_60hz() },
        );
        assert!(
            state.vertical_velocity < before,
            "a late jump must be refused and gravity keep pulling, got {} from {}",
            state.vertical_velocity,
            before
        );
    }

    /// Coyote time must not hand out a free extra jump: after a real ground
    /// jump the character is airborne with the budget already spent, and the
    /// stale `grounded == true` frame Rapier reports must not refill it.
    #[test]
    fn coyote_time_does_not_add_a_jump_after_a_real_jump() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert_eq!(state.jumps_used, 1);
        // Rapier's contact flag lags a frame: still says grounded while rising.
        step_character(&mut state, CharacterStepInput { grounded: true, ..base_input() });
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert_eq!(
            state.jumps_used, 1,
            "a single-jump character must never reach two jumps from one launch"
        );
    }

    // ---- Jump buffer (finding #4) ---------------------------------------

    /// A press a fraction of a second before landing is the single most common
    /// platformer input; without a buffer it is swallowed entirely.
    #[test]
    fn a_jump_pressed_just_before_landing_still_fires() {
        let mut state = CharacterMotionState::default();
        // Airborne long enough that the coyote window is definitively gone.
        for _ in 0..10 {
            step_character(&mut state, frame_60hz());
        }
        // Press while still falling: refused this frame, but buffered.
        step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..frame_60hz() },
        );
        assert!(state.jump_buffer_timer > 0.0, "the press must be buffered");

        // Two more falling frames, then land — still inside the 0.1s buffer,
        // and with no second press.
        for _ in 0..2 {
            step_character(&mut state, frame_60hz());
        }
        let out = step_character(&mut state, CharacterStepInput { grounded: true, ..frame_60hz() });
        assert!(out.y > 0.0, "the buffered press must fire on landing, got {}", out.y);
        assert_eq!(state.jumps_used, 1);
    }

    #[test]
    fn a_buffered_press_expires_rather_than_firing_forever() {
        let mut state = CharacterMotionState::default();
        for _ in 0..10 {
            step_character(&mut state, frame_60hz());
        }
        step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..frame_60hz() },
        );
        // Ten more airborne frames at 60Hz drains the 0.1s buffer.
        for _ in 0..10 {
            step_character(&mut state, frame_60hz());
        }
        assert_eq!(state.jump_buffer_timer, 0.0, "the buffer must decay to zero");

        let out = step_character(&mut state, CharacterStepInput { grounded: true, ..frame_60hz() });
        assert!(
            out.y <= 0.0,
            "a stale press must not launch the character on landing, got {out:?}"
        );
    }

    /// One press must buy exactly one jump. Without zeroing the buffer on
    /// acceptance, the same press would still be live on the next frame and
    /// would immediately spend the double jump too.
    #[test]
    fn one_press_cannot_spend_both_jumps() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput {
                grounded: true,
                jump_just_pressed: true,
                can_double_jump: true,
                ..base_input()
            },
        );
        assert_eq!(state.jumps_used, 1);
        for _ in 0..3 {
            step_character(
                &mut state,
                CharacterStepInput { can_double_jump: true, ..base_input() },
            );
        }
        assert_eq!(
            state.jumps_used, 1,
            "the double jump must wait for a SECOND press, got {}",
            state.jumps_used
        );
    }

    // ---- Symmetric velocity clamp (finding #6) ---------------------------

    /// A negative `gravityScale` (an authored "anti-gravity" feel, or a typo)
    /// accelerates the character UPWARD without bound. The one-sided clamp
    /// caught only the downward runaway, so the upward one reached infinity in
    /// a couple of seconds and every derived translation became non-finite.
    #[test]
    fn a_negative_gravity_scale_stays_bounded() {
        let mut state = CharacterMotionState::default();
        let anti = CharacterStepInput { gravity_scale: -1.0, ..base_input() };
        for _ in 0..1000 {
            let out = step_character(&mut state, anti);
            assert!(out.is_finite(), "translation must stay finite, got {out:?}");
        }
        assert_eq!(state.vertical_velocity, MAX_RISE_VELOCITY);
    }

    #[test]
    fn the_rise_and_fall_caps_are_mirror_images() {
        assert_eq!(MAX_RISE_VELOCITY, -TERMINAL_VELOCITY);
        assert!(MAX_RISE_VELOCITY > 0.0);
    }

    /// The clamp is written as two explicit comparisons rather than
    /// `f32::clamp` so that a NaN velocity passes through instead of being
    /// silently pinned to a bound — a NaN must stay visible, not be laundered
    /// into a plausible-looking number.
    #[test]
    fn a_nan_velocity_is_not_laundered_into_a_bound() {
        let mut state = CharacterMotionState { vertical_velocity: f32::NAN, ..Default::default() };
        step_character(&mut state, base_input());
        assert!(state.vertical_velocity.is_nan());
    }

    // ---- Ground-normal threshold (finding #3) ----------------------------

    /// Rapier's own controller classifies a contact by the angle between the up
    /// axis and `normal1`, so a supporting surface has `normal1.y` near +1 and
    /// the walkable cut-off is the cosine of the climb angle.
    #[test]
    fn ground_normal_threshold_tracks_the_climb_angle() {
        let expected = MAX_SLOPE_CLIMB_DEGREES.to_radians().cos();
        assert!(
            (GROUND_NORMAL_MIN_Y - expected).abs() < 1e-3,
            "threshold {GROUND_NORMAL_MIN_Y} must be cos({MAX_SLOPE_CLIMB_DEGREES}deg) = {expected}"
        );
    }

    // ---- Moving-platform carry (finding #3) ------------------------------

    #[test]
    fn no_contacts_carry_nothing() {
        assert_eq!(select_carry_delta(&[]), Vec3::ZERO);
    }

    #[test]
    fn a_platform_underfoot_is_carried() {
        let delta = Vec3::new(0.5, 0.0, -0.25);
        assert_eq!(select_carry_delta(&[(Vec3::Y, delta)]), delta);
    }

    /// A wall or a ceiling is not a floor. Carrying from a side contact would
    /// shove the character along any moving surface it merely brushed.
    #[test]
    fn a_wall_or_ceiling_contact_carries_nothing() {
        let delta = Vec3::new(1.0, 0.0, 0.0);
        assert_eq!(select_carry_delta(&[(Vec3::X, delta)]), Vec3::ZERO, "wall");
        assert_eq!(select_carry_delta(&[(Vec3::NEG_Y, delta)]), Vec3::ZERO, "ceiling");
        // Exactly at the climb limit is still ground; just past it is not.
        let steep = Vec3::new(0.0, GROUND_NORMAL_MIN_Y - 0.01, 0.9);
        assert_eq!(select_carry_delta(&[(steep, delta)]), Vec3::ZERO, "too steep");
    }

    /// Standing in a corner where two platforms touch: the flattest contact is
    /// the one actually holding the character up.
    #[test]
    fn the_flattest_supporting_contact_wins() {
        let floor = Vec3::new(2.0, 0.0, 0.0);
        let ramp = Vec3::new(0.0, 0.0, 3.0);
        let contacts = [
            (Vec3::new(0.0, 0.8, 0.6).normalize(), ramp),
            (Vec3::Y, floor),
        ];
        assert_eq!(select_carry_delta(&contacts), floor);
    }

    /// A stationary platform contributes nothing, and must not shadow a moving
    /// one the character is also touching.
    #[test]
    fn a_still_platform_does_not_shadow_a_moving_one() {
        let moving = Vec3::new(0.0, 0.0, 0.4);
        let contacts = [
            (Vec3::Y, Vec3::ZERO),
            (Vec3::new(0.0, 0.9, 0.4).normalize(), moving),
        ];
        assert_eq!(select_carry_delta(&contacts), moving);
    }

    #[test]
    fn a_non_finite_contact_is_ignored() {
        let good = Vec3::new(0.0, 0.0, 0.3);
        let contacts = [
            (Vec3::new(f32::NAN, 1.0, 0.0), Vec3::splat(9.0)),
            (Vec3::Y, Vec3::new(f32::INFINITY, 0.0, 0.0)),
            (Vec3::new(0.0, 0.9, 0.1).normalize(), good),
        ];
        assert_eq!(select_carry_delta(&contacts), good);
    }

    // ---- GroundedMirror (finding #16) ------------------------------------

    #[test]
    fn the_mirror_reports_a_first_sighting_in_both_directions() {
        let mut mirror = GroundedMirror::default();
        let mut out = mirror.observe(true, grounded_map(&[("a", true), ("b", false)]));
        out.sort();
        assert_eq!(out, vec![("a".to_string(), true), ("b".to_string(), false)]);
    }

    #[test]
    fn the_mirror_is_silent_when_nothing_changed() {
        let mut mirror = GroundedMirror::default();
        mirror.observe(true, grounded_map(&[("a", true)]));
        assert!(mirror.observe(true, grounded_map(&[("a", true)])).is_empty());
    }

    /// Leaving Play must forget everything, so that a restarted game re-emits
    /// the full grounded state instead of silently agreeing with a stale
    /// mirror from the previous session — the browser's own map was cleared on
    /// stop, so agreement means it never learns the truth.
    #[test]
    fn stopping_then_restarting_re_emits_the_state() {
        let mut mirror = GroundedMirror::default();
        mirror.observe(true, grounded_map(&[("a", true)]));
        assert!(mirror.observe(false, grounded_map(&[("a", true)])).is_empty(), "stop emits nothing");
        assert_eq!(
            mirror.observe(true, grounded_map(&[("a", true)])),
            vec![("a".to_string(), true)],
            "a restart must re-emit even an unchanged value"
        );
    }

    // ---- DiagnosticsMirror (finding #2) ----------------------------------

    #[test]
    fn diagnostics_are_emitted_once_then_stay_quiet() {
        let mut mirror = DiagnosticsMirror::default();
        let first = mirror.observe(true, &["player".to_string()]);
        assert_eq!(first, Some(vec!["player".to_string()]));
        assert_eq!(mirror.observe(true, &["player".to_string()]), None);
    }

    /// An empty list is a real value, not "nothing to say": it is how the UI
    /// learns that a previously-skipped character now has a collider.
    #[test]
    fn a_list_that_becomes_empty_is_reported() {
        let mut mirror = DiagnosticsMirror::default();
        mirror.observe(true, &["player".to_string()]);
        assert_eq!(mirror.observe(true, &[]), Some(Vec::new()));
        assert_eq!(mirror.observe(true, &[]), None);
    }

    #[test]
    fn diagnostics_reset_on_stop_so_a_restart_re_reports() {
        let mut mirror = DiagnosticsMirror::default();
        mirror.observe(true, &["player".to_string()]);
        assert_eq!(mirror.observe(false, &["player".to_string()]), None, "stop emits nothing");
        assert_eq!(
            mirror.observe(true, &["player".to_string()]),
            Some(vec!["player".to_string()]),
            "a restart must re-report the same skipped character"
        );
    }
}
