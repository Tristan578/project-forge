//! Undo/Redo history system.
//!
//! This module provides a command history for undoing and redoing editor actions.
//! All undoable actions are stored in a stack with their reverse operations.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::animation_clip::AnimationClipData;
use super::asset_manager::AssetRef;
use super::audio::AudioData;
use super::csg::CsgMeshData;
use super::game_camera::GameCameraData;
use super::game_components::GameComponents;
use super::lighting::LightData;
use super::material::MaterialData;
use super::particles::ParticleData;
use super::pending_commands::EntityType;
use super::physics::{JointData, PhysicsData};
use super::physics_2d::{PhysicsJoint2d, Physics2dData};
use super::scripting::ScriptData;
use super::shader_effects::ShaderEffectData;
use super::lod::LodData;
use super::skeletal_animation2d::SkeletalAnimation2d;
use super::skeleton2d::SkeletonData2d;
use super::sprite::SpriteData;
use super::terrain::{TerrainData, TerrainMeshData};
use super::tilemap::TilemapData;

/// Snapshot of transform data for undo/redo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformSnapshot {
    pub position: [f32; 3],
    pub rotation: [f32; 4], // Quaternion
    pub scale: [f32; 3],
}

impl From<&Transform> for TransformSnapshot {
    fn from(t: &Transform) -> Self {
        Self {
            position: [t.translation.x, t.translation.y, t.translation.z],
            rotation: [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w],
            scale: [t.scale.x, t.scale.y, t.scale.z],
        }
    }
}

impl TransformSnapshot {
    pub fn to_transform(&self) -> Transform {
        Transform {
            translation: Vec3::new(self.position[0], self.position[1], self.position[2]),
            rotation: Quat::from_xyzw(
                self.rotation[0],
                self.rotation[1],
                self.rotation[2],
                self.rotation[3],
            ),
            scale: Vec3::new(self.scale[0], self.scale[1], self.scale[2]),
        }
    }
}

/// Complete snapshot of an entity for perfect restoration.
/// Stores the original entity_id so it can be reused on restore.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitySnapshot {
    /// Original entity ID - reused when restoring to preserve references
    pub entity_id: String,
    /// Type of entity (cube, sphere, light, etc.)
    pub entity_type: EntityType,
    /// Display name
    pub name: String,
    /// Transform state
    pub transform: TransformSnapshot,
    /// Parent entity ID (for hierarchy preservation)
    pub parent_id: Option<String>,
    /// Visibility state
    pub visible: bool,
    /// Material data (for mesh entities)
    pub material_data: Option<MaterialData>,
    /// Light data (for light entities)
    pub light_data: Option<LightData>,
    /// Physics data (if entity has physics configured)
    pub physics_data: Option<PhysicsData>,
    /// Whether physics is enabled on this entity
    pub physics_enabled: bool,
    /// Asset reference (for imported glTF models)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_ref: Option<AssetRef>,
    /// Script data (if entity has a script)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_data: Option<ScriptData>,
    /// Audio data (if entity has audio)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_data: Option<AudioData>,
    /// Reverb zone data (if entity has reverb zone)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverb_zone_data: Option<super::reverb_zone::ReverbZoneData>,
    /// Whether reverb zone is enabled on this entity
    #[serde(default)]
    pub reverb_zone_enabled: bool,
    /// Particle data (if entity has particles configured)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particle_data: Option<ParticleData>,
    /// Whether particle emission is enabled on this entity
    #[serde(default)]
    pub particle_enabled: bool,
    /// Shader effect data (if entity has custom shader)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shader_effect_data: Option<ShaderEffectData>,
    /// CSG mesh vertex/index data (for CsgResult entities, needed for undo restore)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csg_mesh_data: Option<CsgMeshData>,
    /// Terrain data (if entity is a terrain)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain_data: Option<TerrainData>,
    /// Terrain mesh (heightmap) data for reconstruction
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain_mesh_data: Option<TerrainMeshData>,
    /// Procedural mesh data (for extrude/lathe/combine results)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub procedural_mesh_data: Option<super::procedural_mesh::ProceduralMeshData>,
    /// Joint data (if entity has a physics joint)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joint_data: Option<JointData>,
    /// Game components (pre-built behaviors)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_components: Option<GameComponents>,
    /// Animation clip data (keyframe property animation)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animation_clip_data: Option<AnimationClipData>,
    /// Game camera configuration (if entity has a game camera)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_camera_data: Option<GameCameraData>,
    /// Whether this entity is the active game camera
    #[serde(default)]
    pub active_game_camera: bool,
    /// Sprite data (if entity is a 2D sprite)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite_data: Option<SpriteData>,
    /// 2D physics data (if entity has 2D physics configured)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub physics2d_data: Option<Physics2dData>,
    /// Whether 2D physics is enabled on this entity
    #[serde(default)]
    pub physics2d_enabled: bool,
    /// 2D joint data (if entity has a 2D physics joint)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joint2d_data: Option<PhysicsJoint2d>,
    /// Tilemap data (if entity is a tilemap)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tilemap_data: Option<TilemapData>,
    /// Whether tilemap rendering is enabled
    #[serde(default)]
    pub tilemap_enabled: bool,
    /// Skeleton 2D data (if entity has a skeleton)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeleton2d_data: Option<SkeletonData2d>,
    /// Whether skeleton 2D is enabled
    #[serde(default)]
    pub skeleton2d_enabled: bool,
    /// Skeletal animations (if entity has skeletal animations)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeletal_animations: Option<Vec<SkeletalAnimation2d>>,
    /// LOD configuration (if entity has LOD data)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lod_data: Option<LodData>,
}

