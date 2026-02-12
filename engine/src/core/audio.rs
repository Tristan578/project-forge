//! Audio data component for entity audio.
//!
//! Stores audio configuration on entities. All playback execution happens in JS
//! via the Web Audio API. This component is metadata-only.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Helper function to provide default bus name for serde.
fn default_bus() -> String {
    "sfx".to_string()
}

/// Audio data attached to an entity.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioData {
    /// Asset ID referencing an imported audio file
    pub asset_id: Option<String>,
    /// Volume (0.0 = silent, 1.0 = full)
    pub volume: f32,
    /// Playback rate (1.0 = normal, 0.5 = half speed, 2.0 = double)
    pub pitch: f32,
    /// Loop playback
    pub loop_audio: bool,
    /// Spatial (3D positional) audio
    pub spatial: bool,
    /// Max distance for spatial falloff
    pub max_distance: f32,
    /// Reference distance for spatial audio
    pub ref_distance: f32,
    /// Rolloff factor for distance attenuation
    pub rolloff_factor: f32,
    /// Auto-play when entering Play mode
    pub autoplay: bool,
    /// Bus name this entity routes to (default: "sfx")
    #[serde(default = "default_bus")]
    pub bus: String,
}

impl Default for AudioData {
    fn default() -> Self {
        Self {
            asset_id: None,
            volume: 1.0,
            pitch: 1.0,
            loop_audio: false,
            spatial: false,
            max_distance: 50.0,
            ref_distance: 1.0,
            rolloff_factor: 1.0,
            autoplay: false,
            bus: "sfx".to_string(),
        }
    }
}

/// Marker component: entity has active audio enabled.
/// Separate from AudioData to allow toggling audio on/off without losing config.
#[derive(Component, Debug, Clone)]
pub struct AudioEnabled;

// ---------------------------------------------------------------------------
// Audio Bus System (Phase A-1)
// ---------------------------------------------------------------------------

/// Audio bus configuration resource.
/// Stores metadata for all audio buses. JS owns the actual GainNode instances.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioBusConfig {
    pub buses: Vec<AudioBusDef>,
}

impl Default for AudioBusConfig {
    fn default() -> Self {
        Self {
            buses: vec![
                AudioBusDef {
                    name: "master".to_string(),
                    volume: 1.0,
                    muted: false,
                    soloed: false,
                    effects: vec![],
                },
                AudioBusDef {
                    name: "sfx".to_string(),
                    volume: 1.0,
                    muted: false,
                    soloed: false,
                    effects: vec![],
                },
                AudioBusDef {
                    name: "music".to_string(),
                    volume: 0.8,
                    muted: false,
                    soloed: false,
                    effects: vec![],
                },
                AudioBusDef {
                    name: "ambient".to_string(),
                    volume: 0.7,
                    muted: false,
                    soloed: false,
                    effects: vec![],
                },
                AudioBusDef {
                    name: "voice".to_string(),
                    volume: 1.0,
                    muted: false,
                    soloed: false,
                    effects: vec![],
                },
            ],
        }
    }
}

/// Definition of a single audio bus.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioBusDef {
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub soloed: bool,
    #[serde(default)]
    pub effects: Vec<AudioEffectDef>,
}

/// Definition of an audio effect on a bus (Phase A-2).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEffectDef {
    pub effect_type: String,
    pub params: HashMap<String, f32>,
    pub enabled: bool,
}
