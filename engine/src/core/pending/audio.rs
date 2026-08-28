//! Audio and reverb zone pending commands.

use super::PendingCommands;
use crate::core::audio::AudioEffectDef;
use crate::core::reverb_zone::{ReverbZoneCommand, ReverbZoneResync};

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct ScriptUpdate {
    pub entity_id: String,
    pub source: String,
    pub enabled: bool,
    pub template: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ScriptRemoval {
    pub entity_id: String,
}

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
    pub bus: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AudioRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct AudioPlayback {
    pub entity_id: String,
    pub action: String,
    pub volume: Option<f32>,
    pub pitch: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct AudioBusUpdate {
    pub bus_name: String,
    pub volume: Option<f32>,
    pub muted: Option<bool>,
    pub soloed: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AudioBusCreate {
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub soloed: bool,
}

#[derive(Debug, Clone)]
pub struct AudioBusDelete {
    pub bus_name: String,
}

#[derive(Debug, Clone)]
pub struct AudioBusEffectsUpdate {
    pub bus_name: String,
    pub effects: Vec<AudioEffectDef>,
}

// Reverb zone commands share ONE ordered queue — see `ReverbZoneCommand` in
// `core/reverb_zone.rs` for why a queue per command kind cannot express "the
// later command wins".

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_script_update(&mut self, update: ScriptUpdate) {
        self.script_updates.push(update);
    }

    pub fn queue_script_removal(&mut self, removal: ScriptRemoval) {
        self.script_removals.push(removal);
    }

    pub fn queue_audio_update(&mut self, update: AudioUpdate) {
        self.audio_updates.push(update);
    }

    pub fn queue_audio_removal(&mut self, removal: AudioRemoval) {
        self.audio_removals.push(removal);
    }

    pub fn queue_audio_playback(&mut self, playback: AudioPlayback) {
        self.audio_playback.push(playback);
    }

    pub fn queue_audio_bus_update(&mut self, update: AudioBusUpdate) {
        self.audio_bus_updates.push(update);
    }

    pub fn queue_audio_bus_create(&mut self, create: AudioBusCreate) {
        self.audio_bus_creates.push(create);
    }

    pub fn queue_audio_bus_delete(&mut self, delete: AudioBusDelete) {
        self.audio_bus_deletes.push(delete);
    }

    pub fn queue_audio_bus_effects_update(&mut self, update: AudioBusEffectsUpdate) {
        self.audio_bus_effects_updates.push(update);
    }

    pub fn queue_reverb_zone_command(&mut self, command: ReverbZoneCommand) {
        self.reverb_zone_commands.push(command);
    }

    pub fn queue_reverb_zone_resync(&mut self, resync: ReverbZoneResync) {
        self.reverb_zone_resyncs.push(resync);
    }
}

// === Bridge Functions ===

pub fn queue_script_update_from_bridge(update: ScriptUpdate) -> bool {
    super::with_pending(|pc| pc.queue_script_update(update)).is_some()
}

pub fn queue_script_removal_from_bridge(removal: ScriptRemoval) -> bool {
    super::with_pending(|pc| pc.queue_script_removal(removal)).is_some()
}

pub fn queue_audio_update_from_bridge(update: AudioUpdate) -> bool {
    super::with_pending(|pc| pc.queue_audio_update(update)).is_some()
}

pub fn queue_audio_removal_from_bridge(removal: AudioRemoval) -> bool {
    super::with_pending(|pc| pc.queue_audio_removal(removal)).is_some()
}

pub fn queue_audio_playback_from_bridge(playback: AudioPlayback) -> bool {
    super::with_pending(|pc| pc.queue_audio_playback(playback)).is_some()
}

pub fn queue_audio_bus_update_from_bridge(update: AudioBusUpdate) -> bool {
    super::with_pending(|pc| pc.queue_audio_bus_update(update)).is_some()
}

pub fn queue_audio_bus_create_from_bridge(create: AudioBusCreate) -> bool {
    super::with_pending(|pc| pc.queue_audio_bus_create(create)).is_some()
}

pub fn queue_audio_bus_delete_from_bridge(delete: AudioBusDelete) -> bool {
    super::with_pending(|pc| pc.queue_audio_bus_delete(delete)).is_some()
}

pub fn queue_audio_bus_effects_update_from_bridge(update: AudioBusEffectsUpdate) -> bool {
    super::with_pending(|pc| pc.queue_audio_bus_effects_update(update)).is_some()
}

pub fn queue_reverb_zone_command_from_bridge(command: ReverbZoneCommand) -> bool {
    super::with_pending(|pc| pc.queue_reverb_zone_command(command)).is_some()
}

/// Queue a re-report of reverb state that changed without a command.
///
/// Named for the thread-local it reaches, not for a bridge caller: the only
/// callers are the undo and redo arms in `core/entity_factory.rs`, which are pure
/// Rust and cannot emit an event themselves. `with_pending` is a thread-local, so
/// this is reachable from `core/` and natively testable.
pub fn queue_reverb_zone_resync_pending(resync: ReverbZoneResync) -> bool {
    super::with_pending(|pc| pc.queue_reverb_zone_resync(resync)).is_some()
}