impl EntitySnapshot {
    /// Create a new snapshot with required fields; all optional fields default to None/false.
    pub fn new(
        entity_id: String,
        entity_type: EntityType,
        name: String,
        transform: TransformSnapshot,
    ) -> Self {
        Self {
            entity_id,
            entity_type,
            name,
            transform,
            parent_id: None,
            visible: true,
            material_data: None,
            light_data: None,
            physics_data: None,
            physics_enabled: false,
            asset_ref: None,
            script_data: None,
            audio_data: None,
            reverb_zone_data: None,
            reverb_zone_enabled: false,
            particle_data: None,
            particle_enabled: false,
            shader_effect_data: None,
            csg_mesh_data: None,
            terrain_data: None,
            terrain_mesh_data: None,
            procedural_mesh_data: None,
            joint_data: None,
            game_components: None,
            animation_clip_data: None,
            game_camera_data: None,
            active_game_camera: false,
            sprite_data: None,
            physics2d_data: None,
            physics2d_enabled: false,
            joint2d_data: None,
            tilemap_data: None,
            tilemap_enabled: false,
            skeleton2d_data: None,
            skeleton2d_enabled: false,
            skeletal_animations: None,
            lod_data: None,
        }
    }
}

/// An action that can be undone/redone.
#[derive(Debug, Clone)]
pub enum UndoableAction {
    /// Transform changed (stores old and new values)
    TransformChange {
        entity_id: String,
        old_transform: TransformSnapshot,
        new_transform: TransformSnapshot,
    },

    /// Multiple entities transformed together (for multi-select transforms)
    MultiTransformChange {
        /// Vec of (entity_id, old_transform, new_transform)
        transforms: Vec<(String, TransformSnapshot, TransformSnapshot)>,
    },

    /// Entity was renamed
    Rename {
        entity_id: String,
        old_name: String,
        new_name: String,
    },

    /// Entity was spawned (stores snapshot for deletion on undo)
    Spawn {
        snapshot: EntitySnapshot,
    },

    /// Entity was deleted (stores snapshot for respawn on undo)
    Delete {
        snapshot: EntitySnapshot,
    },

    /// Entity was duplicated
    Duplicate {
        source_entity_id: String,
        snapshot: EntitySnapshot, // Snapshot of the new entity
    },

    /// Visibility was toggled
    VisibilityChange {
        entity_id: String,
        old_visible: bool,
        new_visible: bool,
    },

