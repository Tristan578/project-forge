//! Pending commands resource for queuing commands from the bridge to ECS systems.
//!
//! Commands from JavaScript cannot directly access Bevy's ECS. Instead, they
//! queue requests in this resource, which systems process each frame.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::audio::AudioEffectDef;
use super::camera_presets::CameraPreset;
use super::engine_mode::ModeChangeRequest;
use super::gizmo::CoordinateMode;
use super::input::{ActionDef, InputPreset};
use super::lighting::LightData;
use super::material::MaterialData;
use super::particles::ParticleData;
use super::physics::PhysicsData;
use super::post_processing::{BloomSettings, ChromaticAberrationSettings, ColorGradingSettings, SharpeningSettings};
use super::shader_effects::ShaderEffectData;
use super::terrain::TerrainData;

/// A query request type for MCP resource reads.
#[derive(Debug, Clone)]
pub enum QueryRequest {
    SceneGraph,
    Selection,
    EntityDetails { entity_id: String },
    CameraState,
    EngineMode,
    InputBindings,
    InputState,
    PhysicsState { entity_id: String },
    AssetList,
    ScriptData { entity_id: String },
    ScriptTemplates,
    AudioData { entity_id: String },
    PostProcessingState,
    AudioBuses,
    ParticleState { entity_id: String },
    AnimationState { entity_id: String },
    AnimationGraph { entity_id: String },
    ShaderData { entity_id: String },
    TerrainState { entity_id: String },
    QualitySettings,
}

/// A pending glTF import request.
#[derive(Debug, Clone)]
pub struct GltfImportRequest {
    pub data_base64: String,
    pub name: String,
    pub position: Option<bevy::math::Vec3>,
}

/// A pending texture load request.
#[derive(Debug, Clone)]
pub struct TextureLoadRequest {
    pub data_base64: String,
    pub name: String,
    pub entity_id: String,
    pub slot: String,
}

/// A pending place-asset request (spawn instance of registered asset).
#[derive(Debug, Clone)]
pub struct PlaceAssetRequest {
    pub asset_id: String,
    pub position: Option<bevy::math::Vec3>,
}

/// A pending delete-asset request.
#[derive(Debug, Clone)]
pub struct DeleteAssetRequest {
    pub asset_id: String,
}

/// A pending remove-texture request.
#[derive(Debug, Clone)]
pub struct RemoveTextureRequest {
    pub entity_id: String,
    pub slot: String,
}

/// A pending input binding update request.
#[derive(Debug, Clone)]
pub struct InputBindingUpdate {
    pub action_def: ActionDef,
}

/// A pending input preset request.
#[derive(Debug, Clone)]
pub struct InputPresetRequest {
    pub preset: InputPreset,
}

/// A pending input binding removal request.
#[derive(Debug, Clone)]
pub struct InputBindingRemoval {
    pub action_name: String,
}

/// A pending physics update request.
#[derive(Debug, Clone)]
pub struct PhysicsUpdate {
    pub entity_id: String,
    pub physics_data: PhysicsData,
}

/// A pending physics toggle request.
#[derive(Debug, Clone)]
pub struct PhysicsToggle {
    pub entity_id: String,
    pub enabled: bool,
}

/// A pending debug physics toggle request.
#[derive(Debug, Clone)]
pub struct DebugPhysicsToggle;

/// A pending script update request.
#[derive(Debug, Clone)]
pub struct ScriptUpdate {
    pub entity_id: String,
    pub source: String,
    pub enabled: bool,
    pub template: Option<String>,
}

/// A pending script removal request.
#[derive(Debug, Clone)]
pub struct ScriptRemoval {
    pub entity_id: String,
}

/// A pending audio update request.
#[derive(Debug, Clone)]
pub struct AudioUpdate {
    pub entity_id: String,
    pub asset_id: Option<String>,
    pub volume: Option<f32>,
    pub pitch: Option<f32>,
    pub loop_audio: Option<bool>,
    pub spatial: Option<bool>,
    pub max_distance: Option<f32>,
    pub ref_distance: Option<f32>,
    pub rolloff_factor: Option<f32>,
    pub autoplay: Option<bool>,
}

/// A pending audio removal request.
#[derive(Debug, Clone)]
pub struct AudioRemoval {
    pub entity_id: String,
}

/// A pending audio playback request.
#[derive(Debug, Clone)]
pub struct AudioPlayback {
    pub entity_id: String,
    pub action: String,  // "play", "stop", "pause", "resume"
}

