//! Pending commands resource for queuing commands from the bridge to ECS systems.
//!
//! Commands from JavaScript cannot directly access Bevy's ECS. Instead, they
//! queue requests in this resource, which systems process each frame.
//!
//! Domain modules define request structs, queue methods, and bridge functions:
//! - `transform` — Transform, rename, spawn, delete, duplicate, selection, camera, snap
//! - `material` — Material, lighting, environment, post-processing, shaders, skybox
//! - `physics` — Physics 3D + 2D, joints, forces, raycasts
//! - `audio` — Scripts, audio, buses, reverb zones
//! - `animation` — Animation playback, clips, skeleton 2D
//! - `particles` — Particle system
//! - `procedural` — CSG, terrain, extrude, lathe, array, combine
//! - `game` — Game components, game camera, input bindings
//! - `sprites` — Sprites, 2D camera, project type
//! - `scene` — Scene export/load, assets, prefabs, quality
//! - `query` — MCP query requests

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

pub mod animation;
pub mod audio;
pub mod edit_mode;
pub mod game;
pub mod material;
pub mod particles;
pub mod performance;
pub mod physics;
pub mod procedural;
pub mod query;
pub mod scene;
pub mod sprites;
pub mod transform;

// Re-export all request types and bridge functions from domain modules
pub use animation::*;
pub use audio::*;
pub use edit_mode::*;
pub use game::*;
pub use material::*;
pub use particles::*;
pub use performance::*;
pub use physics::*;
pub use procedural::*;
pub use query::*;
pub use scene::*;
pub use sprites::*;
pub use transform::*;

/// Entity types that can be spawned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Component)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Cube,
    Sphere,
    Plane,
    Cylinder,
    Cone,
    Torus,
    Capsule,
    CsgResult,
    Terrain,
    ProceduralMesh,
    PointLight,
    DirectionalLight,
    SpotLight,
    GltfModel,
    GltfMesh,
    Sprite,
}

impl EntityType {
    /// Parse entity type from string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "cube" => Some(EntityType::Cube),
            "sphere" => Some(EntityType::Sphere),
            "plane" => Some(EntityType::Plane),
            "cylinder" => Some(EntityType::Cylinder),
            "cone" => Some(EntityType::Cone),
            "torus" => Some(EntityType::Torus),
            "capsule" => Some(EntityType::Capsule),
            "csg_result" => Some(EntityType::CsgResult),
            "terrain" => Some(EntityType::Terrain),
            "procedural_mesh" => Some(EntityType::ProceduralMesh),
            "point_light" => Some(EntityType::PointLight),
            "directional_light" => Some(EntityType::DirectionalLight),
            "spot_light" => Some(EntityType::SpotLight),
            "gltf_model" => Some(EntityType::GltfModel),
            "gltf_mesh" => Some(EntityType::GltfMesh),
            "sprite" => Some(EntityType::Sprite),
            _ => None,
        }
    }

    /// Get the default name for this entity type.
    pub fn default_name(&self) -> &'static str {
        match self {
            EntityType::Cube => "Cube",
            EntityType::Sphere => "Sphere",
            EntityType::Plane => "Plane",
            EntityType::Cylinder => "Cylinder",
            EntityType::Cone => "Cone",
            EntityType::Torus => "Torus",
            EntityType::Capsule => "Capsule",
            EntityType::CsgResult => "CSG Result",
            EntityType::Terrain => "Terrain",
            EntityType::ProceduralMesh => "Procedural Mesh",
            EntityType::PointLight => "Point Light",
            EntityType::DirectionalLight => "Directional Light",
            EntityType::SpotLight => "Spot Light",
            EntityType::GltfModel => "Model",
            EntityType::GltfMesh => "Mesh",
            EntityType::Sprite => "Sprite",
        }
    }
}

