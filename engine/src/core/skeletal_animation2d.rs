//! 2D Skeletal animation system.
//!
//! This module provides keyframe animation for 2D skeletons,
//! including animation clips, playback, and blending.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Component containing a skeletal animation clip.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletalAnimation2d {
    pub name: String,
    pub duration: f32,
    pub looping: bool,
    pub tracks: HashMap<String, Vec<BoneKeyframe>>, // bone_name -> keyframes
}

/// A keyframe for a bone in an animation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoneKeyframe {
    pub time: f32,
    pub position: Option<[f32; 2]>,
    pub rotation: Option<f32>,
    pub scale: Option<[f32; 2]>,
    pub easing: EasingType2d,
}

/// Easing function type for keyframe interpolation.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EasingType2d {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Step,
}

/// Component for playing skeletal animations.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletalAnimPlayer2d {
    pub current_animation: Option<String>,
    pub time: f32,
    pub speed: f32,
    pub playing: bool,
    pub blend_animations: Vec<BlendEntry>,
}

/// A blend entry for animation blending.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendEntry {
    pub animation_name: String,
    pub weight: f32,
    pub time: f32,
}

impl Default for SkeletalAnimPlayer2d {
    fn default() -> Self {
        Self {
            current_animation: None,
            time: 0.0,
            speed: 1.0,
            playing: false,
            blend_animations: vec![],
        }
    }
}

impl Default for EasingType2d {
    fn default() -> Self {
        Self::Linear
    }
}
