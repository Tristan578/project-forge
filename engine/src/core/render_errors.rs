//! Render-error policy: what the engine does when wgpu reports an error (#8887).
//!
//! Bevy 0.19 routes every wgpu error through a [`RenderErrorHandler`] resource.
//! Its default writes `AppExit::error()` for ANY error, so a single validation
//! error in one pipeline quit the whole editor. On the web that exit is silent:
//! the canvas freezes, queued commands stop being processed, and nothing tells
//! the editor why. That is exactly how the transform-gizmo layout mismatch on
//! this PR presented — "Play does nothing" — until the console was read.
//!
//! This module replaces that default with [`spawnforge_render_error_handler`]:
//!
//! | Class (`ErrorType`) | Policy | Why |
//! |---|---|---|
//! | `Validation`, first in a window | `Ignore` (keep rendering) | One bad draw or pipeline. Wgpu drops the failing submission; the next frame renders normally. |
//! | `Internal`, first in a window | `Ignore` | Same shape as a validation error from the backend's side. |
//! | a second `Validation`/`Internal` within [`REPEAT_WINDOW_SECS`] | `StopRendering` | The cause is persistent. Rendering on would fail every frame, and Bevy's own docs warn that an ignored repeating error can strobe. Stopping on the SECOND error bounds a glitch to two frames. |
//! | `OutOfMemory` | `StopRendering` | Nothing here can free GPU memory; retrying fails again. |
//! | `DeviceLost` | `StopRendering` | The GPU device is gone. `RenderErrorPolicy::Recover` exists, but re-creating the device on an existing web canvas is untested here, so it is not claimed. |
//!
//! `StopRendering` keeps the app ALIVE: the main world, the command queue, the
//! scene and `export_scene` (and so saving and autosave) keep working; only the
//! viewport stops updating. Nothing in this module ever writes `AppExit`.
//!
//! Every decision is recorded as a [`RenderErrorReport`] in
//! [`RenderErrorTracker`]. `bridge/render_errors.rs` drains those each frame
//! and emits them to the editor as the `RENDER_ERROR` event, which the editor
//! turns into a plain-language notification. This module is pure Rust so the
//! classification and emission bookkeeping are testable natively (the bridge is
//! wasm32-only).

use bevy::prelude::*;
use bevy::render::error_handler::{ErrorType, RenderError, RenderErrorHandler, RenderErrorPolicy};
use serde::Serialize;

/// A second non-fatal error within this many seconds of the first one stops
/// rendering. Wall-clock (`Time<Real>`), so a paused game does not stretch it.
pub const REPEAT_WINDOW_SECS: f64 = 10.0;

/// Upper bound on the wgpu description carried to the editor. The text is
/// diagnostic detail for a disclosure and for Sentry, never the headline.
pub const DETAIL_MAX_CHARS: usize = 2000;

/// Reports the drain has not collected yet are capped, so a build without the
/// bridge drain (a native test, a future headless target) cannot grow the
/// queue without bound. Oldest reports are dropped first.
pub const MAX_PENDING_REPORTS: usize = 16;

/// The editor-facing classification of a wgpu error. One variant per
/// `wgpu_types::error::ErrorType`, which is exhaustive (not `#[non_exhaustive]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderErrorClass {
    Validation,
    Internal,
    OutOfMemory,
    DeviceLost,
}

impl From<ErrorType> for RenderErrorClass {
    fn from(ty: ErrorType) -> Self {
        match ty {
            ErrorType::Validation => Self::Validation,
            ErrorType::Internal => Self::Internal,
            ErrorType::OutOfMemory => Self::OutOfMemory,
            ErrorType::DeviceLost => Self::DeviceLost,
        }
    }
}

impl RenderErrorClass {
    /// Whether one occurrence of this class can be skipped while rendering
    /// continues. See the policy table in the module docs.
    pub fn is_skippable(self) -> bool {
        matches!(self, Self::Validation | Self::Internal)
    }
}

