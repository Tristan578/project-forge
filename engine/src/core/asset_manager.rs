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

/// Return the decoded byte length of a padded standard-base64 payload without
/// allocating the decoded bytes. Accepts either raw base64 or a data URL.
pub fn decoded_base64_size(data: &str) -> Option<u64> {
    fn sextet(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let payload = data.split_once(',').map_or(data, |(_, payload)| payload);
    let bytes = payload.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }

    let padding = bytes.iter().rev().take_while(|&&byte| byte == b'=').count();
    if padding > 2 {
        return None;
    }
    let content_len = bytes.len().saturating_sub(padding);
    if !bytes[..content_len].iter().all(|&byte| sextet(byte).is_some())
        || bytes[content_len..].iter().any(|&byte| byte != b'=')
    {
        return None;
    }
    if (padding == 2 && sextet(bytes[content_len - 1])? & 0x0f != 0)
        || (padding == 1 && sextet(bytes[content_len - 1])? & 0x03 != 0)
    {
        return None;
    }

    let decoded_len = bytes
        .len()
        .checked_div(4)?
        .checked_mul(3)?
        .checked_sub(padding)?;
    u64::try_from(decoded_len).ok()
}

#[cfg(test)]
mod tests {
    use super::decoded_base64_size;

    #[test]
    fn decoded_base64_size_reports_payload_bytes() {
        assert_eq!(decoded_base64_size("AQIDBA=="), Some(4));
        assert_eq!(
            decoded_base64_size("data:audio/wav;base64,AQIDBA=="),
            Some(4)
        );
        assert_eq!(decoded_base64_size("AQI="), Some(2));
        assert_eq!(decoded_base64_size(""), Some(0));
    }

    #[test]
    fn decoded_base64_size_rejects_invalid_payloads() {
        assert_eq!(decoded_base64_size("not base64"), None);
        assert_eq!(decoded_base64_size("data:audio/wav;base64,%%%"), None);
        assert_eq!(decoded_base64_size("A===-"), None);
        assert_eq!(decoded_base64_size("AB=="), None);
    }
}
