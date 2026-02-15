use bevy::prelude::*;
use serde::{Deserialize, Serialize};

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
