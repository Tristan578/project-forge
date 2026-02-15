//! Animation and skeleton 2D pending commands.

use super::PendingCommands;
use crate::core::animation_clip::{AnimationClipData, Interpolation, PlayMode, PropertyTarget};

// === Animation Request Structs ===

#[derive(Debug, Clone)]
pub struct AnimationRequest {
    pub entity_id: String,
    pub action: AnimationAction,
}

#[derive(Debug, Clone)]
pub enum AnimationAction {
    Play {
        clip_name: String,
        crossfade_secs: f32,
    },
    Pause,
    Resume,
    Stop,
    Seek { time_secs: f32 },
    SetSpeed { speed: f32 },
    SetLoop { looping: bool },
    SetBlendWeight { clip_name: String, weight: f32 },
    SetClipSpeed { clip_name: String, speed: f32 },
}

#[derive(Debug, Clone)]
pub struct AnimationClipUpdate {
    pub entity_id: String,
    pub clip_data: AnimationClipData,
}

#[derive(Debug, Clone)]
pub struct AnimationClipAddKeyframe {
    pub entity_id: String,
    pub target: PropertyTarget,
    pub time: f32,
    pub value: f32,
    pub interpolation: Interpolation,
}

#[derive(Debug, Clone)]
pub struct AnimationClipRemoveKeyframe {
    pub entity_id: String,
    pub target: PropertyTarget,
    pub time: f32,
}

#[derive(Debug, Clone)]
pub struct AnimationClipUpdateKeyframe {
    pub entity_id: String,
    pub target: PropertyTarget,
    pub time: f32,
    pub new_value: Option<f32>,
    pub new_interpolation: Option<Interpolation>,
    pub new_time: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct AnimationClipPropertyUpdate {
    pub entity_id: String,
    pub duration: Option<f32>,
    pub play_mode: Option<PlayMode>,
    pub speed: Option<f32>,
    pub autoplay: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AnimationClipPreview {
    pub entity_id: String,
    pub action: String,
    pub seek_time: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct AnimationClipRemoval {
    pub entity_id: String,
}

// === Skeleton 2D Request Structs ===

#[derive(Debug, Clone)]
pub struct CreateSkeleton2dRequest {
    pub entity_id: String,
    pub skeleton_data: crate::core::skeleton2d::SkeletonData2d,
}

#[derive(Debug, Clone)]
pub struct AddBone2dRequest {
    pub entity_id: String,
    pub bone: crate::core::skeleton2d::Bone2dDef,
}

#[derive(Debug, Clone)]
pub struct RemoveBone2dRequest {
    pub entity_id: String,
    pub bone_name: String,
}

#[derive(Debug, Clone)]
pub struct UpdateBone2dRequest {
    pub entity_id: String,
    pub bone_name: String,
    pub local_position: Option<[f32; 2]>,
    pub local_rotation: Option<f32>,
    pub local_scale: Option<[f32; 2]>,
    pub length: Option<f32>,
    pub color: Option<[f32; 4]>,
}

#[derive(Debug, Clone)]
pub struct CreateSkeletalAnimation2dRequest {
    pub entity_id: String,
    pub animation: crate::core::skeletal_animation2d::SkeletalAnimation2d,
}

#[derive(Debug, Clone)]
pub struct AddKeyframe2dRequest {
    pub entity_id: String,
    pub animation_name: String,
    pub bone_name: String,
    pub keyframe: crate::core::skeletal_animation2d::BoneKeyframe,
}

#[derive(Debug, Clone)]
pub struct PlaySkeletalAnimation2dRequest {
    pub entity_id: String,
    pub animation_name: String,
    pub loop_animation: bool,
    pub speed: f32,
}

#[derive(Debug, Clone)]
pub struct SetSkeleton2dSkinRequest {
    pub entity_id: String,
    pub skin_name: String,
}

#[derive(Debug, Clone)]
pub struct CreateIkChain2dRequest {
    pub entity_id: String,
    pub constraint: crate::core::skeleton2d::IkConstraint2d,
}

#[derive(Debug, Clone)]
pub struct GetSkeleton2dRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct ImportSkeletonJsonRequest {
    pub entity_id: String,
    pub json_data: String,
    pub format: String,
}

#[derive(Debug, Clone)]
pub struct AutoWeightSkeleton2dRequest {
    pub entity_id: String,
    pub method: String,
    pub iterations: u32,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_animation_request(&mut self, request: AnimationRequest) {
        self.animation_requests.push(request);
    }

    pub fn queue_animation_clip_update(&mut self, update: AnimationClipUpdate) {
        self.animation_clip_updates.push(update);
    }

    pub fn queue_animation_clip_add_keyframe(&mut self, request: AnimationClipAddKeyframe) {
        self.animation_clip_add_keyframes.push(request);
    }

    pub fn queue_animation_clip_remove_keyframe(&mut self, request: AnimationClipRemoveKeyframe) {
        self.animation_clip_remove_keyframes.push(request);
    }

    pub fn queue_animation_clip_update_keyframe(&mut self, request: AnimationClipUpdateKeyframe) {
        self.animation_clip_update_keyframes.push(request);
    }

    pub fn queue_animation_clip_property_update(&mut self, update: AnimationClipPropertyUpdate) {
        self.animation_clip_property_updates.push(update);
    }

    pub fn queue_animation_clip_preview(&mut self, preview: AnimationClipPreview) {
        self.animation_clip_previews.push(preview);
    }

    pub fn queue_animation_clip_removal(&mut self, removal: AnimationClipRemoval) {
        self.animation_clip_removals.push(removal);
    }

    pub fn queue_create_skeleton2d(&mut self, request: CreateSkeleton2dRequest) {
        self.create_skeleton2d_requests.push(request);
    }

    pub fn queue_add_bone2d(&mut self, request: AddBone2dRequest) {
        self.add_bone2d_requests.push(request);
    }

    pub fn queue_remove_bone2d(&mut self, request: RemoveBone2dRequest) {
        self.remove_bone2d_requests.push(request);
    }

    pub fn queue_update_bone2d(&mut self, request: UpdateBone2dRequest) {
        self.update_bone2d_requests.push(request);
    }

    pub fn queue_create_skeletal_animation2d(&mut self, request: CreateSkeletalAnimation2dRequest) {
        self.create_skeletal_animation2d_requests.push(request);
    }

    pub fn queue_add_keyframe2d(&mut self, request: AddKeyframe2dRequest) {
        self.add_keyframe2d_requests.push(request);
    }

    pub fn queue_play_skeletal_animation2d(&mut self, request: PlaySkeletalAnimation2dRequest) {
        self.play_skeletal_animation2d_requests.push(request);
    }

    pub fn queue_set_skeleton2d_skin(&mut self, request: SetSkeleton2dSkinRequest) {
        self.set_skeleton2d_skin_requests.push(request);
    }

    pub fn queue_create_ik_chain2d(&mut self, request: CreateIkChain2dRequest) {
        self.create_ik_chain2d_requests.push(request);
    }

    pub fn queue_get_skeleton2d(&mut self, request: GetSkeleton2dRequest) {
        self.get_skeleton2d_requests.push(request);
    }

    pub fn queue_import_skeleton_json(&mut self, request: ImportSkeletonJsonRequest) {
        self.import_skeleton_json_requests.push(request);
    }

    pub fn queue_auto_weight_skeleton2d(&mut self, request: AutoWeightSkeleton2dRequest) {
        self.auto_weight_skeleton2d_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_animation_request_from_bridge(request: AnimationRequest) -> bool {
    super::with_pending(|pc| pc.queue_animation_request(request)).is_some()
}

pub fn queue_animation_clip_update_from_bridge(update: AnimationClipUpdate) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_update(update)).is_some()
}

pub fn queue_animation_clip_add_keyframe_from_bridge(request: AnimationClipAddKeyframe) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_add_keyframe(request)).is_some()
}

pub fn queue_animation_clip_remove_keyframe_from_bridge(request: AnimationClipRemoveKeyframe) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_remove_keyframe(request)).is_some()
}