/// A pending audio bus update request.
#[derive(Debug, Clone)]
pub struct AudioBusUpdate {
    pub bus_name: String,
    pub volume: Option<f32>,
    pub muted: Option<bool>,
    pub soloed: Option<bool>,
}

/// A pending audio bus creation request.
#[derive(Debug, Clone)]
pub struct AudioBusCreate {
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub soloed: bool,
}

/// A pending audio bus deletion request.
#[derive(Debug, Clone)]
pub struct AudioBusDelete {
    pub bus_name: String,
}

/// A pending audio bus effects update request (A-2).
#[derive(Debug, Clone)]
pub struct AudioBusEffectsUpdate {
    pub bus_name: String,
    pub effects: Vec<AudioEffectDef>,
}

/// A pending particle update request.
#[derive(Debug, Clone)]
pub struct ParticleUpdate {
    pub entity_id: String,
    pub particle_data: ParticleData,
}

/// A pending particle toggle request.
#[derive(Debug, Clone)]
pub struct ParticleToggle {
    pub entity_id: String,
    pub enabled: bool,
}

/// A pending particle removal request.
#[derive(Debug, Clone)]
pub struct ParticleRemoval {
    pub entity_id: String,
}

/// A pending particle preset application request.
#[derive(Debug, Clone)]
pub struct ParticlePresetRequest {
    pub entity_id: String,
    pub preset: String,
}

/// A pending particle playback control request.
#[derive(Debug, Clone)]
pub struct ParticlePlayback {
    pub entity_id: String,
    pub action: String, // "play", "stop", "burst"
    pub burst_count: Option<u32>,
}

/// A pending animation playback request.
#[derive(Debug, Clone)]
pub struct AnimationRequest {
    pub entity_id: String,
    pub action: AnimationAction,
}

/// A pending shader update request.
#[derive(Debug, Clone)]
pub struct ShaderUpdate {
    pub entity_id: String,
    pub shader_data: ShaderEffectData,
}

/// A pending shader removal request (sets shader_type to "none").
#[derive(Debug, Clone)]
pub struct ShaderRemoval {
    pub entity_id: String,
}

/// A pending CSG boolean operation request.
#[derive(Debug, Clone)]
pub struct CsgRequest {
    pub entity_id_a: String,
    pub entity_id_b: String,
    pub operation: super::csg::CsgOperation,
    pub delete_sources: bool,
    pub result_name: Option<String>,
}

/// A pending terrain spawn request.
#[derive(Debug, Clone)]
pub struct TerrainSpawnRequest {
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
    pub terrain_data: TerrainData,
}

/// A pending terrain update request (modify noise params -> regenerate mesh).
#[derive(Debug, Clone)]
pub struct TerrainUpdate {
    pub entity_id: String,
    pub terrain_data: TerrainData,
}

/// A pending terrain sculpt request (modify heightmap at position+radius).
#[derive(Debug, Clone)]
pub struct TerrainSculpt {
    pub entity_id: String,
    pub position: [f32; 2], // x, z in terrain local space
    pub radius: f32,
    pub strength: f32,
}

/// A pending extrude request.
#[derive(Debug, Clone)]
pub struct ExtrudeRequest {
    pub shape: String, // circle, square, hexagon, star
    pub radius: f32,
    pub length: f32,
    pub segments: u32,
    pub inner_radius: Option<f32>,
    pub star_points: Option<u32>,
    pub size: Option<f32>,
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
}

/// A pending lathe request.
#[derive(Debug, Clone)]
pub struct LatheRequest {
    pub profile: Vec<[f32; 2]>,
    pub segments: u32,
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
}

/// A pending array request.
#[derive(Debug, Clone)]
pub struct ArrayRequest {
    pub entity_id: String,
    pub pattern: String, // grid or circle
    pub count_x: Option<u32>,
    pub count_y: Option<u32>,
    pub count_z: Option<u32>,
    pub spacing_x: Option<f32>,
    pub spacing_y: Option<f32>,
    pub spacing_z: Option<f32>,
    pub circle_count: Option<u32>,
    pub circle_radius: Option<f32>,
}

/// A pending combine request.
#[derive(Debug, Clone)]
pub struct CombineRequest {
    pub entity_ids: Vec<String>,
    pub delete_sources: bool,
    pub name: Option<String>,
}

