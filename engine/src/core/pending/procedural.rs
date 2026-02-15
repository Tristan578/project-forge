//! CSG, terrain, and procedural mesh pending commands.

use super::PendingCommands;
use crate::core::terrain::TerrainData;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct CsgRequest {
    pub entity_id_a: String,
    pub entity_id_b: String,
    pub operation: crate::core::csg::CsgOperation,
    pub delete_sources: bool,
    pub result_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TerrainSpawnRequest {
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
    pub terrain_data: TerrainData,
}

#[derive(Debug, Clone)]
pub struct TerrainUpdate {
    pub entity_id: String,
    pub terrain_data: TerrainData,
}

#[derive(Debug, Clone)]
pub struct TerrainSculpt {
    pub entity_id: String,
    pub position: [f32; 2],
    pub radius: f32,
    pub strength: f32,
}

#[derive(Debug, Clone)]
pub struct ExtrudeRequest {
    pub shape: String,
    pub radius: f32,
    pub length: f32,
    pub segments: u32,
    pub inner_radius: Option<f32>,
    pub star_points: Option<u32>,
    pub size: Option<f32>,
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
}

#[derive(Debug, Clone)]
pub struct LatheRequest {
    pub profile: Vec<[f32; 2]>,
    pub segments: u32,
    pub name: Option<String>,
    pub position: Option<bevy::math::Vec3>,
}

#[derive(Debug, Clone)]
pub struct ArrayRequest {
    pub entity_id: String,
    pub pattern: String,
    pub count_x: Option<u32>,
    pub count_y: Option<u32>,
    pub count_z: Option<u32>,
    pub spacing_x: Option<f32>,
    pub spacing_y: Option<f32>,
    pub spacing_z: Option<f32>,
    pub circle_count: Option<u32>,
    pub circle_radius: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct CombineRequest {
    pub entity_ids: Vec<String>,
    pub delete_sources: bool,
    pub name: Option<String>,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_csg(&mut self, request: CsgRequest) {
        self.csg_requests.push(request);
    }

    pub fn queue_terrain_spawn(&mut self, request: TerrainSpawnRequest) {
        self.terrain_spawn_requests.push(request);
    }

    pub fn queue_terrain_update(&mut self, update: TerrainUpdate) {
        self.terrain_updates.push(update);
    }

    pub fn queue_terrain_sculpt(&mut self, sculpt: TerrainSculpt) {
        self.terrain_sculpts.push(sculpt);
    }

    pub fn queue_extrude(&mut self, request: ExtrudeRequest) {
        self.extrude_requests.push(request);
    }

    pub fn queue_lathe(&mut self, request: LatheRequest) {
        self.lathe_requests.push(request);
    }

    pub fn queue_array(&mut self, request: ArrayRequest) {
        self.array_requests.push(request);
    }

    pub fn queue_combine(&mut self, request: CombineRequest) {
        self.combine_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_csg_from_bridge(request: CsgRequest) -> bool {
    super::with_pending(|pc| pc.queue_csg(request)).is_some()
}

pub fn queue_terrain_spawn_from_bridge(request: TerrainSpawnRequest) -> bool {
    super::with_pending(|pc| pc.queue_terrain_spawn(request)).is_some()
}

pub fn queue_terrain_update_from_bridge(update: TerrainUpdate) -> bool {
    super::with_pending(|pc| pc.queue_terrain_update(update)).is_some()
}

pub fn queue_terrain_sculpt_from_bridge(sculpt: TerrainSculpt) -> bool {
    super::with_pending(|pc| pc.queue_terrain_sculpt(sculpt)).is_some()
}

pub fn queue_extrude_from_bridge(request: ExtrudeRequest) -> bool {
    super::with_pending(|pc| pc.queue_extrude(request)).is_some()
}

pub fn queue_lathe_from_bridge(request: LatheRequest) -> bool {
    super::with_pending(|pc| pc.queue_lathe(request)).is_some()
}

pub fn queue_array_from_bridge(request: ArrayRequest) -> bool {
    super::with_pending(|pc| pc.queue_array(request)).is_some()
}

pub fn queue_combine_from_bridge(request: CombineRequest) -> bool {
    super::with_pending(|pc| pc.queue_combine(request)).is_some()
}
