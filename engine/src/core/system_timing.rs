//! Per-system-group CPU timing capture (performance.FR-1.OP-01 / OP-04).
//!
//! A bounded rolling buffer of per-frame CPU cost, attributed to a small set of
//! coarse system groups (entity-sync, transform-apply, physics, rendering). It
//! exists so that a frame spike observed in the editor can be attributed to the
//! group of systems responsible for it, from a captured session rather than
//! from a live-but-unrecorded read.
//!
//! Each group names exactly what its bridge bracket measures, so the "Top
//! costly systems" panel never over-claims. In particular the labels are
//! deliberately narrow (`EntitySync`, `TransformApply`) rather than the broad
//! `Scripting`/`Bridge` they replaced: user-script CPU is paid off-frame in the
//! JS Worker and never reaches a Rust bracket, and only the transform drain is
//! bracketed, not every JS→engine command drain. `Physics` is the exception —
//! its bracket wraps Rapier's actual `PhysicsSet` step, so the honest name is
//! the accurate one.
//!
//! Design invariants:
//! - Pure core/. This module holds only data + accumulation logic. The
//!   wall-clock measurement wiring and the JS emit live in
//!   bridge/observability_bridge.rs, per Bridge Isolation. Everything here is
//!   native-testable with cargo test --lib; the bridge wiring is wasm32-only and
//!   never runs in CI, so the merge-gating assertions live here.
//! - Bounded. The buffer is a ring of at most capacity frames, so a long
//!   capture session can never grow memory without bound (N1 boundary).
//! - Never fabricate zero (N1 / OP-02 negative case). A group's per-frame cost
//!   is Option<f32>: None means "not measured this frame" and is surfaced
//!   downstream as unavailable, never as a real 0.0. A measured Some(0.0) is a
//!   legitimate "ran and was effectively free" and is distinct from None.
//!   Rendering/GPU timing is not instrumented in this slice (deferred to OP-02),
//!   so that group stays None end-to-end and the UI renders it as "unknown".
//! - Cheap when idle. Every recording entry point short-circuits when a capture
//!   session is not active, so steady-state overhead is a single boolean branch
//!   per bracket system per frame.

use bevy::prelude::*;
use std::collections::VecDeque;

/// Number of coarse system groups attributed by the timeline.
pub const SYSTEM_GROUP_COUNT: usize = 4;

/// Default ring-buffer capacity, in frames (~4s at 60fps). Bounds the memory a
/// capture session can occupy regardless of how long it runs.
pub const DEFAULT_TIMING_CAPACITY: usize = 240;

/// A coarse group of engine systems that a frame's CPU cost is attributed to.
///
/// The set is intentionally small and stable: an attribution axis for spike
/// triage, not a per-system profiler. GPU time is a separate axis and is not
/// represented here (see OP-02).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SystemGroup {
    /// Per-frame entity-state sync emitted to the JS script runtime
    /// (`emit_play_tick_system`): builds and emits the delta-compressed entity
    /// snapshot. This is Rust-side serialization only — user script code runs
    /// off-frame in the JS Worker sandbox and is NOT captured here, so the group
    /// is named for what it measures rather than "scripting".
    EntitySync,
    /// JS→engine transform command application (`apply_pending_transforms`).
    /// Only the transform drain is bracketed, not the other JS→engine command
    /// drains (visibility, material, tilemap, camera, skeleton2d, …), so the
    /// group is named for that specific drain rather than the whole bridge.
    TransformApply,
    /// Rapier's physics simulation step — collision detection, constraint
    /// solving and writeback. The bracket wraps Rapier's `PhysicsSet`
    /// (SyncBackend→StepSimulation→Writeback) in `PostUpdate`, which is where
    /// `RapierPhysicsPlugin` schedules the real simulation, so this is the
    /// actual physics CPU cost.
    Physics,
    /// Render-side CPU work. Not instrumented in this slice (OP-02); always
    /// reported unavailable so it can never masquerade as 0.0.
    Rendering,
}

impl SystemGroup {
    /// Every group, in stable index order.
    pub const ALL: [SystemGroup; SYSTEM_GROUP_COUNT] = [
        SystemGroup::EntitySync,
        SystemGroup::TransformApply,
        SystemGroup::Physics,
        SystemGroup::Rendering,
    ];

    /// Stable array index for this group (0..SYSTEM_GROUP_COUNT).
    #[inline]
    pub const fn index(self) -> usize {
        match self {
            SystemGroup::EntitySync => 0,
            SystemGroup::TransformApply => 1,
            SystemGroup::Physics => 2,
            SystemGroup::Rendering => 3,
        }
    }

