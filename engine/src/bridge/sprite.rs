//! Sprite rendering pipeline, animation engine, and 2D camera management.
//!
//! This module handles:
//! - Processing pending sprite data updates from the bridge
//! - Processing pending sprite removals
//! - Syncing SpriteData changes to Bevy's Sprite rendering component
//! - Emitting sprite state on selection change
//! - Managing Camera2d lifecycle (spawn/despawn orthographic camera)
//! - Syncing Camera2dData -> Bevy Camera2d + OrthographicProjection
//! - Processing project type changes
//! - Sprite sheet slicing (TextureAtlas from SpriteSheetData grid/manual config)
//! - Frame timing (advancing current frame based on fps and delta time)
//! - Animation state machine (state-based clip selection with transitions)

use bevy::prelude::*;
use bevy::image::{Image, TextureAtlasLayout};
use bevy::render::camera::{ClearColorConfig, Projection};
use bevy::sprite::Anchor;

use crate::core::{
    asset_manager::TextureHandleMap,
    camera_2d::{Camera2dData, Camera2dEnabled, CameraBounds, Managed2dCamera},
    entity_id::EntityId,
    history::{HistoryStack, UndoableAction},
    pending_commands::PendingCommands,
    project_type::ProjectType,
    sprite::{
        AnimParam, AnimationStateMachineData, FloatOp, FrameDuration, SliceMode,
        SpriteAnchor, SpriteAnimationTimer, SpriteAnimatorData,
        SpriteData, SpriteEnabled, SpriteSheetData, TransitionCondition,
        z_from_sorting,
    },
    tilemap::{TilemapData, TilemapEnabled, TilemapOrigin},
    tileset::TilesetData,
};
use super::{events, Selection, SelectionChangedEvent};

/// Marker component for child entities that represent individual tile sprites.
#[derive(Component)]
pub struct TileEntity;

/// Tracks a version counter so we know when to rebuild tile children.
#[derive(Component, Default)]
pub struct TilemapRenderState {
    /// Number of layers * tiles last time we rendered.
    pub last_hash: u64,
}

/// Newtype wrapper for Handle<TextureAtlasLayout> since Handle<T> is not a Component in Bevy 0.16.
#[derive(Component)]
pub struct AtlasLayoutHandle(pub Handle<TextureAtlasLayout>);

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
/// Preserves the existing texture_atlas if present (set by sprite sheet systems).
pub(super) fn sync_sprite_rendering(
    mut query: Query<(Entity, &SpriteData, Option<&mut Sprite>), Changed<SpriteData>>,
    texture_handles: Res<TextureHandleMap>,
    mut commands: Commands,
    mut transform_query: Query<&mut Transform>,
) {
    for (entity, sprite_data, existing_sprite) in query.iter_mut() {
        // Resolve texture handle from asset ID
        let image_handle = sprite_data.texture_asset_id.as_ref()
            .and_then(|asset_id| texture_handles.0.get(asset_id))
            .cloned()
            .unwrap_or_default();

        // Preserve existing texture_atlas if present (set by sprite sheet slicing)
        let existing_atlas = existing_sprite
            .as_ref()
            .and_then(|s| s.texture_atlas.clone());

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
            texture_atlas: existing_atlas,
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

// ========== Sprite Sheet Systems ==========

/// System that processes pending sprite sheet updates from the bridge.
/// Inserts/updates SpriteSheetData on matching entities.
pub(super) fn apply_sprite_sheet_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut SpriteSheetData>)>,
    mut commands: Commands,
) {
    for update in pending.sprite_sheet_updates.drain(..) {
        let found = query.iter_mut().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, existing)) = found else { continue };

        if let Some(mut existing_data) = existing {
            *existing_data = update.sprite_sheet_data;
        } else {
            commands.entity(entity).insert(update.sprite_sheet_data);
        }
    }
}

/// System that processes pending sprite sheet removals.
pub(super) fn apply_sprite_sheet_removals(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId)>,
    mut commands: Commands,
    mut sprite_query: Query<&mut Sprite>,
) {
    for removal in pending.sprite_sheet_removals.drain(..) {
        let found = query.iter().find(|(_, eid)| eid.0 == removal.entity_id);
        let Some((entity, _)) = found else { continue };

        // Clear the atlas from the Sprite component
        if let Ok(mut sprite) = sprite_query.get_mut(entity) {
            sprite.texture_atlas = None;
        }
        commands.entity(entity)
            .remove::<SpriteSheetData>()
            .remove::<AtlasLayoutHandle>();
    }
}

