//! Environment settings - skybox, clear color, fog.
//!
//! Provides:
//! - Configurable ClearColor background
//! - Distance fog (linear falloff)
//! - Skybox cubemap rendering with 5 built-in presets
//! - Image-based lighting (IBL)

use bevy::prelude::*;
use bevy::pbr::{DistanceFog, FogFalloff};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use serde::{Serialize, Deserialize};

use super::camera::EditorCamera;

/// User-editable environment settings, serializable for the bridge.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSettings {
    pub skybox_brightness: f32,
    pub ibl_intensity: f32,
    pub ibl_rotation_degrees: f32,
    pub clear_color: [f32; 3],
    pub fog_enabled: bool,
    pub fog_color: [f32; 3],
    pub fog_start: f32,
    pub fog_end: f32,
    pub skybox_preset: Option<String>,
    pub skybox_asset_id: Option<String>,
}

impl Default for EnvironmentSettings {
    fn default() -> Self {
        Self {
            skybox_brightness: 1000.0,
            ibl_intensity: 900.0,
            ibl_rotation_degrees: 0.0,
            clear_color: [0.1, 0.1, 0.12],    // Dark grey-blue
            fog_enabled: false,
            fog_color: [0.5, 0.5, 0.55],
            fog_start: 30.0,
            fog_end: 100.0,
            skybox_preset: None,
            skybox_asset_id: None,
        }
    }
}

/// Resource for caching generated preset cubemap handles.
#[derive(Resource, Default)]
pub struct SkyboxHandles {
    pub handles: std::collections::HashMap<String, Handle<Image>>,
}

/// Generate a procedural cubemap for a built-in preset.
/// Returns a cubemap Image with 6 faces (64x64 each).
pub fn generate_preset_cubemap(preset: &str) -> Image {
    let size = 64;
    let face_size = size * size * 4; // RGBA

    // Define color schemes for each preset
    let colors = match preset {
        "studio" => {
            // Neutral gray studio
            let gray = [0x88, 0x88, 0x88, 0xFF];
            [gray; 6]
        }
        "sunset" => {
            // Warm orange/purple gradient
            let orange = [0xFF, 0x66, 0x33, 0xFF];
            let purple = [0x66, 0x33, 0xAA, 0xFF];
            [orange, orange, purple, orange, orange, orange] // Bottom faces orange, top purple
        }
        "overcast" => {
            // Cool gray-blue
            let cool = [0x77, 0x88, 0xAA, 0xFF];
            [cool; 6]
        }
        "night" => {
            // Dark navy
            let navy = [0x11, 0x11, 0x33, 0xFF];
            [navy; 6]
        }
        "bright_day" => {
            // Blue top, white bottom
            let blue = [0x88, 0xBB, 0xFF, 0xFF];
            let white = [0xEE, 0xEE, 0xEE, 0xFF];
            [white, white, blue, white, white, white] // Bottom white, top blue
        }
        _ => {
            // Default fallback
            let gray = [0x88, 0x88, 0x88, 0xFF];
            [gray; 6]
        }
    };

    // Create pixel data for all 6 faces
    let mut data = Vec::with_capacity(face_size * 6);
    for face_color in &colors {
        for _ in 0..(size * size) {
            data.extend_from_slice(face_color);
        }
    }

    // Create the cubemap image
    let mut image = Image::new(
        Extent3d {
            width: size as u32,
            height: size as u32,
            depth_or_array_layers: 6,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        bevy::render::render_asset::RenderAssetUsages::RENDER_WORLD,
    );

    // Mark as cubemap
    image.reinterpret_stacked_2d_as_array(6);
    image.texture_view_descriptor = Some(bevy::render::render_resource::TextureViewDescriptor {
        dimension: Some(bevy::render::render_resource::TextureViewDimension::Cube),
        ..default()
    });

    image
}

pub struct EnvironmentPlugin;

impl Plugin for EnvironmentPlugin {
    fn build(&self, app: &mut App) {
        let settings = EnvironmentSettings::default();
        let clear = ClearColor(Color::linear_rgb(
            settings.clear_color[0],
            settings.clear_color[1],
            settings.clear_color[2],
        ));
        app.insert_resource(settings)
           .insert_resource(clear)
           .add_systems(Update, sync_environment_settings);
    }
}

/// Watches EnvironmentSettings resource and syncs to Bevy components (ClearColor, FogSettings).
pub fn sync_environment_settings(
    settings: Res<EnvironmentSettings>,
    mut clear_color: ResMut<ClearColor>,
    mut fog_query: Query<(Entity, &mut DistanceFog), With<EditorCamera>>,
    camera_no_fog: Query<Entity, (With<EditorCamera>, Without<DistanceFog>)>,
    mut commands: Commands,
) {
    if !settings.is_changed() {
        return;
    }

    // Update clear color
    clear_color.0 = Color::linear_rgb(
        settings.clear_color[0],
        settings.clear_color[1],
        settings.clear_color[2],
    );

    // Handle fog
    if settings.fog_enabled {
        let fog_color = Color::linear_rgb(
            settings.fog_color[0],
            settings.fog_color[1],
            settings.fog_color[2],
        );

        if let Ok((_entity, mut fog)) = fog_query.single_mut() {
            // Update existing fog
            fog.color = fog_color;
            fog.falloff = FogFalloff::Linear {
                start: settings.fog_start,
                end: settings.fog_end,
            };
        } else if let Ok(camera_entity) = camera_no_fog.single() {
            // Add fog to camera
            commands.entity(camera_entity).insert(DistanceFog {
                color: fog_color,
                falloff: FogFalloff::Linear {
                    start: settings.fog_start,
                    end: settings.fog_end,
                },
                ..default()
            });
        }
    } else {
        // Remove fog if present
        if let Ok((entity, _)) = fog_query.single_mut() {
            commands.entity(entity).remove::<DistanceFog>();
        }
    }
}
