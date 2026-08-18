//! Reverb zone component for spatial audio reverb.
//!
//! Stores reverb zone configuration on entities. All reverb processing happens in JS
//! via the Web Audio API. This component is metadata-only.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Shape of the reverb zone trigger volume.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ReverbShape {
    Box { size: [f32; 3] },
    Sphere { radius: f32 },
}

impl Default for ReverbShape {
    fn default() -> Self {
        Self::Box {
            size: [10.0, 10.0, 10.0],
        }
    }
}

/// Reverb zone data attached to an entity.
#[derive(Component, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverbZoneData {
    /// Shape of the zone (box or sphere)
    pub shape: ReverbShape,
    /// Reverb preset name ("hall", "room", "cave", "outdoor", "custom")
    pub preset: String,
    /// Wet mix amount (0.0 = dry, 1.0 = fully wet)
    pub wet_mix: f32,
    /// Decay time in seconds
    pub decay_time: f32,
    /// Pre-delay in milliseconds
    pub pre_delay: f32,
    /// Distance from edge to start blending
    pub blend_radius: f32,
    /// Higher priority wins in overlaps
    pub priority: i32,
}

impl Default for ReverbZoneData {
    fn default() -> Self {
        Self {
            shape: ReverbShape::default(),
            preset: "hall".to_string(),
            wet_mix: 0.5,
            decay_time: 2.0,
            pre_delay: 10.0,
            blend_radius: 2.0,
            priority: 0,
        }
    }
}

/// Marker component: entity has reverb zone enabled.
#[derive(Component, Debug, Clone)]
pub struct ReverbZoneEnabled;

// ---------------------------------------------------------------------------
// Command resolution
//
// `ReverbZoneData` and `ReverbZoneEnabled` are two components written by three
// different commands (`set_reverb_zone`, `toggle_reverb_zone`,
// `remove_reverb_zone`), and authoring one zone dispatches two of them in the
// same frame. Deciding what to write is therefore a fold over a frame's worth
// of commands, not a per-command action — and the bridge is `wasm32`-only, so
// that decision has to live here to be testable at all.
// ---------------------------------------------------------------------------

/// The net effect of one frame's reverb-zone commands on a single entity.
#[derive(Debug, Clone, PartialEq)]
pub enum ReverbZoneIntent {
    /// `set_reverb_zone` and/or `toggle_reverb_zone` landed for this entity.
    /// `data` is `None` when only a toggle landed; `enabled` is `None` when only
    /// a set landed.
    Set {
        data: Option<ReverbZoneData>,
        enabled: Option<bool>,
    },
    /// `remove_reverb_zone` landed for this entity.
    Remove,
}

/// What the caller must write for one entity, given that entity's current state.
///
/// Every field is "do nothing" by default, so a command that asks for a state the
/// entity is already in produces no ECS writes, no event, and no history entry.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ReverbZoneWrite {
    /// Insert this `ReverbZoneData` (absent = leave the existing data alone).
    pub insert_data: Option<ReverbZoneData>,
    /// Remove `ReverbZoneData`.
    pub remove_data: bool,
    /// `Some(true)` insert `ReverbZoneEnabled`, `Some(false)` remove it,
    /// `None` leave it exactly as it is.
    pub set_enabled: Option<bool>,
    /// The single event to emit for this entity this frame, if any.
    pub event: Option<ReverbZoneEvent>,
    /// The undo entry to record, if anything actually changed.
    pub history: Option<ReverbZoneHistory>,
}

/// The one event a resolved write emits — at most one per entity per frame.
#[derive(Debug, Clone, PartialEq)]
pub enum ReverbZoneEvent {
    Changed { data: ReverbZoneData, enabled: bool },
    Removed,
}

/// Both halves of the state, so undo can restore enablement as well as data.
#[derive(Debug, Clone, PartialEq)]
pub struct ReverbZoneHistory {
    pub old_data: Option<ReverbZoneData>,
    pub new_data: Option<ReverbZoneData>,
    pub old_enabled: bool,
    pub new_enabled: bool,
}

/// One queued reverb-zone command, in the order the browser dispatched it.
///
/// The three commands share ONE queue, and that is load-bearing rather than
/// tidiness: with a queue per command kind, "the later command wins" is not
/// derivable at all. A `remove_reverb_zone` followed by a `set_reverb_zone` for
/// the same entity comes back in whatever order the queues happen to be drained,
/// so the removal beat a *later* set and the zone the user just authored was
/// deleted — silently, since the removal event then wiped the store's optimistic
/// copy.
#[derive(Debug, Clone, PartialEq)]
pub enum ReverbZoneCommand {
    Set {
        entity_id: String,
        data: ReverbZoneData,
    },
    Toggle {
        entity_id: String,
        enabled: bool,
    },
    Remove {
        entity_id: String,
    },
}