/// System that processes pending sprite animator updates from the bridge.
/// Inserts/updates SpriteAnimatorData and ensures SpriteAnimationTimer exists.
pub(super) fn apply_sprite_animator_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut SpriteAnimatorData>)>,
    mut commands: Commands,
) {
    for update in pending.sprite_animator_updates.drain(..) {
        let found = query.iter_mut().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, existing)) = found else { continue };

        if let Some(mut existing_data) = existing {
            *existing_data = update.animator_data;
        } else {
            commands.entity(entity)
                .insert(update.animator_data)
                .insert(SpriteAnimationTimer::default());
        }
    }
}

/// System that processes pending sprite animator removals.
pub(super) fn apply_sprite_animator_removals(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId)>,
    mut commands: Commands,
) {
    for removal in pending.sprite_animator_removals.drain(..) {
        let found = query.iter().find(|(_, eid)| eid.0 == removal.entity_id);
        let Some((entity, _)) = found else { continue };

        commands.entity(entity)
            .remove::<SpriteAnimatorData>()
            .remove::<SpriteAnimationTimer>();
    }
}

/// System that processes pending animation state machine updates.
pub(super) fn apply_animation_state_machine_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut AnimationStateMachineData>)>,
    mut commands: Commands,
) {
    for update in pending.animation_state_machine_updates.drain(..) {
        let found = query.iter_mut().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, existing)) = found else { continue };

        if let Some(mut existing_data) = existing {
            *existing_data = update.state_machine_data;
        } else {
            commands.entity(entity).insert(update.state_machine_data);
        }
    }
}

/// System that processes pending animation state machine removals.
pub(super) fn apply_animation_state_machine_removals(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId)>,
    mut commands: Commands,
) {
    for removal in pending.animation_state_machine_removals.drain(..) {
        let found = query.iter().find(|(_, eid)| eid.0 == removal.entity_id);
        let Some((entity, _)) = found else { continue };

        commands.entity(entity).remove::<AnimationStateMachineData>();
    }
}

// ========== Sprite Sheet Atlas Sync ==========

/// System that builds/updates the TextureAtlas inside the Sprite from SpriteSheetData when it changes.
/// This handles the "sheet slicing" step: computing the atlas layout from grid/manual config.
pub(super) fn sync_sprite_sheet_atlas(
    query: Query<(Entity, &SpriteSheetData), Changed<SpriteSheetData>>,
    texture_handles: Res<TextureHandleMap>,
    images: Res<Assets<Image>>,
    mut atlas_layouts: ResMut<Assets<TextureAtlasLayout>>,
    mut sprite_query: Query<&mut Sprite>,
    mut commands: Commands,
) {
    for (entity, sheet_data) in query.iter() {
        // Resolve the texture handle
        let Some(image_handle) = texture_handles.0.get(&sheet_data.asset_id) else {
            continue;
        };

        let layout_handle = match &sheet_data.slice_mode {
            SliceMode::Grid { columns, rows, tile_size, padding, offset } => {
                let tile = UVec2::new(tile_size[0] as u32, tile_size[1] as u32);
                let cols = *columns;
                let rws = *rows;
                let pad = Some(UVec2::new(padding[0] as u32, padding[1] as u32));
                let off = Some(UVec2::new(offset[0] as u32, offset[1] as u32));

                let layout = TextureAtlasLayout::from_grid(tile, cols, rws, pad, off);
                atlas_layouts.add(layout)
            }
            SliceMode::Manual { regions } => {
                // For manual mode, build a custom layout from frame rects
                let mut layout = TextureAtlasLayout::new_empty(
                    // Try to get the actual image size for the atlas
                    images.get(image_handle)
                        .map(|img| img.size())
                        .unwrap_or(UVec2::new(1024, 1024)),
                );

                for region in regions {
                    layout.add_texture(URect::new(
                        region.x as u32,
                        region.y as u32,
                        (region.x + region.width) as u32,
                        (region.y + region.height) as u32,
                    ));
                }

                atlas_layouts.add(layout)
            }
        };

        // Store the layout handle as a component for reference
        commands.entity(entity).insert(AtlasLayoutHandle(layout_handle.clone()));

        // Set the texture_atlas on the Sprite component
        if let Ok(mut sprite) = sprite_query.get_mut(entity) {
            sprite.texture_atlas = Some(TextureAtlas {
                layout: layout_handle,
                index: 0,
            });
        }
    }
}

// ========== Frame Timing System ==========

