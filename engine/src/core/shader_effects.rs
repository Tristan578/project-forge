//! Custom shader effects system via MaterialExtension.
//!
//! This module provides a library of built-in visual effect shaders that extend
//! the standard PBR pipeline using Bevy's `ExtendedMaterial` pattern.

use bevy::prelude::*;
use bevy::asset::weak_handle;
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::render::render_resource::{AsBindGroup, Shader, ShaderRef};
use serde::{Deserialize, Serialize};

/// Stable handle for the forge effects shader, registered manually to avoid
/// `embedded_asset!` panicking on Windows due to backslash path separators.
const FORGE_EFFECTS_SHADER_HANDLE: Handle<Shader> = weak_handle!("f09eeffc-e750-4001-a000-000000000001");

// --- Default helper functions for serde ---
fn default_custom_color() -> [f32; 4] { [0.0, 1.0, 1.0, 1.0] } // Cyan
fn default_noise_scale() -> f32 { 4.0 }
fn default_edge_width() -> f32 { 0.05 }
fn default_scan_frequency() -> f32 { 80.0 }
fn default_scan_speed() -> f32 { 2.0 }
fn default_distortion() -> f32 { 0.1 }
fn default_toon_bands() -> u32 { 3 }
fn default_fresnel_power() -> f32 { 3.0 }

/// Serializable shader effect metadata stored as an ECS component.
/// This is the bridge-friendly representation. The actual GPU data
/// lives in ForgeShaderExtension (asset type, not component).
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderEffectData {
    /// Which shader effect is active.
    /// Values: "none", "dissolve", "hologram", "force_field",
    ///         "lava_flow", "toon", "fresnel_glow"
    pub shader_type: String,

    // --- Shared uniforms (all effects can use these) ---
    /// Custom tint color [r, g, b, a] (linear)
    #[serde(default = "default_custom_color")]
    pub custom_color: [f32; 4],

    /// Noise scale for procedural effects
    #[serde(default = "default_noise_scale")]
    pub noise_scale: f32,

    /// Emission strength multiplier for glow effects
    #[serde(default)]
    pub emission_strength: f32,

    // --- Dissolve-specific ---
    /// Dissolve threshold [0.0 = fully visible, 1.0 = fully dissolved]
    #[serde(default)]
    pub dissolve_threshold: f32,

    /// Edge glow width during dissolve
    #[serde(default = "default_edge_width")]
    pub dissolve_edge_width: f32,

    // --- Hologram-specific ---
    /// Scan line frequency
    #[serde(default = "default_scan_frequency")]
    pub scan_line_frequency: f32,

    /// Scan line speed (lines per second)
    #[serde(default = "default_scan_speed")]
    pub scan_line_speed: f32,

    // --- Lava/Flow-specific ---
    /// UV scroll speed [x, y]
    #[serde(default)]
    pub scroll_speed: [f32; 2],

    /// Distortion strength
    #[serde(default = "default_distortion")]
    pub distortion_strength: f32,

    // --- Toon-specific ---
    /// Number of shade bands for cel-shading
    #[serde(default = "default_toon_bands")]
    pub toon_bands: u32,

    /// Fresnel power (higher = narrower rim)
    #[serde(default = "default_fresnel_power")]
    pub fresnel_power: f32,
}

impl Default for ShaderEffectData {
    fn default() -> Self {
        Self {
            shader_type: "none".to_string(),
            custom_color: default_custom_color(),
            noise_scale: default_noise_scale(),
            emission_strength: 0.0,
            dissolve_threshold: 0.0,
            dissolve_edge_width: default_edge_width(),
            scan_line_frequency: default_scan_frequency(),
            scan_line_speed: default_scan_speed(),
            scroll_speed: [0.0, 0.0],
            distortion_strength: default_distortion(),
            toon_bands: default_toon_bands(),
            fresnel_power: default_fresnel_power(),
        }
    }
}

impl ShaderEffectData {
    /// Map shader type string to uniform integer.
    pub fn shader_type_to_u32(&self) -> u32 {
        match self.shader_type.as_str() {
            "dissolve" => 1,
            "hologram" => 2,
            "force_field" => 3,
            "lava_flow" => 4,
            "toon" => 5,
            "fresnel_glow" => 6,
            _ => 0, // "none" or unknown = passthrough
        }
    }
}

/// GPU extension struct for the unified uniform block.
/// All fields share binding 100 and are grouped into a single UBO by Bevy.
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct ForgeShaderExtension {
    #[uniform(100)]
    pub shader_type: u32,
    #[uniform(100)]
    pub noise_scale: f32,
    #[uniform(100)]
    pub emission_strength: f32,
    #[uniform(100)]
    pub dissolve_threshold: f32,

    #[uniform(100)]
    pub custom_color: Vec4,

    #[uniform(100)]
    pub scroll_speed: Vec2,
    #[uniform(100)]
    pub dissolve_edge_width: f32,
    #[uniform(100)]
    pub scan_line_frequency: f32,

    #[uniform(100)]
    pub scan_line_speed: f32,
    #[uniform(100)]
    pub distortion_strength: f32,
    #[uniform(100)]
    pub toon_bands: u32,
    #[uniform(100)]
    pub fresnel_power: f32,
}

impl Default for ForgeShaderExtension {
    fn default() -> Self {
        let data = ShaderEffectData::default();
        Self::from(&data)
    }
}

impl From<&ShaderEffectData> for ForgeShaderExtension {
    fn from(data: &ShaderEffectData) -> Self {
        Self {
            shader_type: data.shader_type_to_u32(),
            noise_scale: data.noise_scale,
            emission_strength: data.emission_strength,
            dissolve_threshold: data.dissolve_threshold,
            custom_color: Vec4::new(
                data.custom_color[0],
                data.custom_color[1],
                data.custom_color[2],
                data.custom_color[3],
            ),
            scroll_speed: Vec2::new(data.scroll_speed[0], data.scroll_speed[1]),
            dissolve_edge_width: data.dissolve_edge_width,
            scan_line_frequency: data.scan_line_frequency,
            scan_line_speed: data.scan_line_speed,
            distortion_strength: data.distortion_strength,
            toon_bands: data.toon_bands,
            fresnel_power: data.fresnel_power,
        }
    }
}

impl MaterialExtension for ForgeShaderExtension {
    fn fragment_shader() -> ShaderRef {
        FORGE_EFFECTS_SHADER_HANDLE.into()
    }
}

/// Type alias for the extended material using our shader extension.
pub type ForgeMaterial = ExtendedMaterial<StandardMaterial, ForgeShaderExtension>;

/// Plugin that registers the shader effects system.
pub struct ShaderEffectsPlugin;

impl Plugin for ShaderEffectsPlugin {
    fn build(&self, app: &mut App) {
        // Register shader directly via include_str! to avoid the embedded_asset! macro
        // panicking on Windows due to backslash path separators in file!() output.
        app.world_mut()
            .resource_mut::<Assets<Shader>>()
            .insert(
                FORGE_EFFECTS_SHADER_HANDLE.id(),
                Shader::from_wgsl(
                    include_str!("../shaders/forge_effects.wgsl"),
                    "shaders/forge_effects.wgsl",
                ),
            );

        // Register the ExtendedMaterial type
        app.add_plugins(
            MaterialPlugin::<ForgeMaterial>::default()
        );

        info!("Shader effects plugin initialized");
    }
}