    /// Material was changed
    MaterialChange {
        entity_id: String,
        old_material: MaterialData,
        new_material: MaterialData,
    },

    /// Light properties were changed
    LightChange {
        entity_id: String,
        old_light: LightData,
        new_light: LightData,
    },

    /// Physics properties were changed
    PhysicsChange {
        entity_id: String,
        old_physics: PhysicsData,
        new_physics: PhysicsData,
    },

    /// Script was changed
    ScriptChange {
        entity_id: String,
        old_script: Option<ScriptData>,
        new_script: Option<ScriptData>,
    },

    /// Audio configuration changed
    AudioChange {
        entity_id: String,
        old_audio: Option<AudioData>,
        new_audio: Option<AudioData>,
    },

    /// Reverb zone configuration changed
    ReverbZoneChange {
        entity_id: String,
        old_reverb: Option<super::reverb_zone::ReverbZoneData>,
        new_reverb: Option<super::reverb_zone::ReverbZoneData>,
    },

    /// Particle configuration changed
    ParticleChange {
        entity_id: String,
        old_particle: Option<ParticleData>,
        new_particle: Option<ParticleData>,
    },

    /// Shader effect configuration changed
    ShaderChange {
        entity_id: String,
        old_shader: Option<ShaderEffectData>,
        new_shader: Option<ShaderEffectData>,
    },

    /// CSG boolean operation performed
    CsgOperation {
        /// Snapshot of entity A (for restore on undo if deleted)
        source_a_snapshot: Option<EntitySnapshot>,
        /// Snapshot of entity B (for restore on undo if deleted)
        source_b_snapshot: Option<EntitySnapshot>,
        /// Snapshot of the result entity (for delete on undo)
        result_snapshot: EntitySnapshot,
        /// Whether source entities were deleted
        sources_deleted: bool,
    },

    /// Terrain noise parameters or sculpt operation changed
    TerrainChange {
        entity_id: String,
        old_terrain: TerrainData,
        new_terrain: TerrainData,
        old_mesh_data: TerrainMeshData,
        new_mesh_data: TerrainMeshData,
    },

    /// Extrude operation performed
    ExtrudeShape {
        snapshot: EntitySnapshot,
    },

    /// Lathe operation performed
    LatheShape {
        snapshot: EntitySnapshot,
    },

    /// Array operation performed
    ArrayEntity {
        source_id: String,
        created_snapshots: Vec<EntitySnapshot>,
    },

    /// Combine operation performed
    CombineMeshes {
        source_snapshots: Vec<EntitySnapshot>,
        result_snapshot: EntitySnapshot,
    },

    /// Joint configuration changed
    JointChange {
        entity_id: String,
        old_joint: Option<JointData>,
        new_joint: Option<JointData>,
    },

    /// Game component added, updated, or removed
    GameComponentChange {
        entity_id: String,
        old_components: Option<GameComponents>,  // None = no GameComponents existed
        new_components: Option<GameComponents>,  // None = GameComponents removed
    },

    /// Animation clip configuration changed (keyframe animation)
    AnimationClipChange {
        entity_id: String,
        old_clip: Option<AnimationClipData>,
        new_clip: Option<AnimationClipData>,
    },

    /// Sprite configuration changed
    SpriteChange {
        entity_id: String,
        old_sprite: Option<SpriteData>,
        new_sprite: Option<SpriteData>,
    },

    /// 2D Physics properties were changed
    Physics2dChange {
        entity_id: String,
        old_physics: Option<Physics2dData>,
        new_physics: Option<Physics2dData>,
    },

    /// 2D Joint configuration changed
    Joint2dChange {
        entity_id: String,
        old_joint: Option<PhysicsJoint2d>,
        new_joint: Option<PhysicsJoint2d>,
    },

    /// Tilemap configuration changed
    TilemapChange {
        entity_id: String,
        old_tilemap: Option<TilemapData>,
        new_tilemap: Option<TilemapData>,
    },

