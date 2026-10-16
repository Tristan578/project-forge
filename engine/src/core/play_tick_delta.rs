//! Play-tick delta bookkeeping: which entities changed since the frame the
//! engine last emitted, and which have vanished.
//!
//! `bridge::scripts::emit_play_tick_system` emits one `PLAY_TICK_DELTA` per
//! Play frame — the entities whose transform or info changed since its
//! previous frame, plus the ids that are gone — and the editor's event hub
//! merges each delta onto a full-frame snapshot of its own
//! (`web/src/hooks/events/playTickSnapshot.ts`, #10375). The two caches have
//! to agree on exactly one thing: the first frame after ANY transition out of
//! Play is a full frame. The hub forgets its snapshot on every
//! `ENGINE_MODE_CHANGED` that lands outside Play, so this cache must be empty
//! by the time the next Play frame is computed.
//!
//! The emit system's own per-frame clear (it empties the cache on every frame
//! it runs outside Play) is not enough on its own. A pause and a resume, or a
//! stop and a play, queued in ONE engine update — chat and MCP can send two
//! mode commands between frames — are both applied by
//! `apply_mode_change_requests` in that update, each with its own
//! `ENGINE_MODE_CHANGED`, while the emit system never runs outside Play and so
//! never clears. The hub has reset, the cache is still populated, and the next
//! delta omits every entity that did not move: scripts and the replay bus then
//! see a scene missing most of its entities until each one happens to change
//! (Devin review on #10390). So the mode-transition path clears the cache
//! itself, through [`PlayTickDeltaCache::on_leaving_play`], on every ACCEPTED
//! transition out of Play; the frame timing of the emit system no longer
//! matters.
//!
//! Deliberately `std`-only — no Bevy import, no `Resource` derive — so the
//! whole file can be `#[path]`-included by a plain cargo project and its tests
//! run natively on a machine whose native engine build does not link (the
//! `wgpu-hal` dx12 backend on Windows). The Bevy resource that owns one of
//! these is `bridge::scripts::PlayTickCache`.

use std::collections::HashMap;

/// Per-entity state cached from the previous emitted play-tick frame.
#[derive(Clone, Debug, PartialEq)]
pub struct CachedEntityState {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
    pub name: String,
    pub entity_type: String,
    pub collider_radius: f32,
}

/// What one `PLAY_TICK_DELTA` has to carry: the entities new or changed since
/// the previous emitted frame, and the ids that were in that frame and are gone.
#[derive(Debug, Default, PartialEq)]
pub struct PlayTickDelta {
    pub changed: Vec<(String, CachedEntityState)>,
    pub removed: Vec<String>,
}

/// The previous emitted frame, keyed by entity id.
///
/// Empty means "the next frame is full": with nothing to diff against, every
/// entity in the next [`advance`](Self::advance) is reported as changed.
#[derive(Debug, Default)]
pub struct PlayTickDeltaCache {
    /// Public so the bridge's existing resource tests can seed and inspect it;
    /// production code goes through the methods below.
    pub states: HashMap<String, CachedEntityState>,
}

