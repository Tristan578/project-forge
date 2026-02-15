//! LOD and performance pending commands.

use super::PendingCommands;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct SetLodRequest {
    pub entity_id: String,
    pub lod_distances: [f32; 3],
    pub auto_generate: bool,
    pub lod_ratios: [f32; 3],
}

#[derive(Debug, Clone)]
pub struct GenerateLodsRequest {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct SetPerformanceBudgetRequest {
    pub max_triangles: u32,
    pub max_draw_calls: u32,
    pub target_fps: f32,
    pub warning_threshold: f32,
}

#[derive(Debug, Clone)]
pub struct GetPerformanceStatsRequest;

#[derive(Debug, Clone)]
pub struct OptimizeSceneRequest;

#[derive(Debug, Clone)]
pub struct SetLodDistancesRequest {
    pub distances: [f32; 3],
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_set_lod(&mut self, request: SetLodRequest) {
        self.set_lod_requests.push(request);
    }

    pub fn queue_generate_lods(&mut self, request: GenerateLodsRequest) {
        self.generate_lods_requests.push(request);
    }

    pub fn queue_set_performance_budget(&mut self, request: SetPerformanceBudgetRequest) {
        self.set_performance_budget_requests.push(request);
    }

    pub fn queue_get_performance_stats(&mut self, request: GetPerformanceStatsRequest) {
        self.get_performance_stats_requests.push(request);
    }

    pub fn queue_optimize_scene(&mut self, request: OptimizeSceneRequest) {
        self.optimize_scene_requests.push(request);
    }

    pub fn queue_set_lod_distances(&mut self, request: SetLodDistancesRequest) {
        self.set_lod_distances_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn bridge_set_lod(
    entity_id: String,
    lod_distances: [f32; 3],
    auto_generate: bool,
    lod_ratios: [f32; 3],
) {
    super::with_pending(|pc| {
        pc.queue_set_lod(SetLodRequest {
            entity_id,
            lod_distances,
            auto_generate,
            lod_ratios,
        });
    });
}

pub fn bridge_generate_lods(entity_id: String) {
    super::with_pending(|pc| {
        pc.queue_generate_lods(GenerateLodsRequest { entity_id });
    });
}

pub fn bridge_set_performance_budget(
    max_triangles: u32,
    max_draw_calls: u32,
    target_fps: f32,
    warning_threshold: f32,
) {
    super::with_pending(|pc| {
        pc.queue_set_performance_budget(SetPerformanceBudgetRequest {
            max_triangles,
            max_draw_calls,
            target_fps,
            warning_threshold,
        });
    });
}

pub fn bridge_get_performance_stats() {
    super::with_pending(|pc| {
        pc.queue_get_performance_stats(GetPerformanceStatsRequest);
    });
}

pub fn bridge_optimize_scene() {
    super::with_pending(|pc| {
        pc.queue_optimize_scene(OptimizeSceneRequest);
    });
}

pub fn bridge_set_lod_distances(distances: [f32; 3]) {
    super::with_pending(|pc| {
        pc.queue_set_lod_distances(SetLodDistancesRequest { distances });
    });
}