/// System that advances sprite animation frames based on delta time.
/// Runs every frame on entities that have an active SpriteAnimatorData + SpriteSheetData.
/// Mutates `Sprite.texture_atlas.index` to show the correct frame.
pub(super) fn animate_sprite_frames(
    time: Res<Time>,
    mut query: Query<(
        &SpriteAnimatorData,
        &SpriteSheetData,
        &mut SpriteAnimationTimer,
        &mut Sprite,
    )>,
) {
    let dt = time.delta_secs();

    for (animator, sheet, mut timer, mut sprite) in query.iter_mut() {
        // Only animate if playing and a clip is selected
        if !animator.playing {
            continue;
        }
        let Some(clip_name) = &animator.current_clip else {
            continue;
        };
        let Some(clip) = sheet.clips.get(clip_name) else {
            continue;
        };
        if clip.frames.is_empty() {
            continue;
        }

        // Need a texture_atlas on the sprite to animate
        let Some(atlas) = sprite.texture_atlas.as_mut() else {
            continue;
        };

        // Determine the duration for the current frame
        let current_frame_in_clip = animator.frame_index.min(clip.frames.len() - 1);
        let frame_dur = match &clip.frame_durations {
            FrameDuration::Uniform { duration } => *duration,
            FrameDuration::PerFrame { durations } => {
                durations.get(current_frame_in_clip).copied().unwrap_or(0.1)
            }
        };

        // Accumulate time (adjusted by speed)
        timer.elapsed += dt * animator.speed;

        // Check if we need to advance frames
        if frame_dur > 0.0 && timer.elapsed >= frame_dur {
            timer.elapsed -= frame_dur;

            // Calculate next frame index within the clip
            let num_clip_frames = clip.frames.len();
            let next_frame = if clip.ping_pong {
                // Ping-pong: reverse direction at boundaries
                if timer.forward {
                    if current_frame_in_clip + 1 >= num_clip_frames {
                        timer.forward = false;
                        current_frame_in_clip.saturating_sub(1)
                    } else {
                        current_frame_in_clip + 1
                    }
                } else if current_frame_in_clip == 0 {
                    timer.forward = true;
                    1.min(num_clip_frames - 1)
                } else {
                    current_frame_in_clip - 1
                }
            } else if clip.looping {
                (current_frame_in_clip + 1) % num_clip_frames
            } else {
                // Non-looping: clamp at last frame
                (current_frame_in_clip + 1).min(num_clip_frames - 1)
            };

            // Map clip frame index to the atlas index
            let atlas_index = clip.frames.get(next_frame).copied().unwrap_or(0);
            atlas.index = atlas_index;
        }
    }
}

// ========== Animation State Machine System ==========

/// System that evaluates the animation state machine and updates the animator's current clip.
/// Checks transition conditions and switches states when conditions are met.
pub(super) fn evaluate_animation_state_machine(
    mut query: Query<(
        &mut AnimationStateMachineData,
        &mut SpriteAnimatorData,
    )>,
) {
    for (mut state_machine, mut animator) in query.iter_mut() {
        let current_state = state_machine.current_state.clone();
        if current_state.is_empty() {
            continue;
        }

        // Find the first valid transition from the current state
        let mut next_state: Option<String> = None;
        let mut consumed_trigger: Option<String> = None;

        for transition in &state_machine.transitions {
            if transition.from_state != current_state {
                continue;
            }

            let condition_met = match &transition.condition {
                TransitionCondition::Always => true,
                TransitionCondition::ParamBool { name, value } => {
                    state_machine.parameters.get(name).map_or(false, |p| {
                        matches!(p, AnimParam::Bool { value: v } if *v == *value)
                    })
                }
                TransitionCondition::ParamFloat { name, op, threshold } => {
                    state_machine.parameters.get(name).map_or(false, |p| {
                        if let AnimParam::Float { value } = p {
                            match op {
                                FloatOp::Greater => *value > *threshold,
                                FloatOp::Less => *value < *threshold,
                                FloatOp::Equal => (*value - *threshold).abs() < f32::EPSILON,
                            }
                        } else {
                            false
                        }
                    })
                }
                TransitionCondition::ParamTrigger { name } => {
                    let triggered = state_machine.parameters.get(name).map_or(false, |p| {
                        matches!(p, AnimParam::Trigger { value: true })
                    });
                    if triggered {
                        consumed_trigger = Some(name.clone());
                    }
                    triggered
                }
            };

            if condition_met {
                next_state = Some(transition.to_state.clone());
                break;
            }
        }

        // Consume trigger (reset to false after evaluation)
        if let Some(trigger_name) = consumed_trigger {
            if let Some(param) = state_machine.parameters.get_mut(&trigger_name) {
                *param = AnimParam::Trigger { value: false };
            }
        }

        // Transition to the new state
        if let Some(new_state) = next_state {
            state_machine.current_state = new_state.clone();

            // Look up the clip name for this state
            if let Some(clip_name) = state_machine.states.get(&new_state) {
                animator.current_clip = Some(clip_name.clone());
                animator.frame_index = 0;
                animator.playing = true;
            }
        } else {
            // Ensure the animator is playing the clip for the current state
            if let Some(clip_name) = state_machine.states.get(&current_state) {
                if animator.current_clip.as_ref() != Some(clip_name) {
                    animator.current_clip = Some(clip_name.clone());
                    animator.frame_index = 0;
                    animator.playing = true;
                }
            }
        }
    }
}

