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
}