pub fn queue_animation_clip_update_keyframe_from_bridge(request: AnimationClipUpdateKeyframe) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_update_keyframe(request)).is_some()
}

pub fn queue_animation_clip_property_update_from_bridge(update: AnimationClipPropertyUpdate) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_property_update(update)).is_some()
}

pub fn queue_animation_clip_preview_from_bridge(preview: AnimationClipPreview) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_preview(preview)).is_some()
}

pub fn queue_animation_clip_removal_from_bridge(removal: AnimationClipRemoval) -> bool {
    super::with_pending(|pc| pc.queue_animation_clip_removal(removal)).is_some()
}

pub fn queue_create_skeleton2d_from_bridge(request: CreateSkeleton2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_create_skeleton2d(request)).is_some()
}

pub fn queue_add_bone2d_from_bridge(request: AddBone2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_add_bone2d(request)).is_some()
}

pub fn queue_remove_bone2d_from_bridge(request: RemoveBone2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_bone2d(request)).is_some()
}

pub fn queue_update_bone2d_from_bridge(request: UpdateBone2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_update_bone2d(request)).is_some()
}

pub fn queue_create_skeletal_animation2d_from_bridge(request: CreateSkeletalAnimation2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_create_skeletal_animation2d(request)).is_some()
}

pub fn queue_add_keyframe2d_from_bridge(request: AddKeyframe2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_add_keyframe2d(request)).is_some()
}

pub fn queue_play_skeletal_animation2d_from_bridge(request: PlaySkeletalAnimation2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_play_skeletal_animation2d(request)).is_some()
}

pub fn queue_set_skeleton2d_skin_from_bridge(request: SetSkeleton2dSkinRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_skeleton2d_skin(request)).is_some()
}

pub fn queue_create_ik_chain2d_from_bridge(request: CreateIkChain2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_create_ik_chain2d(request)).is_some()
}

pub fn queue_get_skeleton2d_from_bridge(request: GetSkeleton2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_get_skeleton2d(request)).is_some()
}

pub fn queue_import_skeleton_json_from_bridge(request: ImportSkeletonJsonRequest) -> bool {
    super::with_pending(|pc| pc.queue_import_skeleton_json(request)).is_some()
}

pub fn queue_auto_weight_skeleton2d_from_bridge(request: AutoWeightSkeleton2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_auto_weight_skeleton2d(request)).is_some()
}
