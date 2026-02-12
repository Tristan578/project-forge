//! Event types for engine <-> frontend communication.
//!
//! These are pure Rust types that get serialized/deserialized at the bridge layer.

use serde::{Deserialize, Serialize};

/// Events sent from the frontend to the engine
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum InboundEvent {
    /// Initialize the engine with a canvas
    Init { canvas_id: String },

    /// Update the entire scene graph
    UpdateScene { scene: SceneGraph },

    /// Spawn a new entity
    SpawnEntity { entity: EntityDef },

    /// Remove an entity
    DespawnEntity { id: String },

    /// Update an entity's transform
    UpdateTransform { id: String, transform: Transform },

    /// Set camera properties
    SetCamera { camera: CameraDef },
}

/// Events sent from the engine to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum OutboundEvent {
    /// Engine ready notification
    Ready,

    /// Engine error
    Error { message: String },

    /// Frame rendered (for performance tracking)
    FrameRendered { frame: u64, delta_ms: f32 },

    /// Entity was clicked/selected
    EntitySelected { id: String },
}

/// Scene graph definition
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct SceneGraph {
    pub entities: Vec<EntityDef>,
}

/// Entity definition
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EntityDef {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub transform: Transform,
    #[serde(default)]
    pub mesh: Option<MeshDef>,
    #[serde(default)]
    pub material: Option<MaterialDef>,
    #[serde(default)]
    pub children: Vec<EntityDef>,
}

/// Transform component
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Transform {
    #[serde(default)]
    pub position: [f32; 3],
    #[serde(default)]
    pub rotation: [f32; 4], // Quaternion [x, y, z, w]
    #[serde(default = "default_scale")]
    pub scale: [f32; 3],
}

fn default_scale() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

/// Mesh definition
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum MeshDef {
    Cube { size: f32 },
    Sphere { radius: f32 },
    Plane { width: f32, height: f32 },
    Custom { asset_path: String },
}

/// Material definition
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MaterialDef {
    #[serde(default = "default_color")]
    pub color: [f32; 4], // RGBA
    #[serde(default)]
    pub texture: Option<String>,
    #[serde(default)]
    pub metallic: f32,
    #[serde(default = "default_roughness")]
    pub roughness: f32,
}

fn default_color() -> [f32; 4] {
    [1.0, 1.0, 1.0, 1.0]
}

fn default_roughness() -> f32 {
    0.5
}

/// Camera definition
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CameraDef {
    pub position: [f32; 3],
    pub target: [f32; 3],
    #[serde(default = "default_fov")]
    pub fov: f32,
    #[serde(default = "default_near")]
    pub near: f32,
    #[serde(default = "default_far")]
    pub far: f32,
}

fn default_fov() -> f32 {
    60.0
}

fn default_near() -> f32 {
    0.1
}

fn default_far() -> f32 {
    1000.0
}
