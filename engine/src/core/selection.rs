//! Selection system for entity picking.
//!
//! Supports multi-selection with primary/secondary distinction.
//! Primary selection is the last clicked entity, used for Inspector focus.

use bevy::prelude::*;
use std::collections::HashSet;

/// Currently selected entities (supports multi-selection).
#[derive(Resource, Default, Debug)]
pub struct Selection {
    /// All selected entities (Bevy Entity handles).
    pub entities: HashSet<Entity>,
    /// All selected entity IDs (String IDs for bridge communication).
    pub entity_ids: HashSet<String>,
    /// Primary selection (last clicked, used for Inspector focus).
    pub primary: Option<Entity>,
    /// Primary entity ID for bridge communication.
    pub primary_id: Option<String>,
}

impl Selection {
    /// Select a single entity, clearing previous selection.
    pub fn select_one(&mut self, entity: Entity, id: String) {
        self.entities.clear();
        self.entity_ids.clear();
        self.entities.insert(entity);
        self.entity_ids.insert(id.clone());
        self.primary = Some(entity);
        self.primary_id = Some(id);
    }

    /// Add entity to selection (Ctrl+Click behavior).
    pub fn add(&mut self, entity: Entity, id: String) {
        self.entities.insert(entity);
        self.entity_ids.insert(id.clone());
        self.primary = Some(entity);
        self.primary_id = Some(id);
    }

    /// Remove entity from selection (Ctrl+Click on already selected).
    pub fn remove(&mut self, entity: Entity, id: &str) {
        self.entities.remove(&entity);
        self.entity_ids.remove(id);
        // Update primary if we removed it
        if self.primary == Some(entity) {
            self.primary = self.entities.iter().next().copied();
            self.primary_id = self.entity_ids.iter().next().cloned();
        }
    }

    /// Toggle entity selection (Ctrl+Click).
    pub fn toggle(&mut self, entity: Entity, id: String) {
        if self.entities.contains(&entity) {
            self.remove(entity, &id);
        } else {
            self.add(entity, id);
        }
    }

    /// Clear all selections.
    pub fn clear(&mut self) {
        self.entities.clear();
        self.entity_ids.clear();
        self.primary = None;
        self.primary_id = None;
    }

    /// Check if entity is selected.
    pub fn is_selected(&self, entity: Entity) -> bool {
        self.entities.contains(&entity)
    }

    /// Check if entity ID is selected.
    pub fn is_id_selected(&self, id: &str) -> bool {
        self.entity_ids.contains(id)
    }

    /// Get count of selected entities.
    pub fn count(&self) -> usize {
        self.entities.len()
    }

    /// Check if selection is empty.
    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    /// Get all selected entity IDs as a Vec for serialization.
    pub fn selected_ids(&self) -> Vec<String> {
        self.entity_ids.iter().cloned().collect()
    }
}

/// Event fired when selection changes, used to trigger bridge events.
#[derive(Event)]
pub struct SelectionChangedEvent {
    pub selected_ids: Vec<String>,
    pub primary_id: Option<String>,
    pub primary_name: Option<String>,
}
