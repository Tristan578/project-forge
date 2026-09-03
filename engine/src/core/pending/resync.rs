//! The cross-domain component re-report queue.
//!
//! Unlike every other module here this one is not a domain: a
//! [`ComponentResync`] can describe physics, audio, a sprite or a tilemap, and
//! it exists because the *writer* (an undo/redo arm, or `spawn_from_snapshot`)
//! is domain-agnostic. Filing it under any single domain would make the other
//! fourteen look like guests.

use super::PendingCommands;
use crate::core::component_resync::ComponentResync;

/// The most component re-reports one frame may turn into JS callbacks.
///
/// Each resync becomes one synchronous callback and most of the handlers behind
/// them write a whole-map spread into a Zustand slice, so the cost of draining
/// K of them in a frame is superlinear in K. A restore path is free to queue
/// more than this — Play → Stop respawns every entity the running game deleted,
/// and that count belongs to the game, not to us — so the queue is drained over
/// as many frames as it takes. The resyncs are state reports with no ordering
/// requirement between them, so arriving a frame later is invisible; a frozen
/// tab is not.
///
/// Not a tuning knob anyone has measured: it is the order of magnitude at which
/// a single frame's callbacks stay under a frame budget, chosen so that the
/// pathological case degrades instead of hanging.
pub const MAX_RESYNC_DRAIN_PER_FRAME: usize = 256;

impl PendingCommands {
    pub fn queue_component_resync(&mut self, resync: ComponentResync) {
        self.component_resyncs.push(resync);
    }
}

/// Queue a re-report of component state that changed without a command.
///
/// Named for the thread-local it reaches, not for a bridge caller: the only
/// callers are the undo/redo arms and `spawn_from_snapshot` in
/// `core/entity_factory.rs`, which are pure Rust and cannot emit an event
/// themselves. `with_pending` is a thread-local, so this is reachable from
/// `core/` and natively testable.
///
/// Returns `false` when no `PendingCommands` is registered — the caller MUST
/// check it. An unregistered push is a silent no-op, and swallowing that signal
/// would defeat the very re-report the call exists to make: the browser's mirror
/// would keep stale state with nothing in the log to say why.
pub fn queue_component_resync_pending(resync: ComponentResync) -> bool {
    super::with_pending(|pc| pc.queue_component_resync(resync)).is_some()
}
