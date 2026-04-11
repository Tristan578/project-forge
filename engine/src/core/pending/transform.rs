//! Transform, entity, and camera pending commands.

use bevy::prelude::*;
use super::PendingCommands;
use crate::core::camera_presets::CameraPreset;
use crate::core::gizmo::CoordinateMode;
use crate::core::engine_mode::ModeChangeRequest;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct TransformUpdate {
    pub entity_id: String,
    pub position: Option<Vec3>,
    pub rotation: Option<Quat>,
    pub scale: Option<Vec3>,
}

#[derive(Debug, Clone)]
pub struct RenameRequest {
    pub entity_id: String,
    pub new_name: String,
}

#[derive(Debug, Clone)]
pub struct CameraFocusRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct CameraOrbitRequest {
    pub delta_yaw: Option<f32>,
    pub delta_pitch: Option<f32>,
    pub delta_radius: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub entity_type: super::EntityType,
    pub name: Option<String>,
    pub position: Option<Vec3>,
}

#[derive(Debug, Clone)]
pub struct DeleteRequest {
    pub entity_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DuplicateRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct CameraPresetRequest {
    pub preset: CameraPreset,
}

#[derive(Debug, Clone)]
pub struct ReparentRequest {
    pub entity_id: String,
    pub new_parent_id: Option<String>,
    pub insert_index: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct SnapSettingsUpdate {
    pub translation_snap: Option<f32>,
    pub rotation_snap_degrees: Option<f32>,
    pub scale_snap: Option<f32>,
    pub grid_visible: Option<bool>,
    pub grid_size: Option<f32>,
    pub grid_extent: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct SelectionRequest {
    pub entity_id: String,
    pub mode: SelectionMode,
}

#[derive(Debug, Clone)]
pub enum SelectionMode {
    Replace,
    Add,
    Toggle,
}

#[derive(Debug, Clone)]
pub struct VisibilityRequest {
    pub entity_id: String,
    pub visible: bool,
}

#[derive(Debug, Clone)]
pub struct GizmoModeRequest {
    pub mode: String,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_transform_update(&mut self, update: TransformUpdate) {
        self.transform_updates.push(update);
    }

    pub fn queue_rename(&mut self, request: RenameRequest) {
        self.rename_requests.push(request);
    }

    pub fn queue_camera_focus(&mut self, request: CameraFocusRequest) {
        self.camera_focus_requests.push(request);
    }

    pub fn queue_camera_orbit(&mut self, request: CameraOrbitRequest) {
        self.camera_orbit_requests.push(request);
    }

    pub fn queue_spawn(&mut self, request: SpawnRequest) {
        self.spawn_requests.push(request);
    }

    pub fn queue_delete(&mut self, request: DeleteRequest) {
        self.delete_requests.push(request);
    }

    pub fn queue_duplicate(&mut self, request: DuplicateRequest) {
        self.duplicate_requests.push(request);
    }

    pub fn queue_snap_settings_update(&mut self, update: SnapSettingsUpdate) {
        self.snap_settings_updates.push(update);
    }

    pub fn queue_grid_toggle(&mut self) {
        self.grid_toggles.push(());
    }

    pub fn queue_camera_preset(&mut self, request: CameraPresetRequest) {
        self.camera_preset_requests.push(request);
    }

    pub fn queue_reparent(&mut self, request: ReparentRequest) {
        self.reparent_requests.push(request);
    }

    pub fn queue_coordinate_mode_update(&mut self, mode: CoordinateMode) {
        self.coordinate_mode_update = Some(mode);
    }

    pub fn queue_selection(&mut self, request: SelectionRequest) {
        self.selection_requests.push(request);
    }

    pub fn queue_visibility(&mut self, request: VisibilityRequest) {
        self.visibility_requests.push(request);
    }

    pub fn queue_clear_selection(&mut self) {
        self.clear_selection_requests.push(());
    }

    pub fn queue_gizmo_mode(&mut self, request: GizmoModeRequest) {
        self.gizmo_mode_requests.push(request);
    }

    pub fn queue_mode_change(&mut self, request: ModeChangeRequest) {
        self.mode_change_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_transform_update_from_bridge(update: TransformUpdate) -> bool {
    super::with_pending(|pc| pc.queue_transform_update(update)).is_some()
}

pub fn queue_rename_from_bridge(request: RenameRequest) -> bool {
    super::with_pending(|pc| pc.queue_rename(request)).is_some()
}

pub fn queue_camera_focus_from_bridge(request: CameraFocusRequest) -> bool {
    super::with_pending(|pc| pc.queue_camera_focus(request)).is_some()
}

pub fn queue_camera_orbit_from_bridge(request: CameraOrbitRequest) -> bool {
    super::with_pending(|pc| pc.queue_camera_orbit(request)).is_some()
}

pub fn queue_spawn_from_bridge(request: SpawnRequest) -> bool {
    super::with_pending(|pc| pc.queue_spawn(request)).is_some()
}

pub fn queue_delete_from_bridge(request: DeleteRequest) -> bool {
    super::with_pending(|pc| pc.queue_delete(request)).is_some()
}

pub fn queue_duplicate_from_bridge(request: DuplicateRequest) -> bool {
    super::with_pending(|pc| pc.queue_duplicate(request)).is_some()
}

pub fn queue_snap_settings_update_from_bridge(update: SnapSettingsUpdate) -> bool {
    super::with_pending(|pc| pc.queue_snap_settings_update(update)).is_some()
}

pub fn queue_grid_toggle_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_grid_toggle()).is_some()
}

pub fn queue_camera_preset_from_bridge(request: CameraPresetRequest) -> bool {
    super::with_pending(|pc| pc.queue_camera_preset(request)).is_some()
}

pub fn queue_reparent_from_bridge(request: ReparentRequest) -> bool {
    super::with_pending(|pc| pc.queue_reparent(request)).is_some()
}

pub fn queue_coordinate_mode_update_from_bridge(mode: CoordinateMode) -> bool {
    super::with_pending(|pc| pc.queue_coordinate_mode_update(mode)).is_some()
}

pub fn queue_selection_from_bridge(request: SelectionRequest) -> bool {
    super::with_pending(|pc| pc.queue_selection(request)).is_some()
}

pub fn queue_visibility_from_bridge(request: VisibilityRequest) -> bool {
    super::with_pending(|pc| pc.queue_visibility(request)).is_some()
}

pub fn queue_clear_selection_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_clear_selection()).is_some()
}

pub fn queue_gizmo_mode_from_bridge(request: GizmoModeRequest) -> bool {
    super::with_pending(|pc| pc.queue_gizmo_mode(request)).is_some()
}

pub fn queue_mode_change_from_bridge(request: ModeChangeRequest) -> bool {
    super::with_pending(|pc| pc.queue_mode_change(request)).is_some()
}
