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
pub mod character_controller;
pub mod commands;
pub mod component_carry;
pub mod csg;
pub mod custom_wgsl;
pub mod edit_mode;
pub mod engine_mode;
pub mod entity_factory;
pub mod entity_id;
pub mod environment;
pub mod game_camera;
pub mod game_components;
pub mod gizmo;
pub mod history;
pub mod input;
pub mod json_guard;
pub mod lighting;
pub mod lod;
pub mod material;
pub mod mesh_simplify;
pub mod observability;
pub mod particles;
/// Shared primitives for the source-parity gates. Test-only: it is never
/// compiled into the wasm build, and nothing outside a `#[cfg(test)]` module
/// may depend on it.
#[cfg(test)]
pub mod parity_util;
pub mod pending;
/// Backward-compatible alias for the split pending_commands module.
pub mod pending_commands {
    pub use super::pending::*;
}
pub mod physics;
pub mod physics_2d;
pub mod physics_2d_sim;
pub mod post_processing;
pub mod procedural_mesh;
pub mod project_type;
pub mod quality;
pub mod reparent;
pub mod reverb_zone;
/// Native `App` schedule smoke test for B0002-class (Res+ResMut of the same
/// resource) conflicts across the full, really-registered `Update` schedule.
/// Test-only: never compiled into the wasm build. See its module doc comment.
#[cfg(test)]
pub mod schedule_smoke;
pub mod shader_effects;
pub mod scene;
pub mod scene_file;
pub mod scene_graph;
pub mod scripting;
pub mod selection;
pub mod skeletal_animation2d;
pub mod skeleton2d;
pub mod snap;
/// Source-parity gates for every `EntitySnapshot` producer, including the four
/// under `bridge/` that `cargo test` never compiles.
///
/// The file carries its own `#![cfg(test)]`, which is what keeps it out of the
/// wasm build; repeating the attribute here would be a `duplicated_attribute`
/// warning, and the inner form is the stronger of the two because it travels
/// with the file rather than with this declaration.
mod snapshot_producer_parity_tests;
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
