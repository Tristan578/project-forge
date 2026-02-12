//! Particle system data types and presets.
//!
//! This module contains pure data types for particle effects. The types are
//! platform-agnostic and always compiled on both WebGL2 and WebGPU builds.
//! The bevy_hanabi integration (creating actual GPU particles) is WebGPU-only
//! and lives in the bridge layer.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Blend mode for particle rendering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticleBlendMode {
    Additive,
    AlphaBlend,
    Premultiply,
}

impl Default for ParticleBlendMode {
    fn default() -> Self {
        Self::AlphaBlend
    }
}

/// Emission shape (where particles spawn).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EmissionShape {
    Point,
    Sphere { radius: f32 },
    Cone { radius: f32, height: f32 },
    Box { half_extents: [f32; 3] },
    Circle { radius: f32 },
}

impl Default for EmissionShape {
    fn default() -> Self {
        Self::Point
    }
}

/// Spawner mode: how particles are emitted over time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SpawnerMode {
    /// Continuous emission at a steady rate (particles per second).
    Continuous { rate: f32 },
    /// Emit a fixed count all at once, then stop.
    Burst { count: u32 },
    /// Emit a fixed count once on spawn, never again.
    Once { count: u32 },
}

impl Default for SpawnerMode {
    fn default() -> Self {
        Self::Continuous { rate: 50.0 }
    }
}

/// Orientation mode for billboard/velocity-aligned particles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticleOrientation {
    Billboard,
    VelocityAligned,
    Fixed,
}

impl Default for ParticleOrientation {
    fn default() -> Self {
        Self::Billboard
    }
}

/// Named preset identifier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticlePreset {
    Fire,
    Smoke,
    Sparks,
    Rain,
    Snow,
    Explosion,
    MagicSparkle,
    Dust,
    Trail,
    Custom,
}

impl Default for ParticlePreset {
    fn default() -> Self {
        Self::Custom
    }
}

impl ParticlePreset {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "fire" => Some(Self::Fire),
            "smoke" => Some(Self::Smoke),
            "sparks" => Some(Self::Sparks),
            "rain" => Some(Self::Rain),
            "snow" => Some(Self::Snow),
            "explosion" => Some(Self::Explosion),
            "magic_sparkle" => Some(Self::MagicSparkle),
            "dust" => Some(Self::Dust),
            "trail" => Some(Self::Trail),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Fire => "Fire",
            Self::Smoke => "Smoke",
            Self::Sparks => "Sparks",
            Self::Rain => "Rain",
            Self::Snow => "Snow",
            Self::Explosion => "Explosion",
            Self::MagicSparkle => "Magic Sparkle",
            Self::Dust => "Dust",
            Self::Trail => "Trail",
            Self::Custom => "Custom",
        }
    }
}

/// A color gradient stop (position 0.0-1.0, RGBA color).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub position: f32,
    pub color: [f32; 4],
}

/// A size keyframe (position 0.0-1.0, size value).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeKeyframe {
    pub position: f32,
    pub size: f32,
}

/// Particle effect configuration component.
/// Serializable, bridge-friendly representation of a particle system.
/// Always compiled on both WebGL2 and WebGPU.
#[derive(Component, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleData {
    /// Which preset this was derived from (Custom if hand-edited).
    pub preset: ParticlePreset,

    // -- Spawner --
    pub spawner_mode: SpawnerMode,
    pub max_particles: u32,

    // -- Lifetime --
    pub lifetime_min: f32,
    pub lifetime_max: f32,

    // -- Emission shape --
    pub emission_shape: EmissionShape,

    // -- Initial velocity --
    pub velocity_min: [f32; 3],
    pub velocity_max: [f32; 3],

    // -- Acceleration (gravity, wind) --
    pub acceleration: [f32; 3],

    // -- Drag --
    pub linear_drag: f32,

    // -- Size over lifetime --
    pub size_start: f32,
    pub size_end: f32,
    pub size_keyframes: Vec<SizeKeyframe>,

    // -- Color over lifetime --
    pub color_gradient: Vec<GradientStop>,

    // -- Rendering --
    pub blend_mode: ParticleBlendMode,
    pub orientation: ParticleOrientation,

    // -- Misc --
    pub world_space: bool,
}

