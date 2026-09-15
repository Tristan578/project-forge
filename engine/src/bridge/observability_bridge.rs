//! Bridge wiring for per-system-group CPU timing (performance.FR-1.OP-01/OP-04).
//!
//! This is the wasm32-only half of the feature. It measures wall-clock CPU time
//! per coarse system group, accumulates it into the pure-core
//! [`SystemTimingBuffer`], and emits a per-frame snapshot to JS as a
//! `SYSTEM_TIMINGS` event while a capture session is active. It lives under
//! `bridge/` because it holds `wasm_bindgen` and the JS emit, per Bridge
//! Isolation; `bridge/` is never compiled by `cargo test`, so the buffer's
//! invariants are asserted natively in `core::system_timing` instead.
//!
//! Instrumented groups this slice: Scripting (per-frame script tick), Bridge
//! (JS→engine command drain), Physics (play-mode step set). Rendering/GPU is
//! NOT instrumented here (OP-02); it is never recorded, so it reaches the UI as
//! `None` → "unknown" rather than a fabricated `0.0`.

use bevy::platform::time::Instant;
use bevy::prelude::*;
use std::cell::Cell;

use crate::bridge::events;
use crate::core::system_timing::{SystemGroup, SystemTimingBuffer, SYSTEM_GROUP_COUNT};

thread_local! {
    /// A pending start(true)/stop(false) request from JS, consumed once per
    /// frame by [`apply_system_timing_capture_request`]. WASM is single
    /// threaded, so a plain `Cell` is sufficient.
    static CAPTURE_REQUEST: Cell<Option<bool>> = const { Cell::new(None) };
}

/// JS entry point: arm (`true`) or disarm (`false`) per-system timing capture.
///
/// The request is latched here and applied on the next frame by the engine, so
/// this never touches the ECS `World` directly.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn set_system_timing_capture(active: bool) {
    CAPTURE_REQUEST.with(|c| c.set(Some(active)));
}

/// Scratch begin-timestamps for the in-flight frame, one slot per group. Bridge
/// local (holds an `Instant`); the committed durations live in the core buffer.
#[derive(Resource, Default)]
pub struct SystemTimingScratch {
    starts: [Option<Instant>; SYSTEM_GROUP_COUNT],
}

impl SystemTimingScratch {
    #[inline]
    fn begin(&mut self, group: SystemGroup, capturing: bool) {
        if capturing {
            self.starts[group.index()] = Some(Instant::now());
        }
    }

    #[inline]
    fn end(&mut self, group: SystemGroup, buffer: &mut SystemTimingBuffer) {
        if let Some(start) = self.starts[group.index()].take() {
            let ms = start.elapsed().as_secs_f32() * 1000.0;
            buffer.record(group, ms);
        }
    }
}

/// Apply a latched JS capture request at the start of the frame.
pub fn apply_system_timing_capture_request(mut buffer: ResMut<SystemTimingBuffer>) {
    if let Some(active) = CAPTURE_REQUEST.with(|c| c.take()) {
        if active {
            buffer.start_capture();
        } else {
            buffer.stop_capture();
        }
    }
}

// --- Per-group begin/end brackets -----------------------------------------
// Each pair only reads the capture flag + a monotonic clock, so steady-state
// (non-capturing) overhead is a single branch per system per frame. The pairs
// are ordered around a representative anchor per group via `.before`/`.after`
// in `bridge/mod.rs`; they take no anchor resources, so they add no ordering
// constraint beyond that and cannot perturb gameplay system order.

/// Begin Scripting-group timing (before the per-frame script tick).
pub fn begin_scripting_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    buffer: Res<SystemTimingBuffer>,
) {
    scratch.begin(SystemGroup::Scripting, buffer.is_capturing());
}

/// End Scripting-group timing (after the per-frame script tick).
pub fn end_scripting_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    mut buffer: ResMut<SystemTimingBuffer>,
) {
    scratch.end(SystemGroup::Scripting, &mut buffer);
}

/// Begin Bridge-group timing (before the JS→engine command drains).
pub fn begin_bridge_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    buffer: Res<SystemTimingBuffer>,
) {
    scratch.begin(SystemGroup::Bridge, buffer.is_capturing());
}

/// End Bridge-group timing (after the JS→engine command drains).
pub fn end_bridge_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    mut buffer: ResMut<SystemTimingBuffer>,
) {
    scratch.end(SystemGroup::Bridge, &mut buffer);
}

/// Begin Physics-group timing (before the play-mode physics step set).
pub fn begin_physics_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    buffer: Res<SystemTimingBuffer>,
) {
    scratch.begin(SystemGroup::Physics, buffer.is_capturing());
}

/// End Physics-group timing (after the play-mode physics step set).
pub fn end_physics_timing(
    mut scratch: ResMut<SystemTimingScratch>,
    mut buffer: ResMut<SystemTimingBuffer>,
) {
    scratch.end(SystemGroup::Physics, &mut buffer);
}

/// Close the in-flight frame and, while capturing, emit a `SYSTEM_TIMINGS`
/// snapshot to JS. Runs last in the frame so every group's bracket has already
/// recorded. A group absent from `perGroupMs` was not measured — the JS side
/// surfaces it as "unknown", never 0.
pub fn commit_and_emit_system_timings(mut buffer: ResMut<SystemTimingBuffer>) {
    let Some(frame) = buffer.commit_frame() else {
        return;
    };

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SystemTimingsPayload {
        frame_index: u64,
        // Only measured groups are present; absent = unavailable this frame.
        per_group_ms: std::collections::BTreeMap<&'static str, f32>,
    }

    let mut per_group_ms = std::collections::BTreeMap::new();
    for group in SystemGroup::ALL {
        if let Some(ms) = frame.group(group) {
            per_group_ms.insert(group.label(), ms);
        }
    }

    events::emit_event(
        "SYSTEM_TIMINGS",
        &SystemTimingsPayload {
            frame_index: frame.frame_index,
            per_group_ms,
        },
    );
}
