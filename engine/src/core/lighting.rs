//! Lighting system for per-entity light property editing.
//!
//! Provides `LightData` — a serializable component covering PointLight,
//! DirectionalLight, and SpotLight properties that can be edited via the
//! bridge and synced back to the actual Bevy light components.

use bevy::prelude::*;
use serde::{Serialize, Deserialize};

/// Light type discriminator.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LightType {
    Point,
    Directional,
    Spot,
}

/// Serializable light properties for bridge communication.
/// Covers all three Bevy light types in a single component.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightData {
    pub light_type: LightType,
    pub color: [f32; 3],
    pub intensity: f32,
    pub shadows_enabled: bool,
    pub shadow_depth_bias: f32,
    pub shadow_normal_bias: f32,

    // Point/Spot specific
    pub range: f32,
    pub radius: f32,

    // Spot specific
    pub inner_angle: f32,
    pub outer_angle: f32,
}

impl LightData {
    /// Default properties for a PointLight.
    pub fn point() -> Self {
        Self {
            light_type: LightType::Point,
            color: [1.0, 1.0, 1.0],
            intensity: 100_000.0,
            shadows_enabled: false,
            shadow_depth_bias: 0.08,
            shadow_normal_bias: 0.6,
            range: 20.0,
            radius: 0.0,
            inner_angle: 0.0,
            outer_angle: std::f32::consts::FRAC_PI_4,
        }
    }

    /// Default properties for a DirectionalLight.
    pub fn directional() -> Self {
        Self {
            light_type: LightType::Directional,
            color: [1.0, 1.0, 1.0],
            intensity: 10_000.0,
            shadows_enabled: true,
            shadow_depth_bias: 0.02,
            shadow_normal_bias: 1.8,
            range: 20.0,
            radius: 0.0,
            inner_angle: 0.0,
            outer_angle: std::f32::consts::FRAC_PI_4,
        }
    }

    /// Default properties for a SpotLight.
    pub fn spot() -> Self {
        Self {
            light_type: LightType::Spot,
            color: [1.0, 1.0, 1.0],
            intensity: 100_000.0,
            shadows_enabled: false,
            shadow_depth_bias: 0.02,
            shadow_normal_bias: 1.8,
            range: 20.0,
            radius: 0.0,
            inner_angle: 0.0,
            outer_angle: std::f32::consts::FRAC_PI_4,
        }
    }
}

/// Plugin that registers the light sync system.
pub struct LightingPlugin;

impl Plugin for LightingPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, sync_light_data);
    }
}

/// System that applies LightData changes to the actual Bevy light components.
fn sync_light_data(
    mut point_lights: Query<(&LightData, &mut PointLight), Changed<LightData>>,
    mut dir_lights: Query<(&LightData, &mut DirectionalLight), (Changed<LightData>, Without<PointLight>, Without<SpotLight>)>,
    mut spot_lights: Query<(&LightData, &mut SpotLight), (Changed<LightData>, Without<PointLight>, Without<DirectionalLight>)>,
) {
    for (data, mut light) in point_lights.iter_mut() {
        light.color = Color::linear_rgb(data.color[0], data.color[1], data.color[2]);
        light.intensity = data.intensity;
        light.shadows_enabled = data.shadows_enabled;
        light.shadow_depth_bias = data.shadow_depth_bias;
        light.shadow_normal_bias = data.shadow_normal_bias;
        light.range = data.range;
        light.radius = data.radius;
    }

    for (data, mut light) in dir_lights.iter_mut() {
        light.color = Color::linear_rgb(data.color[0], data.color[1], data.color[2]);
        light.illuminance = data.intensity;
        light.shadows_enabled = data.shadows_enabled;
        light.shadow_depth_bias = data.shadow_depth_bias;
        light.shadow_normal_bias = data.shadow_normal_bias;
    }

    for (data, mut light) in spot_lights.iter_mut() {
        light.color = Color::linear_rgb(data.color[0], data.color[1], data.color[2]);
        light.intensity = data.intensity;
        light.shadows_enabled = data.shadows_enabled;
        light.shadow_depth_bias = data.shadow_depth_bias;
        light.shadow_normal_bias = data.shadow_normal_bias;
        light.range = data.range;
        light.radius = data.radius;
        light.inner_angle = data.inner_angle;
        light.outer_angle = data.outer_angle;
    }
}
