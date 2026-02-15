//! Query request pending commands (for MCP resource reads).

use super::PendingCommands;

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
    Physics2dState { entity_id: String },
    AssetList,
    ScriptData { entity_id: String },
    ScriptTemplates,
    AudioData { entity_id: String },
    PostProcessingState,
    AudioBuses,
    ReverbZoneState { entity_id: String },
    ParticleState { entity_id: String },
    AnimationState { entity_id: String },
    AnimationGraph { entity_id: String },
    ShaderData { entity_id: String },
    TerrainState { entity_id: String },
    QualitySettings,
    ListJoints,
    GameComponentState { entity_id: String },
    GameCameraState { entity_id: String },
    AnimationClipState { entity_id: String },
    SpriteState { entity_id: String },
    Camera2dState,
    ProjectType,
    Skeleton2dState { entity_id: String },
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_query(&mut self, request: QueryRequest) {
        self.query_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_query_from_bridge(request: QueryRequest) -> bool {
    super::with_pending(|pc| pc.queue_query(request)).is_some()
}
