//! Sprite rendering pipeline and 2D camera management.
//!
//! This module handles:
//! - Processing pending sprite data updates from the bridge
//! - Processing pending sprite removals
//! - Syncing SpriteData changes to Bevy's Sprite rendering component
//! - Emitting sprite state on selection change
//! - Managing Camera2d lifecycle (spawn/despawn orthographic camera)
//! - Syncing Camera2dData -> Bevy Camera2d + OrthographicProjection
//! - Processing project type changes

use bevy::prelude::*;
use bevy::render::camera::{ClearColorConfig, Projection};
use bevy::sprite::Anchor;

use crate::core::{
    asset_manager::TextureHandleMap,
    camera_2d::{Camera2dData, Camera2dEnabled, CameraBounds, Managed2dCamera},
    entity_id::EntityId,
    history::{HistoryStack, UndoableAction},
    pending_commands::PendingCommands,
    project_type::ProjectType,
    sprite::{SpriteAnchor, SpriteData, SpriteEnabled, z_from_sorting},
};
use super::{events, Selection, SelectionChangedEvent};

/// Convert our SpriteAnchor enum to Bevy's Anchor enum.
fn to_bevy_anchor(anchor: &SpriteAnchor) -> Anchor {
    match anchor {
        SpriteAnchor::Center => Anchor::Center,
        SpriteAnchor::TopLeft => Anchor::TopLeft,
        SpriteAnchor::TopCenter => Anchor::TopCenter,
        SpriteAnchor::TopRight => Anchor::TopRight,
        SpriteAnchor::MiddleLeft => Anchor::CenterLeft,
        SpriteAnchor::MiddleRight => Anchor::CenterRight,
        SpriteAnchor::BottomLeft => Anchor::BottomLeft,
        SpriteAnchor::BottomCenter => Anchor::BottomCenter,
        SpriteAnchor::BottomRight => Anchor::BottomRight,
    }
}

/// System that processes pending sprite data updates from the bridge.
/// Applies SpriteData fields from the pending queue to matching entities.
pub(super) fn apply_sprite_data_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(&EntityId, &mut SpriteData)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.sprite_data_updates.drain(..) {
        let found = query.iter_mut().find(|(eid, _)| eid.0 == update.entity_id);
        let Some((_, mut sprite_data)) = found else { continue };

        // Clone old state for undo
        let old_sprite = Some(sprite_data.clone());

        // Apply partial updates
        if let Some(texture_asset_id) = update.texture_asset_id {
            sprite_data.texture_asset_id = texture_asset_id;
        }
        if let Some(color_tint) = update.color_tint {
            sprite_data.color_tint = color_tint;
        }
        if let Some(flip_x) = update.flip_x {
            sprite_data.flip_x = flip_x;
        }
        if let Some(flip_y) = update.flip_y {
            sprite_data.flip_y = flip_y;
        }
        if let Some(custom_size) = update.custom_size {
            sprite_data.custom_size = custom_size;
        }
        if let Some(sorting_layer) = update.sorting_layer {
            sprite_data.sorting_layer = sorting_layer;
        }
        if let Some(sorting_order) = update.sorting_order {
            sprite_data.sorting_order = sorting_order;
        }
        if let Some(anchor_str) = update.anchor {
            sprite_data.anchor = match anchor_str.as_str() {
                "TopLeft" => SpriteAnchor::TopLeft,
                "TopCenter" => SpriteAnchor::TopCenter,
                "TopRight" => SpriteAnchor::TopRight,
                "MiddleLeft" => SpriteAnchor::MiddleLeft,
                "MiddleRight" => SpriteAnchor::MiddleRight,
                "BottomLeft" => SpriteAnchor::BottomLeft,
                "BottomCenter" => SpriteAnchor::BottomCenter,
                "BottomRight" => SpriteAnchor::BottomRight,
                _ => SpriteAnchor::Center,
            };
        }

        let new_sprite = Some(sprite_data.clone());

        // Record undo
        history.push(UndoableAction::SpriteChange {
            entity_id: update.entity_id,
            old_sprite,
            new_sprite,
        });
    }
}

/// System that processes pending sprite removal requests from the bridge.
pub(super) fn apply_sprite_removals(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId, Option<&SpriteData>)>,
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.sprite_removals.drain(..) {
        let found = query.iter().find(|(_, eid, _)| eid.0 == removal.entity_id);
        let Some((entity, _, old_sprite)) = found else { continue };

        let old_sprite_clone = old_sprite.cloned();

        // Remove sprite components
        commands.entity(entity)
            .remove::<SpriteData>()
            .remove::<SpriteEnabled>()
            .remove::<Sprite>();

        // Record undo
        history.push(UndoableAction::SpriteChange {
            entity_id: removal.entity_id,
            old_sprite: old_sprite_clone,
            new_sprite: None,
        });
    }
}

