//! Environment settings - skybox, clear color, fog.
//!
//! For Option B (no external cubemap assets), this provides:
//! - Configurable ClearColor background
//! - Distance fog (linear falloff)
//! - Skybox/IBL fields exist for future use when KTX2 assets are added

use bevy::prelude::*;
use bevy::pbr::{DistanceFog, FogFalloff};
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
        }
    }
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