impl PlayTickDeltaCache {
    /// True when the next [`advance`](Self::advance) will report every entity
    /// as changed and nothing as removed.
    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }

    /// Forget the previous frame. The emit system calls this on every frame it
    /// runs outside Play, so a run that ends with the emit system still
    /// running (the ordinary Stop) also ends with an empty cache.
    pub fn clear(&mut self) {
        self.states.clear();
    }

    /// Record an ACCEPTED mode transition out of Play (Stop or Pause).
    ///
    /// Called from the mode-transition path, not from the emit system, so it
    /// fires even when a transition back into Play is applied in the same
    /// update and the emit system never observes the gap. Same effect as
    /// [`clear`](Self::clear); the name says which of the two call sites a
    /// reader is looking at.
    pub fn on_leaving_play(&mut self) {
        self.states.clear();
    }

    /// Diff `current` against the previous frame, adopt `current` as the new
    /// previous frame, and return what the next `PLAY_TICK_DELTA` must carry.
    ///
    /// Order of `changed` and `removed` follows `HashMap` iteration and is not
    /// significant: the wire payload keys both by id.
    pub fn advance(&mut self, current: HashMap<String, CachedEntityState>) -> PlayTickDelta {
        let changed: Vec<(String, CachedEntityState)> = current
            .iter()
            .filter(|(id, state)| self.states.get(id.as_str()).map_or(true, |prev| prev != *state))
            .map(|(id, state)| (id.clone(), state.clone()))
            .collect();
        let removed: Vec<String> = self
            .states
            .keys()
            .filter(|id| !current.contains_key(id.as_str()))
            .cloned()
            .collect();
        self.states = current;
        PlayTickDelta { changed, removed }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(x: f32) -> CachedEntityState {
        CachedEntityState {
            position: [x, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
            name: "Cube".to_string(),
            entity_type: "cube".to_string(),
            collider_radius: 0.5,
        }
    }

    fn frame(entries: &[(&str, f32)]) -> HashMap<String, CachedEntityState> {
        entries.iter().map(|(id, x)| (id.to_string(), state(*x))).collect()
    }

    fn changed_ids(delta: &PlayTickDelta) -> Vec<&str> {
        let mut ids: Vec<&str> = delta.changed.iter().map(|(id, _)| id.as_str()).collect();
        ids.sort_unstable();
        ids
    }

    fn removed_ids(delta: &PlayTickDelta) -> Vec<&str> {
        let mut ids: Vec<&str> = delta.removed.iter().map(String::as_str).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn the_first_frame_of_a_run_lists_every_entity() {
        let mut cache = PlayTickDeltaCache::default();
        let delta = cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        assert_eq!(changed_ids(&delta), ["a", "b"]);
        assert!(delta.removed.is_empty());
    }

    #[test]
    fn an_unchanged_frame_is_an_empty_delta() {
        // The control for every test below: the delta really is incremental,
        // so a full frame after a transition is the clear's doing and not a
        // cache that never remembers anything.
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        let delta = cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        assert_eq!(delta, PlayTickDelta::default());
    }

    #[test]
    fn a_moved_entity_is_the_only_change() {
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        let delta = cache.advance(frame(&[("a", 5.0), ("b", 2.0)]));
        assert_eq!(changed_ids(&delta), ["a"]);
        assert_eq!(delta.changed[0].1.position[0], 5.0);
        assert!(delta.removed.is_empty());
    }

    #[test]
    fn a_vanished_entity_is_removed_once() {
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        let gone = cache.advance(frame(&[("a", 1.0)]));
        assert_eq!(removed_ids(&gone), ["b"]);
        assert!(gone.changed.is_empty());
        // Not resent: it was dropped from the cache along with the report.
        let next = cache.advance(frame(&[("a", 1.0)]));
        assert_eq!(next, PlayTickDelta::default());
    }

    #[test]
    fn a_frame_outside_play_clears_so_the_next_play_frame_is_full() {
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        cache.clear();
        assert!(cache.is_empty());
        let delta = cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        assert_eq!(changed_ids(&delta), ["a", "b"]);
    }

    #[test]
    fn pause_and_resume_in_one_update_still_make_the_next_frame_full() {
        // A Play frame was emitted. Then, inside ONE engine update, the
        // transition path accepts a Pause (out of Play) and a Resume (back in).
        // The emit system never ran outside Play, so its per-frame clear never
        // fired; the hub, which got both mode events, has forgotten its
        // snapshot. The next frame therefore has to be full, and it has to be
        // the transition path that made it so.
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));

        cache.on_leaving_play(); // Pause accepted
        assert!(cache.is_empty(), "leaving Play must empty the cache at once");
        // Resume accepted: nothing to do, the cache is already empty.

        let delta = cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));
        assert_eq!(changed_ids(&delta), ["a", "b"], "every entity, moved or not");
        // Nothing to remove: the hub dropped its snapshot on the mode event,
        // so there is no stale entity on the other side to retract.
        assert!(delta.removed.is_empty());
    }

    #[test]
    fn stop_and_play_in_one_update_still_make_the_next_frame_full() {
        // Same shape through Edit: Stop (out of Play) then Play, both applied
        // in one update, with an entity that moved in between to show the
        // full frame carries the latest state rather than the cached one.
        let mut cache = PlayTickDeltaCache::default();
        cache.advance(frame(&[("a", 1.0), ("b", 2.0)]));

        cache.on_leaving_play(); // Stop accepted
        // Play accepted: nothing to do.

        let delta = cache.advance(frame(&[("a", 7.0), ("b", 2.0)]));
        assert_eq!(changed_ids(&delta), ["a", "b"]);
        let a = delta.changed.iter().find(|(id, _)| id == "a").map(|(_, s)| s.position[0]);
        assert_eq!(a, Some(7.0));
        assert!(delta.removed.is_empty());
    }
}
