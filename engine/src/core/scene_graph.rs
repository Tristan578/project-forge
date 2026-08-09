//! Scene graph tracking and serialization.
//!
//! Tracks all entities with EntityId and serializes them for the React hierarchy panel.
//! Emits SCENE_GRAPH_UPDATE events when the graph changes.

use bevy::prelude::*;
use serde::Serialize;
use std::collections::HashMap;

use super::audio::{AudioData, AudioEnabled};
use super::entity_id::{EntityId, EntityName, EntityVisible};
use super::game_components::GameComponents;
use super::particles::{ParticleData, ParticleEnabled};
use super::physics::{PhysicsData, PhysicsEnabled};
use super::scripting::ScriptData;
use super::terrain::TerrainEnabled;

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

/// What the node query yields for one entity.
type NodeHit<'a> = (
    Entity,
    &'a EntityId,
    Option<&'a EntityName>,
    Option<&'a EntityVisible>,
    Option<&'a ChildOf>,
    Option<&'a Children>,
);

/// What `visual_query` yields for one entity.
type VisualHit<'a> = (
    Option<&'a Mesh3d>,
    Option<&'a PointLight>,
    Option<&'a DirectionalLight>,
    Option<&'a SpotLight>,
    Option<&'a TerrainEnabled>,
);

/// What `gameplay_query` yields for one entity.
type GameplayHit<'a> = (
    Option<&'a PhysicsData>,
    Option<&'a PhysicsEnabled>,
    Option<&'a AudioData>,
    Option<&'a AudioEnabled>,
    Option<&'a ScriptData>,
    Option<&'a ParticleData>,
    Option<&'a ParticleEnabled>,
    Option<&'a GameComponents>,
);