/// What the engine did about an error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderErrorOutcome {
    /// The error was skipped and the viewport kept rendering.
    Continued,
    /// The viewport stopped rendering. The engine and the scene are still alive.
    Stopped,
}

/// One report bound for the editor. Serialized as the `RENDER_ERROR` payload.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderErrorReport {
    pub error_class: RenderErrorClass,
    pub outcome: RenderErrorOutcome,
    /// The wgpu description, truncated to [`DETAIL_MAX_CHARS`]. May be empty:
    /// wgpu gives `OutOfMemory` no description.
    pub detail: String,
    /// 1-based count of render errors this session, including this one.
    pub occurrence: u32,
}

/// The decision [`RenderErrorTracker::record`] returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderErrorDecision {
    Continue,
    Stop,
}

/// Main-world state behind the handler: the repeat window, whether rendering
/// has already been stopped, and the reports awaiting the bridge drain.
#[derive(Resource, Debug, Default)]
pub struct RenderErrorTracker {
    last_skipped_at: Option<f64>,
    stopped_for: Option<RenderErrorClass>,
    occurrences: u32,
    pending: Vec<RenderErrorReport>,
}

impl RenderErrorTracker {
    /// Classify one error delivered by Bevy and record what to tell the editor.
    ///
    /// Bevy calls the handler again on EVERY frame while rendering is stopped,
    /// with the same error, until the policy changes. Those repeats are not new
    /// errors and produce no report; a different class arriving while stopped
    /// (for example a device loss after a validation stop) does.
    pub fn record(&mut self, class: RenderErrorClass, description: &str, now_secs: f64) -> RenderErrorDecision {
        if let Some(stopped_for) = self.stopped_for {
            if stopped_for != class {
                self.stopped_for = Some(class);
                self.push(class, RenderErrorOutcome::Stopped, description);
            }
            return RenderErrorDecision::Stop;
        }

        let repeated = self
            .last_skipped_at
            .is_some_and(|at| now_secs - at <= REPEAT_WINDOW_SECS);

        if class.is_skippable() && !repeated {
            self.last_skipped_at = Some(now_secs);
            self.push(class, RenderErrorOutcome::Continued, description);
            RenderErrorDecision::Continue
        } else {
            self.stopped_for = Some(class);
            self.push(class, RenderErrorOutcome::Stopped, description);
            RenderErrorDecision::Stop
        }
    }

    /// Whether rendering has been stopped this session.
    pub fn is_stopped(&self) -> bool {
        self.stopped_for.is_some()
    }

    /// Take every report not yet emitted, oldest first.
    pub fn take_pending(&mut self) -> Vec<RenderErrorReport> {
        std::mem::take(&mut self.pending)
    }

    fn push(&mut self, class: RenderErrorClass, outcome: RenderErrorOutcome, description: &str) {
        self.occurrences = self.occurrences.saturating_add(1);
        if self.pending.len() >= MAX_PENDING_REPORTS {
            self.pending.remove(0);
        }
        self.pending.push(RenderErrorReport {
            error_class: class,
            outcome,
            detail: truncate_chars(description, DETAIL_MAX_CHARS),
            occurrence: self.occurrences,
        });
    }
}

/// Truncate to at most `max` characters without splitting a UTF-8 sequence.
fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((byte_index, _)) => text[..byte_index].to_string(),
        None => text.to_string(),
    }
}

/// SpawnForge's [`RenderErrorHandler`]. Never quits the app; see the module
/// docs for the per-class policy.
pub fn spawnforge_render_error_handler(
    error: &RenderError,
    main_world: &mut World,
    _render_world: &mut World,
) -> RenderErrorPolicy {
    let now_secs = main_world
        .get_resource::<Time<Real>>()
        .map(|time| time.elapsed_secs_f64())
        .unwrap_or(0.0);
    let class = RenderErrorClass::from(error.ty);
    let decision = main_world
        .get_resource_or_insert_with(RenderErrorTracker::default)
        .record(class, &error.description, now_secs);

    match decision {
        RenderErrorDecision::Continue => {
            warn!("Render error ({class:?}) skipped; rendering continues and the editor has been notified");
            RenderErrorPolicy::Ignore
        }
        RenderErrorDecision::Stop => RenderErrorPolicy::StopRendering,
    }
}