// ========== Tilemap Systems ==========

/// System that processes pending tilemap data updates from the bridge.
/// Inserts/updates TilemapData and TilemapEnabled on matching entities.
pub(super) fn apply_tilemap_data_updates(
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut TilemapData>)>,
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.tilemap_data_updates.drain(..) {
        let found = query.iter_mut().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, existing)) = found else { continue };

        let old_tilemap = existing.as_deref().cloned();

        if let Some(mut existing_data) = existing {
            *existing_data = update.tilemap_data.clone();
        } else {
            commands.entity(entity)
                .insert(update.tilemap_data.clone())
                .insert(TilemapEnabled)
                .insert(TilemapRenderState::default());
        }

        // Record undo
        history.push(UndoableAction::TilemapChange {
            entity_id: update.entity_id,
            old_tilemap,
            new_tilemap: Some(update.tilemap_data),
        });
    }
}

/// System that processes pending tilemap data removals from the bridge.
pub(super) fn apply_tilemap_data_removals(
    mut pending: ResMut<PendingCommands>,
    query: Query<(Entity, &EntityId, Option<&TilemapData>)>,
    tile_entities: Query<Entity, With<TileEntity>>,
    children_query: Query<&Children>,
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.tilemap_data_removals.drain(..) {
        let found = query.iter().find(|(_, eid, _)| eid.0 == removal.entity_id);
        let Some((entity, _, old_tilemap)) = found else { continue };

        let old_tilemap_clone = old_tilemap.cloned();

        // Despawn child tile entities
        if let Ok(children) = children_query.get(entity) {
            for child in children.iter() {
                if tile_entities.contains(child) {
                    commands.entity(child).despawn();
                }
            }
        }

        commands.entity(entity)
            .remove::<TilemapData>()
            .remove::<TilemapEnabled>()
            .remove::<TilemapRenderState>();

        // Record undo
        history.push(UndoableAction::TilemapChange {
            entity_id: removal.entity_id,
            old_tilemap: old_tilemap_clone,
            new_tilemap: None,
        });
    }
}

/// Compute a simple hash of the tilemap data for change detection.
fn tilemap_data_hash(data: &TilemapData) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    // Hash structural properties
    data.tileset_asset_id.hash(&mut hasher);
    data.tile_size[0].hash(&mut hasher);
    data.tile_size[1].hash(&mut hasher);
    data.map_size[0].hash(&mut hasher);
    data.map_size[1].hash(&mut hasher);
    data.layers.len().hash(&mut hasher);
    for layer in &data.layers {
        layer.name.hash(&mut hasher);
        layer.visible.hash(&mut hasher);
        layer.is_collision.hash(&mut hasher);
        // Hash a sample of tile data to detect changes
        for tile in &layer.tiles {
            tile.hash(&mut hasher);
        }
    }
    hasher.finish()
}