/// System that syncs SpriteData changes to Bevy's Sprite rendering component.
/// Runs every frame on entities where SpriteData has changed.
/// Also updates Transform.translation.z based on sorting layer/order.
pub(super) fn sync_sprite_rendering(
    query: Query<(Entity, &SpriteData), Changed<SpriteData>>,
    texture_handles: Res<TextureHandleMap>,
    mut commands: Commands,
    mut transform_query: Query<&mut Transform>,
) {
    for (entity, sprite_data) in query.iter() {
        // Resolve texture handle from asset ID
        let image_handle = sprite_data.texture_asset_id.as_ref()
            .and_then(|asset_id| texture_handles.0.get(asset_id))
            .cloned()
            .unwrap_or_default();

        // Build and insert/update the Bevy Sprite component
        let bevy_sprite = Sprite {
            image: image_handle,
            color: Color::linear_rgba(
                sprite_data.color_tint[0],
                sprite_data.color_tint[1],
                sprite_data.color_tint[2],
                sprite_data.color_tint[3],
            ),
            flip_x: sprite_data.flip_x,
            flip_y: sprite_data.flip_y,
            custom_size: sprite_data.custom_size.map(|s| Vec2::new(s[0], s[1])),
            anchor: to_bevy_anchor(&sprite_data.anchor),
            ..default()
        };

        commands.entity(entity).insert(bevy_sprite);

        // Update Z position based on sorting layer and order
        let target_z = z_from_sorting(sprite_data);
        if let Ok(mut transform) = transform_query.get_mut(entity) {
            transform.translation.z = target_z;
        }
    }
}

/// System that emits sprite data when the primary selection has a SpriteData component (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_sprite_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &SpriteData), Changed<SpriteData>>,
    selection_query: Query<(&EntityId, Option<&SpriteData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, sprite_data)) = selection_query.get(primary) {
                events::emit_sprite_changed(&entity_id.0, sprite_data);
            }
        }
    }

    // Emit when sprite data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, sprite_data)) = query.get(primary) {
            events::emit_sprite_changed(&entity_id.0, Some(sprite_data));
        }
    }
}

// ========== Project Type Systems ==========

/// System that processes pending project type changes.
/// Updates the ProjectType resource and manages Camera2d lifecycle.
pub(super) fn apply_project_type_changes(
    mut pending: ResMut<PendingCommands>,
    mut project_type: ResMut<ProjectType>,
    mut commands: Commands,
    camera_2d_query: Query<Entity, With<Managed2dCamera>>,
) {
    for request in pending.set_project_type_requests.drain(..) {
        let new_type = match request.project_type.as_str() {
            "2d" => ProjectType::TwoD,
            "3d" => ProjectType::ThreeD,
            _ => continue,
        };

        if *project_type == new_type {
            continue;
        }

        *project_type = new_type;

        match new_type {
            ProjectType::TwoD => {
                // Spawn a 2D camera if none exists
                if camera_2d_query.is_empty() {
                    let camera_data = Camera2dData::default();
                    let scale = 1.0 / camera_data.zoom;

                    commands.spawn((
                        Managed2dCamera,
                        Camera2dEnabled,
                        camera_data.clone(),
                        Camera2d,
                        Camera {
                            // Render after the 3D camera (order 0) so 2D overlays on top,
                            // but in practice the 3D camera is disabled when in 2D mode.
                            order: 1,
                            clear_color: ClearColorConfig::Default,
                            ..default()
                        },
                        Projection::Orthographic(OrthographicProjection {
                            scale,
                            ..OrthographicProjection::default_2d()
                        }),
                        Transform::from_xyz(0.0, 0.0, 999.9),
                    ));

                    events::emit_camera_2d_changed(&camera_data);
                }
            }
            ProjectType::ThreeD => {
                // Despawn the managed 2D camera when switching back to 3D
                for entity in camera_2d_query.iter() {
                    commands.entity(entity).despawn();
                }
            }
        }
    }
}

// ========== Camera 2D Systems ==========

/// System that processes pending Camera2dData updates from the bridge.
/// Applies partial updates (zoom, pixel_perfect, bounds) to the Camera2dData component.
pub(super) fn apply_camera_2d_updates(
    mut pending: ResMut<PendingCommands>,
    mut camera_query: Query<&mut Camera2dData, With<Managed2dCamera>>,
) {
    for update in pending.camera_2d_data_updates.drain(..) {
        let Ok(mut camera_data) = camera_query.single_mut() else {
            continue;
        };

        if let Some(zoom) = update.zoom {
            camera_data.zoom = zoom.max(0.01); // Prevent zero/negative zoom
        }
        if let Some(pixel_perfect) = update.pixel_perfect {
            camera_data.pixel_perfect = pixel_perfect;
        }
        if let Some(bounds) = update.bounds {
            camera_data.bounds = bounds.map(|b| CameraBounds {
                min_x: b.min_x,
                max_x: b.max_x,
                min_y: b.min_y,
                max_y: b.max_y,
            });
        }
    }
}

/// System that syncs Camera2dData changes to Bevy's Projection and Camera.
/// Runs when Camera2dData is changed on the managed 2D camera entity.
pub(super) fn sync_camera_2d_rendering(
    query: Query<
        (Entity, &Camera2dData),
        (With<Managed2dCamera>, Changed<Camera2dData>),
    >,
    mut projection_query: Query<&mut Projection>,
) {
    for (entity, camera_data) in query.iter() {
        // Sync zoom -> OrthographicProjection.scale via the Projection component
        // zoom > 1 means zoomed in (things appear bigger), so scale = 1/zoom
        if let Ok(mut projection) = projection_query.get_mut(entity) {
            if let Projection::Orthographic(ref mut ortho) = *projection {
                ortho.scale = 1.0 / camera_data.zoom.max(0.01);
            }
        }

        // Emit the updated state to the frontend
        events::emit_camera_2d_changed(camera_data);
    }
}
