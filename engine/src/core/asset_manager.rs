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

/// Resource mapping asset IDs to loaded GPU texture handles.
/// Populated by apply_texture_load in bridge, consumed by sync_material_data in core.
#[derive(Resource, Default)]
pub struct TextureHandleMap(pub HashMap<String, Handle<Image>>);
