//! Project type configuration for 2D vs 3D mode.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Determines whether the project is 2D or 3D.
/// This affects camera setup, entity spawning defaults, and inspector behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Resource)]
pub enum ProjectType {
    TwoD,
    ThreeD,
}

impl Default for ProjectType {
    fn default() -> Self {
        Self::ThreeD
    }
}
