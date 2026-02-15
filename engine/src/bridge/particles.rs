// Particle system integration for bridge layer

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    particles::{ParticleData, ParticleEnabled},
    pending_commands::PendingCommands,
    history::HistoryStack,
};
use crate::core::selection::{Selection, SelectionChangedEvent};
use super::events;

/// System that applies pending particle updates (always-active).
pub(super) fn apply_particle_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.particle_updates.drain(..) {
        for (entity, entity_id, current_particle, _pe) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_particle = current_particle.cloned();

                // Insert or update particle component
                commands.entity(entity).insert(update.particle_data.clone());

                // Record for undo
                history.push(crate::core::history::UndoableAction::ParticleChange {
                    entity_id: update.entity_id.clone(),
                    old_particle,
                    new_particle: Some(update.particle_data.clone()),
                });

                // Emit change event
                events::emit_particle_changed(&update.entity_id, Some(&update.particle_data), true);
                break;
            }
        }
    }
}

/// System that applies pending particle toggle requests (always-active).
pub(super) fn apply_particle_toggles(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
) {
    for toggle in pending.particle_toggles.drain(..) {
        for (entity, entity_id, particle_data, part_enabled) in query.iter() {
            if entity_id.0 == toggle.entity_id {
                if toggle.enabled {
                    // Enable particles: add ParticleEnabled marker and ParticleData if missing
                    if part_enabled.is_none() {
                        commands.entity(entity).insert(ParticleEnabled);
                    }
                    if particle_data.is_none() {
                        let default_data = ParticleData::default();
                        events::emit_particle_changed(&toggle.entity_id, Some(&default_data), true);
                        commands.entity(entity).insert(default_data);
                    } else {
                        events::emit_particle_changed(&toggle.entity_id, particle_data, true);
                    }
                } else {
                    // Disable particles: remove ParticleEnabled marker (keep ParticleData)
                    if part_enabled.is_some() {
                        commands.entity(entity).remove::<ParticleEnabled>();
                    }
                    events::emit_particle_changed(&toggle.entity_id, particle_data, false);
                }
                break;
            }
        }
    }
}

/// System that applies pending particle removals (always-active).
pub(super) fn apply_particle_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.particle_removals.drain(..) {
        for (entity, entity_id, current_particle) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_particle = current_particle.cloned();

                // Remove particle components
                commands.entity(entity)
                    .remove::<ParticleData>()
                    .remove::<ParticleEnabled>();

                // Record for undo
                history.push(crate::core::history::UndoableAction::ParticleChange {
                    entity_id: removal.entity_id.clone(),
                    old_particle,
                    new_particle: None,
                });

                // Emit change event
                events::emit_particle_changed(&removal.entity_id, None, false);
                break;
            }
        }
    }
}

/// System that applies pending particle preset requests (always-active).
pub(super) fn apply_particle_preset_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::particles::ParticlePreset;

    for request in pending.particle_preset_requests.drain(..) {
        if let Some(preset) = ParticlePreset::from_str(&request.preset) {
            for (entity, entity_id, current_particle, _pe) in query.iter() {
                if entity_id.0 == request.entity_id {
                    let old_particle = current_particle.cloned();
                    let new_data = ParticleData::from_preset(&preset);

                    commands.entity(entity)
                        .insert(new_data.clone())
                        .insert(ParticleEnabled);

                    // Record for undo
                    history.push(crate::core::history::UndoableAction::ParticleChange {
                        entity_id: request.entity_id.clone(),
                        old_particle,
                        new_particle: Some(new_data.clone()),
                    });

                    events::emit_particle_changed(&request.entity_id, Some(&new_data), true);
                    break;
                }
            }
        }
    }
}

/// System that applies pending particle playback actions (always-active).
/// Playback is controlled via ParticleEnabled toggle on both platforms.
pub(super) fn apply_particle_playback(
    mut pending: ResMut<PendingCommands>,
) {
    // Playback (play/stop/burst) is handled by toggling ParticleEnabled.
    // The sync_hanabi_effects system (WebGPU) watches for component changes.
    pending.particle_playback.clear();
}

/// Emit particle changed events on selection changes and particle data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_particle_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ParticleData, Option<&ParticleEnabled>), Changed<ParticleData>>,
    selection_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, particle_data, part_enabled)) = selection_query.get(primary) {
                events::emit_particle_changed(&entity_id.0, particle_data, part_enabled.is_some());
            }
        }
    }

    // Emit when particle data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, particle_data, part_enabled)) = query.get(primary) {
            events::emit_particle_changed(&entity_id.0, Some(particle_data), part_enabled.is_some());
        }
    }
}

// ---------------------------------------------------------------------------
// bevy_hanabi GPU particle rendering (WebGPU only)
// ---------------------------------------------------------------------------

