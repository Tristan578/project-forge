// Animation system integration for bridge layer

use bevy::prelude::*;
use crate::core::{
    animation::{AnimationRegistry, HasAnimations, AnimationPlaybackState, AnimationClipInfo},
    entity_id::EntityId,
    pending_commands::PendingCommands,
};
use bevy::animation::{AnimationPlayer, RepeatAnimation, AnimationClip};
use bevy::animation::graph::AnimationGraph;
use bevy::animation::transition::AnimationTransitions;
use crate::core::selection::{Selection, SelectionChangedEvent};
use super::events;
use bevy::gltf::Gltf;

/// Helper: Build an AnimationPlaybackState from the registry and player.
pub(super) fn build_animation_state(
    entity_id: &str,
    registry: &AnimationRegistry,
    player_query: &Query<&AnimationPlayer>,
) -> Option<AnimationPlaybackState> {
    let entry = registry.entries.get(entity_id)?;

    let player = player_query.get(entry.player_entity).ok()?;

    // Build available clips list
    let available_clips: Vec<AnimationClipInfo> = entry.clip_names.iter().filter_map(|name| {
        let (node_index, duration) = entry.clips.get(name)?;
        Some(AnimationClipInfo {
            name: name.clone(),
            node_index: node_index.index() as u32,
            duration_secs: *duration,
        })
    }).collect();

    // Find the active animation
    let mut active_clip_name = None;
    let mut active_node_index = None;
    let mut is_playing = false;
    let mut is_paused = false;
    let mut elapsed_secs = 0.0;
    let mut speed = 1.0;
    let mut is_looping = false;
    let mut is_finished = false;

    // Check each known clip for active state
    for (name, (node_index, _duration)) in &entry.clips {
        if let Some(active) = player.animation(*node_index) {
            active_clip_name = Some(name.clone());
            active_node_index = Some(node_index.index() as u32);
            is_paused = active.is_paused();
            is_playing = !is_paused && !active.is_finished();
            elapsed_secs = active.seek_time();
            speed = active.speed();
            is_looping = matches!(active.repeat_mode(), RepeatAnimation::Forever);
            is_finished = active.is_finished();
            break;
        }
    }

    Some(AnimationPlaybackState {
        entity_id: entity_id.to_string(),
        available_clips,
        active_clip_name,
        active_node_index,
        is_playing,
        is_paused,
        elapsed_secs,
        speed,
        is_looping,
        is_finished,
    })
}

/// Helper: Build animation graph state with node weights and speeds.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnimationGraphState {
    pub entity_id: String,
    pub nodes: Vec<AnimationNodeState>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnimationNodeState {
    pub clip_name: String,
    pub node_index: u32,
    pub weight: f32,
    pub speed: f32,
    pub is_active: bool,
}

pub(super) fn build_animation_graph_state(
    entity_id: &str,
    entry: &crate::core::animation::EntityAnimationData,
    player: &AnimationPlayer,
) -> AnimationGraphState {
    let mut nodes = Vec::new();
    for (name, (node_index, _duration)) in &entry.clips {
        let animation = player.animation(*node_index);
        let (weight, speed, is_active) = if let Some(anim) = animation {
            (anim.weight(), anim.speed(), true)
        } else {
            (1.0, 1.0, false)
        };
        nodes.push(AnimationNodeState {
            clip_name: name.clone(),
            node_index: node_index.index() as u32,
            weight,
            speed,
            is_active,
        });
    }
    AnimationGraphState {
        entity_id: entity_id.to_string(),
        nodes,
    }
}