/// Resource that holds pending commands from the bridge layer.
/// Systems process these each frame and clear them.
#[derive(Resource, Default)]
pub struct PendingCommands {
    // transform domain
    pub transform_updates: Vec<TransformUpdate>,
    pub rename_requests: Vec<RenameRequest>,
    pub camera_focus_requests: Vec<CameraFocusRequest>,
    pub spawn_requests: Vec<SpawnRequest>,
    pub delete_requests: Vec<DeleteRequest>,
    pub duplicate_requests: Vec<DuplicateRequest>,
    pub reparent_requests: Vec<ReparentRequest>,
    pub snap_settings_updates: Vec<SnapSettingsUpdate>,
    pub grid_toggles: Vec<()>,
    pub camera_preset_requests: Vec<CameraPresetRequest>,
    pub coordinate_mode_update: Option<crate::core::gizmo::CoordinateMode>,
    pub selection_requests: Vec<SelectionRequest>,
    pub mode_change_requests: Vec<crate::core::engine_mode::ModeChangeRequest>,
    // material domain
    pub material_updates: Vec<MaterialUpdate>,
    pub light_updates: Vec<LightUpdate>,
    pub ambient_light_updates: Vec<AmbientLightUpdate>,
    pub environment_updates: Vec<EnvironmentUpdate>,
    pub post_processing_updates: Vec<PostProcessingUpdate>,
    pub shader_updates: Vec<ShaderUpdate>,
    pub shader_removals: Vec<ShaderRemoval>,
    pub set_skybox_requests: Vec<SetSkyboxRequest>,
    pub remove_skybox_requests: Vec<RemoveSkyboxRequest>,
    pub update_skybox_requests: Vec<UpdateSkyboxRequest>,
    pub custom_skybox_requests: Vec<SetCustomSkyboxRequest>,
    // physics domain
    pub physics_updates: Vec<PhysicsUpdate>,
    pub physics_toggles: Vec<PhysicsToggle>,
    pub debug_physics_toggles: Vec<DebugPhysicsToggle>,
    pub create_joint_requests: Vec<CreateJointRequest>,
    pub update_joint_requests: Vec<UpdateJointRequest>,
    pub remove_joint_requests: Vec<RemoveJointRequest>,
    pub force_applications: Vec<ForceApplication>,
    pub raycast_requests: Vec<RaycastRequest>,
    pub physics2d_updates: Vec<Physics2dUpdate>,
    pub physics2d_toggles: Vec<Physics2dToggle>,
    pub create_joint2d_requests: Vec<CreateJoint2dRequest>,
    pub remove_joint2d_requests: Vec<RemoveJoint2dRequest>,
    pub force_applications2d: Vec<ForceApplication2d>,
    pub impulse_applications2d: Vec<ImpulseApplication2d>,
    pub raycast2d_requests: Vec<Raycast2dRequest>,
    pub gravity2d_updates: Vec<Gravity2dUpdate>,
    pub debug_physics2d_toggles: Vec<DebugPhysics2dToggle>,
    // audio domain
    pub script_updates: Vec<ScriptUpdate>,
    pub script_removals: Vec<ScriptRemoval>,
    pub audio_updates: Vec<AudioUpdate>,
    pub audio_removals: Vec<AudioRemoval>,
    pub audio_playback: Vec<AudioPlayback>,
    pub audio_bus_updates: Vec<AudioBusUpdate>,
    pub audio_bus_creates: Vec<AudioBusCreate>,
    pub audio_bus_deletes: Vec<AudioBusDelete>,
    pub audio_bus_effects_updates: Vec<AudioBusEffectsUpdate>,
    pub reverb_zone_updates: Vec<ReverbZoneUpdate>,
    pub reverb_zone_toggles: Vec<ReverbZoneToggle>,
    pub reverb_zone_removals: Vec<ReverbZoneRemoval>,
    // animation domain
    pub animation_requests: Vec<AnimationRequest>,
    pub animation_clip_updates: Vec<AnimationClipUpdate>,
    pub animation_clip_add_keyframes: Vec<AnimationClipAddKeyframe>,
    pub animation_clip_remove_keyframes: Vec<AnimationClipRemoveKeyframe>,
    pub animation_clip_update_keyframes: Vec<AnimationClipUpdateKeyframe>,
    pub animation_clip_property_updates: Vec<AnimationClipPropertyUpdate>,
    pub animation_clip_previews: Vec<AnimationClipPreview>,
    pub animation_clip_removals: Vec<AnimationClipRemoval>,
    pub create_skeleton2d_requests: Vec<CreateSkeleton2dRequest>,
    pub add_bone2d_requests: Vec<AddBone2dRequest>,
    pub remove_bone2d_requests: Vec<RemoveBone2dRequest>,
    pub update_bone2d_requests: Vec<UpdateBone2dRequest>,
    pub create_skeletal_animation2d_requests: Vec<CreateSkeletalAnimation2dRequest>,
    pub add_keyframe2d_requests: Vec<AddKeyframe2dRequest>,
    pub play_skeletal_animation2d_requests: Vec<PlaySkeletalAnimation2dRequest>,
    pub set_skeleton2d_skin_requests: Vec<SetSkeleton2dSkinRequest>,
    pub create_ik_chain2d_requests: Vec<CreateIkChain2dRequest>,
    pub get_skeleton2d_requests: Vec<GetSkeleton2dRequest>,
    pub import_skeleton_json_requests: Vec<ImportSkeletonJsonRequest>,
    pub auto_weight_skeleton2d_requests: Vec<AutoWeightSkeleton2dRequest>,
    // particles domain
    pub particle_updates: Vec<ParticleUpdate>,
    pub particle_toggles: Vec<ParticleToggle>,
    pub particle_removals: Vec<ParticleRemoval>,
    pub particle_preset_requests: Vec<ParticlePresetRequest>,
    pub particle_playback: Vec<ParticlePlayback>,
    // procedural domain
    pub csg_requests: Vec<CsgRequest>,
    pub terrain_spawn_requests: Vec<TerrainSpawnRequest>,
    pub terrain_updates: Vec<TerrainUpdate>,
    pub terrain_sculpts: Vec<TerrainSculpt>,
    pub extrude_requests: Vec<ExtrudeRequest>,
    pub lathe_requests: Vec<LatheRequest>,
    pub array_requests: Vec<ArrayRequest>,
    pub combine_requests: Vec<CombineRequest>,
    // game domain
    pub input_binding_updates: Vec<InputBindingUpdate>,
    pub input_preset_requests: Vec<InputPresetRequest>,
    pub input_binding_removals: Vec<InputBindingRemoval>,
    pub game_component_adds: Vec<GameComponentAddRequest>,
    pub game_component_updates: Vec<GameComponentUpdateRequest>,
    pub game_component_removals: Vec<GameComponentRemovalRequest>,
    pub set_game_camera_requests: Vec<SetGameCameraRequest>,
    pub set_active_game_camera_requests: Vec<SetActiveGameCameraRequest>,
    pub camera_shake_requests: Vec<CameraShakeRequest>,
    // sprites domain
    pub set_project_type_requests: Vec<SetProjectTypeRequest>,
    pub sprite_data_updates: Vec<SpriteDataUpdate>,
    pub sprite_removals: Vec<SpriteRemoval>,
    pub camera_2d_data_updates: Vec<Camera2dDataUpdate>,
    // scene domain
    pub scene_export_requests: Vec<SceneExportRequest>,
    pub scene_load_requests: Vec<SceneLoadRequest>,
    pub new_scene_requests: Vec<NewSceneRequest>,
    pub gltf_import_requests: Vec<GltfImportRequest>,
    pub texture_load_requests: Vec<TextureLoadRequest>,
    pub place_asset_requests: Vec<PlaceAssetRequest>,
    pub delete_asset_requests: Vec<DeleteAssetRequest>,
    pub remove_texture_requests: Vec<RemoveTextureRequest>,
    pub quality_preset_requests: Vec<QualityPresetRequest>,
    pub instantiate_prefab_requests: Vec<InstantiatePrefabRequest>,
    // query domain
    pub query_requests: Vec<QueryRequest>,
    // edit_mode domain
    pub enter_edit_mode_requests: Vec<EnterEditModeRequest>,
    pub exit_edit_mode_requests: Vec<ExitEditModeRequest>,
    pub set_selection_mode_requests: Vec<SetSelectionModeRequest>,
    pub select_elements_requests: Vec<SelectElementsRequest>,
    pub mesh_operation_requests: Vec<MeshOperationRequest>,
    pub recalc_normals_requests: Vec<RecalcNormalsRequest>,
    // performance domain
    pub set_lod_requests: Vec<SetLodRequest>,
    pub generate_lods_requests: Vec<GenerateLodsRequest>,
    pub set_performance_budget_requests: Vec<SetPerformanceBudgetRequest>,
    pub get_performance_stats_requests: Vec<GetPerformanceStatsRequest>,
    pub optimize_scene_requests: Vec<OptimizeSceneRequest>,
    pub set_lod_distances_requests: Vec<SetLodDistancesRequest>,
}

// === Thread-Local Bridge Access ===

thread_local! {
    static PENDING_COMMANDS: RefCell<Option<*mut PendingCommands>> = const { RefCell::new(None) };
}

/// Register the PendingCommands resource pointer for bridge access.
/// Called during app setup.
pub fn register_pending_commands(commands: *mut PendingCommands) {
    PENDING_COMMANDS.with(|pc| {
        *pc.borrow_mut() = Some(commands);
    });
}

/// Helper for bridge functions: access PendingCommands via thread-local.
/// Returns None if the resource isn't registered yet.
pub(crate) fn with_pending<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PendingCommands) -> R,
{
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            // SAFETY: WASM is single-threaded and we control the lifetime
            Some(unsafe { f(&mut *ptr) })
        } else {
            None
        }
    })
}
