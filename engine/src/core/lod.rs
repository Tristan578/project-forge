//! Level-of-detail system — distance-based mesh decimation for performance.
//!
//! `LodData` stores per-entity distance thresholds and triangle reduction ratios.
//! The `update_lod_levels` system computes camera distance each frame and emits
//! `LOD_CHANGED` events when the active level changes. Mesh simplification uses
//! QEM (Quadric Error Metric) or Fast (position-only) backends from `mesh_simplify`.

use bevy::prelude::*;
use bevy::mesh::Mesh;
use serde::{Deserialize, Serialize};
use crate::core::mesh_simplify::{MeshSimplifier, QemSimplifier, FastSimplifier};

#[derive(Component, Debug, Clone, Serialize, Deserialize)]
pub struct LodData {
    pub lod_distances: [f32; 3],  // Distance thresholds for LOD1, LOD2, LOD3
    pub auto_generate: bool,
    pub lod_ratios: [f32; 3],    // Triangle reduction ratios (0.5, 0.25, 0.1)
    pub current_lod: u8,          // Current active LOD level (0-3)
}

impl Default for LodData {
    fn default() -> Self {
        Self {
            lod_distances: [20.0, 50.0, 100.0],
            auto_generate: false,
            lod_ratios: [0.5, 0.25, 0.1],
            current_lod: 0,
        }
    }
}

#[derive(Component, Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceBudget {
    pub max_triangles: u32,       // Max total triangles
    pub max_draw_calls: u32,      // Max draw calls
    pub target_fps: f32,          // Target frame rate
    pub warning_threshold: f32,   // Warn when budget usage exceeds this (0.0-1.0)
}

impl Default for PerformanceBudget {
    fn default() -> Self {
        Self {
            max_triangles: 500_000,
            max_draw_calls: 200,
            target_fps: 60.0,
            warning_threshold: 0.8,
        }
    }
}

/// Stores pre-generated LOD mesh handles for an entity.
/// Index 0 = original mesh, indices 1-3 = simplified LODs.
#[derive(Component, Debug, Clone)]
pub struct LodMeshes {
    pub levels: [Option<Handle<Mesh>>; 4],
}

impl Default for LodMeshes {
    fn default() -> Self {
        Self {
            levels: [None, None, None, None],
        }
    }
}

/// Bevy resource that holds the active mesh simplification backend.
///
/// Defaults to `QemSimplifier` (attribute-preserving QEM). Can be switched to
/// `FastSimplifier` (position-only, lower quality but faster) via the
/// `set_simplification_backend` command.
#[derive(Resource)]
pub struct SimplificationBackend {
    pub backend: Box<dyn MeshSimplifier>,
    pub backend_name: String,
}

impl Default for SimplificationBackend {
    fn default() -> Self {
        Self {
            backend: Box::new(QemSimplifier),
            backend_name: "qem".to_string(),
        }
    }
}

impl SimplificationBackend {
    /// Switch the active backend by name. Accepts `"qem"` or `"fast"`.
    /// Unknown names fall back to `"qem"`.
    pub fn set_by_name(&mut self, name: &str) {
        match name {
            "fast" => {
                self.backend = Box::new(FastSimplifier);
                self.backend_name = "fast".to_string();
            }
            _ => {
                self.backend = Box::new(QemSimplifier);
                self.backend_name = "qem".to_string();
            }
        }
    }
}

/// Resource tracking real-time performance metrics.
#[derive(Resource, Debug, Clone, Default)]
pub struct PerformanceMetrics {
    pub fps: f32,
    pub frame_time_ms: f32,
    pub entity_count: u32,
    pub triangle_count: u32,
    pub draw_call_estimate: u32,
    pub wasm_heap_bytes: u64,
    pub mesh_memory_bytes: u64,
    /// Frame counter for throttling metrics collection.
    pub frame_counter: u32,
}
