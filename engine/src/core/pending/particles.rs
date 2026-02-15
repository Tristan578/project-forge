//! Particle system pending commands.

use super::PendingCommands;
use crate::core::particles::ParticleData;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct ParticleUpdate {
    pub entity_id: String,
    pub particle_data: ParticleData,
}

#[derive(Debug, Clone)]
pub struct ParticleToggle {
    pub entity_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct ParticleRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct ParticlePresetRequest {
    pub entity_id: String,
    pub preset: String,
}

#[derive(Debug, Clone)]
pub struct ParticlePlayback {
    pub entity_id: String,
    pub action: String,
    pub burst_count: Option<u32>,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_particle_update(&mut self, update: ParticleUpdate) {
        self.particle_updates.push(update);
    }

    pub fn queue_particle_toggle(&mut self, toggle: ParticleToggle) {
        self.particle_toggles.push(toggle);
    }

    pub fn queue_particle_removal(&mut self, removal: ParticleRemoval) {
        self.particle_removals.push(removal);
    }

    pub fn queue_particle_preset(&mut self, request: ParticlePresetRequest) {
        self.particle_preset_requests.push(request);
    }

    pub fn queue_particle_playback(&mut self, playback: ParticlePlayback) {
        self.particle_playback.push(playback);
    }
}

// === Bridge Functions ===

pub fn queue_particle_update_from_bridge(update: ParticleUpdate) -> bool {
    super::with_pending(|pc| pc.queue_particle_update(update)).is_some()
}

pub fn queue_particle_toggle_from_bridge(toggle: ParticleToggle) -> bool {
    super::with_pending(|pc| pc.queue_particle_toggle(toggle)).is_some()
}

pub fn queue_particle_removal_from_bridge(removal: ParticleRemoval) -> bool {
    super::with_pending(|pc| pc.queue_particle_removal(removal)).is_some()
}

pub fn queue_particle_preset_from_bridge(request: ParticlePresetRequest) -> bool {
    super::with_pending(|pc| pc.queue_particle_preset(request)).is_some()
}

pub fn queue_particle_playback_from_bridge(playback: ParticlePlayback) -> bool {
    super::with_pending(|pc| pc.queue_particle_playback(playback)).is_some()
}
