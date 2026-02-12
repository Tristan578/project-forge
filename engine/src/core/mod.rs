//! Core engine logic - pure Rust, no JS dependencies.
//!
//! This module contains all game engine logic that is platform-agnostic.
//! All browser/JS interop must go through the bridge module.

pub mod animation;
pub mod asset_manager;
pub mod audio;
pub mod camera;
pub mod camera_presets;
pub mod commands;
pub mod engine_mode;
pub mod entity_factory;
pub mod entity_id;
pub mod environment;
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
pub mod post_processing;
pub mod reparent;
pub mod scene;
pub mod scene_file;
pub mod scene_graph;
pub mod scripting;
pub mod selection;
pub mod snap;
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
