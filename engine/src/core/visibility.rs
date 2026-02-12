//! Visibility system for syncing EntityVisible with Bevy's Visibility.
//!
//! The EntityVisible component is the "source of truth" for whether an entity
//! should be rendered. This system syncs it with Bevy's Visibility component.

use bevy::prelude::*;

use super::entity_id::{EntityId, EntityVisible};

/// System that syncs EntityVisible component with Bevy's Visibility component.
/// Runs whenever EntityVisible is changed.
pub fn sync_visibility(
    mut query: Query<(&EntityVisible, &mut Visibility), Changed<EntityVisible>>,
) {
    for (entity_visible, mut visibility) in query.iter_mut() {
        *visibility = if entity_visible.0 {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
}

/// Handle set_visibility command from React.
/// Returns Ok(()) if entity was found and updated, Err with message otherwise.
pub fn handle_set_visibility(
    entity_id: &str,
    visible: bool,
    query: &mut Query<(&EntityId, &mut EntityVisible)>,
) -> Result<(), String> {
    for (eid, mut ev) in query.iter_mut() {
        if eid.0 == entity_id {
            ev.0 = visible;
            return Ok(());
        }
    }
    Err(format!("Entity not found: {}", entity_id))
}
