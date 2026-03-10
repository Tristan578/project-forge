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
    pub target_entity_id: String, // EntityId of target (UUID string)
    pub bend_direction: f32,     // +1.0 or -1.0
    pub mix: f32,                // 0.0 = FK, 1.0 = IK
}

/// Marker component indicating skeleton is enabled.
#[derive(Component)]
pub struct SkeletonEnabled2d;

/// Marker component inserted after `init_skinned_meshes_2d` completes for a given entity.
/// Prevents re-initialization every frame when animation mutates `SkeletonData2d`.
/// Removed when the active skin changes so that the init system re-runs for the new skin.
#[derive(Component)]
pub struct SkinnedMeshInitialized;

/// Runtime component for CPU-skinned 2D meshes.
/// Created once when a skeleton with mesh attachments is enabled.
/// NOT serialized in scene files — derived from SkeletonData2d on load.
#[derive(Component)]
pub struct SkinnedMesh2d {
    /// Bind-pose vertex positions (never modified after creation).
    pub bind_positions: Vec<[f32; 2]>,
    /// Bind-pose UVs (copied to mesh once at init).
    pub bind_uvs: Vec<[f32; 2]>,
    /// Triangle indices (copied to mesh once at init).
    pub triangles: Vec<u16>,
    /// Pre-resolved bone indices per vertex (index into SkeletonData2d.bones).
    /// Replaces per-frame string-based HashMap lookups.
    pub vertex_bone_indices: Vec<Vec<usize>>,
    /// Corresponding weights per vertex (parallel to vertex_bone_indices).
    pub vertex_bone_weights: Vec<Vec<f32>>,
    /// Bind-pose world transforms per bone: (position, rotation_deg, scale).
    /// The inverse operation is applied analytically during skinning.
    pub bind_pose_transforms: Vec<(Vec2, f32, Vec2)>,
    /// Name of the source attachment (for skin-switch detection).
    pub source_attachment: String,
}

/// Cached per-frame world transforms for skeleton bones.
/// Computed once after animation + IK, reused by skinning and gizmo systems.
#[derive(Component)]
pub struct BoneWorldTransforms2d {
    /// Per-bone: (world_position, world_rotation_deg, world_scale).
    /// Indexed by bone order in SkeletonData2d.bones.
    pub transforms: Vec<(Vec2, f32, Vec2)>,
}

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