    /// Skeleton 2D configuration changed
    SkeletonChange {
        entity_id: String,
        old_skeleton: Option<SkeletonData2d>,
        new_skeleton: Option<SkeletonData2d>,
    },
}

impl UndoableAction {
    /// Get a human-readable description of this action.
    pub fn description(&self) -> String {
        match self {
            UndoableAction::TransformChange { .. } => "Transform".to_string(),
            UndoableAction::MultiTransformChange { transforms } => {
                format!("Transform {} objects", transforms.len())
            }
            UndoableAction::Rename { new_name, .. } => format!("Rename to '{}'", new_name),
            UndoableAction::Spawn { snapshot } => format!("Create '{}'", snapshot.name),
            UndoableAction::Delete { snapshot } => format!("Delete '{}'", snapshot.name),
            UndoableAction::Duplicate { snapshot, .. } => format!("Duplicate '{}'", snapshot.name),
            UndoableAction::VisibilityChange { new_visible, .. } => {
                if *new_visible {
                    "Show".to_string()
                } else {
                    "Hide".to_string()
                }
            }
            UndoableAction::MaterialChange { .. } => "Material Change".to_string(),
            UndoableAction::LightChange { .. } => "Light Change".to_string(),
            UndoableAction::PhysicsChange { .. } => "Physics Change".to_string(),
            UndoableAction::ScriptChange { .. } => "Script Change".to_string(),
            UndoableAction::AudioChange { .. } => "Audio Change".to_string(),
            UndoableAction::ParticleChange { .. } => "Particle Change".to_string(),
            UndoableAction::ShaderChange { .. } => "Shader Effect Change".to_string(),
            UndoableAction::CsgOperation { result_snapshot, .. } => {
                format!("CSG '{}'", result_snapshot.name)
            }
            UndoableAction::TerrainChange { .. } => "Terrain Change".to_string(),
            UndoableAction::ExtrudeShape { snapshot } => {
                format!("Extrude '{}'", snapshot.name)
            }
            UndoableAction::LatheShape { snapshot } => {
                format!("Lathe '{}'", snapshot.name)
            }
            UndoableAction::ArrayEntity { created_snapshots, .. } => {
                format!("Array {} copies", created_snapshots.len())
            }
            UndoableAction::CombineMeshes { result_snapshot, .. } => {
                format!("Combine '{}'", result_snapshot.name)
            }
            UndoableAction::JointChange { .. } => "Joint Change".to_string(),
            UndoableAction::GameComponentChange { .. } => "Game Component Change".to_string(),
            UndoableAction::AnimationClipChange { .. } => "Animation Clip Change".to_string(),
            UndoableAction::ReverbZoneChange { .. } => "Reverb Zone Change".to_string(),
            UndoableAction::SpriteChange { .. } => "Sprite Change".to_string(),
            UndoableAction::Physics2dChange { .. } => "2D Physics Change".to_string(),
            UndoableAction::Joint2dChange { .. } => "2D Joint Change".to_string(),
            UndoableAction::TilemapChange { .. } => "Tilemap Change".to_string(),
            UndoableAction::SkeletonChange { .. } => "Skeleton 2D Change".to_string(),
        }
    }
}

/// Resource that manages undo/redo history.
#[derive(Resource)]
pub struct HistoryStack {
    /// Actions that can be undone (most recent last)
    undo_stack: Vec<UndoableAction>,
    /// Actions that can be redone (most recent last)
    redo_stack: Vec<UndoableAction>,
    /// Maximum history size
    max_size: usize,
    /// Flag to indicate history changed (for UI update)
    pub dirty: bool,
}

impl Default for HistoryStack {
    fn default() -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_size: 100,
            dirty: false,
        }
    }
}

impl HistoryStack {
    /// Push a new action onto the undo stack.
    /// Clears the redo stack (you can't redo after a new action).
    pub fn push(&mut self, action: UndoableAction) {
        self.undo_stack.push(action);
        self.redo_stack.clear();
        self.dirty = true;

        // Enforce max size
        while self.undo_stack.len() > self.max_size {
            self.undo_stack.remove(0);
        }
    }