/// Marker component on an entity that links to its child hanabi effect entity.
#[cfg(feature = "webgpu")]
#[derive(Component)]
pub(super) struct HanabiEffectLink(Entity);

/// Marker component on the child hanabi effect entity pointing to its parent.
#[cfg(feature = "webgpu")]
#[derive(Component)]
pub(super) struct HanabiEffectParent(Entity);

/// System that synchronises ParticleData/ParticleEnabled ECS components with
/// actual bevy_hanabi GPU particle effect entities (WebGPU only).
///
/// For each entity that has `ParticleData` + `ParticleEnabled`:
///   - If no `HanabiEffectLink` exists, create a child effect entity.
///   - If data changed, recreate the effect asset.
/// For entities that lost `ParticleEnabled` or `ParticleData`:
///   - Despawn the child effect entity and remove the link.
#[cfg(feature = "webgpu")]
pub(super) fn sync_hanabi_effects(
    mut commands: Commands,
    mut effects: ResMut<Assets<bevy_hanabi::EffectAsset>>,
    // Entities with particle data — we need Added/Changed detection
    added_q: Query<
        (Entity, &ParticleData),
        (With<ParticleEnabled>, Added<ParticleEnabled>),
    >,
    changed_q: Query<
        (Entity, &ParticleData),
        (With<ParticleEnabled>, Changed<ParticleData>),
    >,
    // Entities that have the link but no longer have ParticleEnabled
    orphan_link_q: Query<
        (Entity, &HanabiEffectLink),
        Without<ParticleEnabled>,
    >,
    // All entities with link (for data-removed check)
    all_link_q: Query<(Entity, &HanabiEffectLink, Option<&ParticleData>)>,
    // Child effect entities
    effect_parent_q: Query<(Entity, &HanabiEffectParent)>,
) {
    // --- Handle newly enabled particles: spawn child effect entity ---
    for (entity, data) in added_q.iter() {
        let handle = build_hanabi_effect(data, &mut effects);
        let child = commands.spawn((
            Name::new("particle_effect"),
            bevy_hanabi::ParticleEffect::new(handle),
            HanabiEffectParent(entity),
            Transform::default(),
            Visibility::default(),
        )).id();
        commands.entity(entity).insert(HanabiEffectLink(child));
        commands.entity(entity).add_child(child);
    }

    // --- Handle data changes: recreate effect asset ---
    for (entity, data) in changed_q.iter() {
        // Skip if this entity was just added (handled above)
        if added_q.get(entity).is_ok() {
            continue;
        }
        // Find existing child effect entity
        for (child_entity, parent_link) in effect_parent_q.iter() {
            if parent_link.0 == entity {
                let new_handle = build_hanabi_effect(data, &mut effects);
                commands.entity(child_entity).insert(
                    bevy_hanabi::ParticleEffect::new(new_handle),
                );
                break;
            }
        }
    }

    // --- Handle disabled particles: despawn child effect entity ---
    for (entity, link) in orphan_link_q.iter() {
        commands.entity(link.0).despawn();
        commands.entity(entity).remove::<HanabiEffectLink>();
    }

    // --- Handle removed ParticleData: despawn child ---
    for (entity, link, data) in all_link_q.iter() {
        if data.is_none() {
            commands.entity(link.0).despawn();
            commands.entity(entity).remove::<HanabiEffectLink>();
        }
    }
}

