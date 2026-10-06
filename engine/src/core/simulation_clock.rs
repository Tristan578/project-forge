//! Pinned simulation clock for deterministic input replay (#10007).
//!
//! Every simulation system in this engine steps by `Time::delta_secs()`:
//! `game_components::system_character_controller` scales the character's
//! movement by it, and Rapier's default `TimestepMode::Variable` integrates
//! `min(delta * time_scale, max_dt)` per frame (bevy_rapier 0.35,
//! `plugin/context/mod.rs`). Under a wall clock, how far an entity travels in
//! N rendered frames therefore depends on how long each frame took — which on
//! the per-PR SwiftShader software rasteriser varies from frame to frame and
//! run to run. That is the whole reason `web/e2e/engine/inputReplay.spec.ts`
//! could not be a required gate: a 120-tick replay produced a different
//! displacement every run.
//!
//! The fix is Bevy's own `TimeUpdateStrategy::ManualDuration`: while it is set,
//! `bevy_time::time_system` advances `Time<Real>` by exactly that duration each
//! frame instead of reading the wall clock, so `Time<Virtual>` (and therefore
//! every `Res<Time>` the simulation reads) sees one identical delta per
//! rendered frame. A replay that injects one trace frame per engine frame then
//! advances the simulation by exactly one tick per frame regardless of frame
//! cadence — the "pinned runtime" #9902's acceptance criteria name.
//!
//! This module is pure `core/`: it owns the request type, the validation, the
//! resource that records the current pin, and the drain system that applies
//! queued requests. The drain is scheduled in `First`, BEFORE `TimeSystems`,
//! so a request queued from the bridge between two frames is already in force
//! when the very next frame's `time_system` runs — a replay runner that
//! dispatches `pin_frame_rate` and then awaits one play tick is guaranteed to
//! replay every subsequent frame on the pinned clock.
//!
//! Unpinning returns the strategy to `Automatic`. The first automatic frame
//! measures its delta from the last SYNTHETIC instant, so it can be large
//! (the pinned clock and the wall clock drift apart); `Time<Virtual>` clamps
//! it to its `max_delta` (250 ms by default), which is the same treatment Bevy
//! gives any stalled frame. Physics is additionally capped at Rapier's
//! `max_dt`. Documented in `docs/decisions/2026-10-05-pinned-simulation-clock-for-replay.md`.

use bevy::prelude::*;
use bevy::time::{TimeSystems, TimeUpdateStrategy};
use serde_json::Value;
use std::time::Duration;

use super::pending_commands::PendingCommands;

/// The rate `pin_frame_rate` uses when the payload carries no `hz`.
pub const DEFAULT_PIN_HZ: u32 = 60;
/// Lowest accepted pin rate (one simulation tick per rendered frame, 1 s each).
pub const MIN_PIN_HZ: u32 = 1;
/// Highest accepted pin rate.
pub const MAX_PIN_HZ: u32 = 240;

/// A queued request to pin or unpin the simulation clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameRatePinRequest {
    /// Advance the simulation by exactly `1 / hz` seconds every rendered frame.
    Pin { hz: u32 },
    /// Return to the wall clock.
    Unpin,
}

/// The current pin, so a caller (and a test) can read back what is in force.
/// `None` means the wall clock drives the simulation.
#[derive(Resource, Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SimulationClockPin {
    pub hz: Option<u32>,
}

impl SimulationClockPin {
    /// Whether a pinned rate is currently driving `Time`.
    pub fn is_pinned(&self) -> bool {
        self.hz.is_some()
    }
}

/// The per-frame duration a pinned rate advances the simulation by.
///
/// Integer nanoseconds, truncated: 60 Hz is 16_666_666 ns, not 16.666…ms. What
/// matters for determinism is that every frame gets the SAME duration, and an
/// integer period is reproducible across machines in a way a float division
/// followed by `Duration::from_secs_f64` is not guaranteed to be.
pub fn pin_duration(hz: u32) -> Duration {
    Duration::from_nanos(1_000_000_000 / u64::from(hz.max(MIN_PIN_HZ)))
}

