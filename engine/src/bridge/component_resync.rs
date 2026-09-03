//! Drain for [`crate::core::component_resync::ComponentResync`].
//!
//! The undo/redo arms and `spawn_from_snapshot` live in `core/` and cannot emit
//! — the bridge is `wasm32`-only — so they queue a re-report on
//! `PendingCommands` and this system turns each one into the event the browser
//! already knows how to handle. It is a pure mapping: the payload comes off the
//! resync, never from a fresh ECS query, because the arms and this system are
//! separate systems in the same unordered `Update` tuple and both write through
//! a deferred `Commands`.
//!
//! Registered OUTSIDE the `#[cfg(not(feature = "runtime"))]` editor block and
//! `.in_set(ResyncDrainSet)`, which `bridge/mod.rs` orders after
//! `EditorApplySet` so the arms have filled the queue by the time this runs.
//! `core::schedule_smoke::every_resync_drain_is_ordered_after_the_undo_arms`
//! derives that requirement by scanning `bridge/` for resync-queue drains, and
//! fails if the registration is missing. That scan tracks the enclosing `fn`
//! line by line, so its needle must not appear in prose above the first `fn` —
//! hence the circumlocution here.

use bevy::prelude::*;

use super::events;
use crate::core::component_resync::ComponentResync;
use crate::core::gizmo::TransformPayload;
use crate::core::pending_commands::PendingCommands;

/// Re-report every queued component write to the browser.
///
/// One event per resync, in queue order. Nothing is applied and no history is
/// recorded: the ECS write already happened in the arm that queued this.
pub(super) fn apply_component_resyncs(mut pending: ResMut<PendingCommands>) {
    if pending.component_resyncs.is_empty() {
        return;
    }

    // Bounded per frame: a scene restore can queue thousands, and each one below
    // becomes a synchronous JS callback whose handler spreads a whole Zustand
    // map. Whatever does not fit stays queued and drains next frame — these are
    // state reports with no ordering requirement, so late is fine and frozen is
    // not (`MAX_RESYNC_DRAIN_PER_FRAME`).
    let take = pending
        .component_resyncs
        .len()
        .min(crate::core::pending::resync::MAX_RESYNC_DRAIN_PER_FRAME);
    let resyncs: Vec<ComponentResync> = pending.component_resyncs.drain(..take).collect();

    for resync in resyncs {
        match resync {
            ComponentResync::Transform {
                entity_id,
                transform,
            } => {
                // `TRANSFORM_CHANGED` carries Euler radians; a snapshot carries a
                // quaternion. Converting here rather than in `core/` keeps
                // `ComponentResync` in the arms' own vocabulary.
                let (rx, ry, rz) = transform
                    .to_transform()
                    .rotation
                    .to_euler(bevy::math::EulerRot::XYZ);
                events::emit_event(
                    "TRANSFORM_CHANGED",
                    &TransformPayload {
                        entity_id,
                        position: transform.position,
                        rotation: [rx, ry, rz],
                        scale: transform.scale,
                    },
                );
            }
            ComponentResync::Material { entity_id, data } => {
                events::emit_material_changed(&entity_id, &data);
            }
            ComponentResync::Light { entity_id, data } => {
                events::emit_light_changed(&entity_id, &data);
            }
            ComponentResync::Physics {
                entity_id,
                data,
                enabled,
            } => {
                events::emit_physics_changed(&entity_id, &data, enabled);
            }
            ComponentResync::Joint { entity_id, data } => match data {
                Some(joint) => events::emit_joint_changed(&entity_id, &joint),
                None => events::emit_joint_removed(&entity_id),
            },
            ComponentResync::Audio { entity_id, data } => {
                events::emit_audio_changed(&entity_id, data.as_ref());
            }
            ComponentResync::Particle {
                entity_id,
                data,
                enabled,
            } => {
                events::emit_particle_changed(&entity_id, data.as_ref(), enabled);
            }
            ComponentResync::Shader { entity_id, data } => {
                events::emit_shader_changed(&entity_id, data.as_ref());
            }
            ComponentResync::Script { entity_id, data } => {
                events::emit_script_changed(&entity_id, data.as_ref());
            }
            ComponentResync::GameComponents {
                entity_id,
                components,
            } => {
                events::emit_game_component_changed(&entity_id, &components);
            }
            ComponentResync::AnimationClip { entity_id, data } => match data {
                Some(clip) => events::emit_animation_clip_changed(&entity_id, &clip),
                None => events::emit_animation_clip_removed(&entity_id),
            },
            ComponentResync::Sprite { entity_id, data } => {
                events::emit_sprite_changed(&entity_id, data.as_ref());
            }
            ComponentResync::Physics2d {
                entity_id,
                data,
                enabled,
            } => match data {
                Some(physics) => events::emit_physics2d_changed(&entity_id, &physics, enabled),
                None => events::emit_physics2d_removed(&entity_id),
            },
            ComponentResync::Joint2d { entity_id, data } => match data {
                Some(joint) => events::emit_joint2d_changed(&entity_id, &joint),
                None => events::emit_joint2d_removed(&entity_id),
            },
            ComponentResync::Tilemap { entity_id, data } => {
                events::emit_tilemap_changed(&entity_id, data.as_ref());
            }
        }
    }
}