/// System that detects newly-loaded glTF scenes with AnimationPlayer components
/// and registers their animation clips in the AnimationRegistry.
pub(super) fn register_gltf_animations(
    mut animation_registry: ResMut<AnimationRegistry>,
    player_query: Query<(Entity, &AnimationPlayer), Without<HasAnimations>>,
    child_of_query: Query<&ChildOf>,
    entity_id_query: Query<&EntityId>,
    gltf_assets: Res<Assets<Gltf>>,
    gltf_handle_query: Query<&crate::core::asset_manager::GltfSourceHandle>,
    clip_assets: Res<Assets<AnimationClip>>,
    mut commands: Commands,
    mut graphs: ResMut<Assets<AnimationGraph>>,
) {
    for (player_entity, _player) in player_query.iter() {
        // Walk up the hierarchy to find the ancestor with our EntityId component
        let mut ancestor = player_entity;
        let mut found_entity_id: Option<String> = None;

        for _depth in 0..20 {
            if let Ok(eid) = entity_id_query.get(ancestor) {
                found_entity_id = Some(eid.0.clone());
                break;
            }
            if let Ok(child_of) = child_of_query.get(ancestor) {
                ancestor = child_of.parent();
            } else {
                break;
            }
        }

        let entity_id_str = match found_entity_id {
            Some(id) => id,
            None => continue, // Not one of our managed entities
        };

        // Already registered?
        if animation_registry.entries.contains_key(&entity_id_str) {
            continue;
        }

        // Try to find the Gltf asset to discover named animations
        // Walk up hierarchy again to find the entity with GltfSourceHandle
        let mut gltf_ancestor = player_entity;
        let mut gltf_handle_opt: Option<&Handle<Gltf>> = None;
        for _depth in 0..20 {
            if let Ok(source_handle) = gltf_handle_query.get(gltf_ancestor) {
                gltf_handle_opt = Some(&source_handle.0);
                break;
            }
            if let Ok(child_of) = child_of_query.get(gltf_ancestor) {
                gltf_ancestor = child_of.parent();
            } else {
                break;
            }
        }

        // Get the Gltf asset to discover animations
        let gltf_asset = gltf_handle_opt.and_then(|h| gltf_assets.get(h));
        if gltf_asset.is_none() {
            // Asset not loaded yet, try next frame
            continue;
        }
        let gltf = gltf_asset.unwrap();

        if gltf.named_animations.is_empty() {
            // No animations in this glTF, mark as processed to avoid rechecking
            commands.entity(player_entity).insert(HasAnimations);
            continue;
        }

        // Build AnimationGraph from the clips
        let mut clip_handles: Vec<Handle<AnimationClip>> = Vec::new();
        let mut clip_names_ordered: Vec<String> = Vec::new();

        for (name, handle) in &gltf.named_animations {
            clip_handles.push(handle.clone());
            clip_names_ordered.push(name.to_string());
        }

        let (graph, node_indices) = AnimationGraph::from_clips(clip_handles.iter().cloned());
        let graph_handle = graphs.add(graph);

        // Build the clips map
        let mut clips = std::collections::HashMap::new();
        for (i, name) in clip_names_ordered.iter().enumerate() {
            let node_index = node_indices[i];
            let duration = clip_handles.get(i)
                .and_then(|h| clip_assets.get(h))
                .map(|c| c.duration())
                .unwrap_or(0.0);
            clips.insert(name.clone(), (node_index, duration));
        }

        // Auto-generate names for unnamed animations
        let mut final_names = Vec::new();
        for (i, name) in clip_names_ordered.iter().enumerate() {
            let display_name = if name.is_empty() {
                format!("Animation {}", i + 1)
            } else {
                name.clone()
            };
            final_names.push(display_name);
        }

        // Insert AnimationGraphHandle and AnimationTransitions on the player entity
        commands.entity(player_entity)
            .insert(AnimationGraphHandle(graph_handle.clone()))
            .insert(AnimationTransitions::new())
            .insert(HasAnimations);

        // Register in the animation registry
        let entry = crate::core::animation::EntityAnimationData {
            clips,
            clip_names: final_names.clone(),
            player_entity,
            graph_handle,
        };
        animation_registry.entries.insert(entity_id_str.clone(), entry);

        // Build and emit the initial state
        let available_clips: Vec<AnimationClipInfo> = final_names.iter().enumerate().filter_map(|(i, name)| {
            let duration = clip_handles.get(i)
                .and_then(|h| clip_assets.get(h))
                .map(|c| c.duration())
                .unwrap_or(0.0);
            Some(AnimationClipInfo {
                name: name.clone(),
                node_index: node_indices[i].index() as u32,
                duration_secs: duration,
            })
        }).collect();

        let state = AnimationPlaybackState {
            entity_id: entity_id_str.clone(),
            available_clips,
            active_clip_name: None,
            active_node_index: None,
            is_playing: false,
            is_paused: false,
            elapsed_secs: 0.0,
            speed: 1.0,
            is_looping: false,
            is_finished: false,
        };

        events::emit_animation_list_changed(&state);
        tracing::info!("Registered {} animations for entity {}", final_names.len(), entity_id_str);
    }
}

