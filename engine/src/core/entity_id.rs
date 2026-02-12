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
