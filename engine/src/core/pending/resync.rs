//! The cross-domain component re-report queue.
//!
//! Unlike every other module here this one is not a domain: a
//! [`ComponentResync`] can describe physics, audio, a sprite or a tilemap, and
//! it exists because the *writer* (an undo/redo arm, or `spawn_from_snapshot`)
//! is domain-agnostic. Filing it under any single domain would make the other
//! fourteen look like guests.

use super::PendingCommands;
use crate::core::component_resync::ComponentResync;

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
