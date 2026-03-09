//! Asset management system for tracking imported models and textures.
//!
//! Provides `AssetRef`, `AssetRegistry`, and related types for tracking
//! imported glTF models and texture images. Pure Rust, no browser deps.

use bevy::prelude::*;
use bevy::gltf::Gltf;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique reference linking an entity to an imported asset.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub asset_id: String,
    pub asset_name: String,
    pub asset_type: AssetKind,
}

/// The kind of asset.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    GltfModel,
    Texture,
    Audio,
}

/// Resource tracking all known assets in the current session.
#[derive(Resource, Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRegistry {
    pub assets: HashMap<String, AssetMetadata>,
}

/// Metadata for an imported asset.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMetadata {
    pub id: String,
    pub name: String,
    pub kind: AssetKind,
    pub file_size: u64,
    pub source: AssetSource,
}

/// How the asset was obtained.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum AssetSource {
    Upload { filename: String },
    Url { url: String },
    Generated { provider: String, prompt: String },
}

/// Wrapper component storing a Handle<Gltf> on an entity.
/// In Bevy 0.16, Handle<T> no longer implements Component directly.
#[derive(Component, Clone, Debug)]
pub struct GltfSourceHandle(pub Handle<Gltf>);

/// Marker component indicating that a glTF scene has been spawned for this entity.
/// Used to prevent re-spawning on subsequent frames while waiting for asset load.
#[derive(Component)]
pub struct GltfSceneSpawned;

/// Resource mapping asset IDs to loaded GPU texture handles.
/// Populated by apply_texture_load in bridge, consumed by sync_material_data in core.
#[derive(Resource, Default)]
pub struct TextureHandleMap(pub HashMap<String, Handle<Image>>);

/// Resource wrapping Bevy's in-memory asset Dir for glTF loading.
/// The Dir is shared with the "memory" AssetSource registered at startup.
/// Systems insert decoded glTF bytes here, and AssetServer loads from "memory://path".
#[derive(Resource, Clone)]
pub struct GltfMemoryDir(pub bevy::asset::io::memory::Dir);

impl Default for GltfMemoryDir {
    fn default() -> Self {
        Self(bevy::asset::io::memory::Dir::default())
    }
}
