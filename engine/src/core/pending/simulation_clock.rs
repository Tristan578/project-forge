//! Simulation-clock pending commands (#10007): the queue behind
//! `pin_frame_rate` / `unpin_frame_rate`, drained by
//! `core::simulation_clock::apply_frame_rate_pin_requests`.

use super::PendingCommands;
use crate::core::simulation_clock::FrameRatePinRequest;

impl PendingCommands {
    /// Queue a pin/unpin request for the next frame's drain.
    pub fn queue_frame_rate_pin(&mut self, request: FrameRatePinRequest) {
        self.frame_rate_pin_requests.push(request);
    }
}

/// Bridge entry: queue a pin/unpin request. `false` when `PendingCommands` is
/// not registered, which the command arm reports as the usual
/// "not initialized" error rather than dropping the request.
pub fn queue_frame_rate_pin_from_bridge(request: FrameRatePinRequest) -> bool {
    super::with_pending(|pc| pc.queue_frame_rate_pin(request)).is_some()
}