/// System that applies pending animation requests to AnimationPlayer components.
pub(super) fn apply_animation_requests(
    mut pending: ResMut<PendingCommands>,
    animation_registry: Res<AnimationRegistry>,
    mut player_query: Query<(&mut AnimationPlayer, Option<&mut AnimationTransitions>)>,
) {
    use crate::core::pending_commands::AnimationAction;

    for request in pending.animation_requests.drain(..) {
        let entry = match animation_registry.entries.get(&request.entity_id) {
            Some(e) => e,
            None => {
                tracing::warn!("No animation data for entity: {}", request.entity_id);
                continue;
            }
        };

        let (mut player, mut transitions_opt) = match player_query.get_mut(entry.player_entity) {
            Ok(p) => p,
            Err(_) => {
                tracing::warn!("AnimationPlayer not found for entity: {}", request.entity_id);
                continue;
            }
        };

        match request.action {
            AnimationAction::Play { clip_name, crossfade_secs } => {
                if let Some((node_index, _duration)) = entry.clips.get(&clip_name) {
                    if crossfade_secs > 0.0 {
                        if let Some(transitions) = transitions_opt.as_mut() {
                            transitions.play(
                                &mut player,
                                *node_index,
                                std::time::Duration::from_secs_f32(crossfade_secs),
                            ).repeat();
                        } else {
                            player.start(*node_index).repeat();
                        }
                    } else {
                        player.start(*node_index).repeat();
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
            AnimationAction::Pause => {
                player.pause_all();
            }
            AnimationAction::Resume => {
                player.resume_all();
            }
            AnimationAction::Stop => {
                player.stop_all();
            }
            AnimationAction::Seek { time_secs } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.seek_to(time_secs);
                        break;
                    }
                }
            }
            AnimationAction::SetSpeed { speed } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_speed(speed);
                        break;
                    }
                }
            }
            AnimationAction::SetLoop { looping } => {
                for (_name, (node_index, _)) in &entry.clips {
                    if let Some(active) = player.animation_mut(*node_index) {
                        if looping {
                            active.set_repeat(RepeatAnimation::Forever);
                        } else {
                            active.set_repeat(RepeatAnimation::Never);
                        }
                        break;
                    }
                }
            }
            AnimationAction::SetBlendWeight { clip_name, weight } => {
                if let Some((node_index, _)) = entry.clips.get(&clip_name) {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_weight(weight);
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
            AnimationAction::SetClipSpeed { clip_name, speed } => {
                if let Some((node_index, _)) = entry.clips.get(&clip_name) {
                    if let Some(active) = player.animation_mut(*node_index) {
                        active.set_speed(speed);
                    }
                } else {
                    tracing::warn!("Unknown clip '{}' for entity: {}", clip_name, request.entity_id);
                }
            }
        }
    }
}

/// Emit animation state when selection changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_animation_on_selection(
    selection: Res<Selection>,
    animation_registry: Res<AnimationRegistry>,
    player_query: Query<&AnimationPlayer>,
    entity_id_query: Query<&EntityId>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok(eid) = entity_id_query.get(primary) {
                if let Some(state) = build_animation_state(&eid.0, &animation_registry, &player_query) {
                    events::emit_animation_state_changed(&state);
                }
            }
        }
    }
}

/// Periodically emit animation state while playing (throttled to ~200ms).
#[cfg(not(feature = "runtime"))]
pub(super) fn poll_animation_state(
    selection: Res<Selection>,
    animation_registry: Res<AnimationRegistry>,
    player_query: Query<&AnimationPlayer>,
    entity_id_query: Query<&EntityId>,
    time: Res<Time>,
    mut last_emit: Local<f32>,
) {
    let elapsed = time.elapsed_secs();
    if elapsed - *last_emit < 0.2 {
        return;
    }

    if let Some(primary) = selection.primary {
        if let Ok(eid) = entity_id_query.get(primary) {
            if let Some(state) = build_animation_state(&eid.0, &animation_registry, &player_query) {
                if state.is_playing {
                    events::emit_animation_state_changed(&state);
                    *last_emit = elapsed;
                }
            }
        }
    }
}
