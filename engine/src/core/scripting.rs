//! Script data component for entity scripting.
//!
//! Stores TypeScript source code on entities. All execution happens in JS.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Script data attached to an entity.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptData {
    pub source: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}