impl ReverbZoneCommand {
    pub fn entity_id(&self) -> &str {
        match self {
            ReverbZoneCommand::Set { entity_id, .. }
            | ReverbZoneCommand::Toggle { entity_id, .. }
            | ReverbZoneCommand::Remove { entity_id } => entity_id,
        }
    }
}

/// A state re-report for one entity whose reverb state changed *without* a
/// command — undo and redo, whose arms live in `core/` and so cannot emit.
///
/// It carries the state the arm WROTE rather than an entity id to be re-read.
/// `apply_undo_requests` and the reverb applicator are separate systems in the
/// same unordered tuple, and both write through a deferred `Commands`, so a
/// re-query in the same frame may still observe pre-undo state — exactly the
/// coin flip this module exists to eliminate.
#[derive(Debug, Clone, PartialEq)]
pub struct ReverbZoneResync {
    pub entity_id: String,
    pub data: Option<ReverbZoneData>,
    pub enabled: bool,
}

impl ReverbZoneResync {
    /// The event the browser must receive to match what was written.
    pub fn event(&self) -> ReverbZoneEvent {
        match &self.data {
            Some(data) => ReverbZoneEvent::Changed {
                data: data.clone(),
                enabled: self.enabled,
            },
            None => ReverbZoneEvent::Removed,
        }
    }
}

/// Fold a frame's reverb-zone commands into one intent per entity.
///
/// Ordering policy — one ordered queue, so the policy is simply *last writer
/// wins*, per command kind and across kinds alike:
///
/// - A later `Set` replaces an earlier one; a later `Toggle` replaces an earlier
///   one.
/// - A `Set` and a `Toggle` merge into a single `Set`, which is what authoring a
///   zone actually dispatches (data, then enablement) — and is why a user action
///   produces exactly one event.
/// - A `Remove` discards whatever preceded it for that entity, and a `Set` or
///   `Toggle` *after* a remove starts a fresh intent. Both directions follow from
///   position alone, so what the caller asked for last is what happens.
///
/// Entities come back in first-seen order, so the result is deterministic
/// regardless of how the ECS iterates.
pub fn resolve_reverb_zone_commands(
    commands: impl IntoIterator<Item = ReverbZoneCommand>,
) -> Vec<(String, ReverbZoneIntent)> {
    let mut resolved: Vec<(String, ReverbZoneIntent)> = Vec::new();

    for command in commands {
        // Linear search is deliberate: a frame carries a handful of entities at
        // most, and it keeps first-seen ordering without a second index.
        let index = match resolved
            .iter()
            .position(|(id, _)| id == command.entity_id())
        {
            Some(i) => i,
            None => {
                resolved.push((
                    command.entity_id().to_string(),
                    ReverbZoneIntent::Set {
                        data: None,
                        enabled: None,
                    },
                ));
                resolved.len() - 1
            }
        };
        let slot = &mut resolved[index].1;

        match command {
            ReverbZoneCommand::Set { data, .. } => match slot {
                ReverbZoneIntent::Set { data: slot_data, .. } => *slot_data = Some(data),
                // Re-authoring after a remove in the same frame is a
                // re-creation, not a no-op.
                ReverbZoneIntent::Remove => {
                    *slot = ReverbZoneIntent::Set {
                        data: Some(data),
                        enabled: None,
                    }
                }
            },
            ReverbZoneCommand::Toggle { enabled, .. } => match slot {
                ReverbZoneIntent::Set {
                    enabled: slot_enabled,
                    ..
                } => *slot_enabled = Some(enabled),
                ReverbZoneIntent::Remove => {
                    *slot = ReverbZoneIntent::Set {
                        data: None,
                        enabled: Some(enabled),
                    }
                }
            },
            ReverbZoneCommand::Remove { .. } => *slot = ReverbZoneIntent::Remove,
        }
    }

    resolved
}

