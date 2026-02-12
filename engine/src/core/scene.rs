//! Scene setup - spawns initial 3D entities.

use bevy::prelude::*;
use bevy_panorbit_camera::PanOrbitCamera;
use transform_gizmo_bevy::prelude::GizmoCamera;

use super::camera::EditorCamera;
use super::entity_factory::Undeletable;
use super::entity_id::{EntityId, EntityName, EntityVisible};
use super::lighting::LightData;
use super::material::MaterialData;
use super::pending_commands::EntityType;

/// Marker component for the player entity.
#[derive(Component)]
pub struct Player;

/// Marker component for the ground plane.
#[derive(Component)]
pub struct Ground;

/// Startup system: spawn the basic scene.
pub fn setup_scene(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Ground plane
    commands.spawn((
        Ground,
        EntityType::Plane,
        EntityId::default(),
        EntityName::new("Ground"),
        EntityVisible::default(),
        MaterialData {
            base_color: [0.3, 0.3, 0.3, 1.0],
            ..MaterialData::default()
        },
        Mesh3d(meshes.add(Plane3d::default().mesh().size(2.0, 2.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.3, 0.3, 0.3),
            ..default()
        })),
        Transform::from_scale(Vec3::new(5.0, 1.0, 5.0)),
    ));

    // Player cube
    commands.spawn((
        Player,
        EntityType::Cube,
        EntityId::default(),
        EntityName::new("Player"),
        EntityVisible::default(),
        MaterialData {
            base_color: [0.8, 0.2, 0.2, 1.0],
            ..MaterialData::default()
        },
        Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.8, 0.2, 0.2),
            ..default()
        })),
        Transform::from_xyz(0.0, 0.5, 0.0),
    ));

    // Ambient light for base illumination (important for WebGL2 PBR)
    commands.insert_resource(AmbientLight {
        color: Color::WHITE,
        brightness: 300.0,
        affects_lightmapped_meshes: true,
    });

    // Directional light with shadows enabled
    commands.spawn((
        EntityType::DirectionalLight,
        EntityId::default(),
        EntityName::new("Sun Light"),
        EntityVisible::default(),
        LightData::directional(),
        DirectionalLight {
            illuminance: 10_000.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -0.5, 0.5, 0.0)),
    ));

    // Camera with orbit controls (not pickable - internal entity, cannot be deleted)
    commands.spawn((
        EntityId::default(),
        EntityName::new("Main Camera"),
        EntityVisible::default(),
        Undeletable,
        EditorCamera,
        GizmoCamera,
        Camera3d::default(),
        #[cfg(feature = "webgl2")]
        Msaa::Off,
        #[cfg(feature = "webgpu")]
        Msaa::Sample4,
        Transform::from_xyz(5.0, 5.0, 5.0).looking_at(Vec3::ZERO, Vec3::Y),
        PanOrbitCamera {
            // Focus point (what the camera orbits around)
            focus: Vec3::ZERO,
            // Initial radius (distance from focus)
            radius: Some(8.66), // ~sqrt(5^2 + 5^2 + 5^2)
            // Orbit with right mouse button
            button_orbit: MouseButton::Right,
            // Pan with middle mouse button
            button_pan: MouseButton::Middle,
            // Zoom sensitivity
            zoom_sensitivity: 0.5,
            // Orbit sensitivity
            orbit_sensitivity: 1.0,
            // Pan sensitivity
            pan_sensitivity: 0.5,
            // Minimum/maximum zoom distance
            zoom_lower_limit: 1.0,
            zoom_upper_limit: Some(100.0),
            // Pitch limits to prevent flipping
            pitch_lower_limit: Some(-1.4), // ~-80 degrees
            pitch_upper_limit: Some(1.4),  // ~80 degrees
            ..default()
        },
    ));
}
