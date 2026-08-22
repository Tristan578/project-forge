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
    /// Every 2D joint in the scene. Answered by `bridge::query::process_joint2d_queries`.
    ListJoints2d,
    /// One entity's 2D joint. Answered by the same system, which replies on the
    /// existing `JOINT2D_CHANGED` channel rather than inventing a second wire
    /// shape for a single joint (PF-1194).
    Joint2dState { entity_id: String },
    GameComponentState { entity_id: String },
    GameCameraState { entity_id: String },
    AnimationClipState { entity_id: String },
    SpriteState { entity_id: String },
    Camera2dState,
    ProjectType,
    Skeleton2dState { entity_id: String },
    SpriteSheetState { entity_id: String },
    SpriteAnimatorState { entity_id: String },
    PlayState,
    GameComponentTypes,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_query(&mut self, request: QueryRequest) {
        self.query_requests.push(request);
    }

    /// Remove and return every queued query request matching `pred`, leaving
    /// every other pending read untouched.
    ///
    /// The obvious spelling — `query_requests.drain(..).filter(pred)` — empties
    /// the WHOLE queue and keeps only the matches, silently destroying every
    /// other system's pending reads. That shipped in `handle_physics2d_query`
    /// and made whichever query system happened to run first the only one that
    /// ever answered (PF-1194). Bridge systems are wasm32-only and cannot be
    /// unit-tested natively, so the retention logic lives here — one
    /// implementation with native tests, rather than the same read-then-retain
    /// dance hand-written at every call site.
    pub fn take_queries(&mut self, pred: impl Fn(&QueryRequest) -> bool) -> Vec<QueryRequest> {
        let mut taken = Vec::new();
        let mut kept = Vec::with_capacity(self.query_requests.len());
        for request in self.query_requests.drain(..) {
            if pred(&request) {
                taken.push(request);
            } else {
                kept.push(request);
            }
        }
        self.query_requests = kept;
        taken
    }
}

// === Bridge Functions ===

pub fn queue_query_from_bridge(request: QueryRequest) -> bool {
    super::with_pending(|pc| pc.queue_query(request)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue(pc: &mut PendingCommands, requests: Vec<QueryRequest>) {
        for request in requests {
            pc.queue_query(request);
        }
    }

    /// The assertion that fails on a revert to `drain(..).filter(..)`: the
    /// requests the predicate rejects must STILL be in the queue afterwards.
    #[test]
    fn take_queries_leaves_non_matching_requests_in_the_queue() {
        let mut pc = PendingCommands::default();
        queue(
            &mut pc,
            vec![
                QueryRequest::SceneGraph,
                QueryRequest::Physics2dState { entity_id: "a".into() },
                QueryRequest::Selection,
                QueryRequest::ListJoints,
            ],
        );

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::Physics2dState { .. }));

        assert_eq!(taken.len(), 1);
        assert!(matches!(&taken[0], QueryRequest::Physics2dState { entity_id } if entity_id == "a"));
        assert_eq!(pc.query_requests.len(), 3);
        assert!(matches!(pc.query_requests[0], QueryRequest::SceneGraph));
        assert!(matches!(pc.query_requests[1], QueryRequest::Selection));
        assert!(matches!(pc.query_requests[2], QueryRequest::ListJoints));
    }

    #[test]
    fn take_queries_returns_every_match_in_queue_order() {
        let mut pc = PendingCommands::default();
        queue(
            &mut pc,
            vec![
                QueryRequest::Joint2dState { entity_id: "first".into() },
                QueryRequest::SceneGraph,
                QueryRequest::Joint2dState { entity_id: "second".into() },
            ],
        );

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::Joint2dState { .. }));

        let ids: Vec<String> = taken
            .iter()
            .map(|r| match r {
                QueryRequest::Joint2dState { entity_id } => entity_id.clone(),
                other => panic!("unexpected request {other:?}"),
            })
            .collect();
        assert_eq!(ids, vec!["first".to_string(), "second".to_string()]);
        assert_eq!(pc.query_requests.len(), 1);
        assert!(matches!(pc.query_requests[0], QueryRequest::SceneGraph));
    }

    #[test]
    fn take_queries_with_no_match_is_a_no_op() {
        let mut pc = PendingCommands::default();
        queue(&mut pc, vec![QueryRequest::SceneGraph, QueryRequest::Selection]);

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d));

        assert!(taken.is_empty());
        assert_eq!(pc.query_requests.len(), 2);
    }

    /// A second call must not re-answer an already-taken request: this is what
    /// stops a query system emitting the same reply on every frame.
    #[test]
    fn take_queries_is_not_repeatable_for_the_same_request() {
        let mut pc = PendingCommands::default();
        queue(&mut pc, vec![QueryRequest::ListJoints2d, QueryRequest::SceneGraph]);

        assert_eq!(pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d)).len(), 1);
        assert_eq!(pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d)).len(), 0);
        assert_eq!(pc.query_requests.len(), 1);
    }
}