/// Turn one resolved intent into the exact set of writes for an entity.
///
/// `current_enabled` is whether the entity carries `ReverbZoneEnabled` right now.
/// Enablement is only ever written when it actually changes, so an action that
/// says nothing about it can never flip it — the failure mode that made undo
/// re-enable a disabled body in 2D physics (PF-1173).
pub fn plan_reverb_zone_write(
    intent: &ReverbZoneIntent,
    current_data: Option<&ReverbZoneData>,
    current_enabled: bool,
) -> ReverbZoneWrite {
    match intent {
        ReverbZoneIntent::Remove => {
            if current_data.is_none() && !current_enabled {
                // Nothing to remove. Emitting `Removed` here would tell the
                // browser to drop a zone it never had.
                return ReverbZoneWrite::default();
            }
            ReverbZoneWrite {
                insert_data: None,
                remove_data: current_data.is_some(),
                set_enabled: if current_enabled { Some(false) } else { None },
                event: Some(ReverbZoneEvent::Removed),
                history: Some(ReverbZoneHistory {
                    old_data: current_data.cloned(),
                    new_data: None,
                    old_enabled: current_enabled,
                    new_enabled: false,
                }),
            }
        }
        ReverbZoneIntent::Set { data, enabled } => {
            if data.is_none() && enabled.is_none() {
                // Says nothing about either half. `resolve_reverb_zone_commands`
                // cannot produce this (a slot only exists because a command
                // filled it), but the planner is public and must not invent an
                // event for a request that asked for nothing.
                return ReverbZoneWrite::default();
            }

            let target_enabled = enabled.unwrap_or(current_enabled);

            // Which data the entity ends the frame with, and whether we have to
            // write it. Enabling an entity that has no zone at all materialises
            // the default — an enabled marker with no data is a state nothing
            // else can read.
            let (insert_data, effective) = match (data, current_data) {
                (Some(d), _) => (Some(d.clone()), d.clone()),
                (None, Some(current)) => (None, current.clone()),
                (None, None) if target_enabled => {
                    let d = ReverbZoneData::default();
                    (Some(d.clone()), d)
                }
                // Disabling an entity that has no zone: nothing exists to
                // disable, so there is nothing to write or report.
                (None, None) => return ReverbZoneWrite::default(),
            };

            let set_enabled = if target_enabled == current_enabled {
                None
            } else {
                Some(target_enabled)
            };

            let changed = insert_data.is_some() || set_enabled.is_some();

            ReverbZoneWrite {
                insert_data,
                remove_data: false,
                set_enabled,
                // Gated on `changed` alongside the history entry, so a write that
                // does nothing reports nothing. Re-reporting an unchanged zone
                // rebuilt `reverbZones[id]` in the store with fresh object
                // identity and re-rendered every subscriber; a browser that wants
                // to *ask* has `get_reverb_zone`.
                event: changed.then(|| ReverbZoneEvent::Changed {
                    data: effective.clone(),
                    enabled: target_enabled,
                }),
                history: changed.then(|| ReverbZoneHistory {
                    old_data: current_data.cloned(),
                    new_data: Some(effective),
                    old_enabled: current_enabled,
                    new_enabled: target_enabled,
                }),
            }
        }
    }
}

#[cfg(test)]
mod reverb_zone_resolution_tests {
    //! Reverb zones reach the engine through three commands that write two
    //! components, and authoring one zone dispatches two of them in the same
    //! frame. These pin the fold and the per-entity plan, which is everything
    //! the bridge system decides — the system itself is `wasm32`-only and cannot
    //! be compiled here.

    use super::*;

    fn data(preset: &str) -> ReverbZoneData {
        ReverbZoneData {
            preset: preset.to_string(),
            ..Default::default()
        }
    }

    // -- resolve -----------------------------------------------------------

    fn set(id: &str, preset: &str) -> ReverbZoneCommand {
        ReverbZoneCommand::Set {
            entity_id: id.to_string(),
            data: data(preset),
        }
    }

    fn toggle(id: &str, enabled: bool) -> ReverbZoneCommand {
        ReverbZoneCommand::Toggle {
            entity_id: id.to_string(),
            enabled,
        }
    }

    fn remove(id: &str) -> ReverbZoneCommand {
        ReverbZoneCommand::Remove {
            entity_id: id.to_string(),
        }
    }

    #[test]
    fn a_set_and_a_toggle_for_one_entity_merge_into_a_single_intent() {
        // This is what authoring a zone dispatches: data, then enablement.
        // Two intents would mean two events and two undo entries per click.
        let resolved = resolve_reverb_zone_commands(vec![set("e1", "cave"), toggle("e1", true)]);

        assert_eq!(
            resolved,
            vec![(
                "e1".to_string(),
                ReverbZoneIntent::Set {
                    data: Some(data("cave")),
                    enabled: Some(true),
                }
            )]
        );
    }