    /// Pop the most recent action for undo.
    pub fn pop_undo(&mut self) -> Option<UndoableAction> {
        let action = self.undo_stack.pop();
        if action.is_some() {
            self.dirty = true;
        }
        action
    }

    /// Pop the most recent action for redo.
    pub fn pop_redo(&mut self) -> Option<UndoableAction> {
        let action = self.redo_stack.pop();
        if action.is_some() {
            self.dirty = true;
        }
        action
    }

    /// Push an action onto the redo stack (after undo).
    pub fn push_redo(&mut self, action: UndoableAction) {
        self.redo_stack.push(action);
    }

    /// Push an action onto the undo stack without clearing the redo stack.
    /// Used during redo operations.
    pub fn push_undo_only(&mut self, action: UndoableAction) {
        self.undo_stack.push(action);
        self.dirty = true;

        // Enforce max size
        while self.undo_stack.len() > self.max_size {
            self.undo_stack.remove(0);
        }
    }

    /// Check if undo is available.
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// Check if redo is available.
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Get the description of the next undo action.
    pub fn undo_description(&self) -> Option<String> {
        self.undo_stack.last().map(|a| a.description())
    }

    /// Get the description of the next redo action.
    pub fn redo_description(&self) -> Option<String> {
        self.redo_stack.last().map(|a| a.description())
    }
}

/// Pending undo/redo requests from the bridge.
#[derive(Default)]
pub struct PendingHistoryCommands {
    pub undo_requested: bool,
    pub redo_requested: bool,
}

// Global instance for bridge access (WASM is single-threaded)
use std::cell::RefCell;

thread_local! {
    static HISTORY_STACK: RefCell<Option<*mut HistoryStack>> = const { RefCell::new(None) };
    static PENDING_HISTORY: RefCell<PendingHistoryCommands> = const { RefCell::new(PendingHistoryCommands { undo_requested: false, redo_requested: false }) };
}

/// Register the HistoryStack resource pointer for bridge access.
pub fn register_history_stack(history: *mut HistoryStack) {
    HISTORY_STACK.with(|h| {
        *h.borrow_mut() = Some(history);
    });
}

/// Queue an undo request from the bridge layer.
pub fn queue_undo_from_bridge() -> bool {
    PENDING_HISTORY.with(|ph| {
        ph.borrow_mut().undo_requested = true;
    });
    true
}

/// Queue a redo request from the bridge layer.
pub fn queue_redo_from_bridge() -> bool {
    PENDING_HISTORY.with(|ph| {
        ph.borrow_mut().redo_requested = true;
    });
    true
}

/// Take pending undo request (clears it).
pub fn take_undo_request() -> bool {
    PENDING_HISTORY.with(|ph| {
        let requested = ph.borrow().undo_requested;
        ph.borrow_mut().undo_requested = false;
        requested
    })
}

/// Take pending redo request (clears it).
pub fn take_redo_request() -> bool {
    PENDING_HISTORY.with(|ph| {
        let requested = ph.borrow().redo_requested;
        ph.borrow_mut().redo_requested = false;
        requested
    })
}

