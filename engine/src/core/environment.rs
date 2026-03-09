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
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    );

    // Mark as cubemap — image is already created with depth_or_array_layers: 6,
    // so no reinterpret_stacked_2d_as_array call is needed (that's for stacked 2D layouts).
    image.texture_view_descriptor = Some(bevy::render::render_resource::TextureViewDescriptor {
        dimension: Some(bevy::render::render_resource::TextureViewDimension::Cube),
        ..default()
    });

    image
}

/// Convert an equirectangular (2:1 aspect ratio) image into a cubemap with 6 faces.
///
/// The input image is a standard equirectangular projection (latitude/longitude mapped to x/y).
/// The output is a Bevy `Image` with `depth_or_array_layers: 6` and `TextureViewDimension::Cube`.
///
/// Face order: +X, -X, +Y, -Y, +Z, -Z (standard cubemap convention).
pub fn equirectangular_to_cubemap(source: &Image, face_size: u32) -> Image {
    let src_width = source.width();
    let src_height = source.height();
    let src_data = source.data.as_ref().expect("Image has no pixel data");

    // Determine bytes per pixel from the source format
    let bpp: usize = match source.texture_descriptor.format {
        TextureFormat::Rgba8Unorm | TextureFormat::Rgba8UnormSrgb => 4,
        TextureFormat::Rgba16Float => 8,
        _ => 4, // Fallback — most decoded PNGs are RGBA8
    };
    let out_bpp: usize = 4; // Output is always RGBA8

    let face_pixels = (face_size * face_size) as usize;
    let mut data = vec![0u8; face_pixels * 6 * out_bpp];

    // For each of the 6 faces, compute the direction vector for each texel,
    // then sample from the equirectangular source.
    for face in 0u32..6 {
        for y in 0..face_size {
            for x in 0..face_size {
                // Normalized coordinates in [-1, 1]
                let u = (x as f32 + 0.5) / face_size as f32 * 2.0 - 1.0;
                let v = (y as f32 + 0.5) / face_size as f32 * 2.0 - 1.0;

                // Direction vector for this texel on this face
                let (dx, dy, dz) = match face {
                    0 => ( 1.0, -v,   -u),   // +X
                    1 => (-1.0, -v,    u),   // -X
                    2 => ( u,    1.0,  v),   // +Y
                    3 => ( u,   -1.0, -v),   // -Y
                    4 => ( u,   -v,    1.0), // +Z
                    5 => (-u,   -v,   -1.0), // -Z
                    _ => unreachable!(),
                };

                // Convert direction to spherical coordinates
                let len = (dx * dx + dy * dy + dz * dz).sqrt();
                let nx = dx / len;
                let ny = dy / len;
                let nz = dz / len;

                // theta: azimuth angle [-pi, pi], phi: elevation [-pi/2, pi/2]
                let theta = nz.atan2(nx);
                let phi = ny.asin();

                // Map to equirectangular UV coordinates [0, 1]
                let eq_u = (theta / std::f32::consts::PI + 1.0) * 0.5;
                let eq_v = (-phi / std::f32::consts::FRAC_PI_2 + 1.0) * 0.5;

                // Sample source pixel (nearest neighbor)
                let sx = ((eq_u * src_width as f32) as u32).min(src_width - 1);
                let sy = ((eq_v * src_height as f32) as u32).min(src_height - 1);

                let src_idx = (sy as usize * src_width as usize + sx as usize) * bpp;
                let dst_idx = (face as usize * face_pixels + y as usize * face_size as usize + x as usize) * out_bpp;

                if src_idx + 3 < src_data.len() && dst_idx + 3 < data.len() {
                    if bpp == 8 {
                        // Rgba16Float -> Rgba8: read f16 values, convert to u8
                        // For simplicity, use a basic conversion (clamp to [0,1])
                        for c in 0..4 {
                            let half_idx = src_idx + c * 2;
                            let half_bits = u16::from_le_bytes([
                                src_data[half_idx],
                                src_data[half_idx + 1],
                            ]);
                            let f = half_to_f32(half_bits);
                            data[dst_idx + c] = (f.clamp(0.0, 1.0) * 255.0) as u8;
                        }
                    } else {
                        data[dst_idx]     = src_data[src_idx];
                        data[dst_idx + 1] = src_data[src_idx + 1];
                        data[dst_idx + 2] = src_data[src_idx + 2];
                        data[dst_idx + 3] = src_data[src_idx + 3];
                    }
                }
            }
        }
    }

    let mut image = Image::new(
        Extent3d {
            width: face_size,
            height: face_size,
            depth_or_array_layers: 6,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    );

    image.texture_view_descriptor = Some(bevy::render::render_resource::TextureViewDescriptor {
        dimension: Some(bevy::render::render_resource::TextureViewDimension::Cube),
        ..default()
    });

    image
}

/// Convert IEEE 754 half-precision float (f16) to f32.
fn half_to_f32(h: u16) -> f32 {
    let sign = ((h >> 15) & 1) as u32;
    let exp = ((h >> 10) & 0x1F) as u32;
    let mant = (h & 0x3FF) as u32;

    if exp == 0 {
        // Subnormal or zero
        if mant == 0 {
            return f32::from_bits(sign << 31);
        }
        // Subnormal: normalize
        let mut e = 0i32;
        let mut m = mant;
        while m & 0x400 == 0 {
            m <<= 1;
            e -= 1;
        }
        m &= 0x3FF;
        let f_exp = (127 - 15 + 1 + e) as u32;
        return f32::from_bits((sign << 31) | (f_exp << 23) | (m << 13));
    }
    if exp == 31 {
        // Inf or NaN
        return f32::from_bits((sign << 31) | (0xFF << 23) | (mant << 13));
    }
    let f_exp = exp + (127 - 15);
    f32::from_bits((sign << 31) | (f_exp << 23) | (mant << 13))
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
