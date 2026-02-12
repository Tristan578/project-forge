//! Animation management for glTF skeletal animation playback.
//!
//! Pure Rust, no browser dependencies. Provides the AnimationRegistry
//! resource that maps entities to their available animation clips.

use bevy::prelude::*;
use bevy::animation::graph::AnimationNodeIndex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Information about a single animation clip available on an entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationClipInfo {
    /// Human-readable name from the glTF file (e.g., "Walk", "Idle", "Run")
    pub name: String,
    /// Index into the AnimationGraph for this entity
    pub node_index: u32,
    /// Duration of the clip in seconds
    pub duration_secs: f32,
}

/// Snapshot of the current playback state for an animation on an entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationPlaybackState {
    /// EntityId string of the entity owning this animation
    pub entity_id: String,
    /// List of all available clips
    pub available_clips: Vec<AnimationClipInfo>,
    /// Name of the currently active clip, if any
    pub active_clip_name: Option<String>,
    /// Node index of the currently active clip
    pub active_node_index: Option<u32>,
    /// Whether an animation is currently playing (not paused, not finished)
    pub is_playing: bool,
    /// Whether an animation is currently paused
    pub is_paused: bool,
    /// Current elapsed time in seconds
    pub elapsed_secs: f32,
    /// Playback speed multiplier (1.0 = normal)
    pub speed: f32,
    /// Whether the animation is set to loop
    pub is_looping: bool,
    /// Whether the animation has completed (non-looping only)
    pub is_finished: bool,
}

/// Per-entity record in the AnimationRegistry.
/// Stores the mapping from clip names to AnimationGraph node indices.
#[derive(Debug, Clone)]
pub struct EntityAnimationData {
    /// Map from clip name -> (NodeIndex, duration_secs)
    pub clips: HashMap<String, (AnimationNodeIndex, f32)>,
    /// Ordered list of clip names (for consistent UI ordering)
    pub clip_names: Vec<String>,
    /// The Bevy Entity that holds the AnimationPlayer (descendant of the top-level entity)
    pub player_entity: Entity,
    /// Handle to the AnimationGraph asset for this entity
    pub graph_handle: Handle<AnimationGraph>,
}

/// Global resource tracking all entities that have animation data.
/// Keyed by the EntityId string (from our EntityId component on the top-level entity).
#[derive(Resource, Default)]
pub struct AnimationRegistry {
    pub entries: HashMap<String, EntityAnimationData>,
}

/// Marker component placed on the top-level entity to indicate it has registered animations.
/// Used to avoid re-registering.
#[derive(Component)]
pub struct HasAnimations;

/// Plugin that registers the AnimationRegistry resource.
pub struct AnimationPlugin;

impl Plugin for AnimationPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<AnimationRegistry>();
    }
}
