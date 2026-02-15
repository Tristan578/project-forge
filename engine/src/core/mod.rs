//! Core engine logic - pure Rust, no JS dependencies.
//!
//! This module contains all game engine logic that is platform-agnostic.
//! All browser/JS interop must go through the bridge module.

pub mod animation;
pub mod animation_clip;
pub mod asset_manager;
pub mod audio;
pub mod blend_tree2d;
pub mod camera;
pub mod camera_2d;
pub mod camera_presets;
pub mod commands;
pub mod csg;
pub mod engine_mode;
pub mod entity_factory;
pub mod entity_id;
pub mod environment;
pub mod game_camera;
pub mod game_components;
pub mod game_components_helpers;
pub mod events;
pub mod gizmo;
pub mod history;
pub mod input;
pub mod lighting;
pub mod material;
pub mod observability;
pub mod particles;
pub mod pending_commands;
pub mod physics;
pub mod physics_2d;
pub mod post_processing;
pub mod procedural_mesh;
pub mod project_type;
pub mod quality;
pub mod reparent;
pub mod reverb_zone;
pub mod shader_effects;
pub mod scene;
pub mod scene_file;
pub mod scene_graph;
pub mod scripting;
pub mod selection;
pub mod skeletal_animation2d;
pub mod skeleton2d;
pub mod snap;
pub mod sprite;
pub mod terrain;
pub mod tilemap;
pub mod tileset;
pub mod viewport;
pub mod visibility;

use std::sync::OnceLock;

static ENGINE_INITIALIZED: OnceLock<bool> = OnceLock::new();

/// Engine initialization state
pub struct Engine {
    canvas_id: String,
}

impl Engine {
    /// Check if engine is already initialized (singleton pattern)
    pub fn is_initialized() -> bool {
        ENGINE_INITIALIZED.get().is_some()
    }

    /// Mark engine as initialized
    pub fn mark_initialized() -> bool {
        ENGINE_INITIALIZED.set(true).is_ok()
    }

    /// Create a new engine instance
    pub fn new(canvas_id: String) -> Self {
        Self { canvas_id }
    }

    /// Get the canvas ID
    pub fn canvas_id(&self) -> &str {
        &self.canvas_id
    }
}