/// System that builds the scene graph from entities.
///
/// The detection queries are split in two only to stay clear of Bevy's 15-wide
/// query tuple limit; the split carries no meaning. Both are all-`Option<&T>`,
/// so they match every entity and `.get(entity)` always resolves.
pub fn build_scene_graph(
    query: Query<NodeHit<'static>>,
    parent_query: Query<&EntityId>,
    visual_query: Query<VisualHit<'static>>,
    gameplay_query: Query<GameplayHit<'static>>,
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
        let components = detect_components(
            visual_query.get(entity).ok(),
            gameplay_query.get(entity).ok(),
        );

        let node = SceneNodeData {
            entity_id: id.clone(),
            name: name.map(|n| n.0.clone()).unwrap_or_else(|| "Entity".to_string()),
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

/// Detect what notable components an entity has.
///
/// The emitted strings are the Rust type names, and they are a WIRE CONTRACT:
/// `SceneNodeData` carries no entity-type field, so the JS side classifies every
/// entity by matching these names as string literals — `'PhysicsData'`,
/// `'PointLight'`, `'Mesh3d'` and the rest appear in a dozen editor surfaces
/// (light counts, the entity picker, LOD gating, the physics-feel panel, the
/// scene statistics). Renaming one here silently returns that consumer to its
/// fallback branch; it is a breaking change, not a refactor.
fn detect_components(visual: Option<VisualHit<'_>>, gameplay: Option<GameplayHit<'_>>) -> Vec<String> {
    let (mesh, point, directional, spot, terrain) = visual.unwrap_or_default();
    let (physics, physics_enabled, audio, audio_enabled, script, particle, particle_enabled, game) =
        gameplay.unwrap_or_default();

    [
        (mesh.is_some(), "Mesh3d"),
        (point.is_some(), "PointLight"),
        (directional.is_some(), "DirectionalLight"),
        (spot.is_some(), "SpotLight"),
        (terrain.is_some(), "TerrainEnabled"),
        (physics.is_some(), "PhysicsData"),
        (physics_enabled.is_some(), "PhysicsEnabled"),
        (audio.is_some(), "AudioData"),
        (audio_enabled.is_some(), "AudioEnabled"),
        (script.is_some(), "ScriptData"),
        (particle.is_some(), "ParticleData"),
        (particle_enabled.is_some(), "ParticleEnabled"),
        (game.is_some(), "GameComponents"),
    ]
    .into_iter()
    .filter(|(present, _)| *present)
    .map(|(_, name)| name.to_string())
    .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs `build_scene_graph` once and returns the (sorted) component list the
    /// named node reports. Sorting keeps assertions independent of the order the
    /// detector happens to push names in.
    fn components_for(world: &mut World, id: &str) -> Vec<String> {
        let mut schedule = Schedule::default();
        schedule.add_systems(build_scene_graph);
        schedule.run(world);

        let cache = world.resource::<SceneGraphCache>();
        let node = cache
            .data
            .nodes
            .get(id)
            .unwrap_or_else(|| panic!("scene graph has no node '{id}'"));
        let mut names = node.components.clone();
        names.sort();
        names
    }

    fn world_with_cache() -> World {
        let mut world = World::new();
        world.insert_resource(SceneGraphCache::default());
        world
    }

    fn script() -> ScriptData {
        ScriptData {
            source: "// noop".to_string(),
            enabled: true,
            template: None,
        }
    }

    #[test]
    fn reports_physics_components() {
        let mut world = world_with_cache();
        world.spawn((
            EntityId("phys".to_string()),
            PhysicsData::default(),
            PhysicsEnabled,
        ));

        assert_eq!(
            components_for(&mut world, "phys"),
            vec!["PhysicsData".to_string(), "PhysicsEnabled".to_string()],
        );
    }

    #[test]
    fn reports_light_type_by_exact_name() {
        let mut world = world_with_cache();
        world.spawn((EntityId("point".to_string()), PointLight::default()));
        world.spawn((EntityId("dir".to_string()), DirectionalLight::default()));
        world.spawn((EntityId("spot".to_string()), SpotLight::default()));

        assert_eq!(
            components_for(&mut world, "point"),
            vec!["PointLight".to_string()],
        );
        assert_eq!(
            components_for(&mut world, "dir"),
            vec!["DirectionalLight".to_string()],
        );
        assert_eq!(
            components_for(&mut world, "spot"),
            vec!["SpotLight".to_string()],
        );
    }

    #[test]
    fn reports_mesh_and_terrain() {
        let mut world = world_with_cache();
        world.spawn((
            EntityId("ground".to_string()),
            Mesh3d(Handle::default()),
            TerrainEnabled,
        ));

        assert_eq!(
            components_for(&mut world, "ground"),
            vec!["Mesh3d".to_string(), "TerrainEnabled".to_string()],
        );
    }

    #[test]
    fn reports_script_audio_particle_and_game_components() {
        let mut world = world_with_cache();
        world.spawn((
            EntityId("player".to_string()),
            script(),
            AudioData::default(),
            AudioEnabled,
            ParticleData::default(),
            ParticleEnabled,
            GameComponents::default(),
        ));

        assert_eq!(
            components_for(&mut world, "player"),
            vec![
                "AudioData".to_string(),
                "AudioEnabled".to_string(),
                "GameComponents".to_string(),
                "ParticleData".to_string(),
                "ParticleEnabled".to_string(),
                "ScriptData".to_string(),
            ],
        );
    }

    #[test]
    fn entity_with_no_notable_components_reports_none() {
        let mut world = world_with_cache();
        world.spawn(EntityId("bare".to_string()));

        assert!(components_for(&mut world, "bare").is_empty());
    }

    #[test]
    fn detection_is_per_entity_not_shared() {
        // A detector built from all-`Option<&T>` queries matches EVERY entity, so
        // a lookup that ignored the entity would hand the same list to all of
        // them. Two entities with disjoint components prove the per-entity path.
        let mut world = world_with_cache();
        world.spawn((EntityId("a".to_string()), PhysicsEnabled));
        world.spawn((EntityId("b".to_string()), AudioEnabled));

        assert_eq!(
            components_for(&mut world, "a"),
            vec!["PhysicsEnabled".to_string()],
        );
        assert_eq!(
            components_for(&mut world, "b"),
            vec!["AudioEnabled".to_string()],
        );
    }
}