/// Installs [`spawnforge_render_error_handler`] and its tracker.
///
/// Order-independent against `RenderPlugin`: that plugin registers Bevy's
/// default with `init_resource`, which never replaces an existing resource,
/// and this plugin uses `insert_resource`, which always does.
pub struct RenderErrorReportingPlugin;

impl Plugin for RenderErrorReportingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RenderErrorTracker>()
            .insert_resource(RenderErrorHandler(spawnforge_render_error_handler));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::app::AppExit;
    use bevy::ecs::message::Messages;

    fn render_error(ty: ErrorType, description: &str) -> RenderError {
        RenderError { ty, description: description.to_string(), source: None }
    }

    fn classes_and_outcomes(tracker: &mut RenderErrorTracker) -> Vec<(RenderErrorClass, RenderErrorOutcome)> {
        tracker.take_pending().into_iter().map(|r| (r.error_class, r.outcome)).collect()
    }

    #[test]
    fn one_validation_error_continues_and_reports_continued() {
        let mut tracker = RenderErrorTracker::default();
        assert_eq!(tracker.record(RenderErrorClass::Validation, "bad layout", 1.0), RenderErrorDecision::Continue);
        let reports = tracker.take_pending();
        assert_eq!(reports, vec![RenderErrorReport {
            error_class: RenderErrorClass::Validation,
            outcome: RenderErrorOutcome::Continued,
            detail: "bad layout".to_string(),
            occurrence: 1,
        }]);
        assert!(!tracker.is_stopped());
    }

    #[test]
    fn one_internal_error_continues() {
        let mut tracker = RenderErrorTracker::default();
        assert_eq!(tracker.record(RenderErrorClass::Internal, "x", 0.0), RenderErrorDecision::Continue);
        assert_eq!(classes_and_outcomes(&mut tracker), vec![(RenderErrorClass::Internal, RenderErrorOutcome::Continued)]);
    }

    #[test]
    fn a_second_skippable_error_inside_the_window_stops_rendering() {
        let mut tracker = RenderErrorTracker::default();
        tracker.record(RenderErrorClass::Validation, "a", 5.0);
        assert_eq!(
            tracker.record(RenderErrorClass::Internal, "b", 5.0 + REPEAT_WINDOW_SECS),
            RenderErrorDecision::Stop,
        );
        assert_eq!(classes_and_outcomes(&mut tracker), vec![
            (RenderErrorClass::Validation, RenderErrorOutcome::Continued),
            (RenderErrorClass::Internal, RenderErrorOutcome::Stopped),
        ]);
        assert!(tracker.is_stopped());
    }

    #[test]
    fn skippable_errors_spaced_beyond_the_window_each_continue() {
        let mut tracker = RenderErrorTracker::default();
        assert_eq!(tracker.record(RenderErrorClass::Validation, "a", 0.0), RenderErrorDecision::Continue);
        assert_eq!(
            tracker.record(RenderErrorClass::Validation, "b", REPEAT_WINDOW_SECS + 0.001),
            RenderErrorDecision::Continue,
        );
        let reports = tracker.take_pending();
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[1].occurrence, 2);
    }

    #[test]
    fn out_of_memory_stops_immediately() {
        let mut tracker = RenderErrorTracker::default();
        assert_eq!(tracker.record(RenderErrorClass::OutOfMemory, "", 0.0), RenderErrorDecision::Stop);
        assert_eq!(classes_and_outcomes(&mut tracker), vec![(RenderErrorClass::OutOfMemory, RenderErrorOutcome::Stopped)]);
    }

    #[test]
    fn device_lost_stops_immediately() {
        let mut tracker = RenderErrorTracker::default();
        assert_eq!(tracker.record(RenderErrorClass::DeviceLost, "gone", 0.0), RenderErrorDecision::Stop);
        assert_eq!(classes_and_outcomes(&mut tracker), vec![(RenderErrorClass::DeviceLost, RenderErrorOutcome::Stopped)]);
    }

    #[test]
    fn bevy_re_polling_a_stopped_error_every_frame_reports_it_once() {
        let mut tracker = RenderErrorTracker::default();
        for frame in 0..120 {
            assert_eq!(
                tracker.record(RenderErrorClass::OutOfMemory, "", frame as f64 / 60.0),
                RenderErrorDecision::Stop,
            );
        }
        assert_eq!(tracker.take_pending().len(), 1);
    }

    #[test]
    fn a_different_class_while_stopped_is_reported() {
        let mut tracker = RenderErrorTracker::default();
        tracker.record(RenderErrorClass::OutOfMemory, "", 0.0);
        assert_eq!(tracker.record(RenderErrorClass::DeviceLost, "lost", 1.0), RenderErrorDecision::Stop);
        assert_eq!(classes_and_outcomes(&mut tracker), vec![
            (RenderErrorClass::OutOfMemory, RenderErrorOutcome::Stopped),
            (RenderErrorClass::DeviceLost, RenderErrorOutcome::Stopped),
        ]);
    }

    #[test]
    fn a_skippable_error_after_a_stop_does_not_resume_rendering() {
        let mut tracker = RenderErrorTracker::default();
        tracker.record(RenderErrorClass::DeviceLost, "lost", 0.0);
        assert_eq!(tracker.record(RenderErrorClass::Validation, "v", 100.0), RenderErrorDecision::Stop);
    }

    #[test]
    fn detail_is_truncated_on_a_character_boundary() {
        let long = "é".repeat(DETAIL_MAX_CHARS + 5);
        let mut tracker = RenderErrorTracker::default();
        tracker.record(RenderErrorClass::Validation, &long, 0.0);
        let detail = &tracker.take_pending()[0].detail;
        assert_eq!(detail.chars().count(), DETAIL_MAX_CHARS);
        assert!(long.starts_with(detail.as_str()));
    }

    #[test]
    fn pending_reports_are_bounded_oldest_first() {
        let mut tracker = RenderErrorTracker::default();
        for i in 0..(MAX_PENDING_REPORTS as u32 + 4) {
            // Spaced beyond the window so each one is a fresh, reportable error.
            tracker.record(RenderErrorClass::Validation, "v", f64::from(i) * (REPEAT_WINDOW_SECS + 1.0));
        }
        let reports = tracker.take_pending();
        assert_eq!(reports.len(), MAX_PENDING_REPORTS);
        assert_eq!(reports[0].occurrence, 5);
        assert!(tracker.take_pending().is_empty(), "take_pending must drain");
    }

    #[test]
    fn report_serializes_to_the_camel_case_wire_shape() {
        let report = RenderErrorReport {
            error_class: RenderErrorClass::OutOfMemory,
            outcome: RenderErrorOutcome::Stopped,
            detail: String::new(),
            occurrence: 3,
        };
        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            serde_json::json!({ "errorClass": "outOfMemory", "outcome": "stopped", "detail": "", "occurrence": 3 }),
        );
        for (class, wire) in [
            (RenderErrorClass::Validation, "validation"),
            (RenderErrorClass::Internal, "internal"),
            (RenderErrorClass::DeviceLost, "deviceLost"),
        ] {
            assert_eq!(serde_json::to_value(class).unwrap(), serde_json::json!(wire));
        }
        assert_eq!(serde_json::to_value(RenderErrorOutcome::Continued).unwrap(), serde_json::json!("continued"));
    }

    /// Runs the handler the plugin actually installed (not the function by
    /// name), so a plugin that registered Bevy's default would fail here.
    fn run_installed_handler(app: &mut App, error: &RenderError) -> RenderErrorPolicy {
        let handler = app.world().resource::<RenderErrorHandler>().0;
        let mut render_world = World::new();
        handler(error, app.world_mut(), &mut render_world)
    }

    fn app_exit_count(app: &App) -> usize {
        app.world().resource::<Messages<AppExit>>().len()
    }

    #[test]
    fn installed_handler_never_quits_the_app() {
        let mut app = App::new();
        app.add_plugins(RenderErrorReportingPlugin);

        let validation = render_error(ErrorType::Validation, "Pipeline layout mismatch");
        assert!(matches!(run_installed_handler(&mut app, &validation), RenderErrorPolicy::Ignore));
        assert!(matches!(run_installed_handler(&mut app, &validation), RenderErrorPolicy::StopRendering));
        let lost = render_error(ErrorType::DeviceLost, "");
        assert!(matches!(run_installed_handler(&mut app, &lost), RenderErrorPolicy::StopRendering));

        assert_eq!(app_exit_count(&app), 0, "the handler must never write AppExit");
        let reports = app.world_mut().resource_mut::<RenderErrorTracker>().take_pending();
        assert_eq!(
            reports.iter().map(|r| (r.error_class, r.outcome)).collect::<Vec<_>>(),
            vec![
                (RenderErrorClass::Validation, RenderErrorOutcome::Continued),
                (RenderErrorClass::Validation, RenderErrorOutcome::Stopped),
                (RenderErrorClass::DeviceLost, RenderErrorOutcome::Stopped),
            ],
        );
        assert_eq!(reports[0].detail, "Pipeline layout mismatch");
    }

    #[test]
    fn bevy_default_handler_is_what_this_replaces() {
        // Pins the premise: 0.19's default quits on any error. If a Bevy bump
        // changes that, this module's reason to exist should be re-read.
        let mut app = App::new();
        app.init_resource::<RenderErrorHandler>();
        let validation = render_error(ErrorType::Validation, "x");
        assert!(matches!(run_installed_handler(&mut app, &validation), RenderErrorPolicy::StopRendering));
        assert_eq!(app_exit_count(&app), 1);
    }

    #[test]
    fn plugin_wins_over_render_plugins_init_resource_in_either_order() {
        // `RenderPlugin::build` calls `init_resource::<RenderErrorHandler>()`.
        let mut before = App::new();
        before.add_plugins(RenderErrorReportingPlugin);
        before.init_resource::<RenderErrorHandler>();

        let mut after = App::new();
        after.init_resource::<RenderErrorHandler>();
        after.add_plugins(RenderErrorReportingPlugin);

        for app in [&mut before, &mut after] {
            let validation = render_error(ErrorType::Validation, "x");
            assert!(matches!(run_installed_handler(app, &validation), RenderErrorPolicy::Ignore));
            assert_eq!(app_exit_count(app), 0);
        }
    }

    #[test]
    fn handler_measures_the_window_on_real_time() {
        let mut app = App::new();
        app.add_plugins(RenderErrorReportingPlugin);
        app.insert_resource(Time::<Real>::default());
        let validation = render_error(ErrorType::Validation, "x");
        assert!(matches!(run_installed_handler(&mut app, &validation), RenderErrorPolicy::Ignore));

        // `Time<Real>`'s first update only records the instant; the second
        // one advances `elapsed`. Prime it, then step past the window.
        let later = std::time::Duration::from_secs_f64(REPEAT_WINDOW_SECS + 1.0);
        let mut time = app.world_mut().resource_mut::<Time<Real>>();
        time.update_with_duration(std::time::Duration::ZERO);
        time.update_with_duration(later);
        assert!(time.elapsed_secs_f64() > REPEAT_WINDOW_SECS, "the clock did not advance; this test would be vacuous");
        assert!(matches!(run_installed_handler(&mut app, &validation), RenderErrorPolicy::Ignore));
    }
}