impl Default for ParticleData {
    fn default() -> Self {
        Self {
            preset: ParticlePreset::Custom,
            spawner_mode: SpawnerMode::Continuous { rate: 50.0 },
            max_particles: 1000,
            lifetime_min: 1.0,
            lifetime_max: 2.0,
            emission_shape: EmissionShape::Point,
            velocity_min: [0.0, 1.0, 0.0],
            velocity_max: [0.0, 2.0, 0.0],
            acceleration: [0.0, 0.0, 0.0],
            linear_drag: 0.0,
            size_start: 0.1,
            size_end: 0.0,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 1.0, 1.0, 1.0],
                },
                GradientStop {
                    position: 1.0,
                    color: [1.0, 1.0, 1.0, 0.0],
                },
            ],
            blend_mode: ParticleBlendMode::AlphaBlend,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }
}

/// Marker component: entity should emit particles.
/// Separate from ParticleData to allow toggling on/off without losing config.
#[derive(Component, Debug, Clone)]
pub struct ParticleEnabled;

// ============================================================================
// Preset Factory Functions
// ============================================================================

impl ParticleData {
    /// Fire preset: warm colors, updraft, additive blend.
    pub fn fire() -> Self {
        Self {
            preset: ParticlePreset::Fire,
            spawner_mode: SpawnerMode::Continuous { rate: 80.0 },
            max_particles: 2000,
            lifetime_min: 0.3,
            lifetime_max: 1.2,
            emission_shape: EmissionShape::Circle { radius: 0.2 },
            velocity_min: [-0.3, 1.5, -0.3],
            velocity_max: [0.3, 3.0, 0.3],
            acceleration: [0.0, 1.0, 0.0], // slight updraft
            linear_drag: 0.5,
            size_start: 0.15,
            size_end: 0.0,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 0.9, 0.2, 1.0],
                }, // bright yellow
                GradientStop {
                    position: 0.3,
                    color: [1.0, 0.4, 0.05, 1.0],
                }, // orange
                GradientStop {
                    position: 0.7,
                    color: [0.8, 0.1, 0.0, 0.8],
                }, // dark red
                GradientStop {
                    position: 1.0,
                    color: [0.1, 0.1, 0.1, 0.0],
                }, // black, transparent
            ],
            blend_mode: ParticleBlendMode::Additive,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }

    /// Smoke preset: gray wisps, grows larger over time.
    pub fn smoke() -> Self {
        Self {
            preset: ParticlePreset::Smoke,
            spawner_mode: SpawnerMode::Continuous { rate: 30.0 },
            max_particles: 1500,
            lifetime_min: 2.0,
            lifetime_max: 4.0,
            emission_shape: EmissionShape::Circle { radius: 0.3 },
            velocity_min: [-0.2, 0.5, -0.2],
            velocity_max: [0.2, 1.5, 0.2],
            acceleration: [0.0, 0.3, 0.0],
            linear_drag: 1.0,
            size_start: 0.1,
            size_end: 0.5,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [0.5, 0.5, 0.5, 0.6],
                },
                GradientStop {
                    position: 0.5,
                    color: [0.4, 0.4, 0.4, 0.3],
                },
                GradientStop {
                    position: 1.0,
                    color: [0.3, 0.3, 0.3, 0.0],
                },
            ],
            blend_mode: ParticleBlendMode::AlphaBlend,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }

    /// Sparks preset: fast, short-lived, gravity affected.
    pub fn sparks() -> Self {
        Self {
            preset: ParticlePreset::Sparks,
            spawner_mode: SpawnerMode::Burst { count: 50 },
            max_particles: 500,
            lifetime_min: 0.2,
            lifetime_max: 0.8,
            emission_shape: EmissionShape::Point,
            velocity_min: [-3.0, 1.0, -3.0],
            velocity_max: [3.0, 5.0, 3.0],
            acceleration: [0.0, -9.8, 0.0], // gravity
            linear_drag: 0.2,
            size_start: 0.03,
            size_end: 0.01,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 0.95, 0.5, 1.0],
                }, // bright yellow-white
                GradientStop {
                    position: 0.5,
                    color: [1.0, 0.6, 0.1, 1.0],
                }, // orange
                GradientStop {
                    position: 1.0,
                    color: [0.8, 0.2, 0.0, 0.0],
                }, // red, fade
            ],
            blend_mode: ParticleBlendMode::Additive,
            orientation: ParticleOrientation::VelocityAligned,
            world_space: true,
        }
    }

    /// Rain preset: fast downward streaks, large volume.
    pub fn rain() -> Self {
        Self {
            preset: ParticlePreset::Rain,
            spawner_mode: SpawnerMode::Continuous { rate: 500.0 },
            max_particles: 30000,
            lifetime_min: 0.5,
            lifetime_max: 1.5,
            emission_shape: EmissionShape::Box {
                half_extents: [10.0, 0.0, 10.0],
            },
            velocity_min: [-0.5, -15.0, -0.5],
            velocity_max: [0.5, -10.0, 0.5],
            acceleration: [0.0, -2.0, 0.0],
            linear_drag: 0.0,
            size_start: 0.02,
            size_end: 0.02,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [0.7, 0.8, 0.9, 0.6],
                },
                GradientStop {
                    position: 1.0,
                    color: [0.5, 0.6, 0.8, 0.2],
                },
            ],
            blend_mode: ParticleBlendMode::AlphaBlend,
            orientation: ParticleOrientation::VelocityAligned,
            world_space: true,
        }
    }

    /// Snow preset: gentle falling, slow, drifting motion.
    pub fn snow() -> Self {
        Self {
            preset: ParticlePreset::Snow,
            spawner_mode: SpawnerMode::Continuous { rate: 100.0 },
            max_particles: 10000,
            lifetime_min: 3.0,
            lifetime_max: 6.0,
            emission_shape: EmissionShape::Box {
                half_extents: [10.0, 0.0, 10.0],
            },
            velocity_min: [-0.5, -1.5, -0.5],
            velocity_max: [0.5, -0.5, 0.5],
            acceleration: [0.0, -0.2, 0.0],
            linear_drag: 2.0,
            size_start: 0.04,
            size_end: 0.04,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 1.0, 1.0, 0.9],
                },
                GradientStop {
                    position: 0.8,
                    color: [0.95, 0.95, 1.0, 0.7],
                },
                GradientStop {
                    position: 1.0,
                    color: [0.9, 0.9, 1.0, 0.0],
                },
            ],
            blend_mode: ParticleBlendMode::AlphaBlend,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }

    /// Explosion preset: one-shot burst, rapid expansion, size ramp.
    pub fn explosion() -> Self {
        Self {
            preset: ParticlePreset::Explosion,
            spawner_mode: SpawnerMode::Once { count: 200 },
            max_particles: 500,
            lifetime_min: 0.3,
            lifetime_max: 1.5,
            emission_shape: EmissionShape::Point,
            velocity_min: [-5.0, -5.0, -5.0],
            velocity_max: [5.0, 8.0, 5.0],
            acceleration: [0.0, -4.0, 0.0],
            linear_drag: 1.5,
            size_start: 0.2,
            size_end: 0.0,
            size_keyframes: vec![
                SizeKeyframe {
                    position: 0.0,
                    size: 0.05,
                },
                SizeKeyframe {
                    position: 0.1,
                    size: 0.25,
                },
                SizeKeyframe {
                    position: 1.0,
                    size: 0.0,
                },
            ],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 1.0, 0.8, 1.0],
                }, // white-hot
                GradientStop {
                    position: 0.15,
                    color: [1.0, 0.6, 0.1, 1.0],
                }, // orange
                GradientStop {
                    position: 0.5,
                    color: [0.6, 0.2, 0.0, 0.8],
                }, // dark orange
                GradientStop {
                    position: 1.0,
                    color: [0.2, 0.2, 0.2, 0.0],
                }, // gray smoke
            ],
            blend_mode: ParticleBlendMode::Additive,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }

    /// Magic sparkle preset: ethereal glowing particles, pulsing size.
    pub fn magic_sparkle() -> Self {
        Self {
            preset: ParticlePreset::MagicSparkle,
            spawner_mode: SpawnerMode::Continuous { rate: 40.0 },
            max_particles: 1000,
            lifetime_min: 0.8,
            lifetime_max: 2.0,
            emission_shape: EmissionShape::Sphere { radius: 0.5 },
            velocity_min: [-1.0, -1.0, -1.0],
            velocity_max: [1.0, 1.0, 1.0],
            acceleration: [0.0, 0.5, 0.0],
            linear_drag: 0.5,
            size_start: 0.06,
            size_end: 0.0,
            size_keyframes: vec![
                SizeKeyframe {
                    position: 0.0,
                    size: 0.02,
                },
                SizeKeyframe {
                    position: 0.3,
                    size: 0.08,
                },
                SizeKeyframe {
                    position: 0.6,
                    size: 0.04,
                },
                SizeKeyframe {
                    position: 1.0,
                    size: 0.0,
                },
            ],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [0.6, 0.2, 1.0, 1.0],
                }, // purple
                GradientStop {
                    position: 0.5,
                    color: [0.2, 0.8, 1.0, 0.8],
                }, // cyan
                GradientStop {
                    position: 1.0,
                    color: [0.8, 0.4, 1.0, 0.0],
                }, // purple-pink, fade
            ],
            blend_mode: ParticleBlendMode::Additive,
            orientation: ParticleOrientation::Billboard,
            world_space: false,
        }
    }

    /// Dust preset: slow-drifting ambient particles.
    pub fn dust() -> Self {
        Self {
            preset: ParticlePreset::Dust,
            spawner_mode: SpawnerMode::Continuous { rate: 15.0 },
            max_particles: 500,
            lifetime_min: 2.0,
            lifetime_max: 5.0,
            emission_shape: EmissionShape::Box {
                half_extents: [1.0, 0.0, 1.0],
            },
            velocity_min: [-0.3, 0.0, -0.3],
            velocity_max: [0.3, 0.3, 0.3],
            acceleration: [0.0, 0.05, 0.0],
            linear_drag: 1.5,
            size_start: 0.03,
            size_end: 0.05,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [0.6, 0.5, 0.3, 0.0],
                },
                GradientStop {
                    position: 0.2,
                    color: [0.6, 0.5, 0.3, 0.4],
                },
                GradientStop {
                    position: 0.8,
                    color: [0.5, 0.4, 0.25, 0.2],
                },
                GradientStop {
                    position: 1.0,
                    color: [0.4, 0.35, 0.2, 0.0],
                },
            ],
            blend_mode: ParticleBlendMode::AlphaBlend,
            orientation: ParticleOrientation::Billboard,
            world_space: true,
        }
    }

    /// Trail preset: leave particles at current position (local space).
    pub fn trail() -> Self {
        Self {
            preset: ParticlePreset::Trail,
            spawner_mode: SpawnerMode::Continuous { rate: 60.0 },
            max_particles: 2000,
            lifetime_min: 0.3,
            lifetime_max: 1.0,
            emission_shape: EmissionShape::Point,
            velocity_min: [0.0, 0.0, 0.0],
            velocity_max: [0.0, 0.0, 0.0],
            acceleration: [0.0, 0.0, 0.0],
            linear_drag: 0.0,
            size_start: 0.08,
            size_end: 0.0,
            size_keyframes: vec![],
            color_gradient: vec![
                GradientStop {
                    position: 0.0,
                    color: [1.0, 1.0, 1.0, 1.0],
                },
                GradientStop {
                    position: 0.5,
                    color: [0.8, 0.9, 1.0, 0.5],
                },
                GradientStop {
                    position: 1.0,
                    color: [0.5, 0.7, 1.0, 0.0],
                },
            ],
            blend_mode: ParticleBlendMode::Additive,
            orientation: ParticleOrientation::Billboard,
            world_space: false, // local space: particles inherit entity transform, creating trail effect
        }
    }

    /// Apply a preset by name, returning the data.
    pub fn from_preset(preset: &ParticlePreset) -> Self {
        match preset {
            ParticlePreset::Fire => Self::fire(),
            ParticlePreset::Smoke => Self::smoke(),
            ParticlePreset::Sparks => Self::sparks(),
            ParticlePreset::Rain => Self::rain(),
            ParticlePreset::Snow => Self::snow(),
            ParticlePreset::Explosion => Self::explosion(),
            ParticlePreset::MagicSparkle => Self::magic_sparkle(),
            ParticlePreset::Dust => Self::dust(),
            ParticlePreset::Trail => Self::trail(),
            ParticlePreset::Custom => Self::default(),
        }
    }
}
