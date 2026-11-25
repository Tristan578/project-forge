//! Game components, game camera, and input pending commands.

use super::PendingCommands;
use crate::core::game_camera::GameCameraMode;
use crate::core::input::{ActionDef, InputPreset};

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct InputBindingUpdate {
    pub action_def: ActionDef,
    /// Local-player slot this binding belongs to (0 = the primary player, the
    /// default for every existing script and scene).
    pub player: u8,
}

#[derive(Debug, Clone)]
pub struct InputPresetRequest {
    pub preset: InputPreset,
    /// Local-player slot the preset is merged into (0 = primary).
    pub player: u8,
}

#[derive(Debug, Clone)]
pub struct InputBindingRemoval {
    pub action_name: String,
    /// Local-player slot the removal targets (0 = primary).
    pub player: u8,
}

/// How many frames an `add_game_component` whose entity is not in the world
/// yet is carried before it is dropped (with a log line).
///
/// `spawn_entity` is a deferred `Commands::spawn`, so an add issued in the
/// SAME frame — a `dispatch_batch`, an agent issuing the two back to back, a
/// test building a scene in one synchronous block — finds no entity in the
/// drain's query. The drain used to `continue` on that, silently: the scene
/// looked complete to the caller and the engine had no component. The spawn
/// lands on the next frame; one deferral is enough for the same-frame case,
/// and the budget is small so a genuinely unknown id is reported, not
/// carried forever. (#10007)
pub const GAME_COMPONENT_ADD_DEFER_FRAMES: u8 = 3;

#[derive(Debug, Clone)]
pub struct GameComponentAddRequest {
    pub entity_id: String,
    pub component_type: String,
    pub properties_json: String,
    /// Frames this request has already waited for its entity (see
    /// [`GAME_COMPONENT_ADD_DEFER_FRAMES`]). Starts at 0.
    pub deferred_frames: u8,
}

impl GameComponentAddRequest {
    /// A fresh request that has not waited for its entity yet.
    pub fn new(entity_id: String, component_type: String, properties_json: String) -> Self {
        Self { entity_id, component_type, properties_json, deferred_frames: 0 }
    }

    /// Whether this request may wait one more frame for its entity.
    pub fn can_defer(&self) -> bool {
        self.deferred_frames < GAME_COMPONENT_ADD_DEFER_FRAMES
    }
}

#[derive(Debug, Clone)]
pub struct GameComponentUpdateRequest {
    pub entity_id: String,
    pub component_type: String,
    pub properties_json: String,
}

#[derive(Debug, Clone)]
pub struct GameComponentRemovalRequest {
    pub entity_id: String,
    pub component_name: String,
}

#[derive(Debug, Clone)]
pub struct SetGameCameraRequest {
    pub entity_id: String,
    pub mode: GameCameraMode,
    pub target_entity: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RemoveGameCameraRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct SetActiveGameCameraRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct CameraShakeRequest {
    pub intensity: f32,
    pub duration: f32,
}

#[derive(Debug, Clone)]
pub struct MouseDeltaRequest {
    pub dx: f32,
    pub dy: f32,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_input_binding_update(&mut self, update: InputBindingUpdate) {
        self.input_binding_updates.push(update);
    }

    pub fn queue_input_preset(&mut self, request: InputPresetRequest) {
        self.input_preset_requests.push(request);
    }

    pub fn queue_input_binding_removal(&mut self, removal: InputBindingRemoval) {
        self.input_binding_removals.push(removal);
    }

    pub fn queue_game_component_add(&mut self, request: GameComponentAddRequest) {
        self.game_component_adds.push(request);
    }

    /// Put back the adds whose entity the drain could not find this frame,
    /// AHEAD of anything queued since (they were queued first), each one
    /// frame older; return the ones that have used up their budget so the
    /// drain can report them. Order is preserved in both lists.
    pub fn defer_game_component_adds(
        &mut self,
        unmatched: Vec<GameComponentAddRequest>,
    ) -> Vec<GameComponentAddRequest> {
        let mut dropped = Vec::new();
        let mut deferred = Vec::new();
        for mut request in unmatched {
            if request.can_defer() {
                request.deferred_frames += 1;
                deferred.push(request);
            } else {
                dropped.push(request);
            }
        }
        if !deferred.is_empty() {
            self.game_component_adds.splice(0..0, deferred);
        }
        dropped
    }

    pub fn queue_game_component_update(&mut self, request: GameComponentUpdateRequest) {
        self.game_component_updates.push(request);
    }

    pub fn queue_game_component_removal(&mut self, request: GameComponentRemovalRequest) {
        self.game_component_removals.push(request);
    }

    pub fn queue_set_game_camera(&mut self, request: SetGameCameraRequest) {
        self.set_game_camera_requests.push(request);
    }

    pub fn queue_remove_game_camera(&mut self, request: RemoveGameCameraRequest) {
        self.remove_game_camera_requests.push(request);
    }

    pub fn queue_set_active_game_camera(&mut self, request: SetActiveGameCameraRequest) {
        self.set_active_game_camera_requests.push(request);
    }

