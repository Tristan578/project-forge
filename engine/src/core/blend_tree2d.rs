//! 2D Animation blend tree system.
//!
//! This module provides blend trees for mixing multiple animations,
//! including 1D blending, 2D blending, and additive blending.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Component defining a blend tree.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendTree2d {
    pub tree_type: BlendTreeType2d,
    pub parameter_name: String,
}

/// Type of blend tree.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum BlendTreeType2d {
    #[serde(rename = "simple1d")]
    Simple1D {
        clips: Vec<BlendClip1D>,
    },
    #[serde(rename = "additive")]
    Additive {
        base_clip: String,
        additive_clip: String,
        weight_param: String,
    },
}

/// A clip in a 1D blend space.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendClip1D {
    pub animation_name: String,
    pub threshold: f32, // parameter value where this clip is at 100%
}