/// System that renders tilemap data as child sprite entities.
/// When TilemapData changes (detected via hash), despawns old tile children and rebuilds.
/// Each visible tile becomes a Sprite child with a TextureAtlas index.
pub(super) fn sync_tilemap_rendering(
    mut tilemap_query: Query<
        (Entity, &TilemapData, &mut TilemapRenderState),
        With<TilemapEnabled>,
    >,
    tile_entities: Query<Entity, With<TileEntity>>,
    children_query: Query<&Children>,
    tileset_query: Query<&TilesetData>,
    texture_handles: Res<TextureHandleMap>,
    mut atlas_layouts: ResMut<Assets<TextureAtlasLayout>>,
    mut commands: Commands,
    transform_query: Query<&Transform>,
) {
    for (tilemap_entity, tilemap_data, mut render_state) in tilemap_query.iter_mut() {
        let current_hash = tilemap_data_hash(tilemap_data);
        if current_hash == render_state.last_hash {
            continue;
        }
        render_state.last_hash = current_hash;

        // Despawn old tile children
        if let Ok(children) = children_query.get(tilemap_entity) {
            for child in children.iter() {
                if tile_entities.contains(child) {
                    commands.entity(child).despawn();
                }
            }
        }

        // Resolve tileset texture handle from the tilemap's tileset_asset_id
        let Some(image_handle) = texture_handles.0.get(&tilemap_data.tileset_asset_id) else {
            continue;
        };

        // Find the TilesetData component on any entity (tilesets are stored per-asset, not per-entity typically).
        // For now, look up by matching asset_id.
        let tileset_opt: Option<&TilesetData> = tileset_query.iter().find(|ts| ts.asset_id == tilemap_data.tileset_asset_id);

        // Calculate atlas columns/rows from tileset or tilemap data
        let tile_w = tilemap_data.tile_size[0];
        let tile_h = tilemap_data.tile_size[1];

        // Compute atlas grid from tileset if available, otherwise estimate
        let (atlas_cols, atlas_rows) = if let Some(ts) = tileset_opt {
            (ts.grid_size[0], ts.grid_size[1])
        } else {
            // Fallback: assume a reasonable default
            (16u32, 16u32)
        };

        let spacing = tileset_opt.map(|ts| ts.spacing).unwrap_or(0);
        let margin = tileset_opt.map(|ts| ts.margin).unwrap_or(0);

        // Build the atlas layout
        let layout = TextureAtlasLayout::from_grid(
            UVec2::new(tile_w, tile_h),
            atlas_cols,
            atlas_rows,
            Some(UVec2::new(spacing, spacing)),
            Some(UVec2::new(margin, margin)),
        );
        let layout_handle = atlas_layouts.add(layout);

        let map_w = tilemap_data.map_size[0] as i32;
        let map_h = tilemap_data.map_size[1] as i32;

        // Get the tilemap entity's world position for offset calculation
        let tilemap_z = transform_query.get(tilemap_entity)
            .map(|t| t.translation.z)
            .unwrap_or(0.0);

        // Base Z for tilemap layers. Layer 0 starts at the entity's Z, each layer adds 0.01.
        let base_z = tilemap_z;

        for (layer_idx, layer) in tilemap_data.layers.iter().enumerate() {
            if !layer.visible {
                continue;
            }

            let layer_z = base_z + (layer_idx as f32 * 0.01);
            let alpha = layer.opacity;

            for row in 0..map_h {
                for col in 0..map_w {
                    let tile_index = (row * map_w + col) as usize;
                    let Some(tile_id) = layer.tiles.get(tile_index).copied().flatten() else {
                        continue;
                    };

                    // Compute world position relative to the tilemap entity.
                    // The tile positions are offsets from the tilemap entity's Transform.
                    let (x, y) = match tilemap_data.origin {
                        TilemapOrigin::TopLeft => {
                            // X increases right, Y decreases down
                            (
                                col as f32 * tile_w as f32,
                                -(row as f32 * tile_h as f32),
                            )
                        }
                        TilemapOrigin::Center => {
                            // Center the map
                            let half_w = (map_w as f32 * tile_w as f32) / 2.0;
                            let half_h = (map_h as f32 * tile_h as f32) / 2.0;
                            (
                                col as f32 * tile_w as f32 - half_w + (tile_w as f32 / 2.0),
                                -(row as f32 * tile_h as f32) + half_h - (tile_h as f32 / 2.0),
                            )
                        }
                    };

                    let tile_sprite = Sprite {
                        image: image_handle.clone(),
                        color: Color::linear_rgba(1.0, 1.0, 1.0, alpha),
                        custom_size: Some(Vec2::new(tile_w as f32, tile_h as f32)),
                        texture_atlas: Some(TextureAtlas {
                            layout: layout_handle.clone(),
                            index: tile_id as usize,
                        }),
                        ..default()
                    };

                    commands.spawn((
                        TileEntity,
                        tile_sprite,
                        Transform::from_xyz(x, y, layer_z),
                        ChildOf(tilemap_entity),
                    ));
                }
            }
        }
    }
}

/// System that emits tilemap data when the primary selection has a TilemapData component (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_tilemap_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &TilemapData), Changed<TilemapData>>,
    selection_query: Query<(&EntityId, Option<&TilemapData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, tilemap_data)) = selection_query.get(primary) {
                events::emit_tilemap_changed(&entity_id.0, tilemap_data);
            }
        }
    }

    // Emit when tilemap data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, tilemap_data)) = query.get(primary) {
            events::emit_tilemap_changed(&entity_id.0, Some(tilemap_data));
        }
    }
}