/// A pending instantiate prefab request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiatePrefabRequest {
    pub snapshot_json: String,
    pub position: Option<[f32; 3]>,
    pub name: Option<String>,
}

/// The specific animation action to perform.
#[derive(Debug, Clone)]
pub enum AnimationAction {
    /// Start playing a clip by name. If crossfade_secs > 0, blend from current.
    Play {
        clip_name: String,
        crossfade_secs: f32,
    },
    /// Pause the currently playing animation.
    Pause,
    /// Resume a paused animation.
    Resume,
    /// Stop all animations on this entity.
    Stop,
    /// Seek to a specific time in the current animation.
    Seek { time_secs: f32 },
    /// Set playback speed.
    SetSpeed { speed: f32 },
    /// Set loop mode.
    SetLoop { looping: bool },
    /// Set blend weight for a specific clip (0.0-1.0).
    SetBlendWeight { clip_name: String, weight: f32 },
    /// Set playback speed for a specific clip.
    SetClipSpeed { clip_name: String, speed: f32 },
}

/// A quality preset change request.
#[derive(Debug, Clone)]
pub struct QualityPresetRequest {
    pub preset: String,
}

/// A pending force/impulse application (Play mode only).
#[derive(Debug, Clone)]
pub struct ForceApplication {
    pub entity_id: String,
    pub force: [f32; 3],
    pub torque: [f32; 3],
    pub is_impulse: bool,
}

/// A pending scene export request.
#[derive(Debug, Clone)]
pub struct SceneExportRequest;

/// A pending scene load request.
#[derive(Debug, Clone)]
pub struct SceneLoadRequest {
    pub json: String,
}

/// A pending new scene request.
#[derive(Debug, Clone)]
pub struct NewSceneRequest;

/// Resource that holds pending commands from the bridge layer.
/// Systems process these each frame and clear them.
#[derive(Resource, Default)]
pub struct PendingCommands {
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
    pub coordinate_mode_update: Option<CoordinateMode>,
    pub material_updates: Vec<MaterialUpdate>,
    pub light_updates: Vec<LightUpdate>,
    pub ambient_light_updates: Vec<AmbientLightUpdate>,
    pub environment_updates: Vec<EnvironmentUpdate>,
    pub post_processing_updates: Vec<PostProcessingUpdate>,
    pub selection_requests: Vec<SelectionRequest>,
    pub query_requests: Vec<QueryRequest>,
    pub mode_change_requests: Vec<ModeChangeRequest>,
    pub input_binding_updates: Vec<InputBindingUpdate>,
    pub input_preset_requests: Vec<InputPresetRequest>,
    pub input_binding_removals: Vec<InputBindingRemoval>,
    pub physics_updates: Vec<PhysicsUpdate>,
    pub physics_toggles: Vec<PhysicsToggle>,
    pub debug_physics_toggles: Vec<DebugPhysicsToggle>,
    pub force_applications: Vec<ForceApplication>,
    pub scene_export_requests: Vec<SceneExportRequest>,
    pub scene_load_requests: Vec<SceneLoadRequest>,
    pub new_scene_requests: Vec<NewSceneRequest>,
    pub gltf_import_requests: Vec<GltfImportRequest>,
    pub texture_load_requests: Vec<TextureLoadRequest>,
    pub place_asset_requests: Vec<PlaceAssetRequest>,
    pub delete_asset_requests: Vec<DeleteAssetRequest>,
    pub remove_texture_requests: Vec<RemoveTextureRequest>,
    pub script_updates: Vec<ScriptUpdate>,
    pub script_removals: Vec<ScriptRemoval>,
    pub audio_updates: Vec<AudioUpdate>,
    pub audio_removals: Vec<AudioRemoval>,
    pub audio_playback: Vec<AudioPlayback>,
    pub audio_bus_updates: Vec<AudioBusUpdate>,
    pub audio_bus_creates: Vec<AudioBusCreate>,
    pub audio_bus_deletes: Vec<AudioBusDelete>,
    pub audio_bus_effects_updates: Vec<AudioBusEffectsUpdate>,
    pub particle_updates: Vec<ParticleUpdate>,
    pub particle_toggles: Vec<ParticleToggle>,
    pub particle_removals: Vec<ParticleRemoval>,
    pub particle_preset_requests: Vec<ParticlePresetRequest>,
    pub particle_playback: Vec<ParticlePlayback>,
    pub animation_requests: Vec<AnimationRequest>,
    pub shader_updates: Vec<ShaderUpdate>,
    pub shader_removals: Vec<ShaderRemoval>,
    pub csg_requests: Vec<CsgRequest>,
    pub terrain_spawn_requests: Vec<TerrainSpawnRequest>,
    pub terrain_updates: Vec<TerrainUpdate>,
    pub terrain_sculpts: Vec<TerrainSculpt>,
    pub extrude_requests: Vec<ExtrudeRequest>,
    pub lathe_requests: Vec<LatheRequest>,
    pub array_requests: Vec<ArrayRequest>,
    pub combine_requests: Vec<CombineRequest>,
    pub quality_preset_requests: Vec<QualityPresetRequest>,
    pub instantiate_prefab_requests: Vec<InstantiatePrefabRequest>,
}

