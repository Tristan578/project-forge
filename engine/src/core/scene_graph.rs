//! Scene graph tracking and serialization.
//!
//! Tracks all entities with EntityId and serializes them for the React hierarchy panel.
//! Emits SCENE_GRAPH_UPDATE events when the graph changes.

use bevy::prelude::*;
use serde::Serialize;
use std::collections::HashMap;

use super::entity_id::{EntityId, EntityName, EntityVisible};

/// Data for a single node in the scene graph.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SceneNodeData {
    pub entity_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub children: Vec<String>,
    pub components: Vec<String>,
    pub visible: bool,
}

/// Full scene graph data sent to React.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneGraphData {
    pub nodes: HashMap<String, SceneNodeData>,
    pub root_ids: Vec<String>,
}

/// Resource that caches the current scene graph.
#[derive(Resource, Default)]
pub struct SceneGraphCache {
    pub data: SceneGraphData,
    pub dirty: bool,
}

/// Event fired when scene graph needs to be sent to React.
#[derive(Event)]
pub struct SceneGraphUpdateEvent {
    pub data: SceneGraphData,
}

/// System that builds the scene graph from entities.
pub fn build_scene_graph(
    query: Query<(
        Entity,
        &EntityId,
        Option<&EntityName>,
        Option<&EntityVisible>,
        Option<&ChildOf>,
        Option<&Children>,
    )>,
    parent_query: Query<&EntityId>,
    mut cache: ResMut<SceneGraphCache>,
) {
    let mut nodes = HashMap::new();
    let mut root_ids = Vec::new();

    for (entity, entity_id, name, visible, child_of, children) in query.iter() {
        let id = entity_id.0.clone();

        // Get parent ID if exists
        let parent_id = child_of.and_then(|c| {
            parent_query.get(c.parent()).ok().map(|pid| pid.0.clone())
        });

        // Get children IDs
        let child_ids: Vec<String> = children
            .map(|c| {
                c.iter()
                    .filter_map(|child| parent_query.get(child).ok().map(|cid| cid.0.clone()))
                    .collect()
            })
            .unwrap_or_default();

        // Build component list (for icons in hierarchy)
        let components = detect_components(entity);

        let node = SceneNodeData {
            entity_id: id.clone(),
            name: name.map(|n| n.0.clone()).unwrap_or_else(|| format!("Entity")),
            parent_id: parent_id.clone(),
            children: child_ids,
            components,
            visible: visible.map(|v| v.0).unwrap_or(true),
        };

        // Track root nodes
        if parent_id.is_none() {
            root_ids.push(id.clone());
        }

        nodes.insert(id, node);
    }

    cache.data = SceneGraphData { nodes, root_ids };
    cache.dirty = true;
}

/// Detect what notable components an entity has (for hierarchy icons).
fn detect_components(_entity: Entity) -> Vec<String> {
    // TODO: Once we have more component types, detect them here
    // For now, return empty - can add "mesh", "light", "camera", etc.
    vec![]
}

/// System that detects when entities with EntityId are added.
pub fn detect_entity_added(
    query: Query<&EntityId, Added<EntityId>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    if !query.is_empty() {
        cache.dirty = true;
    }
}

/// System that detects when entities with EntityId are removed.
pub fn detect_entity_removed(
    mut removed: RemovedComponents<EntityId>,
    mut cache: ResMut<SceneGraphCache>,
) {
    if removed.read().next().is_some() {
        cache.dirty = true;
    }
}

/// System that detects when entity names change.
pub fn detect_name_changed(
    query: Query<&EntityId, Changed<EntityName>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    if !query.is_empty() {
        cache.dirty = true;
    }
}

/// System that detects when visibility changes.
pub fn detect_visibility_changed(
    query: Query<&EntityId, Changed<EntityVisible>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    if !query.is_empty() {
        cache.dirty = true;
    }
}

/// System that detects when parent relationships change.
pub fn detect_parent_changed(
    query: Query<&EntityId, Changed<ChildOf>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    if !query.is_empty() {
        cache.dirty = true;
    }
}
