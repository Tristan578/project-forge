//! Edit mode for polygon modeling (vertex/edge/face editing).

use bevy::prelude::*;
use serde::{Serialize, Deserialize};

/// Marks an entity as being in edit mode (vertex/edge/face editing)
#[derive(Component, Debug, Clone, Serialize, Deserialize)]
pub struct EditModeData {
    pub active: bool,
    pub selection_mode: SelectionMode,
    pub selected_indices: Vec<u32>,
    pub wireframe_visible: bool,
    pub xray_mode: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SelectionMode {
    Vertex,
    Edge,
    Face,
}

/// Mesh edit operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MeshOperation {
    Extrude { indices: Vec<u32>, distance: f32, direction: [f32; 3] },
    Inset { indices: Vec<u32>, amount: f32 },
    Bevel { indices: Vec<u32>, width: f32, segments: u32 },
    LoopCut { edge_index: u32, cuts: u32 },
    Merge { indices: Vec<u32> },
    Bridge { group_a: Vec<u32>, group_b: Vec<u32> },
    Subdivide { indices: Vec<u32>, level: u32 },
    DeleteElements { indices: Vec<u32>, mode: SelectionMode },
}

/// Result of a mesh operation (for undo)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshEditSnapshot {
    pub entity_id: String,
    pub vertices: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
    pub uvs: Vec<[f32; 2]>,
}

impl Default for EditModeData {
    fn default() -> Self {
        Self {
            active: false,
            selection_mode: SelectionMode::Face,
            selected_indices: Vec::new(),
            wireframe_visible: true,
            xray_mode: false,
        }
    }
}