/// A pending selection request from the hierarchy panel.
#[derive(Debug, Clone)]
pub struct SelectionRequest {
    pub entity_id: String,
    pub mode: SelectionMode,
}

/// Selection mode matching React's modes.
#[derive(Debug, Clone)]
pub enum SelectionMode {
    Replace,
    Add,
    Toggle,
}

/// A pending material update request.
#[derive(Debug, Clone)]
pub struct MaterialUpdate {
    pub entity_id: String,
    pub material_data: MaterialData,
}

/// A pending light update request.
#[derive(Debug, Clone)]
pub struct LightUpdate {
    pub entity_id: String,
    pub light_data: LightData,
}

/// A pending ambient light update request.
#[derive(Debug, Clone)]
pub struct AmbientLightUpdate {
    pub color: Option<[f32; 3]>,
    pub brightness: Option<f32>,
}

/// A pending environment update request.
#[derive(Debug, Clone)]
pub struct EnvironmentUpdate {
    pub skybox_brightness: Option<f32>,
    pub ibl_intensity: Option<f32>,
    pub ibl_rotation_degrees: Option<f32>,
    pub clear_color: Option<[f32; 3]>,
    pub fog_enabled: Option<bool>,
    pub fog_color: Option<[f32; 3]>,
    pub fog_start: Option<f32>,
    pub fog_end: Option<f32>,
}

/// A pending post-processing update request.
#[derive(Debug, Clone)]
pub struct PostProcessingUpdate {
    pub bloom: Option<BloomSettings>,
    pub chromatic_aberration: Option<ChromaticAberrationSettings>,
    pub color_grading: Option<ColorGradingSettings>,
    pub sharpening: Option<SharpeningSettings>,
}

/// A pending transform update request.
#[derive(Debug, Clone)]
pub struct TransformUpdate {
    pub entity_id: String,
    pub position: Option<Vec3>,
    pub rotation: Option<Quat>,
    pub scale: Option<Vec3>,
}

/// A pending entity rename request.
#[derive(Debug, Clone)]
pub struct RenameRequest {
    pub entity_id: String,
    pub new_name: String,
}

/// A pending camera focus request.
#[derive(Debug, Clone)]
pub struct CameraFocusRequest {
    pub entity_id: String,
}

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
        }
    }
}

/// A pending spawn request.
#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub entity_type: EntityType,
    pub name: Option<String>,
    pub position: Option<Vec3>,
}

/// A pending delete request.
#[derive(Debug, Clone)]
pub struct DeleteRequest {
    pub entity_ids: Vec<String>,
}

/// A pending duplicate request.
#[derive(Debug, Clone)]
pub struct DuplicateRequest {
    pub entity_id: String,
}

/// A pending camera preset request.
#[derive(Debug, Clone)]
pub struct CameraPresetRequest {
    pub preset: CameraPreset,
}

/// A pending reparent request.
#[derive(Debug, Clone)]
pub struct ReparentRequest {
    pub entity_id: String,
    pub new_parent_id: Option<String>,
    pub insert_index: Option<usize>,
}

/// A pending snap settings update request.
#[derive(Debug, Clone)]
pub struct SnapSettingsUpdate {
    pub translation_snap: Option<f32>,
    pub rotation_snap_degrees: Option<f32>,
    pub scale_snap: Option<f32>,
    pub grid_visible: Option<bool>,
    pub grid_size: Option<f32>,
    pub grid_extent: Option<u32>,
}

impl PendingCommands {
    /// Queue a transform update.
    pub fn queue_transform_update(&mut self, update: TransformUpdate) {
        self.transform_updates.push(update);
    }

    /// Queue a rename request.
    pub fn queue_rename(&mut self, request: RenameRequest) {
        self.rename_requests.push(request);
    }

