//! 2D Skeleton system for skeletal animation.
//!
//! This module provides the core data structures for 2D skeletal animation,
//! including bones, slots, skins, and IK constraints.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Component containing skeleton definition data.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonData2d {
    pub bones: Vec<Bone2dDef>,
    pub slots: Vec<SlotDef>,
    pub skins: HashMap<String, SkinData>,
    pub active_skin: String,
    pub ik_constraints: Vec<IkConstraint2d>,
}

/// Definition of a bone in the skeleton hierarchy.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bone2dDef {
    pub name: String,
    pub parent_bone: Option<String>,
    pub local_position: [f32; 2],
    pub local_rotation: f32, // degrees
    pub local_scale: [f32; 2],
    pub length: f32,
    pub color: [f32; 4],
}

/// A slot connects a bone to a visual attachment.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotDef {
    pub name: String,
    pub bone_name: String,
    pub sprite_part: String, // References EntityId or child entity
    pub blend_mode: BlendMode2d,
    pub attachment: Option<String>, // skin attachment name
}

/// Blend mode for rendering slots.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode2d {
    Normal,
    Additive,
    Multiply,
    Screen,
}

/// A skin contains multiple attachments for different slots.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinData {
    pub name: String,
    pub attachments: HashMap<String, AttachmentData>, // slot_name -> attachment
}

/// An attachment defines visual content for a slot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AttachmentData {
    #[serde(rename = "sprite")]
    Sprite {
        texture_id: String,
        offset: [f32; 2],
        rotation: f32,
        scale: [f32; 2],
    },
    #[serde(rename = "mesh")]
    Mesh {
        texture_id: String,
        vertices: Vec<[f32; 2]>,
        uvs: Vec<[f32; 2]>,
        triangles: Vec<u16>,
        weights: Vec<VertexWeights>,
    },
}

/// Vertex weights for smooth skinning.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VertexWeights {
    pub bones: Vec<String>,   // bone names
    pub weights: Vec<f32>,    // normalized weights (sum = 1.0)
}

/// An IK constraint for inverse kinematics.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IkConstraint2d {
    pub name: String,
    pub bone_chain: Vec<String>, // 2 bones (e.g., ["upper_arm", "forearm"])
    pub target_entity_id: u32,   // EntityId of target
    pub bend_direction: f32,     // +1.0 or -1.0
    pub mix: f32,                // 0.0 = FK, 1.0 = IK
}

/// Marker component indicating skeleton is enabled.
#[derive(Component)]
pub struct SkeletonEnabled2d;

impl Default for SkeletonData2d {
    fn default() -> Self {
        Self {
            bones: vec![Bone2dDef {
                name: "root".to_string(),
                parent_bone: None,
                local_position: [0.0, 0.0],
                local_rotation: 0.0,
                local_scale: [1.0, 1.0],
                length: 50.0,
                color: [1.0, 1.0, 1.0, 1.0],
            }],
            slots: vec![],
            skins: HashMap::from([(
                "default".to_string(),
                SkinData {
                    name: "default".to_string(),
                    attachments: HashMap::new(),
                },
            )]),
            active_skin: "default".to_string(),
            ik_constraints: vec![],
        }
    }
}

impl Default for BlendMode2d {
    fn default() -> Self {
        Self::Normal
    }
}
