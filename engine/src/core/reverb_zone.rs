//! Reverb zone component for spatial audio reverb.
//!
//! Stores reverb zone configuration on entities. All reverb processing happens in JS
//! via the Web Audio API. This component is metadata-only.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Shape of the reverb zone trigger volume.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ReverbShape {
    Box { size: [f32; 3] },
    Sphere { radius: f32 },
}

impl Default for ReverbShape {
    fn default() -> Self {
        Self::Box {
            size: [10.0, 10.0, 10.0],
        }
    }
}

/// Reverb zone data attached to an entity.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverbZoneData {
    /// Shape of the zone (box or sphere)
    pub shape: ReverbShape,
    /// Reverb preset name ("hall", "room", "cave", "outdoor", "custom")
    pub preset: String,
    /// Wet mix amount (0.0 = dry, 1.0 = fully wet)
    pub wet_mix: f32,
    /// Decay time in seconds
    pub decay_time: f32,
    /// Pre-delay in milliseconds
    pub pre_delay: f32,
    /// Distance from edge to start blending
    pub blend_radius: f32,
    /// Higher priority wins in overlaps
    pub priority: i32,
}

impl Default for ReverbZoneData {
    fn default() -> Self {
        Self {
            shape: ReverbShape::default(),
            preset: "hall".to_string(),
            wet_mix: 0.5,
            decay_time: 2.0,
            pre_delay: 10.0,
            blend_radius: 2.0,
            priority: 0,
        }
    }
}

/// Marker component: entity has reverb zone enabled.
#[derive(Component, Debug, Clone)]
pub struct ReverbZoneEnabled;
