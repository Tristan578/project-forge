//! Game components, game camera, and input pending commands.

use super::PendingCommands;
use crate::core::game_camera::GameCameraMode;
use crate::core::input::{ActionDef, InputPreset};

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct InputBindingUpdate {
    pub action_def: ActionDef,
}

#[derive(Debug, Clone)]
pub struct InputPresetRequest {
    pub preset: InputPreset,
}

#[derive(Debug, Clone)]
pub struct InputBindingRemoval {
    pub action_name: String,
}

#[derive(Debug, Clone)]
pub struct GameComponentAddRequest {
    pub entity_id: String,
    pub component_type: String,
    pub properties_json: String,
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
pub struct SetActiveGameCameraRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct CameraShakeRequest {
    pub intensity: f32,
    pub duration: f32,
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

    pub fn queue_game_component_update(&mut self, request: GameComponentUpdateRequest) {
        self.game_component_updates.push(request);
    }

    pub fn queue_game_component_removal(&mut self, request: GameComponentRemovalRequest) {
        self.game_component_removals.push(request);
    }

    pub fn queue_set_game_camera(&mut self, request: SetGameCameraRequest) {
        self.set_game_camera_requests.push(request);
    }

    pub fn queue_set_active_game_camera(&mut self, request: SetActiveGameCameraRequest) {
        self.set_active_game_camera_requests.push(request);
    }

    pub fn queue_camera_shake(&mut self, request: CameraShakeRequest) {
        self.camera_shake_requests.push(request);
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

pub fn queue_set_active_game_camera_from_bridge(request: SetActiveGameCameraRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_active_game_camera(request)).is_some()
}

pub fn queue_camera_shake_from_bridge(request: CameraShakeRequest) -> bool {
    super::with_pending(|pc| pc.queue_camera_shake(request)).is_some()
}