    pub fn queue_camera_shake(&mut self, request: CameraShakeRequest) {
        self.camera_shake_requests.push(request);
    }

    pub fn queue_mouse_delta(&mut self, dx: f32, dy: f32) {
        self.mouse_delta_requests.push(MouseDeltaRequest { dx, dy });
    }
}

// === Bridge Functions ===

pub fn queue_input_binding_update_from_bridge(update: InputBindingUpdate) -> bool {
    super::with_pending(|pc| pc.queue_input_binding_update(update)).is_some()
}

pub fn queue_input_preset_from_bridge(request: InputPresetRequest) -> bool {
    super::with_pending(|pc| pc.queue_input_preset(request)).is_some()
}

pub fn queue_input_binding_removal_from_bridge(removal: InputBindingRemoval) -> bool {
    super::with_pending(|pc| pc.queue_input_binding_removal(removal)).is_some()
}

pub fn queue_game_component_add_from_bridge(request: GameComponentAddRequest) -> bool {
    super::with_pending(|pc| pc.queue_game_component_add(request)).is_some()
}

pub fn queue_game_component_update_from_bridge(request: GameComponentUpdateRequest) -> bool {
    super::with_pending(|pc| pc.queue_game_component_update(request)).is_some()
}

pub fn queue_game_component_removal_from_bridge(request: GameComponentRemovalRequest) -> bool {
    super::with_pending(|pc| pc.queue_game_component_removal(request)).is_some()
}

pub fn queue_set_game_camera_from_bridge(request: SetGameCameraRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_game_camera(request)).is_some()
}

pub fn queue_remove_game_camera_from_bridge(request: RemoveGameCameraRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_game_camera(request)).is_some()
}

pub fn queue_set_active_game_camera_from_bridge(request: SetActiveGameCameraRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_active_game_camera(request)).is_some()
}

pub fn queue_camera_shake_from_bridge(request: CameraShakeRequest) -> bool {
    super::with_pending(|pc| pc.queue_camera_shake(request)).is_some()
}

pub fn queue_mouse_delta_from_bridge(dx: f32, dy: f32) -> bool {
    super::with_pending(|pc| pc.queue_mouse_delta(dx, dy)).is_some()
}

#[cfg(test)]
mod game_component_add_deferral {
    //! A same-frame `add_game_component` is carried until its entity exists
    //! and dropped — reported — only after its budget (#10007). The drain in
    //! `bridge/game.rs` is wasm32-only, so the policy lives here where it
    //! runs natively.
    use super::*;

    fn add(entity: &str) -> GameComponentAddRequest {
        GameComponentAddRequest::new(entity.into(), "character_controller".into(), "{}".into())
    }

    #[test]
    fn a_fresh_request_has_not_waited_and_may_defer() {
        let request = add("player");
        assert_eq!(request.deferred_frames, 0);
        assert!(request.can_defer());
    }

    #[test]
    fn an_unmatched_add_is_requeued_one_frame_older_ahead_of_newer_requests() {
        let mut pending = PendingCommands::default();
        pending.queue_game_component_add(add("newer"));
        let dropped = pending.defer_game_component_adds(vec![add("player")]);
        assert!(dropped.is_empty());
        let ids: Vec<&str> = pending.game_component_adds.iter().map(|r| r.entity_id.as_str()).collect();
        assert_eq!(ids, vec!["player", "newer"], "the deferred add keeps its place ahead of later ones");
        assert_eq!(pending.game_component_adds[0].deferred_frames, 1);
        assert_eq!(pending.game_component_adds[1].deferred_frames, 0);
    }

    #[test]
    fn an_add_is_carried_for_the_budget_then_dropped_and_reported() {
        let mut pending = PendingCommands::default();
        let mut carried = vec![add("ghost")];
        for frame in 1..=GAME_COMPONENT_ADD_DEFER_FRAMES {
            let dropped = pending.defer_game_component_adds(carried);
            assert!(dropped.is_empty(), "frame {frame}: still within the budget");
            carried = pending.game_component_adds.drain(..).collect();
            assert_eq!(carried.len(), 1);
            assert_eq!(carried[0].deferred_frames, frame);
        }
        // The budget is spent: the next unmatched frame reports it instead.
        let dropped = pending.defer_game_component_adds(carried);
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].entity_id, "ghost");
        assert_eq!(dropped[0].deferred_frames, GAME_COMPONENT_ADD_DEFER_FRAMES);
        assert!(pending.game_component_adds.is_empty(), "a dropped add is not requeued");
    }

    #[test]
    fn order_is_preserved_across_deferred_and_dropped() {
        let mut pending = PendingCommands::default();
        let mut spent = add("spent");
        spent.deferred_frames = GAME_COMPONENT_ADD_DEFER_FRAMES;
        let dropped = pending.defer_game_component_adds(vec![add("a"), spent, add("b")]);
        assert_eq!(dropped.iter().map(|r| r.entity_id.as_str()).collect::<Vec<_>>(), vec!["spent"]);
        let ids: Vec<&str> = pending.game_component_adds.iter().map(|r| r.entity_id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }
}
