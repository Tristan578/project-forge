//! Scene, asset, and prefab pending commands.

use serde::{Deserialize, Serialize};
use super::PendingCommands;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct GltfImportRequest {
    pub asset_id: Option<String>,
    pub data_base64: String,
    pub name: String,
    pub position: Option<bevy::math::Vec3>,
    /// When `Some(id)` and an entity with that EntityId exists with no children,
    /// the import attaches to that existing entity in place (preserving its
    /// EntityId / Transform / name) instead of spawning a new root entity.
    pub target_entity_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TextureLoadRequest {
    pub data_base64: String,
    pub name: String,
    pub entity_id: String,
    pub slot: String,
}

#[derive(Debug, Clone)]
pub struct PlaceAssetRequest {
    pub asset_id: String,
    pub position: Option<bevy::math::Vec3>,
}

#[derive(Debug, Clone)]
pub struct DeleteAssetRequest {
    pub asset_id: String,
}

#[derive(Debug, Clone)]
pub struct RemoveTextureRequest {
    pub entity_id: String,
    pub slot: String,
}

/// One caller's request for a scene export.
///
/// `request_id` is the correlation token echoed back on the `SCENE_EXPORTED`
/// event so a listener can tell its own answer from someone else's (PF-1103).
/// It is `Option` because `export_scene` has always been callable with no
/// payload, and a caller that does not care about correlation (the periodic
/// autosave, the chat tool) still must not be forced to mint one.
#[derive(Debug, Clone, Default)]
pub struct SceneExportRequest {
    pub request_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SceneLoadRequest {
    pub json: String,
}

#[derive(Debug, Clone)]
pub struct NewSceneRequest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiatePrefabRequest {
    pub snapshot_json: String,
    pub position: Option<[f32; 3]>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AudioImportRequest {
    pub asset_id: Option<String>,
    pub data_base64: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct QualityPresetRequest {
    pub preset: String,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_scene_export(&mut self, request: SceneExportRequest) {
        self.scene_export_requests.push(request);
    }

    pub fn queue_scene_load(&mut self, request: SceneLoadRequest) {
        self.scene_load_requests.push(request);
    }

    pub fn queue_new_scene(&mut self) {
        self.new_scene_requests.push(NewSceneRequest);
    }

    pub fn queue_gltf_import(&mut self, request: GltfImportRequest) {
        self.gltf_import_requests.push(request);
    }

    pub fn queue_texture_load(&mut self, request: TextureLoadRequest) {
        self.texture_load_requests.push(request);
    }

    pub fn queue_place_asset(&mut self, request: PlaceAssetRequest) {
        self.place_asset_requests.push(request);
    }

    pub fn queue_delete_asset(&mut self, request: DeleteAssetRequest) {
        self.delete_asset_requests.push(request);
    }

    pub fn queue_remove_texture(&mut self, request: RemoveTextureRequest) {
        self.remove_texture_requests.push(request);
    }

    pub fn queue_audio_import(&mut self, request: AudioImportRequest) {
        self.audio_import_requests.push(request);
    }

    pub fn queue_quality_preset(&mut self, request: QualityPresetRequest) {
        self.quality_preset_requests.push(request);
    }

    pub fn queue_instantiate_prefab(&mut self, request: InstantiatePrefabRequest) {
        self.instantiate_prefab_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_scene_export_from_bridge(request: SceneExportRequest) -> bool {
    super::with_pending(|pc| pc.queue_scene_export(request)).is_some()
}

pub fn queue_scene_load_from_bridge(request: SceneLoadRequest) -> bool {
    super::with_pending(|pc| pc.queue_scene_load(request)).is_some()
}

pub fn queue_new_scene_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_new_scene()).is_some()
}

pub fn queue_gltf_import_from_bridge(request: GltfImportRequest) -> bool {
    super::with_pending(|pc| pc.queue_gltf_import(request)).is_some()
}

pub fn queue_texture_load_from_bridge(request: TextureLoadRequest) -> bool {
    super::with_pending(|pc| pc.queue_texture_load(request)).is_some()
}

pub fn queue_place_asset_from_bridge(request: PlaceAssetRequest) -> bool {
    super::with_pending(|pc| pc.queue_place_asset(request)).is_some()
}

pub fn queue_delete_asset_from_bridge(request: DeleteAssetRequest) -> bool {
    super::with_pending(|pc| pc.queue_delete_asset(request)).is_some()
}

pub fn queue_remove_texture_from_bridge(request: RemoveTextureRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_texture(request)).is_some()
}

pub fn queue_audio_import_from_bridge(request: AudioImportRequest) -> bool {
    super::with_pending(|pc| pc.queue_audio_import(request)).is_some()
}

pub fn queue_quality_preset_from_bridge(request: QualityPresetRequest) -> bool {
    super::with_pending(|pc| pc.queue_quality_preset(request)).is_some()
}

pub fn queue_instantiate_prefab_from_bridge(request: InstantiatePrefabRequest) -> bool {
    super::with_pending(|pc| pc.queue_instantiate_prefab(request)).is_some()
}

// === Export correlation ===

/// Collapse one frame's queued export requests into the minimal set of
/// correlation ids that have to be echoed back on `SCENE_EXPORTED`.
///
/// Every emitted event re-runs the web side's whole persistence chain
/// (`setLastExportedScene`, the localStorage autosave, the sessionStorage
/// backup, a store write and a DOM re-broadcast) against a scene JSON that can
/// reach `MAX_SCENE_JSON_BYTES`, so an event that no listener needs is not
/// merely redundant — it is another full multi-megabyte write.
///
/// Correlation only needs one event per *distinct* id. Id-less events are
/// accepted by any waiting listener, so a second one answers nobody: at most
/// one is emitted no matter how many id-less requests coalesced into the frame.
/// One is still emitted, because the back-compat listeners and the autosave
/// side effects hang off it.
///
/// Order follows first appearance in the queue, so the earliest caller is
/// answered first.
pub fn export_correlation_ids(requests: &[SceneExportRequest]) -> Vec<Option<&str>> {
    let mut ids: Vec<Option<&str>> = Vec::new();
    for request in requests {
        let id = request.request_id.as_deref();
        // Linear scan rather than a set: a frame carries a handful of requests
        // at most, so this never grows into the hot path, and it keeps first
        // appearance as the emission order for free.
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

#[cfg(test)]
mod export_correlation_tests {
    use super::{export_correlation_ids, SceneExportRequest};

    fn req(id: Option<&str>) -> SceneExportRequest {
        SceneExportRequest {
            request_id: id.map(str::to_owned),
        }
    }

    /// The single-caller case, correlated and not — one request, one event.
    #[test]
    fn a_single_request_yields_exactly_one_event() {
        assert_eq!(export_correlation_ids(&[req(None)]), vec![None]);
        assert_eq!(export_correlation_ids(&[req(Some("a"))]), vec![Some("a")]);
    }

    /// Two uncorrelated callers in the same frame must NOT double-write the
    /// scene. An id-less event is accepted by every waiting listener, so the
    /// second one answers nobody while still re-running the full persistence
    /// chain against the same multi-megabyte JSON.
    #[test]
    fn id_less_requests_collapse_to_one_event() {
        assert_eq!(
            export_correlation_ids(&[req(None), req(None), req(None)]),
            vec![None],
        );
    }

    /// Each distinct correlation id still gets its own event — collapsing those
    /// would strand a caller waiting on an answer that never arrives.
    #[test]
    fn distinct_ids_each_get_their_own_event() {
        assert_eq!(
            export_correlation_ids(&[req(Some("a")), req(Some("b")), req(None)]),
            vec![Some("a"), Some("b"), None],
        );
    }

    /// A repeated id is one caller, however many times it queued — one event.
    #[test]
    fn repeated_ids_collapse_to_one_event_each() {
        assert_eq!(
            export_correlation_ids(&[req(Some("a")), req(Some("b")), req(Some("a"))]),
            vec![Some("a"), Some("b")],
        );
    }

    /// Order follows first appearance, so the earliest caller is answered
    /// first even when a later duplicate would otherwise reorder the set.
    #[test]
    fn order_follows_first_appearance() {
        assert_eq!(
            export_correlation_ids(&[req(None), req(Some("b")), req(None), req(Some("a"))]),
            vec![None, Some("b"), Some("a")],
        );
    }

    /// An empty queue emits nothing. `apply_scene_export` returns before
    /// building the JSON in that case, but the helper must not invent an event
    /// if that guard is ever restructured.
    #[test]
    fn an_empty_queue_emits_nothing() {
        assert!(export_correlation_ids(&[]).is_empty());
    }
}
