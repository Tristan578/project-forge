//! Edit mode pending commands.

use super::PendingCommands;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct EnterEditModeRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct ExitEditModeRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct SetSelectionModeRequest {
    pub entity_id: String,
    pub mode: String,
}

#[derive(Debug, Clone)]
pub struct SelectElementsRequest {
    pub entity_id: String,
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct MeshOperationRequest {
    pub entity_id: String,
    pub operation: String,
    pub params: String, // JSON-encoded operation params
}

#[derive(Debug, Clone)]
pub struct RecalcNormalsRequest {
    pub entity_id: String,
    pub smooth: bool,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_enter_edit_mode(&mut self, request: EnterEditModeRequest) {
        self.enter_edit_mode_requests.push(request);
    }

    pub fn queue_exit_edit_mode(&mut self, request: ExitEditModeRequest) {
        self.exit_edit_mode_requests.push(request);
    }

    pub fn queue_set_selection_mode(&mut self, request: SetSelectionModeRequest) {
        self.set_selection_mode_requests.push(request);
    }

    pub fn queue_select_elements(&mut self, request: SelectElementsRequest) {
        self.select_elements_requests.push(request);
    }

    pub fn queue_mesh_operation(&mut self, request: MeshOperationRequest) {
        self.mesh_operation_requests.push(request);
    }

    pub fn queue_recalc_normals(&mut self, request: RecalcNormalsRequest) {
        self.recalc_normals_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_enter_edit_mode_from_bridge(request: EnterEditModeRequest) -> bool {
    super::with_pending(|pc| pc.queue_enter_edit_mode(request)).is_some()
}

pub fn queue_exit_edit_mode_from_bridge(request: ExitEditModeRequest) -> bool {
    super::with_pending(|pc| pc.queue_exit_edit_mode(request)).is_some()
}

pub fn queue_set_selection_mode_from_bridge(request: SetSelectionModeRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_selection_mode(request)).is_some()
}

pub fn queue_select_elements_from_bridge(request: SelectElementsRequest) -> bool {
    super::with_pending(|pc| pc.queue_select_elements(request)).is_some()
}

pub fn queue_mesh_operation_from_bridge(request: MeshOperationRequest) -> bool {
    super::with_pending(|pc| pc.queue_mesh_operation(request)).is_some()
}

pub fn queue_recalc_normals_from_bridge(request: RecalcNormalsRequest) -> bool {
    super::with_pending(|pc| pc.queue_recalc_normals(request)).is_some()
}