    /// Stable machine label, matched by the web store / event handler. These
    /// strings are the wire contract with the `SYSTEM_TIMINGS` bridge event and
    /// must stay in lockstep with `SYSTEM_GROUPS` in
    /// `web/src/stores/performanceStore.ts`.
    #[inline]
    pub const fn label(self) -> &'static str {
        match self {
            SystemGroup::EntitySync => "entitySync",
            SystemGroup::TransformApply => "transformApply",
            SystemGroup::Physics => "physics",
            SystemGroup::Rendering => "rendering",
        }
    }
}

/// One captured frame's per-group CPU cost, in milliseconds.
///
/// per_group_ms[g] is None when group g was not measured this frame and
/// Some(ms) when it was (a Some(0.0) is a real measurement, not a gap).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameSystemTimings {
    /// Monotonic frame index within the capture session (0-based).
    pub frame_index: u64,
    /// Per-group CPU time in ms, indexed by SystemGroup::index.
    pub per_group_ms: [Option<f32>; SYSTEM_GROUP_COUNT],
}

impl FrameSystemTimings {
    /// Cost recorded for a group this frame, if it was measured.
    #[inline]
    pub fn group(&self, group: SystemGroup) -> Option<f32> {
        self.per_group_ms[group.index()]
    }

    /// Sum of the measured groups this frame (unmeasured groups contribute
    /// nothing - they are absent, not zero).
    pub fn measured_total_ms(&self) -> f32 {
        self.per_group_ms.iter().flatten().copied().sum()
    }
}

/// Bounded rolling buffer of per-frame system-group CPU timings for one manual
/// capture session.
///
/// A Resource so the bridge's begin/end/commit systems can accumulate into it.
/// It records only while is_capturing() is true.
#[derive(Resource, Debug)]
pub struct SystemTimingBuffer {
    capacity: usize,
    frames: VecDeque<FrameSystemTimings>,
    capturing: bool,
    frame_index: u64,
    /// Accumulator for the in-progress frame; committed by commit_frame.
    current: [Option<f32>; SYSTEM_GROUP_COUNT],
}

impl Default for SystemTimingBuffer {
    fn default() -> Self {
        Self::new(DEFAULT_TIMING_CAPACITY)
    }
}