/// Validate the `hz` field of a `pin_frame_rate` payload.
///
/// Absent or `null` means [`DEFAULT_PIN_HZ`]. Anything else must be a JSON
/// integer in `[MIN_PIN_HZ, MAX_PIN_HZ]`; a float (even `60.0`), a string, a
/// negative or an out-of-range value is refused with a message naming the
/// bound. The offending value is only echoed when it is a number, so the error
/// string stays bounded whatever the payload carried.
pub fn parse_pin_hz(value: Option<&Value>) -> Result<u32, String> {
    let Some(value) = value else {
        return Ok(DEFAULT_PIN_HZ);
    };
    if value.is_null() {
        return Ok(DEFAULT_PIN_HZ);
    }
    let bounds = format!("hz must be an integer between {MIN_PIN_HZ} and {MAX_PIN_HZ}");
    let Some(hz) = value.as_u64() else {
        let got = if value.is_number() {
            value.to_string()
        } else {
            json_type_name(value).to_string()
        };
        return Err(format!("{bounds}, got {got}"));
    };
    if hz < u64::from(MIN_PIN_HZ) || hz > u64::from(MAX_PIN_HZ) {
        return Err(format!("{bounds}, got {hz}"));
    }
    Ok(hz as u32)
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

/// Drain queued pin/unpin requests into Bevy's `TimeUpdateStrategy`.
///
/// Requests are applied in order, so the last one queued in a frame wins.
/// Scheduled in `First` before `TimeSystems` (see the module doc): the frame
/// that drains a request is already stepped on the new strategy.
pub fn apply_frame_rate_pin_requests(
    mut pending: ResMut<PendingCommands>,
    mut strategy: ResMut<TimeUpdateStrategy>,
    mut pin: ResMut<SimulationClockPin>,
) {
    if pending.frame_rate_pin_requests.is_empty() {
        return;
    }
    for request in pending.frame_rate_pin_requests.drain(..) {
        match request {
            FrameRatePinRequest::Pin { hz } => {
                *strategy = TimeUpdateStrategy::ManualDuration(pin_duration(hz));
                pin.hz = Some(hz);
                tracing::info!("Pinned the simulation clock to {hz} Hz");
            }
            FrameRatePinRequest::Unpin => {
                *strategy = TimeUpdateStrategy::Automatic;
                pin.hz = None;
                tracing::info!("Unpinned the simulation clock");
            }
        }
    }
}

/// Registers the pin resource and its drain. Pure core: no bridge imports, and
/// registered in BOTH the editor and the runtime build, because an exported
/// game is replayed the same way the editor's Play mode is.
pub struct SimulationClockPlugin;

impl Plugin for SimulationClockPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SimulationClockPin>()
            .add_systems(First, apply_frame_rate_pin_requests.before(TimeSystems));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::time::{TimePlugin, Virtual};
    use serde_json::json;

    fn app() -> App {
        let mut app = App::new();
        app.add_plugins(TimePlugin);
        app.init_resource::<PendingCommands>();
        app.add_plugins(SimulationClockPlugin);
        app
    }

    fn queue(app: &mut App, request: FrameRatePinRequest) {
        app.world_mut()
            .resource_mut::<PendingCommands>()
            .queue_frame_rate_pin(request);
    }

    fn virtual_delta(app: &App) -> Duration {
        app.world().resource::<Time<Virtual>>().delta()
    }

    fn pin(app: &App) -> SimulationClockPin {
        *app.world().resource::<SimulationClockPin>()
    }

    // === Validation ===

    #[test]
    fn an_absent_or_null_hz_means_the_default_rate() {
        assert_eq!(parse_pin_hz(None), Ok(DEFAULT_PIN_HZ));
        assert_eq!(parse_pin_hz(Some(&Value::Null)), Ok(DEFAULT_PIN_HZ));
    }

    #[test]
    fn an_integer_inside_the_bounds_is_accepted() {
        assert_eq!(parse_pin_hz(Some(&json!(30))), Ok(30));
        assert_eq!(parse_pin_hz(Some(&json!(MIN_PIN_HZ))), Ok(MIN_PIN_HZ));
        assert_eq!(parse_pin_hz(Some(&json!(MAX_PIN_HZ))), Ok(MAX_PIN_HZ));
    }

    #[test]
    fn out_of_range_values_are_refused_with_the_bound_named() {
        for bad in [json!(0), json!(241), json!(-60)] {
            let err = parse_pin_hz(Some(&bad)).unwrap_err();
            assert!(err.contains("between 1 and 240"), "{bad}: {err}");
        }
    }

    #[test]
    fn non_integer_values_are_refused_without_echoing_a_string() {
        let err = parse_pin_hz(Some(&json!(59.5))).unwrap_err();
        assert!(err.contains("got 59.5"), "{err}");
        // `60.0` is a float on the wire; the rate must be an integer.
        assert!(parse_pin_hz(Some(&json!(60.0))).is_err());
        let err = parse_pin_hz(Some(&json!("x".repeat(10_000)))).unwrap_err();
        assert!(err.contains("got a string"), "{err}");
        assert!(err.len() < 120, "a refusal must not echo the payload: {}", err.len());
        assert!(parse_pin_hz(Some(&json!(true))).is_err());
        assert!(parse_pin_hz(Some(&json!([60]))).is_err());
    }

    #[test]
    fn pin_duration_is_the_integer_nanosecond_period() {
        assert_eq!(pin_duration(60), Duration::from_nanos(16_666_666));
        assert_eq!(pin_duration(240), Duration::from_nanos(4_166_666));
        assert_eq!(pin_duration(1), Duration::from_secs(1));
        // A zero rate cannot divide by zero; it is treated as the floor.
        assert_eq!(pin_duration(0), Duration::from_secs(1));
    }

    // === The clock itself ===

    /// The property the whole issue rests on: once pinned, every frame advances
    /// `Time` by the same duration no matter how long the frame really took.
    /// The sleep is what makes this decisive — on the wall clock the second
    /// delta would be >= 30 ms, and on a drain scheduled AFTER `time_system`
    /// the first pinned frame would still read the wall clock.
    #[test]
    fn a_pinned_clock_advances_exactly_one_tick_per_frame_regardless_of_wall_clock() {
        let mut app = app();
        app.update();
        app.update();
        assert!(!pin(&app).is_pinned());

        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        std::thread::sleep(Duration::from_millis(30));
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "first pinned frame");
        assert_eq!(pin(&app).hz, Some(60));

        std::thread::sleep(Duration::from_millis(30));
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "second pinned frame");
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "back-to-back frame");
        assert!(matches!(
            *app.world().resource::<TimeUpdateStrategy>(),
            TimeUpdateStrategy::ManualDuration(d) if d == pin_duration(60)
        ));
    }

    #[test]
    fn unpinning_returns_the_simulation_to_the_wall_clock() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        assert!(pin(&app).is_pinned());

        queue(&mut app, FrameRatePinRequest::Unpin);
        app.update();
        assert!(!pin(&app).is_pinned());
        assert!(matches!(
            *app.world().resource::<TimeUpdateStrategy>(),
            TimeUpdateStrategy::Automatic
        ));

        std::thread::sleep(Duration::from_millis(30));
        app.update();
        let delta = virtual_delta(&app);
        assert!(delta >= Duration::from_millis(30), "wall clock again: {delta:?}");
        assert_ne!(delta, pin_duration(60));
    }

    #[test]
    fn the_last_request_queued_in_a_frame_wins() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 30 });
        queue(&mut app, FrameRatePinRequest::Pin { hz: 120 });
        app.update();
        assert_eq!(pin(&app).hz, Some(120));
        assert_eq!(virtual_delta(&app), pin_duration(120));
        assert!(app.world().resource::<PendingCommands>().frame_rate_pin_requests.is_empty());
    }

    #[test]
    fn a_frame_with_no_request_leaves_the_strategy_alone() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        // Several request-free frames: the pin persists, nothing resets it.
        for _ in 0..5 {
            app.update();
            assert_eq!(virtual_delta(&app), pin_duration(60));
        }
        assert_eq!(pin(&app).hz, Some(60));
    }
}