    /// Queue a camera focus request.
    pub fn queue_camera_focus(&mut self, request: CameraFocusRequest) {
        self.camera_focus_requests.push(request);
    }

    /// Queue a spawn request.
    pub fn queue_spawn(&mut self, request: SpawnRequest) {
        self.spawn_requests.push(request);
    }

    /// Queue a delete request.
    pub fn queue_delete(&mut self, request: DeleteRequest) {
        self.delete_requests.push(request);
    }

    /// Queue a duplicate request.
    pub fn queue_duplicate(&mut self, request: DuplicateRequest) {
        self.duplicate_requests.push(request);
    }

    /// Queue a snap settings update.
    pub fn queue_snap_settings_update(&mut self, update: SnapSettingsUpdate) {
        self.snap_settings_updates.push(update);
    }

    /// Queue a grid toggle.
    pub fn queue_grid_toggle(&mut self) {
        self.grid_toggles.push(());
    }

    /// Queue a camera preset request.
    pub fn queue_camera_preset(&mut self, request: CameraPresetRequest) {
        self.camera_preset_requests.push(request);
    }

    /// Queue a reparent request.
    pub fn queue_reparent(&mut self, request: ReparentRequest) {
        self.reparent_requests.push(request);
    }

    /// Queue a coordinate mode update.
    pub fn queue_coordinate_mode_update(&mut self, mode: CoordinateMode) {
        self.coordinate_mode_update = Some(mode);
    }

    /// Queue a material update.
    pub fn queue_material_update(&mut self, update: MaterialUpdate) {
        self.material_updates.push(update);
    }

    /// Queue a light update.
    pub fn queue_light_update(&mut self, update: LightUpdate) {
        self.light_updates.push(update);
    }

    /// Queue an ambient light update.
    pub fn queue_ambient_light_update(&mut self, update: AmbientLightUpdate) {
        self.ambient_light_updates.push(update);
    }

    /// Queue an environment update.
    pub fn queue_environment_update(&mut self, update: EnvironmentUpdate) {
        self.environment_updates.push(update);
    }

    /// Queue a post-processing update.
    pub fn queue_post_processing_update(&mut self, update: PostProcessingUpdate) {
        self.post_processing_updates.push(update);
    }

    /// Queue a selection request.
    pub fn queue_selection(&mut self, request: SelectionRequest) {
        self.selection_requests.push(request);
    }

    /// Queue a query request (for MCP resource reads).
    pub fn queue_query(&mut self, request: QueryRequest) {
        self.query_requests.push(request);
    }

    /// Queue a mode change request (play/stop/pause/resume).
    pub fn queue_mode_change(&mut self, request: ModeChangeRequest) {
        self.mode_change_requests.push(request);
    }

    /// Queue an input binding update.
    pub fn queue_input_binding_update(&mut self, update: InputBindingUpdate) {
        self.input_binding_updates.push(update);
    }

    /// Queue an input preset request.
    pub fn queue_input_preset(&mut self, request: InputPresetRequest) {
        self.input_preset_requests.push(request);
    }

    /// Queue an input binding removal.
    pub fn queue_input_binding_removal(&mut self, removal: InputBindingRemoval) {
        self.input_binding_removals.push(removal);
    }

    /// Queue a physics update.
    pub fn queue_physics_update(&mut self, update: PhysicsUpdate) {
        self.physics_updates.push(update);
    }

    /// Queue a physics toggle.
    pub fn queue_physics_toggle(&mut self, toggle: PhysicsToggle) {
        self.physics_toggles.push(toggle);
    }

    /// Queue a debug physics toggle.
    pub fn queue_debug_physics_toggle(&mut self) {
        self.debug_physics_toggles.push(DebugPhysicsToggle);
    }

    /// Queue a force application.
    pub fn queue_force_application(&mut self, application: ForceApplication) {
        self.force_applications.push(application);
    }

    /// Queue a scene export request.
    pub fn queue_scene_export(&mut self) {
        self.scene_export_requests.push(SceneExportRequest);
    }

    /// Queue a scene load request.
    pub fn queue_scene_load(&mut self, request: SceneLoadRequest) {
        self.scene_load_requests.push(request);
    }

    /// Queue a new scene request.
    pub fn queue_new_scene(&mut self) {
        self.new_scene_requests.push(NewSceneRequest);
    }