    #[test]
    fn the_later_command_of_a_kind_wins() {
        let resolved = resolve_reverb_zone_commands(vec![
            set("e1", "room"),
            set("e1", "hall"),
            toggle("e1", true),
            toggle("e1", false),
        ]);

        assert_eq!(
            resolved,
            vec![(
                "e1".to_string(),
                ReverbZoneIntent::Set {
                    data: Some(data("hall")),
                    enabled: Some(false),
                }
            )]
        );
    }

    #[test]
    fn a_removal_after_a_set_and_a_toggle_wins() {
        let resolved = resolve_reverb_zone_commands(vec![
            set("e1", "cave"),
            toggle("e1", true),
            remove("e1"),
        ]);

        assert_eq!(resolved, vec![("e1".to_string(), ReverbZoneIntent::Remove)]);
    }

    #[test]
    fn a_set_after_a_removal_re_creates_the_zone() {
        // The old two-queue fold made removal win regardless of position, so a
        // remove-then-set in one frame deleted the zone the user had just
        // authored — the store wrote it optimistically and the removal event
        // wiped it, with no error anywhere.
        let resolved = resolve_reverb_zone_commands(vec![remove("e1"), set("e1", "cave")]);

        assert_eq!(
            resolved,
            vec![(
                "e1".to_string(),
                ReverbZoneIntent::Set {
                    data: Some(data("cave")),
                    enabled: None,
                }
            )]
        );
    }

    #[test]
    fn a_toggle_after_a_removal_starts_a_fresh_intent() {
        let resolved = resolve_reverb_zone_commands(vec![remove("e1"), toggle("e1", true)]);

        assert_eq!(
            resolved,
            vec![(
                "e1".to_string(),
                ReverbZoneIntent::Set {
                    data: None,
                    enabled: Some(true),
                }
            )]
        );
    }

    #[test]
    fn a_removal_alone_resolves_to_remove() {
        let resolved = resolve_reverb_zone_commands(vec![remove("e1")]);

        assert_eq!(resolved, vec![("e1".to_string(), ReverbZoneIntent::Remove)]);
    }

