//! 2D sprite rendering and animation components.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Resource holding the runtime sorting layer configuration.
/// Populated via the `set_sorting_layers` command.
/// Layers are ordered from index 0 (back) to N-1 (front).
#[derive(Resource, Default, Clone)]
pub struct SortingLayerConfig {
    pub layers: Vec<String>,
}

/// Sprite data component for 2D entities.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct SpriteData {
    /// Asset ID of the texture to render
    pub texture_asset_id: Option<String>,
    /// Color tint to apply to the sprite (RGBA, 0-1 range)
    pub color_tint: [f32; 4],
    /// Flip sprite horizontally
    pub flip_x: bool,
    /// Flip sprite vertically
    pub flip_y: bool,
    /// Custom size in world units (None = use texture dimensions)
    pub custom_size: Option<[f32; 2]>,
    /// Sorting layer name for draw order
    pub sorting_layer: String,
    /// Order within the sorting layer (higher = drawn on top)
    pub sorting_order: i32,
    /// Anchor point of the sprite
    pub anchor: SpriteAnchor,
}

/// Anchor point for sprite rendering.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpriteAnchor {
    Center,
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl Default for SpriteData {
    fn default() -> Self {
        Self {
            texture_asset_id: None,
            color_tint: [1.0, 1.0, 1.0, 1.0],
            flip_x: false,
            flip_y: false,
            custom_size: None,
            sorting_layer: "Default".to_string(),
            sorting_order: 0,
            anchor: SpriteAnchor::Center,
        }
    }
}

/// Marker component indicating sprite rendering is enabled.
#[derive(Component)]
pub struct SpriteEnabled;

/// Calculate Z-position from sorting layer and order.
/// Used to convert 2D layering into 3D Z depth for rendering.
///
/// If `config` is provided and non-empty, the layer index in that list is used
/// (each layer spans 100 Z units). Falls back to hardcoded layers otherwise.
pub fn z_from_sorting(data: &SpriteData) -> f32 {
    z_from_sorting_with_config(data, None)
}

/// Calculate Z-position with an optional runtime SortingLayerConfig.
pub fn z_from_sorting_with_config(data: &SpriteData, config: Option<&SortingLayerConfig>) -> f32 {
    let layer_base = if let Some(cfg) = config {
        if !cfg.layers.is_empty() {
            // Look up in the configured layers list
            if let Some(idx) = cfg.layers.iter().position(|l| l == &data.sorting_layer) {
                idx as f32 * 100.0
            } else {
                // Unknown layer: place after all configured layers
                cfg.layers.len() as f32 * 100.0
            }
        } else {
            z_layer_base_hardcoded(&data.sorting_layer)
        }
    } else {
        z_layer_base_hardcoded(&data.sorting_layer)
    };
    layer_base + (data.sorting_order as f32 * 0.01)
}

/// Hardcoded fallback layer Z bases.
fn z_layer_base_hardcoded(layer: &str) -> f32 {
    match layer {
        "Background" => 0.0,
        "Default" => 100.0,
        "Foreground" => 200.0,
        "UI" => 300.0,
        _ => 100.0,
    }
}

// ========== Sprite Sheet & Animation ==========

/// How a sprite sheet is sliced into frames.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SliceMode {
    /// Grid-based slicing: uniform rows/columns.
    Grid {
        columns: u32,
        rows: u32,
        tile_size: [f32; 2],
        padding: [f32; 2],
        offset: [f32; 2],
    },
    /// Manual region-based slicing.
    Manual {
        regions: Vec<FrameRect>,
    },
}

/// A rectangular region within a sprite sheet.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FrameRect {
    pub index: usize,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Sprite sheet data: describes how a texture is divided into animation frames.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct SpriteSheetData {
    /// Asset ID of the sprite sheet texture.
    pub asset_id: String,
    /// How the sheet is sliced.
    pub slice_mode: SliceMode,
    /// Computed frame rectangles (populated from slice_mode).
    pub frames: Vec<FrameRect>,
    /// Named animation clips defined on this sheet.
    pub clips: HashMap<String, SpriteAnimClip>,
}

/// Frame duration mode for an animation clip.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameDuration {
    /// All frames share the same duration (in seconds).
    Uniform { duration: f32 },
    /// Each frame has its own duration (in seconds).
    PerFrame { durations: Vec<f32> },
}

/// A named animation clip within a sprite sheet.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpriteAnimClip {
    /// Clip name.
    pub name: String,
    /// Frame indices into the sprite sheet's frame list.
    pub frames: Vec<usize>,
    /// Duration of each frame.
    pub frame_durations: FrameDuration,
    /// Whether the clip loops.
    pub looping: bool,
    /// Whether the clip ping-pongs (plays forward then backward).
    pub ping_pong: bool,
}

/// Sprite animator component: drives frame playback on an entity.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct SpriteAnimatorData {
    /// The entity_id (or asset_id) of the sprite sheet this animator references.
    pub sprite_sheet_id: String,
    /// Currently playing clip name (None = stopped).
    pub current_clip: Option<String>,
    /// Current frame index within the clip's frame list.
    pub frame_index: usize,
    /// Whether the animator is playing.
    pub playing: bool,
    /// Playback speed multiplier (1.0 = normal).
    pub speed: f32,
}

impl Default for SpriteAnimatorData {
    fn default() -> Self {
        Self {
            sprite_sheet_id: String::new(),
            current_clip: None,
            frame_index: 0,
            playing: false,
            speed: 1.0,
        }
    }
}

/// Runtime animation timer — tracks elapsed time for frame advancement.
/// This is an internal ECS component, not serialized to the frontend.
#[derive(Component, Default)]
pub struct SpriteAnimationTimer {
    /// Accumulated time since last frame change (in seconds).
    pub elapsed: f32,
    /// Direction for ping-pong: true = forward, false = backward.
    pub forward: bool,
}

// ========== Animation State Machine ==========

/// A parameter value for the state machine.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AnimParam {
    Bool { value: bool },
    Float { value: f32 },
    Trigger { value: bool },
}

/// Comparison operator for float conditions.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FloatOp {
    Greater,
    Less,
    Equal,
}

/// Condition for a state transition.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransitionCondition {
    /// Always transitions (after clip finishes or immediately).
    Always,
    /// Transitions when a bool parameter matches.
    ParamBool { name: String, value: bool },
    /// Transitions when a float parameter satisfies a comparison.
    ParamFloat { name: String, op: FloatOp, threshold: f32 },
    /// Transitions when a trigger parameter is set (auto-resets).
    ParamTrigger { name: String },
}

/// A transition between two states in the animation state machine.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateTransition {
    pub from_state: String,
    pub to_state: String,
    pub condition: TransitionCondition,
    /// Transition blend duration in seconds (0 = instant).
    pub duration: f32,
}

/// Animation state machine component: manages state-based clip selection.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct AnimationStateMachineData {
    /// Map of state name -> clip name.
    pub states: HashMap<String, String>,
    /// Transitions between states.
    pub transitions: Vec<StateTransition>,
    /// Current active state name.
    pub current_state: String,
    /// Named parameters that drive transitions.
    pub parameters: HashMap<String, AnimParam>,
}

impl Default for AnimationStateMachineData {
    fn default() -> Self {
        Self {
            states: HashMap::new(),
            transitions: Vec::new(),
            current_state: String::new(),
            parameters: HashMap::new(),
        }
    }
}