    /// Queue a glTF import request.
    pub fn queue_gltf_import(&mut self, request: GltfImportRequest) {
        self.gltf_import_requests.push(request);
    }

    /// Queue a texture load request.
    pub fn queue_texture_load(&mut self, request: TextureLoadRequest) {
        self.texture_load_requests.push(request);
    }

    /// Queue a place-asset request.
    pub fn queue_place_asset(&mut self, request: PlaceAssetRequest) {
        self.place_asset_requests.push(request);
    }

    /// Queue a delete-asset request.
    pub fn queue_delete_asset(&mut self, request: DeleteAssetRequest) {
        self.delete_asset_requests.push(request);
    }

    /// Queue a remove-texture request.
    pub fn queue_remove_texture(&mut self, request: RemoveTextureRequest) {
        self.remove_texture_requests.push(request);
    }

    /// Queue a script update.
    pub fn queue_script_update(&mut self, update: ScriptUpdate) {
        self.script_updates.push(update);
    }

    /// Queue a script removal.
    pub fn queue_script_removal(&mut self, removal: ScriptRemoval) {
        self.script_removals.push(removal);
    }

    /// Queue an audio update.
    pub fn queue_audio_update(&mut self, update: AudioUpdate) {
        self.audio_updates.push(update);
    }

    /// Queue an audio removal.
    pub fn queue_audio_removal(&mut self, removal: AudioRemoval) {
        self.audio_removals.push(removal);
    }

    /// Queue an audio playback action.
    pub fn queue_audio_playback(&mut self, playback: AudioPlayback) {
        self.audio_playback.push(playback);
    }

    /// Queue an audio bus update.
    pub fn queue_audio_bus_update(&mut self, update: AudioBusUpdate) {
        self.audio_bus_updates.push(update);
    }

    /// Queue an audio bus creation.
    pub fn queue_audio_bus_create(&mut self, create: AudioBusCreate) {
        self.audio_bus_creates.push(create);
    }

    /// Queue an audio bus deletion.
    pub fn queue_audio_bus_delete(&mut self, delete: AudioBusDelete) {
        self.audio_bus_deletes.push(delete);
    }

    /// Queue an audio bus effects update.
    pub fn queue_audio_bus_effects_update(&mut self, update: AudioBusEffectsUpdate) {
        self.audio_bus_effects_updates.push(update);
    }

    /// Queue a particle update.
    pub fn queue_particle_update(&mut self, update: ParticleUpdate) {
        self.particle_updates.push(update);
    }

    /// Queue a particle toggle.
    pub fn queue_particle_toggle(&mut self, toggle: ParticleToggle) {
        self.particle_toggles.push(toggle);
    }

    /// Queue a particle removal.
    pub fn queue_particle_removal(&mut self, removal: ParticleRemoval) {
        self.particle_removals.push(removal);
    }

    /// Queue a particle preset request.
    pub fn queue_particle_preset(&mut self, request: ParticlePresetRequest) {
        self.particle_preset_requests.push(request);
    }

    /// Queue a particle playback action.
    pub fn queue_particle_playback(&mut self, playback: ParticlePlayback) {
        self.particle_playback.push(playback);
    }

    /// Queue an animation request.
    pub fn queue_animation_request(&mut self, request: AnimationRequest) {
        self.animation_requests.push(request);
    }

    /// Queue a shader update.
    pub fn queue_shader_update(&mut self, update: ShaderUpdate) {
        self.shader_updates.push(update);
    }

    /// Queue a shader removal.
    pub fn queue_shader_removal(&mut self, removal: ShaderRemoval) {
        self.shader_removals.push(removal);
    }

    /// Queue a CSG request.
    pub fn queue_csg(&mut self, request: CsgRequest) {
        self.csg_requests.push(request);
    }

    /// Queue a terrain spawn request.
    pub fn queue_terrain_spawn(&mut self, request: TerrainSpawnRequest) {
        self.terrain_spawn_requests.push(request);
    }

    /// Queue a terrain update.
    pub fn queue_terrain_update(&mut self, update: TerrainUpdate) {
        self.terrain_updates.push(update);
    }

    /// Queue a terrain sculpt.
    pub fn queue_terrain_sculpt(&mut self, sculpt: TerrainSculpt) {
        self.terrain_sculpts.push(sculpt);
    }

    /// Queue an extrude request.
    pub fn queue_extrude(&mut self, request: ExtrudeRequest) {
        self.extrude_requests.push(request);
    }