    #[test]
    fn entities_come_back_in_first_seen_order_and_never_collapse() {
        let resolved = resolve_reverb_zone_commands(vec![
            set("e2", "cave"),
            toggle("e1", true),
            toggle("e2", false),
            remove("e3"),
        ]);

        let ids: Vec<&str> = resolved.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, vec!["e2", "e1", "e3"]);
        assert_eq!(
            resolved[1].1,
            ReverbZoneIntent::Set {
                data: None,
                enabled: Some(true)
            }
        );
        assert_eq!(resolved[2].1, ReverbZoneIntent::Remove);
    }

    #[test]
    fn an_empty_frame_resolves_to_nothing() {
        let resolved = resolve_reverb_zone_commands(Vec::new());
        assert!(resolved.is_empty());
    }

    // -- resync: the state undo/redo wrote, re-reported ----------------------

    #[test]
    fn a_resync_carrying_data_reports_a_change_with_its_enablement() {
        let resync = ReverbZoneResync {
            entity_id: "e1".to_string(),
            data: Some(data("cave")),
            enabled: false,
        };

        assert_eq!(
            resync.event(),
            ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: false,
            }
        );
    }

    #[test]
    fn a_resync_with_no_data_reports_a_removal() {
        // Undo of a zone's creation. `Changed<ReverbZoneData>` cannot fire for a
        // component that no longer exists, which is the whole reason this queue
        // exists.
        let resync = ReverbZoneResync {
            entity_id: "e1".to_string(),
            data: None,
            enabled: false,
        };

        assert_eq!(resync.event(), ReverbZoneEvent::Removed);
    }

    // -- plan: enablement is only ever written when it changes --------------

    #[test]
    fn a_property_edit_leaves_a_disabled_zone_disabled() {
        // The PF-1173 failure mode in its outbound form: a set with no opinion
        // about enablement must not switch the zone on.
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: Some(data("cave")),
                enabled: None,
            },
            Some(&data("hall")),
            false,
        );

        assert_eq!(write.set_enabled, None);
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: false
            })
        );
    }

    #[test]
    fn a_property_edit_leaves_an_enabled_zone_enabled() {
        // The opposite direction, so "don't touch the marker" cannot regress
        // into "lose the zone".
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: Some(data("cave")),
                enabled: None,
            },
            Some(&data("hall")),
            true,
        );

        assert_eq!(write.set_enabled, None);
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: true
            })
        );
        assert_eq!(
            write.history,
            Some(ReverbZoneHistory {
                old_data: Some(data("hall")),
                new_data: Some(data("cave")),
                old_enabled: true,
                new_enabled: true,
            })
        );
    }

    #[test]
    fn authoring_a_zone_writes_the_real_data_and_the_marker_together() {
        // The ordering coin-flip this replaces: two systems both inserting on a
        // deferred `Commands` meant the toggle could write
        // `ReverbZoneData::default()` over the data the set had queued, because
        // the toggle still read the entity as having none. Resolving first makes
        // that unrepresentable.
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: Some(data("cave")),
                enabled: Some(true),
            },
            None,
            false,
        );

        assert_eq!(write.insert_data, Some(data("cave")));
        assert_eq!(write.set_enabled, Some(true));
        assert!(!write.remove_data);
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: true
            })
        );
        assert_eq!(
            write.history,
            Some(ReverbZoneHistory {
                old_data: None,
                new_data: Some(data("cave")),
                old_enabled: false,
                new_enabled: true,
            })
        );
    }

    #[test]
    fn enabling_an_entity_with_no_zone_materialises_the_default() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: Some(true),
            },
            None,
            false,
        );

        assert_eq!(write.insert_data, Some(ReverbZoneData::default()));
        assert_eq!(write.set_enabled, Some(true));
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: ReverbZoneData::default(),
                enabled: true
            })
        );
    }

    #[test]
    fn enabling_an_entity_that_already_has_a_zone_keeps_its_data() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: Some(true),
            },
            Some(&data("cave")),
            false,
        );

        assert_eq!(write.insert_data, None);
        assert_eq!(write.set_enabled, Some(true));
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: true
            })
        );
    }

    #[test]
    fn disabling_keeps_the_data_and_reports_the_new_state() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: Some(false),
            },
            Some(&data("cave")),
            true,
        );

        assert_eq!(write.insert_data, None);
        assert!(!write.remove_data);
        assert_eq!(write.set_enabled, Some(false));
        assert_eq!(
            write.event,
            Some(ReverbZoneEvent::Changed {
                data: data("cave"),
                enabled: false
            })
        );
    }

    #[test]
    fn toggling_to_the_state_the_entity_is_already_in_reports_nothing() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: Some(true),
            },
            Some(&data("cave")),
            true,
        );

        // A write that does nothing reports nothing — the whole `ReverbZoneWrite`
        // is empty, which is what this type's doc claims. Emitting here rebuilt
        // `reverbZones[id]` in the store with fresh object identity and
        // re-rendered every subscriber; a browser that wants to *ask* has
        // `get_reverb_zone`.
        assert_eq!(write, ReverbZoneWrite::default());
    }

    #[test]
    fn disabling_an_entity_with_no_zone_does_nothing_at_all() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: Some(false),
            },
            None,
            false,
        );

        assert_eq!(write, ReverbZoneWrite::default());
    }

    #[test]
    fn an_intent_that_asks_for_nothing_emits_nothing() {
        let write = plan_reverb_zone_write(
            &ReverbZoneIntent::Set {
                data: None,
                enabled: None,
            },
            Some(&data("cave")),
            true,
        );

        assert_eq!(write, ReverbZoneWrite::default());
    }

    // -- plan: removal ------------------------------------------------------

    #[test]
    fn removing_an_enabled_zone_clears_both_components_and_is_undoable() {
        let write = plan_reverb_zone_write(&ReverbZoneIntent::Remove, Some(&data("cave")), true);

        assert!(write.remove_data);
        assert_eq!(write.set_enabled, Some(false));
        assert_eq!(write.insert_data, None);
        assert_eq!(write.event, Some(ReverbZoneEvent::Removed));
        assert_eq!(
            write.history,
            Some(ReverbZoneHistory {
                old_data: Some(data("cave")),
                new_data: None,
                old_enabled: true,
                new_enabled: false,
            })
        );
    }

    #[test]
    fn removing_a_disabled_zone_does_not_touch_the_marker() {
        let write = plan_reverb_zone_write(&ReverbZoneIntent::Remove, Some(&data("cave")), false);

        assert!(write.remove_data);
        assert_eq!(write.set_enabled, None);
        assert_eq!(write.event, Some(ReverbZoneEvent::Removed));
    }

    #[test]
    fn removing_from_an_entity_that_has_no_zone_reports_nothing() {
        // Emitting `Removed` here would tell the browser to drop a zone it never
        // had, and record an undo entry that restores nothing.
        let write = plan_reverb_zone_write(&ReverbZoneIntent::Remove, None, false);

        assert_eq!(write, ReverbZoneWrite::default());
    }
}
