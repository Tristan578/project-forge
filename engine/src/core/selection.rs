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

/// Message fired when selection changes, used to trigger bridge events.
#[derive(Message)]
pub struct SelectionChangedEvent {
    pub selected_ids: Vec<String>,
    pub primary_id: Option<String>,
    pub primary_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::prelude::Entity;

    /// Helper: create a synthetic Bevy Entity for tests.
    /// Entity::from_bits encodes index + generation into a u64.
    fn entity(index: u32) -> Entity {
        Entity::from_bits((index as u64) | (1u64 << 32))
    }

    #[test]
    fn select_one_clears_previous_and_sets_primary() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.select_one(entity(2), "e2".to_string());

        assert_eq!(sel.count(), 1);
        assert!(sel.is_selected(entity(2)));
        assert!(!sel.is_selected(entity(1)));
        assert_eq!(sel.primary_id.as_deref(), Some("e2"));
    }

    #[test]
    fn add_accumulates_entities() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.add(entity(2), "e2".to_string());

        assert_eq!(sel.count(), 2);
        assert!(sel.is_selected(entity(1)));
        assert!(sel.is_selected(entity(2)));
        // Primary should be the last added
        assert_eq!(sel.primary_id.as_deref(), Some("e2"));
    }

    #[test]
    fn remove_decrements_count() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.add(entity(2), "e2".to_string());
        sel.remove(entity(1), "e1");

        assert_eq!(sel.count(), 1);
        assert!(!sel.is_selected(entity(1)));
        assert!(sel.is_selected(entity(2)));
    }

    #[test]
    fn remove_primary_updates_primary() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.add(entity(2), "e2".to_string());
        // Primary is e2; remove it
        sel.remove(entity(2), "e2");

        // Primary should now be the remaining entity (e1)
        assert!(sel.primary.is_some());
        assert_ne!(sel.primary_id.as_deref(), Some("e2"));
    }

    #[test]
    fn toggle_adds_when_not_selected() {
        let mut sel = Selection::default();
        sel.toggle(entity(1), "e1".to_string());
        assert_eq!(sel.count(), 1);
        assert!(sel.is_selected(entity(1)));
    }

    #[test]
    fn toggle_removes_when_already_selected() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.toggle(entity(1), "e1".to_string());
        assert_eq!(sel.count(), 0);
        assert!(!sel.is_selected(entity(1)));
    }

    #[test]
    fn clear_removes_all() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.add(entity(2), "e2".to_string());
        sel.clear();

        assert!(sel.is_empty());
        assert_eq!(sel.count(), 0);
        assert!(sel.primary.is_none());
        assert!(sel.primary_id.is_none());
    }

    #[test]
    fn is_selected_returns_false_for_unselected() {
        let sel = Selection::default();
        assert!(!sel.is_selected(entity(99)));
    }

    #[test]
    fn is_id_selected_works() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        assert!(sel.is_id_selected("e1"));
        assert!(!sel.is_id_selected("e2"));
    }

    #[test]
    fn is_empty_on_default() {
        let sel = Selection::default();
        assert!(sel.is_empty());
    }

    #[test]
    fn selected_ids_returns_all_ids() {
        let mut sel = Selection::default();
        sel.select_one(entity(1), "e1".to_string());
        sel.add(entity(2), "e2".to_string());
        let mut ids = sel.selected_ids();
        ids.sort();
        assert_eq!(ids, vec!["e1", "e2"]);
    }
}