    /// Queue a lathe request.
    pub fn queue_lathe(&mut self, request: LatheRequest) {
        self.lathe_requests.push(request);
    }

    /// Queue an array request.
    pub fn queue_array(&mut self, request: ArrayRequest) {
        self.array_requests.push(request);
    }

    /// Queue a combine request.
    pub fn queue_combine(&mut self, request: CombineRequest) {
        self.combine_requests.push(request);
    }

    /// Queue a quality preset request.
    pub fn queue_quality_preset(&mut self, request: QualityPresetRequest) {
        self.quality_preset_requests.push(request);
    }

    /// Queue an instantiate prefab request.
    pub fn queue_instantiate_prefab(&mut self, request: InstantiatePrefabRequest) {
        self.instantiate_prefab_requests.push(request);
    }
}

// Global instance for bridge access (WASM is single-threaded)
use std::cell::RefCell;

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

/// Queue a transform update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_transform_update_from_bridge(update: TransformUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            // SAFETY: WASM is single-threaded and we control the lifetime
            unsafe {
                (*ptr).queue_transform_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a rename request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_rename_from_bridge(request: RenameRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            // SAFETY: WASM is single-threaded and we control the lifetime
            unsafe {
                (*ptr).queue_rename(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a camera focus request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_camera_focus_from_bridge(request: CameraFocusRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            // SAFETY: WASM is single-threaded and we control the lifetime
            unsafe {
                (*ptr).queue_camera_focus(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a spawn request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_spawn_from_bridge(request: SpawnRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_spawn(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a delete request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_delete_from_bridge(request: DeleteRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_delete(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a duplicate request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_duplicate_from_bridge(request: DuplicateRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_duplicate(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a snap settings update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_snap_settings_update_from_bridge(update: SnapSettingsUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_snap_settings_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a grid toggle from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_grid_toggle_from_bridge() -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_grid_toggle();
            }
            true
        } else {
            false
        }
    })
}

/// Queue a camera preset request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_camera_preset_from_bridge(request: CameraPresetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_camera_preset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a reparent request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_reparent_from_bridge(request: ReparentRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_reparent(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a material update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_material_update_from_bridge(update: MaterialUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_material_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a light update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_light_update_from_bridge(update: LightUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_light_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an ambient light update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_ambient_light_update_from_bridge(update: AmbientLightUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_ambient_light_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an environment update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_environment_update_from_bridge(update: EnvironmentUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_environment_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a selection request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_selection_from_bridge(request: SelectionRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_selection(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a coordinate mode update from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_coordinate_mode_update_from_bridge(mode: CoordinateMode) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_coordinate_mode_update(mode);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a query request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_query_from_bridge(request: QueryRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_query(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a mode change request from the bridge layer.
/// Returns false if the resource isn't registered yet.
pub fn queue_mode_change_from_bridge(request: ModeChangeRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_mode_change(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an input binding update from the bridge layer.
pub fn queue_input_binding_update_from_bridge(update: InputBindingUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_input_binding_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an input preset request from the bridge layer.
pub fn queue_input_preset_from_bridge(request: InputPresetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_input_preset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an input binding removal from the bridge layer.
pub fn queue_input_binding_removal_from_bridge(removal: InputBindingRemoval) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_input_binding_removal(removal);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a physics update from the bridge layer.
pub fn queue_physics_update_from_bridge(update: PhysicsUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_physics_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a physics toggle from the bridge layer.
pub fn queue_physics_toggle_from_bridge(toggle: PhysicsToggle) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_physics_toggle(toggle);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a debug physics toggle from the bridge layer.
pub fn queue_debug_physics_toggle_from_bridge() -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_debug_physics_toggle();
            }
            true
        } else {
            false
        }
    })
}

/// Queue a force application from the bridge layer.
pub fn queue_force_application_from_bridge(application: ForceApplication) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_force_application(application);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a scene export request from the bridge layer.
pub fn queue_scene_export_from_bridge() -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_scene_export();
            }
            true
        } else {
            false
        }
    })
}

/// Queue a scene load request from the bridge layer.
pub fn queue_scene_load_from_bridge(request: SceneLoadRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_scene_load(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a new scene request from the bridge layer.
pub fn queue_new_scene_from_bridge() -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_new_scene();
            }
            true
        } else {
            false
        }
    })
}

/// Queue a glTF import request from the bridge layer.
pub fn queue_gltf_import_from_bridge(request: GltfImportRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_gltf_import(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a texture load request from the bridge layer.
pub fn queue_texture_load_from_bridge(request: TextureLoadRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_texture_load(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a place-asset request from the bridge layer.
pub fn queue_place_asset_from_bridge(request: PlaceAssetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_place_asset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a delete-asset request from the bridge layer.
pub fn queue_delete_asset_from_bridge(request: DeleteAssetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_delete_asset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a remove-texture request from the bridge layer.
pub fn queue_remove_texture_from_bridge(request: RemoveTextureRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_remove_texture(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a script update from the bridge layer.
pub fn queue_script_update_from_bridge(update: ScriptUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_script_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a script removal from the bridge layer.
pub fn queue_script_removal_from_bridge(removal: ScriptRemoval) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_script_removal(removal);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio update from the bridge layer.
pub fn queue_audio_update_from_bridge(update: AudioUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio removal from the bridge layer.
pub fn queue_audio_removal_from_bridge(removal: AudioRemoval) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_removal(removal);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio playback action from the bridge layer.
pub fn queue_audio_playback_from_bridge(playback: AudioPlayback) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_playback(playback);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a post-processing update from the bridge layer.
pub fn queue_post_processing_update_from_bridge(update: PostProcessingUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_post_processing_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio bus update from the bridge layer.
pub fn queue_audio_bus_update_from_bridge(update: AudioBusUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_bus_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio bus creation from the bridge layer.
pub fn queue_audio_bus_create_from_bridge(create: AudioBusCreate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_bus_create(create);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio bus deletion from the bridge layer.
pub fn queue_audio_bus_delete_from_bridge(delete: AudioBusDelete) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_bus_delete(delete);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an audio bus effects update from the bridge layer.
pub fn queue_audio_bus_effects_update_from_bridge(update: AudioBusEffectsUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_audio_bus_effects_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a particle update from the bridge layer.
pub fn queue_particle_update_from_bridge(update: ParticleUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_particle_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a particle toggle from the bridge layer.
pub fn queue_particle_toggle_from_bridge(toggle: ParticleToggle) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_particle_toggle(toggle);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a particle removal from the bridge layer.
pub fn queue_particle_removal_from_bridge(removal: ParticleRemoval) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_particle_removal(removal);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a particle preset request from the bridge layer.
pub fn queue_particle_preset_from_bridge(request: ParticlePresetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_particle_preset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a particle playback action from the bridge layer.
pub fn queue_particle_playback_from_bridge(playback: ParticlePlayback) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_particle_playback(playback);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an animation request from the bridge layer.
pub fn queue_animation_request_from_bridge(request: AnimationRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_animation_request(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a shader update from the bridge layer.
pub fn queue_shader_update_from_bridge(update: ShaderUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_shader_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a shader removal from the bridge layer.
pub fn queue_shader_removal_from_bridge(removal: ShaderRemoval) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_shader_removal(removal);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a CSG request from the bridge layer.
pub fn queue_csg_from_bridge(request: CsgRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_csg(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a terrain spawn request from the bridge layer.
pub fn queue_terrain_spawn_from_bridge(request: TerrainSpawnRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_terrain_spawn(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a terrain update from the bridge layer.
pub fn queue_terrain_update_from_bridge(update: TerrainUpdate) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_terrain_update(update);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a terrain sculpt from the bridge layer.
pub fn queue_terrain_sculpt_from_bridge(sculpt: TerrainSculpt) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_terrain_sculpt(sculpt);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an extrude request from the bridge layer.
pub fn queue_extrude_from_bridge(request: ExtrudeRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_extrude(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a lathe request from the bridge layer.
pub fn queue_lathe_from_bridge(request: LatheRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_lathe(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an array request from the bridge layer.
pub fn queue_array_from_bridge(request: ArrayRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_array(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a combine request from the bridge layer.
pub fn queue_combine_from_bridge(request: CombineRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_combine(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue a quality preset request from the bridge layer.
pub fn queue_quality_preset_from_bridge(request: QualityPresetRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_quality_preset(request);
            }
            true
        } else {
            false
        }
    })
}

/// Queue an instantiate prefab request from the bridge layer.
pub fn queue_instantiate_prefab_from_bridge(request: InstantiatePrefabRequest) -> bool {
    PENDING_COMMANDS.with(|pc| {
        if let Some(ptr) = *pc.borrow() {
            unsafe {
                (*ptr).queue_instantiate_prefab(request);
            }
            true
        } else {
            false
        }
    })
}