/// Convert a `ParticleData` component into a bevy_hanabi `EffectAsset`.
#[cfg(feature = "webgpu")]
pub(super) fn build_hanabi_effect(
    data: &crate::core::particles::ParticleData,
    effects: &mut Assets<bevy_hanabi::EffectAsset>,
) -> Handle<bevy_hanabi::EffectAsset> {
    use bevy_hanabi::prelude::*;
    use crate::core::particles::*;

    let writer = ExprWriter::new();

    // --- Age: always starts at 0 ---
    let init_age = SetAttributeModifier::new(Attribute::AGE, writer.lit(0.0f32).expr());

    // --- Lifetime: uniform random between min and max ---
    let lifetime_expr = if (data.lifetime_max - data.lifetime_min).abs() < 0.001 {
        writer.lit(data.lifetime_min).expr()
    } else {
        writer.lit(data.lifetime_min).uniform(writer.lit(data.lifetime_max)).expr()
    };
    let init_lifetime = SetAttributeModifier::new(Attribute::LIFETIME, lifetime_expr);

    // --- Velocity: per-component uniform random ---
    let vel_min = Vec3::new(data.velocity_min[0], data.velocity_min[1], data.velocity_min[2]);
    let vel_max = Vec3::new(data.velocity_max[0], data.velocity_max[1], data.velocity_max[2]);
    let vel_expr = if (vel_max - vel_min).length() < 0.001 {
        writer.lit(vel_min).expr()
    } else {
        writer.lit(vel_min).uniform(writer.lit(vel_max)).expr()
    };
    let init_vel = SetAttributeModifier::new(Attribute::VELOCITY, vel_expr);

    // --- Position modifier based on emission shape ---
    // We need to create expression handles before consuming the writer.
    let position_modifier: Option<Box<dyn Modifier + Send + Sync>> = match &data.emission_shape {
        EmissionShape::Point => None,
        EmissionShape::Sphere { radius } => {
            Some(Box::new(SetPositionSphereModifier {
                center: writer.lit(Vec3::ZERO).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Circle { radius } => {
            Some(Box::new(SetPositionCircleModifier {
                center: writer.lit(Vec3::ZERO).expr(),
                axis: writer.lit(Vec3::Y).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Cone { radius, height } => {
            // Approximate cone as a sphere with small radius + upward velocity bias
            // bevy_hanabi has SetPositionCone3dModifier but API may differ
            Some(Box::new(SetPositionSphereModifier {
                center: writer.lit(Vec3::new(0.0, *height * 0.5, 0.0)).expr(),
                radius: writer.lit(*radius).expr(),
                dimension: ShapeDimension::Volume,
            }))
        }
        EmissionShape::Box { half_extents } => {
            let he = Vec3::new(half_extents[0], half_extents[1], half_extents[2]);
            let pos_expr = writer.lit(-he).uniform(writer.lit(he)).expr();
            Some(Box::new(SetAttributeModifier::new(Attribute::POSITION, pos_expr)))
        }
    };

    // --- Acceleration ---
    let accel_vec = Vec3::new(data.acceleration[0], data.acceleration[1], data.acceleration[2]);
    let accel_expr = writer.lit(accel_vec).expr();

    // --- Linear drag ---
    let drag_expr = writer.lit(data.linear_drag).expr();

    // --- Finish the expression module ---
    let module = writer.finish();

    // --- Spawner settings ---
    let spawner = match &data.spawner_mode {
        SpawnerMode::Continuous { rate } => SpawnerSettings::rate((*rate).into()),
        SpawnerMode::Burst { count } => SpawnerSettings::once((*count as f32).into()),
        SpawnerMode::Once { count } => SpawnerSettings::once((*count as f32).into()),
    };

    // --- Simulation space ---
    let sim_space = if data.world_space {
        SimulationSpace::Global
    } else {
        SimulationSpace::Local
    };

    // --- Alpha mode ---
    let alpha_mode = match data.blend_mode {
        ParticleBlendMode::Additive => bevy_hanabi::AlphaMode::Add,
        ParticleBlendMode::AlphaBlend => bevy_hanabi::AlphaMode::Blend,
        ParticleBlendMode::Premultiply => bevy_hanabi::AlphaMode::Premultiply,
    };

    // --- Color gradient ---
    let mut color_gradient = Gradient::new();
    if data.color_gradient.is_empty() {
        color_gradient.add_key(0.0, Vec4::ONE);
        color_gradient.add_key(1.0, Vec4::new(1.0, 1.0, 1.0, 0.0));
    } else {
        for stop in &data.color_gradient {
            color_gradient.add_key(
                stop.position,
                Vec4::new(stop.color[0], stop.color[1], stop.color[2], stop.color[3]),
            );
        }
    }

    // --- Size gradient ---
    let mut size_gradient = Gradient::new();
    if data.size_keyframes.is_empty() {
        size_gradient.add_key(0.0, Vec3::splat(data.size_start));
        size_gradient.add_key(1.0, Vec3::splat(data.size_end));
    } else {
        for kf in &data.size_keyframes {
            size_gradient.add_key(kf.position, Vec3::splat(kf.size));
        }
    }

    // --- Orient mode ---
    let orient = match data.orientation {
        ParticleOrientation::Billboard => OrientModifier::new(OrientMode::FaceCameraPosition),
        ParticleOrientation::VelocityAligned => OrientModifier::new(OrientMode::AlongVelocity),
        ParticleOrientation::Fixed => OrientModifier::new(OrientMode::ParallelCameraDepthPlane),
    };

    // --- Build the EffectAsset ---
    let mut effect = EffectAsset::new(data.max_particles, spawner, module)
        .with_simulation_space(sim_space)
        .with_alpha_mode(alpha_mode)
        .init(init_age)
        .init(init_lifetime)
        .init(init_vel)
        .update(AccelModifier::new(accel_expr))
        .update(LinearDragModifier::new(drag_expr))
        .render(ColorOverLifetimeModifier::new(color_gradient))
        .render(SizeOverLifetimeModifier {
            gradient: size_gradient,
            screen_space_size: false,
        })
        .render(orient);

    // Add position modifier if not Point
    if let Some(pos_mod) = position_modifier {
        effect = effect.add_modifier(ModifierContext::Init, pos_mod);
    }

    effects.add(effect)
}
