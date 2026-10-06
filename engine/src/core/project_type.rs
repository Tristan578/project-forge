//! Project type configuration for 2D vs 3D mode.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Determines whether the project is 2D or 3D.
/// This affects camera setup, entity spawning defaults, and inspector behavior.
///
/// Serialized as `"2d"` / `"3d"` — the one vocabulary shared by the
/// `set_project_type` command payload, the scene file's `metadata.projectType`
/// (#10227) and the web store's `ProjectType = '2d' | '3d'`. The Rust variant
/// names never appear on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Resource)]
pub enum ProjectType {
    #[serde(rename = "2d")]
    TwoD,
    #[serde(rename = "3d")]
    ThreeD,
}

impl Default for ProjectType {
    fn default() -> Self {
        Self::ThreeD
    }
}

impl ProjectType {
    /// The spelling the command payload, the scene file and the web store use.
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::TwoD => "2d",
            Self::ThreeD => "3d",
        }
    }

    /// Parse a wire spelling. Exactly `"2d"` or `"3d"`; anything else — a case
    /// variant, a Rust variant name, an empty string — is `None`, so a caller
    /// refuses it instead of queueing a request the engine would drop.
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "2d" => Some(Self::TwoD),
            "3d" => Some(Self::ThreeD),
            _ => None,
        }
    }

    /// Resolve one project-type request against the live resource (`self`).
    ///
    /// Returns the type the resource should hold afterwards and whether that
    /// is a change — the one case `apply_project_type_changes` switches the
    /// cameras for. `Some(t)` asks for `t`; `None` asks for nothing and leaves
    /// the resource as it is. `None` is what `load_scene` queues for a scene
    /// file with no `metadata.projectType` (#10227): a scene saved before the
    /// field existed INHERITS the session's dimension instead of forcing 3D,
    /// so switching to such a scene in a 2D project keeps the 2D camera. A
    /// fresh engine starts at [`ProjectType::default`] (3D), which is how a
    /// cold open of the same scene still comes up 3D.
    ///
    /// Pure, so the rule is unit-tested natively although the system that
    /// applies it lives in the wasm32-only bridge.
    pub fn apply_request(self, requested: Option<ProjectType>) -> (ProjectType, bool) {
        match requested {
            Some(new_type) if new_type != self => (new_type, true),
            _ => (self, false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectType;

    #[test]
    fn default_is_3d() {
        // Every scene saved before the type was persisted has no say in the
        // matter, and the 3D camera is the one the engine spawns on its own.
        assert_eq!(ProjectType::default(), ProjectType::ThreeD);
    }

    #[test]
    fn wire_names_round_trip_through_from_wire() {
        for variant in [ProjectType::TwoD, ProjectType::ThreeD] {
            assert_eq!(ProjectType::from_wire(variant.wire_name()), Some(variant));
        }
        assert_eq!(ProjectType::TwoD.wire_name(), "2d");
        assert_eq!(ProjectType::ThreeD.wire_name(), "3d");
    }

    #[test]
    fn from_wire_refuses_every_other_spelling() {
        // The command and the scene file share ONE vocabulary with the web
        // store's `ProjectType = '2d' | '3d'`. Case variants and the Rust
        // variant names are not part of it: nothing has ever written them.
        for bad in ["2D", "3D", "TwoD", "ThreeD", "twod", "2", "", " 2d"] {
            assert_eq!(ProjectType::from_wire(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn serde_spelling_is_the_wire_name() {
        // The scene file's `metadata.projectType` is this enum serialized, so
        // the JSON spelling MUST be the same `"2d"` / `"3d"` the
        // `set_project_type` command takes — one vocabulary, not two.
        assert_eq!(serde_json::to_string(&ProjectType::TwoD).unwrap(), "\"2d\"");
        assert_eq!(serde_json::to_string(&ProjectType::ThreeD).unwrap(), "\"3d\"");
        assert_eq!(
            serde_json::from_str::<ProjectType>("\"2d\"").unwrap(),
            ProjectType::TwoD
        );
        assert_eq!(
            serde_json::from_str::<ProjectType>("\"3d\"").unwrap(),
            ProjectType::ThreeD
        );
        // The derive's own variant names were never written anywhere, so they
        // are not accepted either: a file carrying one is malformed, not legacy.
        assert!(serde_json::from_str::<ProjectType>("\"TwoD\"").is_err());
        assert!(serde_json::from_str::<ProjectType>("\"ThreeD\"").is_err());
    }

    #[test]
    fn apply_request_applies_some_and_leaves_none_alone() {
        // `Some` of a different type is a change (the cameras switch); `Some`
        // of the current type is not; `None` — a scene file with no
        // `metadata.projectType` — changes nothing, whatever the session is
        // in. That last row is the absent-aware rule: a key-less scene
        // inherits the session's dimension instead of forcing 3D, so a second
        // scene created in a 2D project, or a pre-#10227 save switched to
        // mid-session, keeps the 2D camera.
        assert_eq!(ProjectType::ThreeD.apply_request(Some(ProjectType::TwoD)), (ProjectType::TwoD, true));
        assert_eq!(ProjectType::TwoD.apply_request(Some(ProjectType::ThreeD)), (ProjectType::ThreeD, true));
        assert_eq!(ProjectType::TwoD.apply_request(Some(ProjectType::TwoD)), (ProjectType::TwoD, false));
        assert_eq!(ProjectType::ThreeD.apply_request(Some(ProjectType::ThreeD)), (ProjectType::ThreeD, false));
        for current in [ProjectType::TwoD, ProjectType::ThreeD] {
            assert_eq!(current.apply_request(None), (current, false), "{current:?}: None must not move the resource");
        }
    }

    #[test]
    fn a_fresh_engine_opens_a_key_less_scene_as_3d_because_it_starts_there() {
        // The migration rule for a cold open holds through the DEFAULT, not
        // through the loader: a key-less scene resolves to whatever the
        // session has, and a fresh session has `ProjectType::default()`.
        assert_eq!(ProjectType::default().apply_request(None), (ProjectType::ThreeD, false));
    }
}