impl SystemTimingBuffer {
    /// Create a buffer bounded to capacity frames. A capacity of 0 is clamped
    /// to 1 so the ring can always hold at least the current frame.
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            capacity,
            frames: VecDeque::with_capacity(capacity),
            capturing: false,
            frame_index: 0,
            current: [None; SYSTEM_GROUP_COUNT],
        }
    }

    /// Maximum number of frames the ring can hold.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Whether a capture session is currently active.
    #[inline]
    pub fn is_capturing(&self) -> bool {
        self.capturing
    }

    /// Number of committed frames currently buffered (never exceeds capacity).
    #[inline]
    pub fn len(&self) -> usize {
        self.frames.len()
    }

    /// Whether no frames are buffered.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Committed frames, oldest first.
    pub fn frames(&self) -> impl Iterator<Item = &FrameSystemTimings> {
        self.frames.iter()
    }

    /// Begin a fresh capture session: clears any prior frames and the in-frame
    /// accumulator, resets the frame index, and arms recording.
    pub fn start_capture(&mut self) {
        self.frames.clear();
        self.current = [None; SYSTEM_GROUP_COUNT];
        self.frame_index = 0;
        self.capturing = true;
    }

    /// End the current capture session. Buffered frames are retained (so they
    /// can still be read/emitted); the in-progress accumulator is discarded.
    pub fn stop_capture(&mut self) {
        self.capturing = false;
        self.current = [None; SYSTEM_GROUP_COUNT];
    }

    /// Record ms of CPU time against group for the in-progress frame.
    ///
    /// No-op unless a capture session is active. Repeated calls within one
    /// frame accumulate, so a group split across several bracketed spans sums
    /// correctly.
    #[inline]
    pub fn record(&mut self, group: SystemGroup, ms: f32) {
        if !self.capturing {
            return;
        }
        let slot = &mut self.current[group.index()];
        *slot = Some(slot.unwrap_or(0.0) + ms);
    }

    /// Close the in-progress frame: push its accumulated per-group costs into
    /// the ring (evicting the oldest frame when at capacity) and reset the
    /// accumulator for the next frame.
    ///
    /// Returns the committed frame, or None when not capturing.
    pub fn commit_frame(&mut self) -> Option<FrameSystemTimings> {
        if !self.capturing {
            return None;
        }
        let frame = FrameSystemTimings {
            frame_index: self.frame_index,
            per_group_ms: self.current,
        };
        self.current = [None; SYSTEM_GROUP_COUNT];
        self.frame_index = self.frame_index.saturating_add(1);

        if self.frames.len() == self.capacity {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
        Some(frame)
    }

    /// Total measured CPU time per group across all buffered frames.
    ///
    /// A group is None only when it was never measured in any buffered frame
    /// (e.g. rendering in this slice); a group measured at least once is
    /// Some(sum), even if every sample was 0.0. This is the aggregate the "top
    /// costly systems" panel ranks, and it preserves the never-zero invariant:
    /// an uninstrumented group stays None all the way to the UI.
    pub fn aggregate_ms(&self) -> [Option<f32>; SYSTEM_GROUP_COUNT] {
        let mut totals: [Option<f32>; SYSTEM_GROUP_COUNT] = [None; SYSTEM_GROUP_COUNT];
        for frame in &self.frames {
            for i in 0..SYSTEM_GROUP_COUNT {
                if let Some(ms) = frame.per_group_ms[i] {
                    totals[i] = Some(totals[i].unwrap_or(0.0) + ms);
                }
            }
        }
        totals
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_indices_are_stable_and_distinct() {
        let mut seen = [false; SYSTEM_GROUP_COUNT];
        for g in SystemGroup::ALL {
            assert!(!seen[g.index()], "duplicate index for {:?}", g);
            seen[g.index()] = true;
        }
        assert!(seen.iter().all(|&s| s), "every index must be covered");
        // Wire labels are the contract with the web store; they must name what
        // the bracket actually measures, not the broad group they replaced.
        assert_eq!(SystemGroup::EntitySync.label(), "entitySync");
        assert_eq!(SystemGroup::TransformApply.label(), "transformApply");
        assert_eq!(SystemGroup::Physics.label(), "physics");
        assert_eq!(SystemGroup::Rendering.label(), "rendering");
        // The retired broad labels must not leak back: a "scripting" bucket
        // that only measured Rust serialization, or a "bridge" bucket that only
        // measured the transform drain, is exactly the mislabel this guards.
        for g in SystemGroup::ALL {
            assert_ne!(g.label(), "scripting", "'scripting' overclaims user-script CPU");
            assert_ne!(g.label(), "bridge", "'bridge' overclaims the full command drains");
        }
    }

    #[test]
    fn recording_is_a_noop_until_capture_starts() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.record(SystemGroup::Physics, 5.0);
        assert_eq!(buf.commit_frame(), None, "commit before capture is a no-op");
        assert!(buf.is_empty(), "nothing buffered before a capture session");
    }

    #[test]
    fn per_group_accumulation_sums_within_a_frame() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.start_capture();
        buf.record(SystemGroup::Physics, 1.5);
        buf.record(SystemGroup::Physics, 2.0);
        buf.record(SystemGroup::EntitySync, 0.25);
        let frame = buf.commit_frame().expect("capturing, so a frame commits");
        assert_eq!(frame.group(SystemGroup::Physics), Some(3.5));
        assert_eq!(frame.group(SystemGroup::EntitySync), Some(0.25));
        // TransformApply and Rendering were never recorded, so unavailable, NOT 0.0.
        assert_eq!(frame.group(SystemGroup::TransformApply), None);
        assert_eq!(frame.group(SystemGroup::Rendering), None);
        assert_eq!(frame.measured_total_ms(), 3.75);
    }

    #[test]
    fn a_measured_zero_is_distinct_from_unmeasured() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.start_capture();
        buf.record(SystemGroup::TransformApply, 0.0);
        let frame = buf.commit_frame().unwrap();
        assert_eq!(frame.group(SystemGroup::TransformApply), Some(0.0));
        assert_eq!(frame.group(SystemGroup::Rendering), None);
    }

    #[test]
    fn ring_buffer_respects_capacity_and_evicts_oldest() {
        let mut buf = SystemTimingBuffer::new(3);
        buf.start_capture();
        for _ in 0..5 {
            buf.record(SystemGroup::Physics, 1.0);
            buf.commit_frame();
        }
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.capacity(), 3);
        let indices: Vec<u64> = buf.frames().map(|f| f.frame_index).collect();
        // Oldest two (0,1) evicted; the last three retained in order.
        assert_eq!(indices, vec![2, 3, 4]);
    }

    #[test]
    fn zero_capacity_is_clamped_to_one() {
        let mut buf = SystemTimingBuffer::new(0);
        assert_eq!(buf.capacity(), 1);
        buf.start_capture();
        buf.record(SystemGroup::Physics, 1.0);
        buf.commit_frame();
        buf.record(SystemGroup::Physics, 2.0);
        buf.commit_frame();
        assert_eq!(buf.len(), 1, "capacity floor of 1 still bounds the ring");
    }

    #[test]
    fn aggregate_preserves_unavailable_groups() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.start_capture();
        buf.record(SystemGroup::Physics, 2.0);
        buf.record(SystemGroup::TransformApply, 1.0);
        buf.commit_frame();
        buf.record(SystemGroup::Physics, 3.0);
        buf.commit_frame();
        let agg = buf.aggregate_ms();
        assert_eq!(agg[SystemGroup::Physics.index()], Some(5.0));
        assert_eq!(agg[SystemGroup::TransformApply.index()], Some(1.0));
        // EntitySync/Rendering never measured, so still unavailable, not 0.0.
        assert_eq!(agg[SystemGroup::EntitySync.index()], None);
        assert_eq!(agg[SystemGroup::Rendering.index()], None);
    }

    #[test]
    fn start_capture_clears_prior_session() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.start_capture();
        buf.record(SystemGroup::Physics, 9.0);
        buf.commit_frame();
        assert_eq!(buf.len(), 1);
        buf.start_capture();
        assert!(buf.is_empty(), "prior frames cleared");
        assert!(buf.is_capturing());
        buf.record(SystemGroup::Physics, 1.0);
        let frame = buf.commit_frame().unwrap();
        assert_eq!(frame.frame_index, 0, "frame index reset for the new session");
    }

    #[test]
    fn stop_capture_retains_frames_but_halts_recording() {
        let mut buf = SystemTimingBuffer::new(8);
        buf.start_capture();
        buf.record(SystemGroup::Physics, 1.0);
        buf.commit_frame();
        buf.stop_capture();
        assert!(!buf.is_capturing());
        assert_eq!(buf.len(), 1, "captured frames survive stop");
        buf.record(SystemGroup::Physics, 5.0);
        assert_eq!(buf.commit_frame(), None);
        assert_eq!(buf.len(), 1);
    }

    /// Regression guard for #9880: a bracket run unconditionally around a
    /// system that itself no-ops outside Play mode (like `emit_play_tick_system`
    /// for the EntitySync group) still calls `record` every frame, manufacturing
    /// a spurious `Some(tiny_ms)` in Edit mode instead of leaving the group
    /// `None`. The fix is to gate the bracket itself with
    /// `.run_if(in_play_mode)`, exactly as wired for the EntitySync bracket in
    /// `bridge/mod.rs`. `bridge/` is wasm32-only and never compiles under
    /// `cargo test --lib` (see module docs above), so this asserts the same
    /// `run_if`-gated-bracket pattern natively against the real `in_play_mode`
    /// condition and the real buffer, standing in for the bridge wiring.
    #[test]
    fn a_bracket_gated_on_in_play_mode_never_records_outside_play() {
        use crate::core::engine_mode::{in_play_mode, EngineMode};

        fn record_marker(mut buffer: ResMut<SystemTimingBuffer>) {
            buffer.record(SystemGroup::EntitySync, 0.0);
        }

        let mut app = App::new();
        app.insert_resource(EngineMode::Edit);
        app.insert_resource(SystemTimingBuffer::new(8));
        app.world_mut().resource_mut::<SystemTimingBuffer>().start_capture();
        app.add_systems(Update, record_marker.run_if(in_play_mode));

        app.update();
        let frame = app
            .world_mut()
            .resource_mut::<SystemTimingBuffer>()
            .commit_frame()
            .expect("capturing, so a frame commits even with nothing recorded");
        assert_eq!(
            frame.group(SystemGroup::EntitySync),
            None,
            "a run_if(in_play_mode)-gated bracket must not record while the \
             wrapped system is inert in Edit mode"
        );

        *app.world_mut().resource_mut::<EngineMode>() = EngineMode::Play;
        app.update();
        let frame = app
            .world_mut()
            .resource_mut::<SystemTimingBuffer>()
            .commit_frame()
            .unwrap();
        assert_eq!(
            frame.group(SystemGroup::EntitySync),
            Some(0.0),
            "the same bracket records once the engine is actually in Play mode"
        );
    }
}
