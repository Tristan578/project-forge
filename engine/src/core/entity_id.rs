//! Entity identification components for bridge communication.
//!
//! Every selectable entity needs a stable ID that survives across frames
//! and can be serialized to JSON for React communication.

use bevy::prelude::*;
use uuid::Uuid;

/// Stable identifier for entities, used in bridge communication.
/// This ID persists across frames and is used to reference entities from React.
#[derive(Component, Clone, Debug, Reflect)]
pub struct EntityId(pub String);

impl Default for EntityId {
    fn default() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl EntityId {
    /// Create a new EntityId with a specific value.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Get the string ID.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Human-readable name for the entity, displayed in the scene hierarchy.
#[derive(Component, Clone, Debug, Default, Reflect)]
pub struct EntityName(pub String);

impl EntityName {
    /// Create a new EntityName.
    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    /// Get the name string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Controls entity visibility in the viewport.
/// Syncs with Bevy's Visibility component via the visibility system.
#[derive(Component, Clone, Debug, Reflect)]
pub struct EntityVisible(pub bool);

impl Default for EntityVisible {
    fn default() -> Self {
        Self(true)
    }
}

impl EntityVisible {
    /// Create visible entity.
    pub fn visible() -> Self {
        Self(true)
    }

    /// Create hidden entity.
    pub fn hidden() -> Self {
        Self(false)
    }

    /// Check if visible.
    pub fn is_visible(&self) -> bool {
        self.0
    }

    /// Toggle visibility.
    pub fn toggle(&mut self) {
        self.0 = !self.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- EntityId ---

    #[test]
    fn entity_id_default_produces_unique_uuids() {
        let id1 = EntityId::default();
        let id2 = EntityId::default();
        assert_ne!(id1.0, id2.0, "default EntityId values must be unique UUIDs");
    }

    #[test]
    fn entity_id_default_is_valid_uuid_format() {
        let id = EntityId::default();
        // UUID v4: 8-4-4-4-12 hex chars separated by '-'
        let parts: Vec<&str> = id.0.split('-').collect();
        assert_eq!(parts.len(), 5, "UUID should have 5 parts: {}", id.0);
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 4);
        assert_eq!(parts[4].len(), 12);
    }

    #[test]
    fn entity_id_new_stores_given_value() {
        let id = EntityId::new("my-custom-id");
        assert_eq!(id.as_str(), "my-custom-id");
    }

    // --- EntityName ---

    #[test]
    fn entity_name_new_stores_value() {
        let name = EntityName::new("TestEntity");
        assert_eq!(name.as_str(), "TestEntity");
    }

    #[test]
    fn entity_name_default_is_empty() {
        let name = EntityName::default();
        assert_eq!(name.as_str(), "");
    }

    // --- EntityVisible ---

    #[test]
    fn entity_visible_default_is_true() {
        let vis = EntityVisible::default();
        assert!(vis.is_visible());
    }

    #[test]
    fn entity_visible_toggle_flips_state() {
        let mut vis = EntityVisible::visible();
        assert!(vis.is_visible());
        vis.toggle();
        assert!(!vis.is_visible());
        vis.toggle();
        assert!(vis.is_visible());
    }

    #[test]
    fn entity_visible_hidden_constructor() {
        let vis = EntityVisible::hidden();
        assert!(!vis.is_visible());
    }
}
