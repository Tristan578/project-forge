//! Entity reparenting — pure logic.
//!
//! Handles reparenting entities in the scene hierarchy, including validation
//! for circular references and proper ChildOf/Children component management.
//!
//! The bridge-side apply system (which drains requests and emits JS events)
//! lives in `bridge/reparent.rs`.

use bevy::prelude::*;

use super::entity_id::EntityId;
use super::pending_commands::ReparentRequest;

/// Process a single reparent request.
/// Returns `Ok(())` on success or an error message.
/// Called from `bridge::reparent::apply_reparent_requests`.
pub fn process_reparent(
    request: &ReparentRequest,
    commands: &mut Commands,
    query: &Query<(Entity, &EntityId, Option<&ChildOf>, Option<&Children>)>,
) -> Result<(), String> {
    // 1. Find the entity to reparent
    let (entity, _, current_parent, _) = query
        .iter()
        .find(|(_, eid, _, _)| eid.0 == request.entity_id)
        .ok_or_else(|| format!("Entity not found: {}", request.entity_id))?;

    // 2. Find the new parent entity (if specified)
    let new_parent_entity = match &request.new_parent_id {
        Some(pid) => {
            let (parent_entity, _, _, _) = query
                .iter()
                .find(|(_, eid, _, _)| eid.0 == *pid)
                .ok_or_else(|| format!("Parent entity not found: {}", pid))?;
            Some(parent_entity)
        }
        None => None,
    };

    // 3. Validate: check for circular reference
    if let Some(new_parent) = new_parent_entity {
        if is_descendant_of(new_parent, entity, query) {
            return Err("Cannot parent entity to its own descendant".to_string());
        }
    }

    // 4. Remove from current parent
    if current_parent.is_some() {
        commands.entity(entity).remove::<ChildOf>();
    }

    // 5. Add to new parent (or keep as root)
    if let Some(new_parent) = new_parent_entity {
        if let Some(index) = request.insert_index {
            // Insert at specific position (clamp to child count for graceful fallback)
            let child_count = query
                .iter()
                .find(|(e, _, _, _)| *e == new_parent)
                .and_then(|(_, _, _, children)| children.map(|c| c.len()))
                .unwrap_or(0);
            let clamped = index.min(child_count);
            commands.entity(new_parent).insert_children(clamped, &[entity]);
        } else {
            commands.entity(new_parent).add_child(entity);
        }
    }

    Ok(())
}

/// Check if `potential_ancestor` is a descendant of `entity`.
/// This prevents circular references when reparenting.
fn is_descendant_of(
    potential_ancestor: Entity,
    entity: Entity,
    query: &Query<(Entity, &EntityId, Option<&ChildOf>, Option<&Children>)>,
) -> bool {
    // Walk up the tree from potential_ancestor
    let mut current = potential_ancestor;

    loop {
        if current == entity {
            return true;
        }

        // Find current entity's parent
        match query.iter().find(|(e, _, _, _)| *e == current) {
            Some((_, _, Some(child_of), _)) => {
                current = child_of.parent();
            }
            _ => break,
        }
    }

    false
}

