//! Audio and reverb zone systems for the bridge layer.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    audio::{AudioData, AudioEnabled, AudioBusConfig},
    reverb_zone::{
        plan_reverb_zone_write, resolve_reverb_zone_commands, ReverbZoneData, ReverbZoneEnabled,
        ReverbZoneEvent,
    },
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
                    bus: update.bus.unwrap_or(base.bus),
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
    mut selection_events: MessageReader<SelectionChangedEvent>,
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

/// System that applies every pending reverb-zone command (always-active).
///
/// One system, not three. `set_reverb_zone`, `toggle_reverb_zone` and
/// `remove_reverb_zone` all write the same two components — `ReverbZoneData` and
/// the `ReverbZoneEnabled` marker — and `Commands` are *deferred*, so separate
/// systems cannot see each other's writes within a frame. As two unordered
/// systems this was a coin flip: the toggle's "insert default data if missing"
/// branch still read `None` after an update had queued the real config, so
/// enabling a zone in the same frame you authored it could overwrite it with
/// `ReverbZoneData::default()`.
///
/// Folding the frame's three queues into one intent per entity
/// (`resolve_reverb_zone_commands`) and then deciding the writes against the
/// entity's *current* state (`plan_reverb_zone_write`) makes that
/// unrepresentable, and delivers exactly one event per entity per frame by
/// construction. Both of those functions live in `core/` and are unit-tested
/// natively — this system is a thin applicator, which is the only shape testable
/// at all given the bridge is `wasm32`-only.
pub(super) fn apply_reverb_zone_commands(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    // Collected rather than passed as lazy iterators: all three queues live on
    // the same `PendingCommands`, so they cannot be borrowed mutably at once.
    let updates: Vec<(String, ReverbZoneData)> = pending
        .reverb_zone_updates
        .drain(..)
        .map(|u| (u.entity_id, u.reverb_zone_data))
        .collect();
    let toggles: Vec<(String, bool)> = pending
        .reverb_zone_toggles
        .drain(..)
        .map(|t| (t.entity_id, t.enabled))
        .collect();
    let removals: Vec<String> = pending
        .reverb_zone_removals
        .drain(..)
        .map(|r| r.entity_id)
        .collect();

    if updates.is_empty() && toggles.is_empty() && removals.is_empty() {
        return;
    }

    for (entity_id, intent) in resolve_reverb_zone_commands(updates, toggles, removals) {
        for (entity, eid, current_data, current_enabled) in query.iter() {
            if eid.0 != entity_id {
                continue;
            }

            let write = plan_reverb_zone_write(&intent, current_data, current_enabled.is_some());

            if let Some(data) = write.insert_data {
                commands.entity(entity).insert(data);
            }
            if write.remove_data {
                commands.entity(entity).remove::<ReverbZoneData>();
            }
            match write.set_enabled {
                Some(true) => {
                    commands.entity(entity).insert(ReverbZoneEnabled);
                }
                Some(false) => {
                    commands.entity(entity).remove::<ReverbZoneEnabled>();
                }
                None => {}
            }

            if let Some(h) = write.history {
                history.push(UndoableAction::ReverbZoneChange {
                    entity_id: entity_id.clone(),
                    old_reverb: h.old_data,
                    new_reverb: h.new_data,
                    old_enabled: h.old_enabled,
                    new_enabled: h.new_enabled,
                });
            }

            match write.event {
                Some(ReverbZoneEvent::Changed { data, enabled }) => {
                    events::emit_reverb_zone_changed(&entity_id, &data, enabled);
                }
                Some(ReverbZoneEvent::Removed) => {
                    events::emit_reverb_zone_removed(&entity_id);
                }
                None => {}
            }

            break;
        }
    }
}

/// Editor-only: emit reverb zone data when entity is selected.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_reverb_zone_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ReverbZoneData), Changed<ReverbZoneData>>,
    selection_query: Query<(&EntityId, Option<&ReverbZoneData>, Option<&ReverbZoneEnabled>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
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
