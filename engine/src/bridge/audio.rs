//! Audio and reverb zone systems for the bridge layer.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    audio::{AudioData, AudioEnabled, AudioBusConfig},
    reverb_zone::{ReverbZoneData, ReverbZoneEnabled},
    selection::{Selection, SelectionChangedEvent},
    pending_commands::PendingCommands,
    history::{HistoryStack, UndoableAction},
};
use super::events;

// ---------------------------------------------------------------------------
// Audio systems
// ---------------------------------------------------------------------------

/// System that applies pending audio updates (always-active).
pub(super) fn apply_audio_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.audio_updates.drain(..) {
        for (entity, entity_id, current_audio) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_audio = current_audio.cloned();

                // Merge partial update with existing data or defaults
                let base = current_audio.cloned().unwrap_or_default();
                let new_audio = AudioData {
                    asset_id: update.asset_id.or(base.asset_id),
                    volume: update.volume.unwrap_or(base.volume),
                    pitch: update.pitch.unwrap_or(base.pitch),
                    loop_audio: update.loop_audio.unwrap_or(base.loop_audio),
                    spatial: update.spatial.unwrap_or(base.spatial),
                    max_distance: update.max_distance.unwrap_or(base.max_distance),
                    ref_distance: update.ref_distance.unwrap_or(base.ref_distance),
                    rolloff_factor: update.rolloff_factor.unwrap_or(base.rolloff_factor),
                    autoplay: update.autoplay.unwrap_or(base.autoplay),
                    bus: base.bus,
                };

                // Insert or update audio components
                commands.entity(entity)
                    .insert(new_audio.clone())
                    .insert(AudioEnabled);

                // Record for undo
                history.push(UndoableAction::AudioChange {
                    entity_id: update.entity_id.clone(),
                    old_audio,
                    new_audio: Some(new_audio.clone()),
                });

                // Emit change event
                events::emit_audio_changed(&update.entity_id, Some(&new_audio));
                break;
            }
        }
    }
}

/// System that applies pending audio removals (always-active).
pub(super) fn apply_audio_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&AudioData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.audio_removals.drain(..) {
        for (entity, entity_id, current_audio) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_audio = current_audio.cloned();

                // Remove audio components
                commands.entity(entity)
                    .remove::<AudioData>()
                    .remove::<AudioEnabled>();

                // Record for undo
                history.push(UndoableAction::AudioChange {
                    entity_id: removal.entity_id.clone(),
                    old_audio,
                    new_audio: None,
                });

                // Emit change event
                events::emit_audio_changed(&removal.entity_id, None);
                break;
            }
        }
    }
}

/// System that applies pending audio playback actions (always-active).
pub(super) fn apply_audio_playback(
    mut pending: ResMut<PendingCommands>,
) {
    for playback in pending.audio_playback.drain(..) {
        // Emit playback event to JS (Web Audio API handles actual playback)
        events::emit_audio_playback(&playback.entity_id, &playback.action);
    }
}

/// System that applies pending audio bus updates (always-active for runtime audio mixing).
pub(super) fn apply_audio_bus_updates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for update in pending.audio_bus_updates.drain(..) {
        if let Some(bus) = bus_config.buses.iter_mut().find(|b| b.name == update.bus_name) {
            if let Some(v) = update.volume {
                bus.volume = v.clamp(0.0, 1.0);
            }
            if let Some(v) = update.muted {
                bus.muted = v;
            }
            if let Some(v) = update.soloed {
                bus.soloed = v;
            }
            events::emit_audio_buses_changed(&bus_config);
        }
    }
}

/// System that applies pending audio bus creation requests (always-active).
pub(super) fn apply_audio_bus_creates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for create in pending.audio_bus_creates.drain(..) {
        // Prevent duplicates
        if bus_config.buses.iter().any(|b| b.name == create.name) {
            continue;
        }
        bus_config.buses.push(crate::core::audio::AudioBusDef {
            name: create.name,
            volume: create.volume.clamp(0.0, 1.0),
            muted: create.muted,
            soloed: create.soloed,
            effects: vec![],
        });
        events::emit_audio_buses_changed(&bus_config);
    }
}