/// Push an action to history from the bridge layer.
pub fn push_action_from_bridge(action: UndoableAction) -> bool {
    HISTORY_STACK.with(|h| {
        if let Some(ptr) = *h.borrow() {
            // SAFETY: WASM is single-threaded and we control the lifetime
            unsafe {
                (*ptr).push(action);
            }
            true
        } else {
            false
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_transform_snapshot() -> TransformSnapshot {
        TransformSnapshot {
            position: [1.0, 2.0, 3.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
        }
    }

    fn make_transform_action(id: &str) -> UndoableAction {
        UndoableAction::TransformChange {
            entity_id: id.to_string(),
            old_transform: make_transform_snapshot(),
            new_transform: TransformSnapshot {
                position: [4.0, 5.0, 6.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        }
    }

    fn make_entity_snapshot() -> EntitySnapshot {
        EntitySnapshot::new(
            "test-entity-id".to_string(),
            crate::core::pending_commands::EntityType::Cube,
            "TestCube".to_string(),
            make_transform_snapshot(),
        )
    }

    // --- TransformSnapshot round-trip ---

    #[test]
    fn transform_snapshot_round_trip() {
        use bevy::prelude::*;
        let t = Transform {
            translation: Vec3::new(1.0, 2.0, 3.0),
            rotation: Quat::from_rotation_y(std::f32::consts::FRAC_PI_4),
            scale: Vec3::new(2.0, 0.5, 1.0),
        };
        let snap = TransformSnapshot::from(&t);
        let restored = snap.to_transform();

        assert!((restored.translation.x - t.translation.x).abs() < 1e-5);
        assert!((restored.translation.y - t.translation.y).abs() < 1e-5);
        assert!((restored.translation.z - t.translation.z).abs() < 1e-5);
        assert!((restored.scale.x - t.scale.x).abs() < 1e-5);
        assert!((restored.scale.y - t.scale.y).abs() < 1e-5);
        assert!((restored.scale.z - t.scale.z).abs() < 1e-5);
        // Rotation: quaternion dot product close to 1 means same rotation
        let dot = restored.rotation.dot(t.rotation).abs();
        assert!(dot > 0.9999);
    }

    // --- HistoryStack: push clears redo ---

    #[test]
    fn push_clears_redo_stack() {
        let mut stack = HistoryStack::default();
        // Put something on the redo stack manually
        stack.push_redo(make_transform_action("a"));
        assert!(stack.can_redo());

        // Pushing a new action must clear redo
        stack.push(make_transform_action("b"));
        assert!(!stack.can_redo(), "push() must clear redo stack");
        assert!(stack.can_undo());
    }

    // --- HistoryStack: push enforces max_size ---

    #[test]
    fn push_enforces_max_size() {
        let mut stack = HistoryStack {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_size: 3,
            dirty: false,
        };
        for i in 0..5 {
            stack.push(UndoableAction::Rename {
                entity_id: format!("e{}", i),
                old_name: "old".to_string(),
                new_name: format!("new{}", i),
            });
        }
        assert_eq!(stack.undo_stack.len(), 3, "undo stack must not exceed max_size");
        // Oldest entries should have been evicted — last pushed entry is most recent
        match &stack.undo_stack[2] {
            UndoableAction::Rename { new_name, .. } => assert_eq!(new_name, "new4"),
            _ => panic!("unexpected action type"),
        }
    }

    // --- HistoryStack: pop returns None when empty ---

    #[test]
    fn pop_undo_returns_none_when_empty() {
        let mut stack = HistoryStack::default();
        assert!(stack.pop_undo().is_none());
    }

    #[test]
    fn pop_redo_returns_none_when_empty() {
        let mut stack = HistoryStack::default();
        assert!(stack.pop_redo().is_none());
    }

    // --- HistoryStack: push_undo_only does NOT clear redo ---

    #[test]
    fn push_undo_only_does_not_clear_redo() {
        let mut stack = HistoryStack::default();
        stack.push_redo(make_transform_action("a"));
        assert!(stack.can_redo());

        stack.push_undo_only(make_transform_action("b"));
        assert!(stack.can_redo(), "push_undo_only must NOT clear redo stack");
        assert!(stack.can_undo());
    }

    // --- HistoryStack: push_undo_only also enforces max_size ---

    #[test]
    fn push_undo_only_enforces_max_size() {
        let mut stack = HistoryStack {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_size: 2,
            dirty: false,
        };
        for i in 0..4 {
            stack.push_undo_only(make_transform_action(&format!("e{}", i)));
        }
        assert_eq!(stack.undo_stack.len(), 2);
    }

    // --- UndoableAction::description for all 29 variants ---

    #[test]
    fn description_transform_change() {
        let action = make_transform_action("e1");
        assert_eq!(action.description(), "Transform");
    }

    #[test]
    fn description_multi_transform_change() {
        let action = UndoableAction::MultiTransformChange {
            transforms: vec![
                ("a".to_string(), make_transform_snapshot(), make_transform_snapshot()),
                ("b".to_string(), make_transform_snapshot(), make_transform_snapshot()),
            ],
        };
        let desc = action.description();
        assert!(desc.contains("2"), "should mention count: {}", desc);
    }

    #[test]
    fn description_rename() {
        let action = UndoableAction::Rename {
            entity_id: "e".to_string(),
            old_name: "old".to_string(),
            new_name: "NewName".to_string(),
        };
        assert!(action.description().contains("NewName"));
    }

    #[test]
    fn description_spawn() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::Spawn { snapshot: snap };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_delete() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::Delete { snapshot: snap };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_duplicate() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::Duplicate {
            source_entity_id: "src".to_string(),
            snapshot: snap,
        };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_visibility_show() {
        let action = UndoableAction::VisibilityChange {
            entity_id: "e".to_string(),
            old_visible: false,
            new_visible: true,
        };
        assert_eq!(action.description(), "Show");
    }

    #[test]
    fn description_visibility_hide() {
        let action = UndoableAction::VisibilityChange {
            entity_id: "e".to_string(),
            old_visible: true,
            new_visible: false,
        };
        assert_eq!(action.description(), "Hide");
    }

    #[test]
    fn description_material_change() {
        let mat = crate::core::material::MaterialData::default();
        let action = UndoableAction::MaterialChange {
            entity_id: "e".to_string(),
            old_material: mat.clone(),
            new_material: mat,
        };
        assert_eq!(action.description(), "Material Change");
    }

    #[test]
    fn description_light_change() {
        let light = crate::core::lighting::LightData::point();
        let action = UndoableAction::LightChange {
            entity_id: "e".to_string(),
            old_light: light.clone(),
            new_light: light,
        };
        assert_eq!(action.description(), "Light Change");
    }

    #[test]
    fn description_physics_change() {
        let phys = crate::core::physics::PhysicsData::default();
        let action = UndoableAction::PhysicsChange {
            entity_id: "e".to_string(),
            old_physics: phys.clone(),
            new_physics: phys,
        };
        assert_eq!(action.description(), "Physics Change");
    }

    #[test]
    fn description_script_change() {
        let action = UndoableAction::ScriptChange {
            entity_id: "e".to_string(),
            old_script: None,
            new_script: None,
        };
        assert_eq!(action.description(), "Script Change");
    }

    #[test]
    fn description_audio_change() {
        let action = UndoableAction::AudioChange {
            entity_id: "e".to_string(),
            old_audio: None,
            new_audio: None,
        };
        assert_eq!(action.description(), "Audio Change");
    }

    #[test]
    fn description_reverb_zone_change() {
        let action = UndoableAction::ReverbZoneChange {
            entity_id: "e".to_string(),
            old_reverb: None,
            new_reverb: None,
        };
        assert_eq!(action.description(), "Reverb Zone Change");
    }

    #[test]
    fn description_particle_change() {
        let action = UndoableAction::ParticleChange {
            entity_id: "e".to_string(),
            old_particle: None,
            new_particle: None,
        };
        assert_eq!(action.description(), "Particle Change");
    }

    #[test]
    fn description_shader_change() {
        let action = UndoableAction::ShaderChange {
            entity_id: "e".to_string(),
            old_shader: None,
            new_shader: None,
        };
        assert_eq!(action.description(), "Shader Effect Change");
    }

    #[test]
    fn description_csg_operation() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::CsgOperation {
            source_a_snapshot: None,
            source_b_snapshot: None,
            result_snapshot: snap,
            sources_deleted: false,
        };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_terrain_change() {
        let td = crate::core::terrain::TerrainData::default();
        let tmd = crate::core::terrain::TerrainMeshData {
            heights: vec![],
            resolution: 64,
            size: 50.0,
        };
        let action = UndoableAction::TerrainChange {
            entity_id: "e".to_string(),
            old_terrain: td.clone(),
            new_terrain: td,
            old_mesh_data: tmd.clone(),
            new_mesh_data: tmd,
        };
        assert_eq!(action.description(), "Terrain Change");
    }

    #[test]
    fn description_extrude_shape() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::ExtrudeShape { snapshot: snap };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_lathe_shape() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::LatheShape { snapshot: snap };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_array_entity() {
        let action = UndoableAction::ArrayEntity {
            source_id: "src".to_string(),
            created_snapshots: vec![make_entity_snapshot(), make_entity_snapshot(), make_entity_snapshot()],
        };
        let desc = action.description();
        assert!(desc.contains("3"), "should mention count: {}", desc);
    }

    #[test]
    fn description_combine_meshes() {
        let snap = make_entity_snapshot();
        let name = snap.name.clone();
        let action = UndoableAction::CombineMeshes {
            source_snapshots: vec![],
            result_snapshot: snap,
        };
        assert!(action.description().contains(&name));
    }

    #[test]
    fn description_joint_change() {
        let action = UndoableAction::JointChange {
            entity_id: "e".to_string(),
            old_joint: None,
            new_joint: None,
        };
        assert_eq!(action.description(), "Joint Change");
    }

    #[test]
    fn description_game_component_change() {
        let action = UndoableAction::GameComponentChange {
            entity_id: "e".to_string(),
            old_components: None,
            new_components: None,
        };
        assert_eq!(action.description(), "Game Component Change");
    }

    #[test]
    fn description_animation_clip_change() {
        let action = UndoableAction::AnimationClipChange {
            entity_id: "e".to_string(),
            old_clip: None,
            new_clip: None,
        };
        assert_eq!(action.description(), "Animation Clip Change");
    }

    #[test]
    fn description_sprite_change() {
        let action = UndoableAction::SpriteChange {
            entity_id: "e".to_string(),
            old_sprite: None,
            new_sprite: None,
        };
        assert_eq!(action.description(), "Sprite Change");
    }

    #[test]
    fn description_physics2d_change() {
        let action = UndoableAction::Physics2dChange {
            entity_id: "e".to_string(),
            old_physics: None,
            new_physics: None,
        };
        assert_eq!(action.description(), "2D Physics Change");
    }

    #[test]
    fn description_joint2d_change() {
        let action = UndoableAction::Joint2dChange {
            entity_id: "e".to_string(),
            old_joint: None,
            new_joint: None,
        };
        assert_eq!(action.description(), "2D Joint Change");
    }

    #[test]
    fn description_tilemap_change() {
        let action = UndoableAction::TilemapChange {
            entity_id: "e".to_string(),
            old_tilemap: None,
            new_tilemap: None,
        };
        assert_eq!(action.description(), "Tilemap Change");
    }

    #[test]
    fn description_skeleton_change() {
        let action = UndoableAction::SkeletonChange {
            entity_id: "e".to_string(),
            old_skeleton: None,
            new_skeleton: None,
        };
        assert_eq!(action.description(), "Skeleton 2D Change");
    }

    // --- EntitySnapshot::new defaults ---

    #[test]
    fn entity_snapshot_new_defaults() {
        let snap = make_entity_snapshot();
        assert_eq!(snap.entity_id, "test-entity-id");
        assert_eq!(snap.name, "TestCube");
        assert!(snap.visible);
        assert!(!snap.physics_enabled);
        assert!(!snap.particle_enabled);
        assert!(!snap.reverb_zone_enabled);
        assert!(!snap.active_game_camera);
        assert!(!snap.physics2d_enabled);
        assert!(!snap.tilemap_enabled);
        assert!(!snap.skeleton2d_enabled);
        assert!(snap.material_data.is_none());
        assert!(snap.light_data.is_none());
        assert!(snap.physics_data.is_none());
        assert!(snap.script_data.is_none());
        assert!(snap.audio_data.is_none());
        assert!(snap.particle_data.is_none());
        assert!(snap.terrain_data.is_none());
        assert!(snap.lod_data.is_none());
    }
}