/// System that applies pending audio bus deletion requests (always-active).
pub(super) fn apply_audio_bus_deletes(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for delete in pending.audio_bus_deletes.drain(..) {
        if delete.bus_name == "master" {
            continue; // Cannot delete master
        }
        bus_config.buses.retain(|b| b.name != delete.bus_name);
        events::emit_audio_buses_changed(&bus_config);
    }
}

/// System that applies pending audio bus effects updates (always-active, Phase A-2).
pub(super) fn apply_audio_bus_effects_updates(
    mut pending: ResMut<PendingCommands>,
    mut bus_config: ResMut<AudioBusConfig>,
) {
    for update in pending.audio_bus_effects_updates.drain(..) {
        if let Some(bus) = bus_config.buses.iter_mut().find(|b| b.name == update.bus_name) {
            bus.effects = update.effects;
            events::emit_audio_buses_changed(&bus_config);
        }
    }
}

/// Emit audio changed events on selection changes and audio data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_audio_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &AudioData), Changed<AudioData>>,
    selection_query: Query<(&EntityId, Option<&AudioData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, audio_data)) = selection_query.get(primary) {
                events::emit_audio_changed(&entity_id.0, audio_data);
            }
        }
    }

    // Emit when audio data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, audio_data)) = query.get(primary) {
            events::emit_audio_changed(&entity_id.0, Some(audio_data));
        }
    }
}

// ---------------------------------------------------------------------------
// Reverb Zone systems
// ---------------------------------------------------------------------------

/// System that applies pending reverb zone updates (always-active).
pub(super) fn apply_reverb_zone_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.reverb_zone_updates.drain(..) {
        for (entity, entity_id, current_reverb_zone, rz_enabled) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_reverb_zone = current_reverb_zone.cloned();

                // Insert or update reverb zone component
                commands.entity(entity).insert(update.reverb_zone_data.clone());

                // Record for undo
                history.push(UndoableAction::ReverbZoneChange {
                    entity_id: update.entity_id.clone(),
                    old_reverb: old_reverb_zone,
                    new_reverb: Some(update.reverb_zone_data.clone()),
                });

                // Emit change event
                let enabled = rz_enabled.is_some();
                events::emit_reverb_zone_changed(&update.entity_id, &update.reverb_zone_data, enabled);
                break;
            }
        }
    }
}

/// System that applies pending reverb zone toggle requests (always-active).
pub(super) fn apply_reverb_zone_toggles(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
) {
    for toggle in pending.reverb_zone_toggles.drain(..) {
        for (entity, entity_id, reverb_zone_data, rz_enabled) in query.iter() {
            if entity_id.0 == toggle.entity_id {
                if toggle.enabled {
                    // Enable reverb zone: add ReverbZoneEnabled marker and ReverbZoneData if missing
                    if rz_enabled.is_none() {
                        commands.entity(entity).insert(ReverbZoneEnabled);
                    }
                    if reverb_zone_data.is_none() {
                        commands.entity(entity).insert(ReverbZoneData::default());
                    }
                    // Emit change event
                    let data = reverb_zone_data.cloned().unwrap_or_default();
                    events::emit_reverb_zone_changed(&toggle.entity_id, &data, true);
                } else {
                    // Disable reverb zone: remove ReverbZoneEnabled marker
                    if rz_enabled.is_some() {
                        commands.entity(entity).remove::<ReverbZoneEnabled>();
                    }
                    // Emit change event
                    if let Some(data) = reverb_zone_data {
                        events::emit_reverb_zone_changed(&toggle.entity_id, data, false);
                    }
                }
                break;
            }
        }
    }
}

/// Editor-only: emit reverb zone data when entity is selected.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_reverb_zone_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ReverbZoneData), Changed<ReverbZoneData>>,
    selection_query: Query<(&EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, reverb_zone_data, rz_enabled)) = selection_query.get(primary) {
                if let Some(data) = reverb_zone_data {
                    events::emit_reverb_zone_changed(&entity_id.0, data, rz_enabled.is_some());
                }
            }
        }
    }

    // Emit when reverb zone data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, reverb_zone_data)) = query.get(primary) {
            // Check if enabled
            if let Ok((_, _, rz_enabled)) = selection_query.get(primary) {
                events::emit_reverb_zone_changed(&entity_id.0, reverb_zone_data, rz_enabled.is_some());
            }
        }
    }
}
